/**
 * The editors' sound player, one sound at a time: the track editor's chunks and
 * the shop editor's view sounds both go through it, so a ▶ plays the same way
 * on either page and a second press stops it.
 */
import type { DecodedAudio } from "@dreamfactory/engine/df/audio";

let audioCtx: AudioContext | null = null;
/** the one playback at a time, and the button showing it as stoppable */
let playing: { btn: HTMLButtonElement; stop: () => void } | null = null;

export function context(): AudioContext {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

export function stopPlayback(): void {
  playing?.stop();
  playing = null;
}

/** play one waveform, taking over the button that started it as a stop button */
export function play(audio: DecodedAudio, btn: HTMLButtonElement, loop = false): void {
  const again = playing?.btn === btn;
  stopPlayback();
  if (again || !audio.samples.length) return;

  const ctx = context();
  const buf = ctx.createBuffer(1, audio.samples.length, Math.max(3000, audio.sampleRate));
  buf.getChannelData(0).set(audio.samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  src.connect(ctx.destination);
  src.start();

  const label = btn.textContent;
  btn.textContent = "◼";
  const handle = {
    btn,
    stop: () => {
      btn.textContent = label;
      try {
        src.stop();
      } catch {
        /* already ended */
      }
    },
  };
  // only the play that is still current clears the state — a stopped source
  // fires "ended" after its successor has already started
  src.addEventListener("ended", () => {
    if (playing === handle) stopPlayback();
  });
  playing = handle;
}
