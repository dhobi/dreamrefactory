/**
 * Audio container decoding — port of DFfile::audioDecoder_v40 / _v41 and
 * the AudioBlockInfos bank structure (dfet DFfile.cpp / DFfile.h).
 *
 * Sound container layout: i32 0x00010000 magic, codec flag i16 @0x1A
 * (1 = v40 8-bit, 2 = v41 16-bit), sample rate i32 @28, uncompressed byte
 * size i32 @36, data start offset i32 @44.
 *
 * The way back — {@link encodeAudioContainer}, for the track editor's WAV
 * import — is at the bottom of this file.
 */

export interface DecodedAudio {
  sampleRate: number;
  /** mono samples in [-1, 1] */
  samples: Float32Array;
}

/** chunk-header fields the reader interprets — and the writer patches */
const MAGIC = 0x00010000;
const OFF_CODEC = 0x1a;
const OFF_RATE = 28;
const OFF_SIZE = 36;
const OFF_DATA_START = 44;
/** the smallest header the writer will synthesize when there is no template */
const MIN_HEADER = 48;

/** v40 codec step tables (256 entries each), as in the original engine */
const STEP_SIZE = new Int8Array(256);
const INDEX_TAB = new Int8Array(256);
for (let i = 0; i < 256; i++) {
  // step: 16 entries each of 0..7, then -8..-1 (sign-extended nibble of i>>4)
  const hi = i >> 4;
  STEP_SIZE[i] = hi < 8 ? hi : hi - 16;
  // index: repeating 0..7, -8..-1 (sign-extended nibble of i&0xf)
  const lo = i & 0x0f;
  INDEX_TAB[i] = lo < 8 ? lo : lo - 16;
}

/**
 * Linearly resample PCM from one rate to another.
 *
 * The game mixes rates INSIDE a single file: the loop chunks of one bank, or
 * the soundtrack segments of one movie, are not all recorded at the same rate,
 * and the split differs per language — `bedrad1.trk`, the bedsit radio, is two
 * chunks of 11025 among thirteen of 22050 in English and nine among fifteen in
 * German. Anything that joins chunks end to end has to bring them to a common
 * rate first, because a buffer can only be played at one: an 11025 chunk left
 * at 22050 plays at double speed, which is what the German radio voice did.
 */
export function resampleTo(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const ratio = to / from;
  const out = new Float32Array(Math.max(1, Math.round(samples.length * ratio)));
  for (let i = 0; i < out.length; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const f = src - i0;
    out[i] = samples[i0] * (1 - f) + samples[i1] * f;
  }
  return out;
}

/** what a sound container's header says about itself, before decoding it */
export interface AudioChunkHeader {
  /** 1 = v40 (8-bit), otherwise v41 (16-bit) */
  codec: number;
  sampleRate: number;
  /** uncompressed size in bytes: v40 samples are 8-bit, v41 samples 16-bit */
  byteSize: number;
  dataStart: number;
}

/** null when the bytes are not a sound container — the editor's probe */
export function readAudioHeader(data: Uint8Array): AudioChunkHeader | null {
  if (data.length < MIN_HEADER) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getInt32(0, true) !== MAGIC) return null;
  return {
    codec: view.getInt16(OFF_CODEC, true),
    sampleRate: view.getInt32(OFF_RATE, true),
    byteSize: view.getInt32(OFF_SIZE, true),
    dataStart: view.getInt32(OFF_DATA_START, true),
  };
}

export function decodeAudioContainer(data: Uint8Array): DecodedAudio {
  const header = readAudioHeader(data);
  if (!header) {
    throw new Error("audio container: bad magic");
  }
  const { codec, sampleRate, byteSize, dataStart } = header;

  if (codec === 1) {
    return { sampleRate, samples: decodeV40(data, dataStart, byteSize) };
  }
  return { sampleRate, samples: decodeV41(data, dataStart, byteSize) };
}

/** wrap to signed 8-bit, the original decoder's arithmetic space */
const i8 = (n: number): number => (n << 24) >> 24;

/** 8-bit codec: literal / step-pair / repeat modes, output centred at 0x40 */
function decodeV40(data: Uint8Array, start: number, byteSize: number): Float32Array {
  const out = new Float32Array(byteSize);
  // decode in int8 space exactly like the original, convert at the end
  const raw = new Int8Array(byteSize + 2); // slack: mode II writes pairs
  let inPos = start;
  let outPos = 0;

  let next = i8(data[inPos++]);
  raw[outPos++] = next + 0x40;
  let prev = next;

  while (outPos < byteSize) {
    next = i8(data[inPos++]);
    if ((next & 0x80) === 0) {
      raw[outPos++] = next + 0x40;
      prev = next;
    } else if ((next & 0x40) === 0) {
      // step-table pairs; low bits encode count-1, like the repeat mode below
      const pairs = (next & 0x3f) + 1;
      for (let i = 0; i < pairs; i++) {
        const b = data[inPos++];
        const step = i8(prev + STEP_SIZE[b]);
        const index = i8(step + INDEX_TAB[b]);
        raw[outPos++] = i8(step + 0x40);
        raw[outPos++] = i8(index + 0x40);
        prev = index;
      }
    } else {
      // repeat previous
      const count = (next & 0x3f) + 1;
      const v = i8(prev + 0x40);
      for (let i = 0; i < count; i++) raw[outPos++] = v;
    }
  }
  // raw holds unsigned-8-style values in int8 space: reinterpret as u8, centre 128
  for (let i = 0; i < byteSize; i++) out[i] = ((raw[i] & 0xff) - 128) / 128;
  return out;
}

