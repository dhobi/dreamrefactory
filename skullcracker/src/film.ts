/**
 * One film on screen — the page's own player, and both pages use it.
 *
 * `engine/src/web/movie-player.ts` is the engine's implementation and the tested
 * one, but it takes a `GameSession`, which this game has not got: no BOOTFILE, no
 * `.SET`, no script to suspend. So this is the same format read again with the
 * same helpers — `segmentInterval`, `frameHoldMs`, `segmentAudio`,
 * `soundtrackFor` — and nothing of the format's logic is duplicated, only the
 * loop around it.
 *
 * It lives here rather than in `main.ts` because the walk page needs it too: the
 * chapter films play between levels and the four TIME films when the mission
 * clock runs out, and those are the same films the films page plays. Everything
 * a page has to supply — where the pixels go, where the words go, what a chain
 * and an ending mean — is the {@link FilmHost} it is handed.
 */
import { MovFile, MovSegment, MovClickRegion } from "@dreamfactory/engine/df/mov";
import { FrameBuffer, decodeFrame, paletteToRGBA } from "@dreamfactory/engine/df/image";
import { segmentInterval, frameHoldMs, TICK_MS } from "@dreamfactory/engine/df/mov-pace";
import { segmentAudio, soundtrackFor } from "@dreamfactory/engine/df/mov-sound";
import { decodeAudioContainer } from "@dreamfactory/engine/df/audio";
import { AudioSink, PlayHandle } from "@dreamfactory/engine/runtime/audio";

/** what a page has to give a film: a screen, a log, and the two exits */
export interface FilmHost {
  /** the bed and the event sounds go here — a deferred sink is fine */
  audio: AudioSink;
  /** put one decoded frame on screen at the origin its segment carries */
  paint(
    pixels: Uint8Array,
    width: number,
    height: number,
    palette: Uint8ClampedArray,
    originX: number,
    originY: number,
  ): void;
  /** a line for whatever the page shows its workings in */
  log(message: string): void;
  /** the film's own data says to chain to another film */
  onChain(movie: string): void;
  /** this film is over, and which frame it ended ON */
  onEnd(lastFrame: string): void;
}

