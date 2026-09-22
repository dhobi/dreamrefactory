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
import { segmentInterval, frameHoldMs } from "@dreamfactory/engine/df/mov-pace";
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
  /**
   * Playback reached the frame the segment header NAMES as its action frame —
   * `+0x40` for 1 and `+0x50` for 2, {@link MovSegment.actionFrame1}.
   *
   * This is how a DreamFactory film answers a question with no script: the
   * player polls "did we go through the frame called X" and the executable does
   * the rest. Skull Cracker's character chooser is the whole of it —
   * `0x449ea9` looks both names up before the film runs, `0x449fbb` compares the
   * current frame index against each, and `0x45e1e0(1 or 2)` sets `0x46b1a8`.
   * `ltpan.mov` names its frame 1 as actionframe ONE and `rtpan.mov` names its
   * frame 1 as actionframe TWO, so which way the camera pans is which player.
   */
  onAction?(which: 1 | 2): void;
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
  /**
   * The film's own one-shots, still playing — the VOICE channel of the original,
   * in the only sense this page has one.
   *
   * They are kept for two reasons: a sound belongs to the film that fired it and
   * has to die with it, and a frame may be authored to hold until they are done
   * ({@link MovSegment} `waitsForVoice`).
   */
  private events: PlayHandle[] = [];
  /** the sound a click just fired, so entering its frame does not fire it twice */
  private clickSound = "";
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

  /**
   * Which frame is on screen, counted from zero — `0x45ddd0`'s `si`.
   *
   * The menu's own per-frame handler is handed exactly this and does two things
   * with it: under 0xa8 it draws the high-score board over the film, and at
   * 0xa7 + n it jumps through the button table. So a caller that wants either
   * needs the index, not the name.
   */
  get frameIndex(): number {
    return this.pos;
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
    // ...and the FIRST frame's own sound, which is where nearly all of this
    // game's audio is. Only three films in the rip carry a loop-table bed
    // (`menu.mov` and the chapter briefings); everything else — Boggs' spoken
    // orders, the seven kill vignettes, the four time-out ones — is a one-shot
    // named by the frame that starts its segment, and this player used to fire
    // a one-shot only from a CLICKED region. `boggs01.mov` has four segments of
    // speech (`1a`…`1d`) and played all four in silence.
    this.enterFrame(0);
  }

  /** a frame is now on screen: fire the sound it names, and report the action */
  private enterFrame(idx: number): void {
    const frame = this.seg.frames[idx];
    const name = frame?.sound ?? "";
    if (name && name.toLowerCase() !== this.clickSound) this.playEvent(name);
    this.clickSound = "";
    // ...and the header's own two named frames, which is how the chooser answers
    const here = (frame?.name ?? "").toLowerCase();
    if (here && here === this.seg.actionFrame1.toLowerCase()) this.host.onAction?.(1);
    if (here && here === this.seg.actionFrame2.toLowerCase()) this.host.onAction?.(2);
  }

  /**
   * How long frame `i` is held — the film's own authored hold, and nothing else.
   *
   * `SC.EXE` computes the deadline in four instructions and consults no sound
   * anywhere in them (`0x44b7db`, the per-frame head of the movie loop):
   *
   * ```
   *   44b7db  call 0x4087c0           ; now, in ticks of 50/3 ms
   *   44b7f5  [0x4a76f4] = eax        ; the deadline is NOW...
   *   44b800  edx = [frame + 2]       ; ...plus this frame's own hold
   *   44b809  ecx = [hdr + 0x1c]      ; ...or the movie's floor
   *   44b80c  cmp edx, ecx            ; whichever is LARGER
   *   44b810  add [0x4a76f4], ecx
   *   44b818  add [0x4a76f4], edx
   * ```
   *
   * and `0x44a033` then spins on `now < [0x4a76f4]`. That is exactly
   * {@link frameHoldMs} — `max(frame.holdTicks, minHoldTicks)` — so a segment
   * that carries a BED is paced no differently from one that does not. The bed
   * is started at segment entry and plays under the picture; it does not set the
   * frame rate, and `interval` (which still says whether this film runs on the
   * clock at all, and still cuts the bed to length) must not raise a hold.
   *
   * Flooring a bed-bearing segment at {@link segmentInterval}'s rate is what
   * made the front end crawl, because every film between the title and level one
   * has one:
   *
   *     MENU.MOV    175 frames   17.10s authored   25.38s played   1.48x
   *     CHAR.MOV     63           4.72s            9.13s           1.94x
   *     LTPAN/RTPAN  59           2.95s            8.55s           2.90x
   *
   * The pans are the worst of it: 59 frames authored at the film's own 3 ticks,
   * held at the 145 ms an interactive film with sound was given, and the camera
   * took three times as long to reach the character it was panning to. It reads
   * the same way further in — a bed authored over a WHOLE film divided by its
   * FIRST segment's frames gave `MALL.MOV` 830 ms a frame, sixteen times the
   * authored rate, for a bed that covers all ten of its segments.
   *
   * The films say the same thing from the other side. Every inset segment in
   * this rip is authored at 3 ticks, 50 ms, and the one-shot over it is exactly
   * as long as the picture:
   *
   *     KILL1  seg2  186 frames x 50ms = 9.30s   "kill 8"  9.29s
   *     BOGGS01 seg2 106                = 5.30s   "1a"     5.25s
   *     BOGGS01 seg3 152                = 7.60s   "1b"     7.57s
   *     BOGGS01 seg4 127                = 6.35s   "1c"     6.32s
   *     BOGGS01 seg5 177                = 8.85s   "1d"     8.82s
   *
   * `engine/src/web/movie-player.ts` has read it this way since the same loop
   * was read in TI.EXE (`0x44b10f`, the identical pair of adds): the hold is the
   * film's, and `interval` only decides whether there is a clock at all.
   */
  private holdMs(i: number): number {
    return frameHoldMs(this.seg, i);
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
    // A frame may be authored to hold until the film has finished SPEAKING —
    // flags bit 0, `MovSegment.waitsForVoice`. Both ends of every inset film in
    // this rip are one: `kill1.mov`'s segment 0 holds its console still until
    // `soundout 3` is done, and its last segment holds before the black frame
    // until `Mon. OFF` is. With no sounds playing this waits on nothing, which
    // is exactly what it did before the sounds existed.
    if (this.seg.frames[this.pos]?.waitsForVoice && this.events.some((h) => !h.done)) return;
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
    const [lx, ly] = this.local(x, y);
    return this.waiting.some((r) => lx >= r.x0 && lx <= r.x1 && ly >= r.y0 && ly <= r.y1);
  }

  /**
   * A screen point in the SEGMENT's own coordinates, which is what a region is in.
   *
   * Every other number in a segment — the frame rects, the delta boxes — is
   * measured from the segment's origin, and the regions are no exception. It has
   * never mattered because every film in this game that has regions is a
   * full-screen one at origin (0,0): `menu.mov`, `char.mov`, the two pans, the
   * prefs panels. The four pause films are the exception and the only one — 512
   * by 232 at origin (0, 42), the interface's own window — and they are also the
   * only films whose regions are BUTTONS with words written on them, so they are
   * the only ones where being 42 pixels out is visible.
   *
   * The picture settles it. `pauseA` draws Continue, Save and Exit centred on
   * screen y160, y193 and y225; its three regions are y107-133, y141-167 and
   * y172-198. Shifted by the origin those are y149-175, y183-209 and y214-240 —
   * one label each, dead centre. Unshifted they land on the blank plates above
   * Continue and on the bezel, which is where every click on this panel went.
   */
  private local(x: number, y: number): [number, number] {
    return [x - this.seg.originX, y - this.seg.originY];
  }

  /**
   * A click at a point on the 512x384 screen — does a region own it?
   *
   * The frame's OWN regions, not {@link waiting}: a `playsThroughRegions` frame
   * (flags bit 2) does not stop for its regions, but it still honours a click
   * that has already happened — `0x44979f` reads the region count either way and
   * only the WAIT is skipped. `char.mov` is the whole reason it matters: every
   * one of its sixty-three frames sets the bit, so the chooser animates while it
   * waits, and reading `waiting` here meant the two figures could not be clicked
   * at all.
   */
  click(x: number, y: number, now: number): boolean {
    const [lx, ly] = this.local(x, y);
    for (const r of this.seg.frames[this.pos]?.regions ?? []) {
      if (lx < r.x0 || lx > r.x1 || ly < r.y0 || ly > r.y1) continue;
      if (r.sound) {
        this.playEvent(r.sound);
        this.clickSound = r.sound.toLowerCase();
      }
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
    // drop the finished ones as we go, so a long interactive film cannot pile
    // handles up for as long as it is on screen
    this.events = this.events.filter((h) => !h.done);
    this.events.push(
      this.host.audio.play(
        "sound",
        decodeAudioContainer(this.mov.file.containers[loc].data, this.mov.file.order),
      ),
    );
  }

  /**
   * One of the seven actions a frame or a region can carry — the table in
   * `engine/src/df/mov.ts`'s module comment, minus the call/return pair.
   *
   * 4 and 5 (push this film and chain out, then pop back) are not implemented
   * and say so rather than misbehaving: a return stack that has never been
   * exercised against real data would be fiction.
   *
   * That used to rest on "no film in this rip uses either", which was a reading
   * of the films that had been opened rather than of the films. It has now been
   * counted, over every `.mov` in the rip — **65 films, 18,573 frame actions and
   * 2,175 region actions** — and what is carried is:
   *
   * ```
   *   frames   1 × 257     2 × 9      3 × 4      6 × 18303
   *   regions  2 × 1999    3 × 176
   * ```
   *
   * So the disc uses four of the seven codes. 4 and 5 are absent from both
   * columns, and 7 — step back one, which IS implemented here — is absent too.
   * Writing the stack would mean writing the test data for it as well, and a
   * player that invented its own semantics for a code the game never emits is
   * worse than one that logs and advances.
   */
  private act(type: number, from: { event?: string; target?: string } | undefined, now: number): void {
    const advance = (to: number): void => {
      this.pos = Math.max(0, Math.min(to, this.seg.frames.length - 1));
      this.dueAt = now + this.holdMs(this.pos);
      this.draw();
      this.enterFrame(this.pos);
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
    for (const h of this.events) h.stop();
    this.events = [];
    const last = this.seg.frames[this.pos]?.name ?? "";
    this.host.onEnd(last);
  }
}