/**
 * The v41 alphabet: one byte per sample, the high bit selecting which of the
 * two forms it is. Both scale the low 7 bits read as a two's-complement 7-bit
 * number (0x40 and up being the negative half) — which is what
 * `sign-extend (b << 9) as i16` comes to, delta then shifted down by 4:
 *
 *   0x00..0x7f  delta    — multiples of 32 in [-2048, 2016]
 *   0x80..0xff  absolute — multiples of 512 in [-32768, 32256]
 */
const v41Delta = (b: number): number => (b < 0x40 ? b : b - 0x80) * 32;
const v41Absolute = (b: number): number => {
  const n = b & 0x7f;
  return (n < 0x40 ? n : n - 0x80) * 512;
};

/** 16-bit codec: high bit selects delta vs absolute, 9-bit shifted */
function decodeV41(data: Uint8Array, start: number, byteSize: number): Float32Array {
  const numSamples = byteSize >> 1;
  const out = new Float32Array(numSamples);
  let current = 0;
  for (let i = 0; i < numSamples; i++) {
    const b = data[start + i];
    // the sum wraps as an i16, as the original decoder's register did
    current = (b & 0x80) === 0 ? ((current + v41Delta(b)) << 16) >> 16 : v41Absolute(b);
    out[i] = current / 32768;
  }
  return out;
}

/**
 * Encode samples with the v41 codec: for each sample take the closer of the
 * nearest reachable delta and the nearest absolute value, which is what makes
 * this lossy — a waveform is tracked in steps of 32 (of 32768) and re-anchored
 * whenever a jump outruns them. `current` is kept inside the i16 range the
 * decoder wraps at, so a loud passage never wraps to the opposite rail.
 */
export function encodeV41(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length);
  let current = 0;
  for (let i = 0; i < samples.length; i++) {
    const target = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768)));

    // nearest delta: rounding can overshoot the i16 rails by up to 16, and the
    // decoder would wrap there, so step back one notch when it does
    let d = Math.max(-0x40, Math.min(0x3f, Math.round((target - current) / 32)));
    while (d !== 0 && (current + d * 32 > 32767 || current + d * 32 < -32768)) d -= Math.sign(d);
    const viaDelta = current + d * 32;

    // nearest absolute
    const a = Math.max(-0x40, Math.min(0x3f, Math.round(target / 512)));
    const viaAbsolute = a * 512;

    if (Math.abs(viaDelta - target) <= Math.abs(viaAbsolute - target)) {
      out[i] = d & 0x7f;
      current = viaDelta;
    } else {
      out[i] = 0x80 | (a & 0x7f);
      current = viaAbsolute;
    }
  }
  return out;
}

/**
 * Pack decoded samples back into a sound container — the import path of the
 * track editor (editors/tracks.html). Always writes the v41 codec (the v40 literal
 * mode reaches only half the sample range, so it is a decoder-only format
 * here); a bank may mix codecs, since the flag is per chunk.
 *
 * `template` is the container being replaced: its header is kept verbatim
 * apart from the fields this format layer knows — codec, sample rate,
 * uncompressed size — so whatever else a shipped header carries survives the
 * round trip. A header i32 that held the OLD compressed length is rewritten to
 * the new one: which field that is (if any) isn't known, but a stale length is
 * the one wrong answer we can rule out. Without a template a minimal 48-byte
 * header is synthesized.
 */
export function encodeAudioContainer(audio: DecodedAudio, template?: Uint8Array): Uint8Array {
  const payload = encodeV41(audio.samples);

  let header: Uint8Array;
  let oldPayloadLength = -1;
  const templateStart =
    template && template.length >= MIN_HEADER
      ? new DataView(template.buffer, template.byteOffset, template.byteLength).getInt32(
          OFF_DATA_START,
          true,
        )
      : -1;
  if (template && templateStart >= MIN_HEADER && templateStart <= template.length) {
    header = template.slice(0, templateStart);
    oldPayloadLength = template.length - templateStart;
  } else {
    header = new Uint8Array(MIN_HEADER);
  }

  const out = new Uint8Array(header.length + payload.length);
  out.set(header);
  out.set(payload, header.length);
  const view = new DataView(out.buffer);
  if (oldPayloadLength > 0) {
    // the i32 header slots that don't overlap a field we interpret
    for (const off of [4, 8, 12, 16, 20, 32, 40]) {
      if (view.getInt32(off, true) === oldPayloadLength) view.setInt32(off, payload.length, true);
    }
  }
  view.setInt32(0, MAGIC, true);
  view.setInt16(OFF_CODEC, 2, true);
  view.setInt32(OFF_RATE, Math.round(audio.sampleRate), true);
  view.setInt32(OFF_SIZE, audio.samples.length * 2, true);
  view.setInt32(OFF_DATA_START, header.length, true);
  return out;
}