export class Film {
  /** every frame of the current segment, decoded in order (the delta chain) */
  private pictures: { pixels: Uint8Array; width: number; height: number }[] = [];
  private palette: Uint8ClampedArray;
  private seg: MovSegment;
  private segIdx = 0;
  /** ms per frame; 0 = this film advances only on a click */
  private interval = 0;
  private pos = 0;
  /** when the frame on screen is due to give way */
  private dueAt = 0;
  private bed: PlayHandle | null = null;
  private byName = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly mov: MovFile,
    private readonly host: FilmHost,
  ) {
    this.seg = mov.segments[0];
    this.palette = paletteToRGBA(this.seg.paletteRaw, 256, mov.file.order);
    this.enterSegment(0, performance.now());
  }

  /** the regions of the frame on screen — empty unless it is waiting for a click */
  get waiting(): readonly MovClickRegion[] {
    const f = this.seg.frames[this.pos];
    if (!f || f.playsThroughRegions) return [];
    return f.regions;
  }

  get where(): string {
    const f = this.seg.frames[this.pos];
    return `${this.name} · segment ${this.segIdx + 1}/${this.mov.segments.length} · frame ${this.pos + 1}/${this.seg.frames.length}${f ? ` "${f.name}"` : ""}`;
  }

  private enterSegment(idx: number, now: number): void {
    this.segIdx = idx;
    this.seg = this.mov.segments[idx];
    this.palette = paletteToRGBA(this.seg.paletteRaw, 256, this.mov.file.order);
    this.byName.clear();
    this.seg.frames.forEach((f, i) => this.byName.set(f.name.toLowerCase(), i));

    // Decode the whole segment up front, in order and into one FrameBuffer:
    // the codec is a delta chain, so frame N only exists once frames 0..N-1 have
    // been decoded on top of each other. This is what the engine's player does
    // too — the memory is the price of the format.
    const fb = new FrameBuffer();
    this.pictures = this.seg.frames.map((f) => {
      const d = decodeFrame(this.mov.file.containers[f.locationFrame].data, fb, this.mov.file.order);
      return { pixels: fb.pixels.slice(0, d.width * d.height), width: d.width, height: d.height };
    });

    // the bed, and the pacing that depends on how long it is
    const sound = segmentAudio(this.seg);
    this.interval = segmentInterval(this.seg, this.seg.frames.length, sound?.audioSec ?? 0, idx);
    this.bed?.stop();
    this.bed = null;
    if (sound) {
      const track = soundtrackFor(this.seg, sound, this.interval, this.seg.frames.length);
      this.bed = this.host.audio.play(
        "theme",
        { sampleRate: track.sampleRate, samples: track.samples },
        { loop: track.loop },
      );
    }
    this.pos = 0;
    this.dueAt = now + this.holdMs(0);
    this.draw();
  }

  /** how long frame `i` is held: its own authored hold, floored by the film's */
  private holdMs(i: number): number {
    const authored = frameHoldMs(this.seg, i);
    const floor = Math.max(this.interval, this.seg.minHoldTicks * TICK_MS);
    return Math.max(authored, floor);
  }

  private draw(): void {
    const p = this.pictures[this.pos];
    if (!p) return;
    this.host.paint(p.pixels, p.width, p.height, this.palette, this.seg.originX, this.seg.originY);
  }

  /**
   * Advance the clock. Called once per animation frame.
   *
   * A frame WITH regions and without the play-through flag waits here
   * indefinitely — that is the menu sitting and waiting to be clicked, and it is
   * the movie format's own idea of modality rather than this page's.
   */
  tick(now: number): void {
    if (this.waiting.length) return;
    if (!this.interval && !this.seg.frames[this.pos]?.type) return;
    if (now < this.dueAt) return;
    this.act(this.seg.frames[this.pos]?.type ?? 6, this.seg.frames[this.pos], now);
  }

  /**
   * Is a waiting region under this point — the hit test without the click.
   *
   * Its own method rather than a flag threaded through {@link click}, because the
   * touch recogniser has to ask BEFORE it knows whether the finger is a tap:
   * a region presses at once and the bare picture waits (see the hooks below).
   */
  owns(x: number, y: number): boolean {
    return this.waiting.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
  }

  /** a click at a point on the 512x384 screen — does a region own it? */
  click(x: number, y: number, now: number): boolean {
    for (const r of this.waiting) {
      if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
      if (r.sound) this.playEvent(r.sound);
      this.act(r.type, r, now);
      return true;
    }
    return false;
  }

  /** ESC, where the film's own header flag allows it */
  skip(): boolean {
    if (!this.seg.keySkips) return false;
    this.finish();
    return true;
  }

  /** a named one-shot out of the film's own chunk table */
  private playEvent(name: string): void {
    const loc = this.seg.sounds.get(name.toLowerCase());
    if (loc === undefined) return;
    this.host.audio.play(
      "sound",
      decodeAudioContainer(this.mov.file.containers[loc].data, this.mov.file.order),
    );
  }

  /**
   * One of the seven actions a frame or a region can carry — the table in
   * `engine/src/df/mov.ts`'s module comment, minus the call/return pair.
   *
   * 4 and 5 (push this film and chain out, then pop back) are not implemented
   * and say so rather than misbehaving: no film in this rip uses either, and a
   * return stack that has never been exercised against real data would be
   * fiction. Everything the menu and the chapter films actually do is here.
   */
  private act(type: number, from: { event?: string; target?: string } | undefined, now: number): void {
    const advance = (to: number): void => {
      this.pos = Math.max(0, Math.min(to, this.seg.frames.length - 1));
      this.dueAt = now + this.holdMs(this.pos);
      this.draw();
    };
    switch (type) {
      case 1:
        // A type-1 exit ends the SEGMENT, and the film only if it is the last —
        // `engine/src/df/mov.ts` says so and `engine/src/web/movie-player.ts`
        // (`endSegment`) is the tested implementation of it. Ending the film here
        // instead, which this player did, made every multi-segment film on the
        // disc stop at its first exit: `BOGGS01.MOV` after ONE frame of its
        // seven segments, `TIME1.MOV` after three of its four.
        this.endSegment(now);
        return;
      case 2: { // go to the named frame
        const to = this.byName.get((from?.target ?? "").toLowerCase());
        if (to === undefined) {
          this.host.log(`${this.name}: frame "${from?.target}" not found — exiting`);
          this.finish();
          return;
        }
        advance(to);
        return;
      }
      case 3: // exit and chain to another film
        this.finish();
        if (from?.event) this.host.onChain(from.event);
        return;
      case 7: // step back one
        advance(this.pos - 1);
        return;
      case 4:
      case 5:
        this.host.log(`${this.name}: action ${type} (call/return) is not implemented — advancing`);
      // fall through
      case 6:
      default: // advance one, and run off the end
        if (this.pos + 1 >= this.seg.frames.length) {
          this.endSegment(now);
          return;
        }
        advance(this.pos + 1);
    }
  }

  /** the next segment of the chain, or the end of the film if none follows */
  private endSegment(now: number): void {
    if (this.segIdx + 1 < this.mov.segments.length) this.enterSegment(this.segIdx + 1, now);
    else this.finish();
  }

  /**
   * End the film, saying which frame it ended ON.
   *
   * That is the whole of a DreamFactory menu's return value. `menu.mov` has no
   * script and fires no event: its six buttons are type-2 jumps to six one-frame
   * "frame 2".."frame 7" at the tail of the same film, each of which is a type-1
   * EXIT. The executable that owned this film read the frame it stopped on and
   * did the rest — which is why the name has to come out of here rather than the
   * exit being just an exit.
   */
  finish(): void {
    this.bed?.stop();
    this.bed = null;
    const last = this.seg.frames[this.pos]?.name ?? "";
    this.host.onEnd(last);
  }
}