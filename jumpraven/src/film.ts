/**
 * A film played the way Lunicus's player plays one (lunicus/src/game/film.ts,
 * after LUNICUS.EXE 0x40e038): in its own palette, a frame held for its hold
 * in ticks of 1/60 s, a frame with the wait-sound bit held until its sound has
 * finished, and a chain followed by name. RAVEN.EXE has not been read yet, so
 * this is Lunicus's reading applied to the same format, and all the prototype
 * uses it for is the intro. Hotspots are not acted on: the intro has none.
 *
 * A click or Esc ends the film, and its chain with it.
 */
import { FrameBuffer, decodeFrame } from "@dreamfactory/engine/df/image";
import { FLAG_WAIT_SOUND, nextFrameV0, paletteV0, readMovFileV0 } from "@dreamfactory/engine/df/mov-v0";
import { V0_BLOCK_SAMPLES, decodeAudioV0, type DecodedAudio } from "@dreamfactory/engine/df/audio";

/** one tick of the clock; a generator yields once per tick */
export type Co<T = void> = Generator<void, T, void>;

export interface FilmHost {
  /** a film's bytes by the game's name for it (`intro2.move`), or null if not read yet */
  film(name: string): Uint8Array | null;
  /** the picture, 512x384 indexed, and the palette it is drawn in */
  show(pixels: Uint8Array, width: number, height: number, top: number, left: number, palette: Uint8ClampedArray): void;
  play(audio: DecodedAudio): void;
  stopSound(): void;
  soundBusy(): boolean;
  /** a click or Esc since the last ask */
  skipped(): boolean;
  log(line: string): void;
  where(line: string): void;
}

/**
 * The block count in front of a v0 sound, in whichever byte order makes the
 * v40 stream behind it end on the container's last byte.
 *
 * Lunicus's own sounds are all little-endian. Jump Raven's films carry sounds
 * of both orders — 60 of the 502 distinct frame sounds in the rip store the
 * count big-endian (`00 24` for 36 blocks), and so do the previews' demo films
 * in Lunicus's rip. The v40 stream is the same either way: only the count moved,
 * which is what a Macintosh-authored sound put into a PC file would do.
 */
function blockCount(d: Uint8Array): number {
  let p = 3;
  let n = 1;
  while (p < d.length) {
    const b = d[p++];
    if (!(b & 0x80)) n++;
    else if (!(b & 0x40)) {
      const k = (b & 0x3f) + 1;
      p += k;
      n += 2 * k;
    } else n += (b & 0x3f) + 1;
  }
  const le = d[0] | (d[1] << 8);
  const be = (d[0] << 8) | d[1];
  if (p === d.length && n === be * V0_BLOCK_SAMPLES && n !== le * V0_BLOCK_SAMPLES) return be;
  return le;
}

export function soundV0(data: Uint8Array): DecodedAudio {
  const blocks = blockCount(data);
  if (blocks === (data[0] | (data[1] << 8))) return decodeAudioV0(data);
  const copy = data.slice();
  copy[0] = blocks & 0xff;
  copy[1] = blocks >> 8;
  return decodeAudioV0(copy);
}

/** one film and every film it chains to; answers the name it stopped on */
export function* playFilm(host: FilmHost, first: string): Co<string> {
  let name = first;
  for (let guard = 0; guard < 16; guard++) {
    let data = host.film(name);
    while (!data) {
      yield;
      data = host.film(name);
    }
    const film = readMovFileV0(data);
    host.log(`▶ ${name} — ${film.frames.length} frames`);
    const palette = paletteV0(film.paletteRaw);
    const fb = new FrameBuffer();
    let decoded = -1;
    let index = 0;
    let chain = "";
    while (index >= 0 && index < film.frames.length) {
      const frame = film.frames[index];
      host.where(`${name} · frame ${index + 1} of ${film.frames.length}`);
      if (decoded !== frame.picture) {
        decodeFrame(film.file.containers[frame.picture].data, fb);
        host.show(fb.pixels, film.width, film.height, film.top, film.left, palette);
        decoded = frame.picture;
      }
      if (frame.sound && film.file.containers[frame.sound]) host.play(soundV0(film.file.containers[frame.sound].data));
      const hold = Math.max(frame.holdTicks, film.framerate);
      for (let t = 0; t < hold; t++) {
        if (host.skipped()) return host.stopSound(), name;
        yield;
      }
      if (frame.flags & FLAG_WAIT_SOUND) {
        while (host.soundBusy()) {
          if (host.skipped()) return host.stopSound(), name;
          yield;
        }
      }
      const next = nextFrameV0(film, index);
      if (next < 0 && frame.action === 3) chain = frame.chainTo;
      index = next;
    }
    if (!chain) return name;
    host.log(`  chains to ${chain}`);
    name = chain;
  }
  return name;
}
