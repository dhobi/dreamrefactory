import { readContainerFile } from "../df/container";
import { RawSaveFile } from "../df/savegame";
import { SetFile, readSetFile } from "../df/set";
import { readShpFile } from "../df/shp";
import { sniffScript } from "../df/script";
import { DEFAULT_ENCODING, DfEncoding } from "../df/text";
import { parseScript } from "./parser";
import { readCstFile } from "../df/cst";
import { CallCtx, Frame, Interpreter, ScriptInstance, Value, toStr } from "./interp";
import { ActorRuntime } from "./actors";
import { PropRuntime } from "./props";
import { seededRng } from "./rng";
import { AudioLibrary, AudioSink } from "./audio";
import { Clock, ENGINE_STEP_MS, WIPE_STEP_MS, ticksAt } from "./clock";
import { EventQueue } from "./input";
import { Scheduler } from "./scheduler";
import { PuppetController } from "./puppet";
import { StageController } from "./stage";
import { FileProvider } from "./setscripts";
import { loadGame, snapshotSave } from "./saveload";
import { packPoint } from "./point";
import { registerGameBuiltins } from "./builtins";
import { BootPlan, EMPTY_BOOT_PLAN, readBootPlan } from "./bootplan";

/**
 * Most displayed frames one call may make up after a stall — a backgrounded
 * tab stops rAF, and waking up owing four minutes of them must not fire four
 * minutes of frame()-based timers in one go. Same spirit (and size) as the
 * scheduler's service-step cap.
 */
const MAX_FRAME_CATCHUP = 64;

/**
 * The loaded title's boot-level UI shops — the ones whose screen props belong on
 * top of the room view rather than only over their own overlay
 * ({@link LoadedShop.persistent}). The NAMES are TAOOT's (the interface band and
 * the inventory): one of the few pieces of game knowledge the engine still
 * carries, and a different title would need its own entries here.
 *
 * Which shops these are is a fact about the shops, so it is applied wherever one
 * of them is opened ({@link GameSession.openShop}) and not by whoever does the
 * opening. It used to be set only by {@link GameSession.loadBootResources} — the
 * port's stand-in for the full game's `boot()` — which is fine for as long as the
 * port is the only thing that ever opens them. TAOOT's 1996 demo opens them
 * itself, from its menu's `dodemo()`, and its interface band came up empty: every
 * prop visible and correctly placed, none of them drawn, because the shop they
 * live in had been opened by the game rather than on its behalf.
 */
const BOOT_UI_SHOPS = ["inven.shp", "house.shp"];

/**
 * Game-wide state that outlives individual sets: one interpreter (globals
 * persist across rooms), the boot script (the loaded title's standard library —
 * TAOOT's is ~65 helpers: changeset, progress, spotmovie, ...), the master
 * stage script (TAOOT: MAIN.STG — gotospecial etc.), audio banks and props.
 *
 * Set switching bottoms out here: the boot library's `changeset` calls the
 * engine primitives `opensetfile(name, scene, view)` / `closesetfile()`, which
 * are builtins registered by the host (SetScripts wires them to onSetChange).
 */
export class GameSession {
  readonly interp = new Interpreter();
  readonly audioLib = new AudioLibrary();
  readonly propRuntime = new PropRuntime();
  readonly actorRuntime = new ActorRuntime();

  /**
   * BOOTFILE script containers, in order. Container 1 holds the startup +
   * key-routing script, container 2 the standard library AND the default
   * event handlers (its keydown implements walking/turning via the
   * currentscene() setter). They stay separate: events traverse them in
   * order, and both are unqualified-call fallbacks.
   */
  bootScripts: ScriptInstance[] = [];
  stageScript: ScriptInstance | null = null;

  /**
   * Mutes the sendtostage→boot fallback (see sendEvent). Set by the host's
   * coldBoot around `runGlobal("boot")` so the boot()'s own closing
   * `sendtostage(...)` (TAOOT: `advanceday()`) stays inert and coldBoot performs
   * the day-advance itself, on the right state.
   */
  suppressStageBootFallback = false;

  get boot(): ScriptInstance | null {
    return this.bootScripts[0] ?? null;
  }
  private setNameNow = "none";
  get currentSetName(): string {
    return this.setNameNow;
  }
  /**
   * Setting it silences any ambience belonging to the set being left, at once.
   *
   * A `soundloop`-flagged cricket loops in place forever, and a title's scripts
   * may only ever bulk-stop crickets in one place (TAOOT: only `initall` calls
   * `stopcricket("all")`), so any other way out of a set used to leave the
   * ambience sounding — TAOOT's `advanceday` endgame arm (`closesetfile()` and
   * straight into the flats) left the boat deck's five crowd loops talking under
   * leave.mov and the whole closing narration. The scheduler silences them on its
   * next service pass, but that is not soon enough here: the endgame arm goes into
   * `playmovie` in the same script, game time stops for the movie, and the crowd
   * was still audible half a second in (measured — tests/browser/endgame.ts's
   * `sounding=[party1,party2,party4]` on the first sample after the deck closed).
   * Hanging it on the name means every path out of a set is covered by
   * construction, rather than each one having to remember.
   */
  set currentSetName(name: string) {
    if (name === this.setNameNow) return;
    this.setNameNow = name;
    // optional: this setter is declared above the `scheduler` field, so a set
    // name assigned during construction would arrive before it exists
    this.scheduler?.silenceAbsentCrickets();
  }
  /**
   * Vertical world→screen projection bias set by the `camerahi` script command
   * (TI.EXE global 0x48a792, subtracted from a point's height in fn 0x43a970:
   * `dyHeight = ptY - camHeight - camerahi`). A title sets it per set from its
   * boot library (TAOOT: `adjustcamera()`, run from `openset` — nonzero ONLY for
   * the A-deck halls: halla 139, hallc 80, halld 150). Without it those halls'
   * world sprites (Sasha/Alex) float above the floor; every other set already
   * grounds because the bias is 0. Applied as `cam.z + cameraHiBias` in the
   * viewer's camera builder (raising the eye drops the feet on screen).
   */
  cameraHiBias = 0;
  /** the active set's script binding (SetScripts) — set by its constructor */
  currentBinding: import("./setscripts").SetScripts | null = null;
  builtinsRegistered = false;

  onLog: (line: string) => void = () => {};
  /**
   * host UI hooks for the dialog builtins (notedialog/questiondialog/textdialog)
   * and quit(). The browser wires real alert/confirm/prompt; the headless
   * defaults are safe and non-blocking — note logs, a question answers "no" (so
   * e.g. a quit prompt cancels), a text prompt returns its supplied default, and
   * quit is inert.
   */
  onNoteDialog: (message: string) => void | Promise<void> = (m) => this.onLog(`note: ${m}`);
  onQuestionDialog: (message: string) => boolean | Promise<boolean> = () => false;
  onTextDialog: (prompt: string, initial: string) => string | Promise<string> = (_p, initial) =>
    initial;
  onQuit: () => void | Promise<void> = () => this.onLog("quit()");
  /**
   * host hook: make a game file available before the (synchronous) provider
   * reads it — the browser fetches on demand and returns null on the first
   * miss, so on-demand loaders (puppets, casts, movies) await this first.
   * No-op in tests, where every file is present synchronously.
   */
  ensureFile: (name: string) => Promise<void> = () => Promise.resolve();
  /**
   * host hook: the game swapped CDs. A multi-disc title's `setpath(disk)` writes
   * a volume name into the resource search path at each story transition
   * (TAOOT: `titanic<N>:`, with 93 basenames shipping on both discs — the public
   * rooms, once per act), so the host's file lookup has to follow which one is
   * mounted.
   */
  onDiscChange: ((disc: 1 | 2) => void) | null = null;

  /**
   * Host hook: a movie sequence has fully ended and these are the files it
   * played. A movie is the one resource a game finishes with — TAOOT ships 275
   * of them, 328 MB, and the largest are one-shot cutscenes — so the host gives
   * their bytes back here rather than waiting for a cache budget to force it.
   */
  onMoviesDone: ((names: string[]) => void) | null = null;
  /** host hook: actually load + display a set (async in the browser) */
  onSetChange: (fileName: string, sceneName: string, viewName: string) => void | Promise<void> =
    () => {};
  /** host hooks for currentscene()/currentview() queries */
  currentSceneName: () => string = () => "";
  currentViewName: () => string = () => "";
  /**
   * hittest(point): what's under a screen pixel — the object NAME and its
   * result() TYPE ("actor"/"scene"/"painting"/"button"/"flat", "" for nothing).
   * The viewer wires this to its click-resolution geometry. Used by e.g.
   * TAOOT's inventory "use item" flow (INVEN.SHP: thename = hittest(arg);
   * switch result() → sendto<type>(thename, offerobject(what))).
   */
  hitTestAt: (x: number, y: number) => { name: string; type: string } = () => ({
    name: "",
    type: "",
  });
  /** the type from the most recent hittest(), returned by result() */
  lastResult = "";
  /** what the last `setcursor` handler asked the pointer to look like ("" = the
   *  plain arrow, which is also what a handler that says nothing leaves) */
  cursorName = "";
  /** facing direction of the current view (radians), for arrival continuity */
  currentRotation: (() => number) | null = null;
  /** facing carried across a set change; the next viewer consumes it */
  lastRotation: number | null = null;

  /**
   * Screen fade (screentoblack/blacktoscreen around gotospecial): 0 = clear,
   * 1 = black. Lives on the session — the viewer is rebuilt mid-transition.
   * While fading OUT the pre-transition frame stays visible via `snapshot`.
   */
  fade = {
    level: 0,
    lastTick: 0,
    queue: [] as { to: number; steps: number }[],
    snapshot: null as { rgba: Uint8ClampedArray; width: number; height: number } | null,
    /**
     * A movie ended and nothing has said what the screen should look like
     * afterwards — see {@link tickFade}, which lifts a leftover one-shot black
     * once the script that played the movie has run out of things to say.
     */
    pendingReveal: false,
  };
  /**
   * A reveal in progress: the screen the game is LEAVING, uncovered a step at a
   * time by the screen it is arriving at (`visualeffect(wipeleft|wiperight, n)`).
   *
   * Held on the session for the same reason the fade is — a transition outlives
   * the viewer that started it — and stepped on the game clock by
   * {@link tickWipe}, so a slow host takes the same number of passes as a fast
   * one rather than the same number of milliseconds.
   *
   * `from` is the old screen. The new one is whatever the viewer paints this
   * frame, so nothing has to be captured twice or held in sync.
   */
  wipe = {
    dir: "" as "" | "left" | "right",
    /** steps already revealed, of `steps` */
    step: 0,
    steps: 0,
    lastTick: 0,
    from: null as { rgba: Uint8ClampedArray; width: number; height: number } | null,
  };

  get wiping(): boolean {
    return this.wipe.dir !== "" && this.wipe.from !== null;
  }

  /**
   * Advance a reveal. One step per WIPE_STEP_MS, which is NOT the engine pass.
   *
   * TI.EXE paces the strips against its own 60 Hz counter rather than the 50 ms
   * service clock: `0x41de90` reads the OS millisecond timer and returns
   * `(ms * 3) / 50`, i.e. ms/16.67, and the wipe's pacer (0x43c600) spins until
   * that counter reaches `timeBase + i` for strip i. So a step is one 60 Hz tick
   * and the scrapbook's `visualeffect(wipeleft, 30)` takes half a second, not the
   * 1.5 s a 50 ms step would give it.
   */
  tickWipe(now: number): void {
    const w = this.wipe;
    if (!this.wiping) return;
    if (!w.lastTick) w.lastTick = now - WIPE_STEP_MS;
    while (this.wiping && now - w.lastTick >= WIPE_STEP_MS) {
      w.lastTick += WIPE_STEP_MS;
      if (++w.step >= w.steps) this.endWipe();
    }
  }

  endWipe(): void {
    this.wipe.dir = "";
    this.wipe.from = null;
    this.wipe.step = 0;
    this.wipe.steps = 0;
    this.wipe.lastTick = 0;
  }

  /** host hook: snapshot the currently displayed frame for fade-outs */
  captureFrame: (() => { rgba: Uint8ClampedArray; width: number; height: number } | null) | null =
    null;

  get fading(): boolean {
    return this.fade.queue.length > 0;
  }

  /** advance the fade one 50 ms engine step at a time */
  tickFade(now: number): void {
    const f = this.fade;
    if (!f.queue.length) {
      f.lastTick = 0;
      // A movie has ended and the script that played it has finished talking
      // (no dispatch left in flight): whatever black it left behind is nobody's
      // any more, so lift it. Deferring to here — rather than revealing the
      // instant the movie ends — is what keeps a boot sequence black (TAOOT:
      // boot() ends the main-menu movie and then spends many frames opening
      // bedsit1 and playing the date caption before advanceday's blacktoscreen
      // fades the flat in; revealing at movie end flashed the room, fully lit,
      // in between). A stage that never fades still gets its reveal (TAOOT's
      // bomb: blackscreen -> bombopen.mov -> setvisible(false), no fade follows).
      if (f.pendingReveal && !f.snapshot && !this.scriptBusy) {
        f.pendingReveal = false;
        f.level = 0;
      }
      return;
    }
    f.pendingReveal = false;
    if (!f.lastTick) f.lastTick = now - ENGINE_STEP_MS;
    while (f.queue.length && now - f.lastTick >= ENGINE_STEP_MS) {
      f.lastTick += ENGINE_STEP_MS;
      const ramp = f.queue[0];
      if (ramp.to === 0) f.snapshot = null; // fading back in reveals the live frame
      const delta = 1 / ramp.steps;
      f.level =
        ramp.to > f.level
          ? Math.min(ramp.to, f.level + delta)
          : Math.max(ramp.to, f.level - delta);
      if (f.level === ramp.to) f.queue.shift();
    }
  }

  constructor(
    readonly files: FileProvider,
    readonly audio: AudioSink,
  ) {
    registerGameBuiltins(this); // core + game families, see builtins/index.ts
    this.interp.realYieldSeq = () => this.realYieldSeq;
  }

  /**
   * The source `random()` draws from. Replaceable so a run can be reproduced:
   * a story calls random() at points that decide observable state (TAOOT:
   * BOOTFILE advanceday() seeds the arrival clock with `sec = random(60) -1`,
   * and BEDSIT1's bomb loop fires after `random(100)` service steps). With
   * Math.random those land differently every run, which is the difference
   * between a state trace you can diff and one you have to mask. Read through
   * a closure in registerCoreBuiltins, so assigning it after construction
   * (the builtins register in this constructor) still takes effect.
   *
   * This is the SCRIPT stream: what `random()` in a script draws from, and
   * nothing else. See {@link ambientRng} for why that separation exists, and
   * {@link seedRandom} for how a host seeds both at once.
   */
  rng: () => number = Math.random;

  /**
   * The stream the ENGINE's own ambient timers draw from — today just cricket
   * re-arm jitter (`Scheduler.rand`).
   *
   * It used to be `rng`, deliberately, on the argument that TI.EXE has one
   * `rand()` so sharing is the faithful arrangement. The argument was true and
   * the cost was too high, and the measurement (TAOOT) is stark. Over carried
   * segments 1-5, the crickets draw **4 times** and scripts draw **834**; the
   * TAOOT corpus's only jittered crickets (`steam1`/`steam2`, BOOTFILE container
   * 2) re-arm on the CLOCK, so those 4 draws move whenever anything moves the
   * clock — and moving them re-values all 834. Un-shadowing `trackbut` changed
   * the script draw COUNT not at all (834 either side) and still flipped the
   * Gorse/Jones coin and reshuffled the crowd extras, because 4 ambient draws
   * had slid into different places in the sequence.
   *
   * Splitting costs a fidelity point that NO SCRIPT CAN OBSERVE: which arbitrary
   * value a draw returns is arbitrary either way, and the original's own sequence
   * came from a time seed nobody can reproduce. What it buys is that an engine
   * change with no effect on what scripts ask for now has no effect on what they
   * get. Crickets stay deterministic — that was the real point of seeding them at
   * all, since a cricket writes its name to sound channel 2 and `currentsound(2)`
   * is script-readable (TAOOT's bedsit landlady sequences her five lines on it).
   */
  ambientRng: () => number = Math.random;

  /**
   * Seed both streams from one number — the only way a host should do it, so the
   * two cannot drift apart the way the two mask lists once did. The ambient
   * stream is offset rather than shared so it draws a different sequence.
   */
  seedRandom(seed: number): void {
    this.rng = seededRng(seed);
    this.ambientRng = seededRng((seed ^ 0x9e3779b9) >>> 0);
  }

  /**
   * Real event-loop yield hook + counter. forceupdate()/stilldown() call
   * nextFrame() to render a frame and pump input, then bump realYieldSeq; the
   * interpreter's while-guard uses the counter to spare interactive loops. In
   * the browser main.ts points nextFrame at requestAnimationFrame; the default
   * resolves immediately (headless / tests advance the clock manually).
   */
  nextFrame: () => Promise<void> = () => Promise.resolve();
  /**
   * True once the host wires nextFrame to real rendered frames (rAF). Only
   * then do forceupdate/stilldown bump realYieldSeq: in a browser an
   * interactive poll loop genuinely waits on the user, so the while-guard must
   * not trip it. Headless (tests) keeps this false — there forceupdate
   * free-runs (it advances its own clock and nextFrame resolves immediately),
   * so a stuck loop MUST still hit the 100k guard instead of hanging forever.
   */
  hasRealFrames = false;
  realYieldSeq = 0;
  /**
   * The host advances movie frames, so `playmovie` may block the way TI.EXE's
   * does. Implied by {@link hasRealFrames} — see the playmovie builtin.
   *
   * Modal playback is the engine's actual behaviour; the non-blocking path is
   * the deviation, taken because a host with no frame source would deadlock on
   * the first cutscene. A harness that pumps `viewer.tick()` itself has a frame
   * source and wants the real semantics: without them a boot walks straight
   * past its interactive menu (TAOOT: playmode.mov's GAME/TOUR choice resolves
   * to whatever `actionframe(1)` happens to hold) and every close-up scores
   * without ever being dismissed.
   */
  modalMovies = false;

  // ---- timing runtime (delay / makeloop / makecricket / soundloop) --------

  readonly clock = new Clock();
  /**
   * loop/cricket/walk scheduling + sound-loop handling on the 50 ms heartbeat.
   * Addressed directly — `session.scheduler.makeLoop(...)` — like the stage and
   * puppet controllers; the session carries no forwarding surface for it.
   */
  readonly scheduler = new Scheduler(this);
  /** host hook: listener (camera) ground position + facing for crickets */
  listener: () => { x: number; y: number; deg: number } | null = () => null;

  /** scripts currently executing/suspended (delay) — input waits on these */
  private inflight = new Set<Promise<unknown>>();
  /**
   * The idle heartbeat's own dispatches — awaited by {@link settle} but NOT by
   * {@link scriptBusy}, because they are not scripts the player started.
   *
   * A boot library's `idle()` calls its clock handler (TAOOT: `calctime()`)
   * straight through, synchronously, once per main-loop pass: in the original it
   * cannot possibly overlap the event
   * dispatch further down the same handler. Here it is an async dispatch, so
   * putting it in `inflight` made the engine look busy for the microtask it took
   * to settle — and `scriptBusy` is what the input queue waits on. The clock then
   * ate keys and clicks: a press made during a walk went `posted=3 taken=0
   * dropped=2` once the heartbeat ran on both hosts, which is the heartbeat
   * poisoning the input path the same way it used to poison its own service pass
   * (see tickTime). Separating the two sets is what lets the clock tick without
   * the player's input paying for it.
   */
  private idleInflight = new Set<Promise<unknown>>();

  /**
   * What each in-flight dispatch IS, for the one question a stall asks: the
   * engine refuses input while `scriptBusy`, and a set of anonymous promises
   * cannot say which one is not coming back. A hung run could report "the engine
   * would not take an arrow" and nothing more; now it can name the dispatch.
   */
  private labels = new WeakMap<Promise<unknown>, string>();

  /** run a script dispatch in the background, tracked for busy/settle */
  track<T>(p: Promise<T>, label = ""): Promise<T> {
    return this.trackIn(this.inflight, p, label);
  }

  /** as {@link track}, for the idle heartbeat — settle waits, scriptBusy doesn't */
  trackIdle<T>(p: Promise<T>, label = ""): Promise<T> {
    return this.trackIn(this.idleInflight, p, label);
  }

  private trackIn<T>(set: Set<Promise<unknown>>, p: Promise<T>, label = ""): Promise<T> {
    set.add(p);
    if (label) this.labels.set(p, label);
    void p.catch((e) => this.onLog(`script error: ${(e as Error).message}`)).then(() => {
      set.delete(p);
    });
    return p;
  }

  /** the dispatches holding the engine right now, named where the caller said so
   *  ("?" for a call site that has not been given a label yet) */
  pending(): string[] {
    return [...this.inflight].map((p) => this.labels.get(p) ?? "?");
  }

  get scriptBusy(): boolean {
    return this.inflight.size > 0;
  }

  /** wait until all in-flight script dispatches finish (tests, shutdown) */
  async settle(maxRounds = 1000): Promise<void> {
    for (let i = 0; i < maxRounds && (this.inflight.size || this.idleInflight.size); i++) {
      await Promise.allSettled([...this.inflight, ...this.idleInflight]);
    }
  }

  /**
   * Monotonic DISPLAYED-frame counter behind frame().
   *
   * `framerate()` is ticks per displayed frame against a 60 Hz base — which is
   * why scripts pass 0 for "unthrottled" and 5 for slow, deliberate frames
   * (TAOOT's fight stage), and why forceupdate() holds that many ticks per call.
   * frame() counts the same unit, so it advances once per `frameRate` ticks,
   * not once per tick. Read off the cast's own seconds→frames conversion,
   * `(seconds * 60) / framerate()`, which only comes out in seconds if frame()
   * runs at 60/framerate() Hz — and confirmed since in TI.EXE itself, where
   * `framerate` is the value added to the last frame's timestamp (0x43a940).
   *
   * Counting raw ticks instead made every timer built on frame() run
   * `frameRate`× fast. The visible one was TAOOT's hasattention(): characters
   * who should speak up after you linger near them for four seconds — Georgia
   * and Morrow on the boat deck — accosted you inside a second and a half, i.e.
   * while you were still walking past.
   *
   * {@link advanceFrames} is where the "per `frameRate` ticks" is enforced, and
   * it counts TICKS OF THE CLOCK rather than calls, so the rate is the same on
   * a browser at any refresh rate and on the pumped-clock host.
   */
  frameCounter = 0;

  /**
   * Witness every write to a named prop's owner — off unless a host asks.
   *
   * Here rather than in either harness, and FORMATTED here too, because the whole
   * value of it is that the two hosts produce lines that can be diffed. The last
   * attempt at this question used a `sendEvent` wrapper headless and a
   * once-per-rAF sampler in the browser, and the two could not be compared at
   * all: the sampler only saw values that survived to a frame boundary, so it
   * reported that the browser never writes `"off"` when in fact it does — just
   * not in the two runs that were measured. A hook on the write itself cannot
   * miss one.
   *
   * `@frame=` is deliberately LAST on the line. It is harness-paced (the two
   * hosts count frames differently by design — tests/playthrough/masks.ts), so a
   * comparison strips it and keeps the causal columns:
   *
   *     sed 's| @frame=.*||' both files, then diff
   *
   * Cheap enough to leave on the write path: `propowner` with a value is a script
   * doing bookkeeping, not something a frame loop does. Set `propTrace` to the
   * lowercased prop names to watch and point `onPropTrace` at a sink.
   */
  readonly propTrace = new Set<string>();
  onPropTrace: ((line: string) => void) | null = null;
  private propTraceSeq = 0;

  /** Record one owner write, if it is being witnessed and actually changes it. */
  tracePropOwner(name: string, from: string, to: string, frame: Frame): void {
    if (!this.onPropTrace || from === to) return;
    if (!this.propTrace.has(name.toLowerCase())) return;
    const at = `set=${this.currentSetName} flat=${this.currentFlat} vis=${this.setVisible ? 1 : 0}`;
    this.onPropTrace(
      `#${String(++this.propTraceSeq).padStart(3, "0")} ${name} ${from || "-"} -> ${to || "-"}` +
        ` by=${frame.script.name}.${frame.handler || "?"} me=${frame.ctx.me || "-"} ${at}` +
        ` @frame=${this.frameCounter}`,
    );
  }

  /** wall-clock tick stamp of the last displayed frame — TI.EXE's 0x48a6d8 */
  private lastFrameTick: number | null = null;
  tickTime(now: number): void {
    this.advanceFrames(now);
    this.scheduler.tickTime(now);
  }

  /**
   * Advance frame() the way TI.EXE does — off the CLOCK, not off how often the
   * host happened to call us.
   *
   * The original increments its counter (0x489efa, all `frame()` returns) once
   * per displayed frame at 0x439b80, and the very next thing it does is spin
   * until real time catches up (0x43a940):
   *
   *     call 0x41de90            ; now = timeGetTime() * 3 / 50
   *     mov  ecx, [0x489efe]     ; framerate  (initialised to 3 at 0x429643)
   *     add  ecx, [0x48a6d8]     ; + last frame's stamp
   *     cmp  eax, ecx
   *     jl   0x43a940            ; not yet -> spin
   *     mov  [0x48a6d8], eax     ; stamp this frame
   *
   * `framerate` is ADDED TO A TIMESTAMP, so a frame is every `framerate` ticks
   * of time — 60/framerate Hz, pinned to the clock however fast the machine
   * draws. That makes the unit a DURATION, which is why it is the same rule on
   * every host and this function has no host special case.
   *
   * Counting the calls instead only agrees when the caller arrives exactly 60
   * times a second, and neither host does:
   *
   *  * the browser delivers whatever rAF gives. At 38 fps (this laptop before
   *    the renderer stopped redrawing unchanged frames) every frame()-based
   *    timer ran 37% slow; on a 120 Hz panel the same code runs them twice as
   *    fast.
   *  * the pumped-clock host advances 50 ms per forceupdate — which already IS
   *    one displayed frame at the default framerate of 3 (3 ticks = 50 ms), so
   *    dividing by framerate again counted every frame three times. That the two
   *    coincide is not luck: the boot's clock handler (TAOOT: calctime) fixes a
   *    main-loop pass at 50 ms (20 passes to the pocketwatch's second), and at
   *    framerate 3 a pass is a frame.
   *
   * The goldens recorded before this ran frame() at 6.67 Hz headless where the
   * original runs it at 20; they were re-recorded, which is the only reason a
   * change this deep in the clock shows up as a diff and not as a mystery.
   */
  private advanceFrames(now: number): void {
    const period = Math.max(1, Math.round(this.frameRate));
    const t = ticksAt(now);
    if (this.lastFrameTick === null) {
      this.lastFrameTick = t;
      return;
    }
    const due = Math.floor((t - this.lastFrameTick) / period);
    if (due <= 0) return;
    // A suspended tab must not replay its whole absence as a burst of frames;
    // the stamp still moves all the way up, so the catch-up happens once.
    this.frameCounter += Math.min(due, MAX_FRAME_CATCHUP);
    this.lastFrameTick += due * period;
  }
  /**
   * sendto* dispatch, shared by the sendto special forms and loop firing:
   * resolve the named target, build the command's dispatch chain, run it in
   * order, and — when no link had the handler at all — resolve through the
   * target's containment chain. Events sent to a scene forward along
   * scene → set main → stage when unhandled/passed (or when the scene has
   * no script at all).
   */
  async sendEvent(
    cmd: string,
    targetName: string,
    handler: string,
    args: Value[],
    callerName: string,
  ): Promise<Value> {
    const inst = this.resolveEventTarget(cmd, targetName, handler);
    const chain = this.buildEventChain(cmd, inst);
    if (!chain.length) {
      this.onLog(`${cmd}("${targetName}", ${handler}(..)) — target not loaded`);
      return 0;
    }
    // EXPERIMENT (see TODO 11b): `target` is the ADDRESSEE where the addressee is
    // a THING — a prop, an actor, a scene, a flat. Where it is a FILE (a shop, a
    // cast, the stage, a puppet, the boot) there is no thing being addressed and
    // `target` stays the caller's context.
    const OBJECT_ADDRESSEE = /^sendto(prop|actor|scene|flat)(fx)?$/;
    const evTarget = OBJECT_ADDRESSEE.test(cmd) ? targetName || callerName : callerName;
    const { value, ran, passed, visited } = await this.runHandlerChain(chain, handler, args, (link) => ({
      me: link.name,
      target: evTarget,
    }));
    // `passcode` means "not mine, ask whoever holds me" — so a chain that ends on
    // one keeps going up the containment chain, exactly as a chain that had no
    // handler at all does. Only the LAST link matters: the loop above already
    // walks a passcode along the chain, and this is what happens when it runs out.
    //
    // The measured case is TAOOT's `inven.shp` notebook (container 0088): its own
    // `setcursor` answers `cursor("arrow")` for the one view where the notebook is
    // scenery on the smokestack platform, and `passcode`s everywhere else — onto
    // the shop main's distance-gated `cursor("touch")`. Without this the passcode
    // was a dead end and the notebook had no cursor at all.
    if ((!ran || passed) && inst) {
      return this.resolveViaContainment(cmd, inst, handler, args, evTarget, value, visited);
    }
    return value;
  }

  /** the script instance a sendto* command names, with per-command fallbacks
   *  for targets that exist but carry no script of their own */
  private resolveEventTarget(cmd: string, targetName: string, handler = ""): ScriptInstance | null {
    let inst =
      this.currentBinding?.findInstance(targetName) ?? this.findGlobalInstance(targetName);
    if (!inst && cmd === "sendtostage") inst = this.stageScript;
    if (!inst && cmd === "sendtoboot") inst = this.boot;
    // a flat is contained in its stage: an event to a flat with no own script
    // (TAOOT's fencing: per-flat click regions carry the scripts, not the flat
    // itself) resolves on the stage main, where shared handlers live (its
    // pointgoesto()/centerstage()/setupsmallprops). (findInstance already returns
    // the flat's own script when one exists, so this fallback only fires when it
    // doesn't.)
    if (!inst && cmd === "sendtoflat") inst = this.stageScript;
    // a prop with no script of its own (TAOOT: a fuse in the fusebox bank)
    // resolves on its owning shop's main, where the shared handler dispatches by
    // `target` (fuseoff/fuseon do propview(target,…)). Mirrors the viewer's
    // prop-click dispatch so prop RUN LOOPS — makeloop("prop", name, handler) —
    // resolve too; without it a scriptless prop's loop fired into nothing (the
    // fuse never settled).
    if (!inst && cmd === "sendtoprop") {
      const pi = this.propRuntime.get(targetName);
      if (pi) inst = this.shopMain(pi.shop.name);
    }
    // The same for an actor with no script of its own, resolving on its owning
    // CAST's main — where the shared character handlers live (`runpuppet`,
    // `initactor` via the boot, `stdactor`), all of them written against `target`
    // rather than `me`.
    //
    // A cast entry can be a STUB: TAOOT's 1996-demo gang.cst carries `smeth` —
    // Frank's contact, and the whole of the demo's first scene — with an 8-byte
    // script container and one empty pose, because everything he does is a puppet
    // conversation the cast main runs. Without this, `sendtoactor("smeth",
    // runpuppet("dsmeth.pup", "door"))` had no chain at all and was dropped as
    // "target not loaded": C71's door opened onto nobody.
    //
    // Gated on the cast main ACTUALLY HAVING the handler, which is the difference
    // between resolving an event and inventing a chain for it. A scriptless actor
    // is not a script and cannot own an event; its cast main is the only thing
    // that can answer for it, and where that cannot either, there is nothing to
    // run — which is precisely what the "target not loaded" line reports. Both
    // handlers full TAOOT sends to ITS stub (`purs`) are of that kind:
    // `playcrickets`, the loop gang.cst arms on him, and `initactor` are defined
    // in no script in the tree. Resolving them anyway walked a chain to the boot
    // library, found nothing there either, and returned the same 0 — but the extra
    // await points along the way reordered the crowd extras' star assignment on
    // the boat deck, which two playthrough segments record.
    if (!inst && cmd === "sendtoactor") {
      const ai = this.actorRuntime.get(targetName);
      const main = ai ? this.castMains.get(ai.cast.name.toLowerCase()) : null;
      if (main?.script.codes.has(handler)) inst = main;
    }
    return inst;
  }

  /** the ordered list of scripts the event traverses (exitcode stops it) */
  private buildEventChain(cmd: string, inst: ScriptInstance | null): ScriptInstance[] {
    const chain = inst ? [inst] : [];
    if (cmd === "sendtoscene" || cmd === "sendtoset") {
      const main = this.currentBinding?.main;
      if (main && main !== inst) chain.push(main);
      if (this.stageScript && this.stageScript !== inst) chain.push(this.stageScript);
    }
    // sendtostage falls through to the boot library when neither the stage nor
    // its main handles the event — the boot holds a title's game-global handlers
    // (TAOOT: the day machine, `advanceday`/`advancetour`). TAOOT's bombit()
    // ends with `sendtostage(advanceday())` to jump Frank from the London flat
    // to the Titanic; without this fallback advanceday no-ops on MAIN.STG (which
    // has no such handler) and the screen stays black after bedex.mov.
    // suppressStageBootFallback: the host's coldBoot runs boot() for its front
    // half (movies/resource loads) but performs the day-advance itself, AFTER
    // resetting currentset→"none" and the mix volumes. TAOOT's boot() ends with
    // its own `sendtostage(advanceday())`; with this fallback live that would
    // fire during runGlobal("boot") — before coldBoot's setup — running
    // advanceday on stale state (clock="startdisk1" then a second advance to
    // clock="bedsit" skips the flat straight to the Titanic). The flag mutes
    // ONLY that boot-internal call.
    if (cmd === "sendtostage" && !this.suppressStageBootFallback) {
      for (const b of this.bootScripts) if (b !== inst && !chain.includes(b)) chain.push(b);
    }
    return chain;
  }

  /**
   * Run `handler` along an ordered chain of scripts — THE event-traversal
   * rule, shared by the sendto* chain ({@link sendEvent}), containment
   * resolution ({@link resolveViaContainment}) and the stage's
   * region→flat→stage click routing (StageController.stageClickAt): a link
   * without the handler is skipped; a link that ran stops the walk unless it
   * `passcode`d on; a consumed event ({@link Interpreter.eventConsumed})
   * always stops it. `passed` is true when the LAST link to run passed the
   * event on and the chain then ran out — the caller carries on up the
   * containment chain, as `passcode` asks.
   *
   * NOT for the walkers whose rules differ on purpose: SetScripts'
   * fireLifecycle (consumption by the handler's own signal, and it continues
   * past a link that throws), sendToButton's library fallback (first match
   * wins, no passcode climb) and runGlobal (first match wins).
   */
  async runHandlerChain(
    chain: (ScriptInstance | null | undefined)[],
    handler: string,
    args: Value[],
    ctxFor: (link: ScriptInstance) => CallCtx,
  ): Promise<{ value: Value; ran: boolean; passed: boolean; visited: ScriptInstance[] }> {
    let value: Value = 0;
    let ran = false;
    let passed = false;
    const visited: ScriptInstance[] = [];
    for (const link of chain) {
      if (!link || !link.script.codes.has(handler)) continue;
      ran = true;
      visited.push(link);
      const res = await this.interp.runHandler(link, handler, args, ctxFor(link));
      value = res.value;
      passed = res.passed;
      if (this.interp.eventConsumed || (res.handled && !res.passed)) break;
    }
    return { value, ran, passed, visited };
  }

  /**
   * Nothing in the chain had the handler: the target resolves it through its
   * CONTAINMENT chain (prop -> shop main, where initprop() lives; then the
   * stage), with me = the target. Deliberately NOT the boot scripts in
   * general: a boot's keydown routes events via sendtoscene, so resolving a
   * scene's missing keydown back into boot would recurse forever (TAOOT's TURK
   * scene134 has a script without keydown — user-reported OOM). EXCEPTION:
   * actor-lifecycle helpers (TAOOT: putdownactor/moveactorstar/moveactorxyz)
   * live in the BOOTFILE and are dispatched via sendtoactor(name,
   * putdownactor()); most casts don't override them, so an actor's putdownactor
   * must reach the boot fallback — without it the officer/Sasha never hid
   * ("actor doesn't leave"). Scoped to sendtoactor so the keydown/scene
   * recursion above is unaffected.
   */
  private async resolveViaContainment(
    cmd: string,
    inst: ScriptInstance,
    handler: string,
    args: Value[],
    evTarget: string,
    fallback: Value = 0,
    visited: ScriptInstance[] = [],
  ): Promise<Value> {
    const libs: ScriptInstance[] = [];
    for (let p = inst.parent; p; p = p.parent) libs.push(p);
    if (this.stageScript && this.stageScript !== inst) libs.push(this.stageScript);
    // ...and NOT when the boot library is what dispatched this very event.
    // A boot's mousedown routes a click with `sendtoactor(thename,
    // mousedown(thepoint))`; an actor with no mousedown anywhere in its chain
    // (TAOOT's demo crowd-walker cast member `extra` — gang.cst's main has no
    // mousedown either) resolved it right back into boot1.mousedown, whose
    // hittest found the same actor under the same point: the reported
    // "dispatch cycle: boot1.mousedown at depth 64", and the click was eaten.
    // The original cannot be routing input back into its own router — TAOOT's
    // demo ships that exact actor — so the fallback is for events the boot
    // did NOT originate: dispatched under a different outer handler, the
    // lifecycle helpers this exception exists for still resolve (closescene
    // sending putdownactor arrives with outerDispatch "closescene").
    if (cmd === "sendtoactor" && this.interp.outerDispatch !== handler) {
      for (const b of this.bootScripts) if (!libs.includes(b)) libs.push(b);
    }
    // A link the chain already ran must not run twice. It can be on both lists:
    // a scene's chain is scene -> set main -> stage, and the stage is also the
    // last thing containment would try — so a stage handler that passcodes used
    // to be the one that got run again. (And a passcode here keeps climbing —
    // the shared traversal rule, see runHandlerChain.)
    const res = await this.runHandlerChain(
      libs.filter((l) => !visited.includes(l)),
      handler,
      args,
      () => ({ me: inst.name, target: evTarget }),
    );
    return res.ran ? res.value : fallback;
  }

  /** sendtopainting(scene, view, paint, handler(args)): fire an event at a named
   *  hotspot in a view (a boot's SPACE door opener routes mousedown here). */
  sendToPainting(
    scene: string,
    view: string,
    paint: string,
    handler: string,
    args: Value[],
  ): Promise<boolean> {
    return this.currentBinding?.paintingEvent(scene, view, paint, handler, args) ?? Promise.resolve(false);
  }

  /** parse a script container into an instance bound to `owner` */
  instanceFrom(data: Uint8Array | undefined, owner: string): ScriptInstance | null {
    if (!data) return null;
    const tokens = sniffScript(data);
    if (!tokens) return null;
    try {
      const script = parseScript(tokens);
      return new ScriptInstance(owner, script);
    } catch (e) {
      this.onLog(`parse error in ${owner}: ${(e as Error).message}`);
      return null;
    }
  }

  /** set once the boot library and its session-scoped resources are up */
  private coreLoaded = false;

  /**
   * **The game is booted**: the BOOTFILE scripts are parsed, their globals
   * seeded, the session-scoped resources its boot plan names open (TAOOT:
   * inven/house shops, the shared audio banks, gang.cst) and the standard
   * in-game stage up. Idempotent by contract, not by patch — asking twice is
   * asking for a state that already holds. Steps in order; each is its own
   * method below.
   *
   * It is a *once* in the game too: TAOOT's `boot()` runs its `openshopfile
   * ("house.shp")`, `opencastfile("gang.cst")`, `openstagefile("main.stg")` at
   * startup and never again. Re-running them is not a no-op — house.shp's
   * `openshop` is a LAYOUT pass (`propxy("bag", 256, 324)`, the interface
   * band), while putting the bag on the C73 bed is `initprops`' one-time job.
   * So a second pass left the bag 2D and the bed bare, and walking out of the
   * cabin and back in through the door lost it. (The game's own restart — the
   * CTL.STG "new game" lever — closes every shop and cast *first* and reopens
   * them by script, so it never needs this to run again.)
   *
   * Callers can't know whether they are first: any entry point may be, and the
   * files only exist once fetched. So they all just say what they need — hence
   * `ensure`, and why the host asks before every set activation.
   *
   * Not latched until the boot scripts are actually in: an early call with no
   * `bootfile` yet must be allowed to try again.
   */
  async ensureBooted(): Promise<void> {
    if (this.coreLoaded) return;
    this.loadBootLibrary();
    await this.loadBootResources();
    await this.initInventoryProps();
    this.syncThemeLever();
    this.coreLoaded = this.bootScripts.length > 0;
  }

  /**
   * What this game's boot opens, read from its own BOOTFILE and cached.
   *
   * The session parses that file anyway ({@link loadBootScripts}), and the plan is
   * derived from the same bytes — so this asks no one for it and needs no wiring.
   * The host reads the same plan for what to FETCH (GameHost.bootPlan); this is
   * what to OPEN, which is the other half of the same question.
   */
  private plan: BootPlan | null = null;

  private bootPlan(): BootPlan {
    if (this.plan) return this.plan;
    const bytes = this.files("bootfile");
    return (this.plan = bytes ? readBootPlan(bytes) : EMPTY_BOOT_PLAN);
  }

  /**
   * The half of the boot that is nobody else's to do: parse the BOOTFILE
   * containers into scripts, wire them as the unqualified-call fallbacks, and
   * seed the globals scripts compare against.
   *
   * Split out because both kinds of boot need exactly this and only one of them
   * needs the rest — see {@link bootedByGame}. It is also the half that cannot
   * be skipped by any caller, the game's own `boot()` included: `boot()` lives in
   * the BOOTFILE, so parsing the file is what makes it callable at all.
   */
  private loadBootLibrary(): void {
    this.loadBootScripts();
    this.refreshFallbacks();
    this.seedBootGlobals();
  }

  /**
   * The GAME's own `boot()` is what boots this session, so {@link ensureBooted}
   * must never stand in for it: parse the boot library and latch, without opening
   * a single resource.
   *
   * Everything `ensureBooted` opens is a re-creation of what a full game's
   * `boot()` does, kept because the port's other entry points — a set pick, a
   * loaded save — reach a running game without ever passing through `boot()`. An
   * edition whose `boot()` *is* being run does not want that re-creation: TAOOT's
   * 1996 DEMO opens gang.cst, two track banks and demo.shp, and then its own menu
   * stage, and the interface band it never asked for is opened by its `dodemo()`
   * — the moment you pick "DEMO" from that menu, alongside main.stg and the
   * inventory (`openshopfile("house.shp") … openstagefile("main.stg")`). Standing
   * in for it painted house.shp's lifebuoy, bag, watch and deck map over the
   * demo's title screen, in the menu flat's palette, and ran inven.shp's
   * `initprops` a whole game early.
   *
   * A stand-in that ALREADY ran is put back down here, because "never stand in
   * for it" has to hold for a caller that arrives second. Any entry point may
   * come first (a set pick, the harness's pre-boot), and the shops it opened
   * carry state that a re-open deliberately keeps ({@link openShop}) — so a
   * `boot()` running afterwards inherits props that were seeded before it had
   * said anything. TAOOT's interface band is that case: `initprops` ->
   * `initinterface` branches on `tour`, `tour` is set from playmode.mov's
   * GAME / GUIDED TOUR menu, and the tour branch says nothing about the bag and
   * the pocketwatch — so a band built early, for the game, left both of them
   * standing in a guided tour, and boot()'s own `openshopfile` re-fired
   * `openshop`, whose `propxy(…, 256, 324)` is the BAND layout, and dragged the
   * pair out of C73 and into the menu band. Closing the shops drops their props
   * ({@link PropRuntime.removeShop}), so `boot()` builds the band once, from
   * scratch, with the flag it has just set.
   *
   * False when there is no BOOTFILE parsed yet, in which case nothing has been
   * latched and there is no `boot()` to run either — the caller has nothing to
   * boot and should say so rather than carry on.
   */
  async bootedByGame(): Promise<boolean> {
    await this.putDownStandIn();
    this.loadBootLibrary();
    this.coreLoaded = this.bootScripts.length > 0;
    return this.coreLoaded;
  }

  /**
   * Close the SHOPS a previous {@link ensureBooted} opened, so the `boot()` about
   * to run opens them itself — see {@link bootedByGame}, which is the only caller.
   *
   * Shops and not everything: the boot's other resources come back clean on their
   * own. An audio bank is bytes, a cast is re-dealt by `initall`'s `initactors`,
   * and a stage file is re-read on open. A shop is the one that deliberately does
   * NOT rebuild ({@link openShop}), because a stage re-entering its own shop must
   * keep the prop states it left — which is right there and wrong here.
   *
   * `__propsinit` goes with them: it is {@link initInventoryProps}' once-latch, and
   * a session whose inventory props no longer exist has not had them dealt.
   *
   * The question asked is whether the SHOPS are open, not whether `coreLoaded` is
   * set — those come apart on the one path that most needs this. `quit()` ->
   * {@link prepareRestart} clears the latch and leaves the finished game's shops
   * standing, so a `coreLoaded` guard would read "nothing stood in" and hand the
   * restarted boot the old game's band.
   */
  private async putDownStandIn(): Promise<void> {
    let closed = false;
    for (const file of this.bootPlan().resources) {
      if (!file.endsWith(".shp") || !this.shopMains.has(file.toLowerCase())) continue;
      await this.closeShop(file);
      closed = true;
    }
    if (closed) this.interp.globals.delete("__propsinit");
  }

  /**
   * The game is over: put everything the finished game had running back down, and
   * forget the boot so {@link ensureBooted} runs again.
   *
   * This is what lets `quit()` return to the front door in place instead of
   * reloading the page. The reason it could not before is real and is handled by
   * the caller, not here: `quit()` is called from inside the script that just
   * played the credits, so a boot re-entered underneath it would be building sets
   * while the old game was still talking. The host schedules this for a later
   * task, and the `settle()` below is the second half of that guarantee — nothing
   * is torn down until the dispatch that asked for it has finished unwinding.
   *
   * What has to go, and why each: the SCHEDULER, or the dead game's loops keep
   * firing at scenes the new one has not built (the same argument as the
   * unscripted-swap reset in GameHost); every AUDIO channel, since a theme is a
   * loop and nothing else would ever stop it; a PUPPET, which would otherwise
   * still hold the dispatch; and the FADE, which is left pinned black by the
   * credits and would keep the front door dark. `coreLoaded` is ensureBooted's
   * idempotence latch and a restart is precisely the case that must run it twice —
   * it re-seeds the boot globals, re-opens main.stg and re-deals the inventory.
   *
   * The GAME state is not reset here on purpose: the title's own boot does it
   * (TAOOT: the BOOTFILE `clock = "startdisk1"` arm — resetgamevars,
   * resetpupvars, and the two loops that walk every actor and prop back to
   * "none"), and the data resetting itself is more faithful than this file
   * guessing at the same list.
   */
  async prepareRestart(): Promise<void> {
    await this.settle();
    this.scheduler.reset();
    for (const channel of ["sound", "voice", "theme"] as const) this.audio.halt(channel);
    this.currentThemeName = "none";
    this.puppetCtrl.closePuppetFile();
    this.fade.queue.length = 0;
    this.fade.snapshot = null;
    this.fade.pendingReveal = false;
    this.fade.level = 1;
    this.endWipe(); // a reveal in flight belongs to the screen being thrown away
    // And the SCREEN, because of where quit() is called from. The CTL panel is a
    // flat: reaching Quit means `transtoflat("ctl.stg")` has already run, which
    // pushed main.stg onto the overlay stack and set `setVisible = false`. The
    // normal way back is `transfromflat`, which the player never gets to take —
    // they quit instead. So the restarted game opened its rooms behind a room
    // nobody was allowed to see: the flat's radio played, the landlady shouted
    // and the traffic moved, over a white void where the picture should be, and
    // only loading a save (whose own path does restore this) cleared it (#35).
    //
    // The stack goes with it. Those are the game's own `savestage1..3` globals,
    // still remembering the finished game's main.stg, and a later transfromflat
    // would pop one that belongs to nothing.
    this.stageCtrl.resetOverlayStack();
    this.setVisible = true;
    this.coreLoaded = false;
  }

  /** parse the BOOTFILE containers into script instances (idempotent) */
  private loadBootScripts(): void {
    const boot = this.files("bootfile");
    if (!boot || this.bootScripts.length) return;
    try {
      const file = readContainerFile(boot);
      for (let i = 1; i < file.containers.length; i++) {
        const inst = this.instanceFrom(file.containers[i].data, `boot${i}`);
        if (inst) this.bootScripts.push(inst);
      }
      this.onLog(
        `boot scripts loaded (${this.bootScripts.map((b) => b.script.codes.size).join("+")} handlers)`,
      );
    } catch (e) {
      this.onLog(`bootfile: ${(e as Error).message}`);
    }
  }

  /**
   * boot()'s variable initialization — scripts test these with != "" and
   * text-compares would treat the uninitialized 0 as "0". The NAMES are
   * TAOOT's boot globals (game knowledge the engine still carries; a title
   * whose boot declares different globals seeds its own via `global`/
   * `dumpglobal` declarations, and these extras are harmless to it).
   *
   * One deliberate DIVERGENCE from the original: themevolume. TAOOT's own
   * boot sets 255 (full), but the ambient themes at full volume are wearing
   * over a long session, so this port starts the music very quiet; the player
   * raises it with the CTL.STG theme lever. wavevolume (SFX/voice) stays at
   * full. syncThemeLever() below keeps the settings panel consistent.
   */
  private seedBootGlobals(): void {
    if (this.interp.globals.has("handitem")) return;
    for (const [k, v] of [
      ["handitem", ""], ["savestage1", ""], ["savestage2", ""], ["savestage3", ""],
      ["saveflat1", ""], ["saveflat2", ""], ["saveflat3", ""],
      ["jumpset", ""], ["playerdeath", ""], ["loopsound", ""], ["seldir", "north"],
      ["twocount", 1], ["threecount", 1], ["fourcount", 1], ["fivecount", 1],
      ["themevolume", 24], // the port's quiet-music default — see docblock
    ] as [string, Value][]) {
      this.interp.globals.set(k, v);
    }
  }

  /** run the inventory shop's initprops once, seeding its prop states
   *  (TAOOT: inven.shp — the name is game knowledge, see BOOT_UI_SHOPS) */
  private async initInventoryProps(): Promise<void> {
    const inven = this.shopMain("inven.shp");
    if (!inven?.script.codes.has("initprops") || this.interp.globals.has("__propsinit")) return;
    this.interp.globals.set("__propsinit", 1);
    await this.fireHandler(inven, "initprops", "inven.shp", "initprops");
  }

  /**
   * Sync the theme lever's rest position to our low default themevolume —
   * TAOOT-specific by nature, like the quiet-music divergence it exists for
   * (a title with no "themetoggle" prop makes this a no-op). house.shp's
   * openshop hardcodes deg 5 = loud; CTL.STG's slider maps themevolume = 8·x,
   * deg = x/6, so deg = themevolume/48. Without this the panel would show the
   * lever near the top over deliberately quiet music.
   */
  private syncThemeLever(): void {
    const lever = this.propRuntime.get("themetoggle");
    if (!lever) return;
    const vol = Number(this.interp.globals.get("themevolume") ?? 0);
    lever.deg = Math.max(0, Math.min(5, Math.floor(vol / 8 / 6)));
  }

  // ---- stage layer (STG flats) --------------------------------------------
  // Flat/region/overlay logic lives in StageController (engine/stage.ts); the
  // widely-shared fields below stay here and the session delegates the methods.

  stageName = "none";
  /** flat script instances of the current stage, by lowercase flat name */
  readonly flatScripts = new Map<string, ScriptInstance>();
  flatNames: string[] = [];
  currentFlat = "none";
  /** whether the set view draws over the flat (setvisible builtin) */
  setVisible = true;
  /**
   * Is there a room on the screen? `setVisible` is only the flag the scripts
   * raise and lower; a set also has to be OPEN for it to mean anything, which
   * is why `setvisible()`'s getter answers with both. The renderer and the hit
   * tests have to ask the same question the scripts get an answer to.
   *
   * TAOOT's endgame is where the difference is visible. `advanceday()` runs
   * `closesetfile()` and only then transtoflat()s to the closing narration — so
   * the boot's own `if currentset() != "none": setvisible(false)` does NOT fire,
   * the flag stays raised over a set that no longer exists, and the viewer went
   * on compositing the room's last decoded frame over the top of every
   * newspaper flat and the final movie: the boat deck we left, with the ending
   * showing in the strip of screen below it.
   */
  get viewShowing(): boolean {
    return this.setVisible && this.currentSetName !== "none";
  }
  /**
   * Is a stage OPEN? The same question the `stagevisible` builtin answers, and
   * the one the input path has to ask before it can resolve a click to a flat
   * or one of its button regions.
   *
   * A stage having a MAIN SCRIPT is a different question, and asking that one
   * instead is a bug the demo found. `openstagefile` parses container 1 as the
   * stage main, and a stage need not have one — TAOOT's `inven1.stg` does, its
   * 1996-demo counterpart `inven.stg` does NOT, because there the FLAT carries
   * the handlers (openflat/closeflat/mousedown/showprop/…). The hit test and
   * the click dispatch both gated the whole stage branch on `stageScript`, so
   * in the demo `hittest` over the open inventory answered "none" instead of
   * `("ok", "button")`, the boot's `mousedown` switch had no case to take, and
   * the bag's OK and Examine buttons did nothing at all — no dispatch, nothing
   * in the log. A stage with no main is still a stage.
   */
  get stageOpen(): boolean {
    return this.stageName !== "none";
  }
  /** name of the looping theme currently playing (currenttheme getter) */
  currentThemeName = "none";
  /**
   * TI.EXE puppet render params by slot (puppetparam builtin), seeded with the
   * defaults `openpuppetfile` writes at 0x4296e4. They are not decoration: the
   * puppet renderer reads 3, 4, 6 and 10 for the colour, size and margin of
   * every line of conversation text, so a wrong default is a visibly wrong
   * screen.
   *
   * | slot | default | what |
   * |-----:|--------:|------|
   * | 1, 2 | 0, 128  | clut range the puppet palette mixes into |
   * | 3    | 250     | answer text colour |
   * | 4    | 251     | frame around the answer you picked |
   * | 5    | 888     | font id (anything but 16 realises as Arial) |
   * | 6    | 12      | text size |
   * | 7    | 0       | subtitles on — see below |
   * | 8    | 0       | (TAOOT sets it around two puppets' lines: ZEIT1, BX2, SHAHACK2) |
   * | 9    | 2       | ticks per byte a text-paced line is held for |
   * | 10   | 8       | left margin of the answer rows (NOT the subtitle, which hardcodes 8) |
   *
   * Two of these TAOOT's shipped data overrides immediately and never puts
   * back — its BOOTFILE `boot()` opens with `puppetparam(9, 1)` and
   * `puppetparam(10, 25)` — so the answer rows a player actually sees are
   * indented 25, and 8 is only what a puppet opened outside the boot would use.
   * The subtitle is unaffected either way: it hardcodes its own 8.
   *
   * Slot 7 is the exception to "seeded with TI.EXE's defaults": the original
   * starts subtitles OFF and lets the title's settings panel turn them on
   * (TAOOT: the CTL.STG subtoggle lever), and this port starts them ON.
   */
  readonly puppetParams = new Map<number, number>([
    [1, 0], [2, 128], [3, 250], [4, 251], [5, 888], [6, 12], [7, 1], [8, 0], [9, 2], [10, 8],
  ]);
  /** subtitles-enabled (puppetparam slot 7); the viewer gates subtitle text on it */
  subtitlesOn(): boolean {
    return (this.puppetParams.get(7) ?? 1) !== 0;
  }
  /**
   * wave (sampled-audio) master volume, 0..9 — the CTL.STG settings dial reads
   * back wavevolume() and writes it live. Drives the sound + voice channels'
   * master gain. Music is separate (global themevolume + themevol). Default 9
   * (full) matches the sink's unity channel gain.
   */
  waveVolume = 9;
  /**
   * Theme (music) loudness as the scripts see it, 0..255 — what `themevol(track)`
   * reads back and `themevol(track, v)` writes. Held here because it has to be
   * READABLE: the getter used to answer nothing, and the scripts duck the score
   * with a read-modify-write.
   *
   * `themevol(currenttheme(2), themevol(currenttheme(2)) / 4)` is the idiom, and
   * with the getter answering 0 it means "set the music to zero and, on the way
   * back up, multiply zero by four". TAOOT's 1996 demo does exactly that around
   * every conversation (gang.cst `prepuppet`/`postpuppet`), so its music died at
   * the first puppet and never came back; NAREND.STG's bad-ending narration
   * ducks in three stages the same way and went silent at the first newspaper.
   *
   * A single channel, so the track name is informational (see the themevol
   * builtin). Starts at 255 — the engine's own full-volume default, which is
   * what a script reading before anything has set it should see.
   */
  themeVolume = 255;
  /** Set the theme loudness (0..255) and apply it to the audio channel. The one
   *  way it is written, so the value a script reads back is the one in effect. */
  setThemeVolume(v: number): void {
    this.themeVolume = Math.max(0, Math.min(255, Math.round(v)));
    this.audio.setChannelVolume("theme", this.themeVolume / 255);
  }
  /** framerate() target cadence; drag loops save/drop/restore it (turbine dials) */
  frameRate = 3;

  // ---- persistent text layer (drawstring/stringwidth builtins) ------------
  /** text drawn by drawstring(), composited over the screen after props.
   *  DreamFactory draws into a persistent buffer; we recomposite each frame,
   *  so we keep the drawn strings and re-apply them. Later draws at the same
   *  (x,y,size) replace earlier ones (TAOOT: CTL redraws its direction letters
   *  every update(); the wireless writes each morse glyph at a fresh x).
   *  Cleared on flat change and by clearmessagebox() (see the messageboxclear
   *  hook). */
  readonly textOverlay: { text: string; x: number; y: number; color: number; size: number }[] = [];
  /** measure a drawstring in device pixels using the render font; set by the
   *  viewer so stringwidth() matches what actually paints. null in headless
   *  tests, where stringwidth() falls back to a fixed-pitch estimate. */
  measureText: ((text: string, size: number) => number) | null = null;
  /**
   * The character set the loaded tree's text bytes are in — subtitles, choice
   * bevels, drawstring. A function rather than a value because the language is
   * the file source's business and can change under a live session; the host
   * points this at {@link FileStore.activeEdition}. Defaults to the same Mac OS
   * Roman a tree with no language reports (src/df/text.ts).
   */
  textEncoding: () => DfEncoding = () => DEFAULT_ENCODING;
  clearTextOverlay(): void {
    this.textOverlay.length = 0;
  }

  /**
   * Input the player made while the engine was mid-gesture, waiting its turn —
   * TI.EXE's event queue, see {@link EventQueue}. The viewer posts to it instead
   * of dropping the gesture, and drains it as it settles; `flushevents()` throws
   * it away, which is the whole reason scripts call that (92 places in the
   * TAOOT corpus).
   */
  readonly events = new EventQueue();

  // ---- pointer state (mouse()/button()/pointx/pointy builtins) ------------
  /** last pointer position in 512×384 screen space; scripts read it via mouse() */
  pointerX = 0;
  pointerY = 0;
  /** whether a mouse button is currently held (button() builtin) */
  pointerDown = false;
  /**
   * Whether SHIFT was held for the press being handled — the `shiftkey()` builtin.
   *
   * Snapshotted when the press arrives rather than tracked as live keyboard state,
   * because that is how the original asks: `shiftkey()` is read INSIDE a mousedown
   * handler (house.shp's HELP button), so what matters is the modifier the click
   * carried and not whether the key happens to still be down two frames later.
   *
   * `optionkey()` and `commandkey()` stay 0 — see the census where they are
   * registered (builtins/scene.ts).
   */
  shiftDown = false;
  /** engine time of the last `button()`/`stilldown()` — see {@link pollingInput} */
  private lastInputPoll = -Infinity;
  /** a script just read the button state: it owns this press (`button`, `stilldown`) */
  inputPolled(): void {
    this.lastInputPoll = this.clock.now;
  }
  /**
   * Is a script sitting in an input poll loop right now?
   *
   * The press that drives such a loop must NOT also go in the event queue. The
   * loop consumes it by polling — `while stilldown()`, `while not button()` — and
   * a queued copy is dispatched again when the loop ends, into whatever is on
   * screen by then. That is what `flushevents()` is for and why scripts call it
   * in 92 places (TAOOT corpus), but not all of them do: TAOOT's INVEN1.STG
   * `dobook()` (hiding the Rubaiyat in a coal bunker) ends without one, and the
   * replayed press then ate the very next click — the bunker flat's OK stopped
   * closing it, in a browser only, because only there does the press outlive a
   * frame.
   *
   * A poll within the last few engine steps means the loop is still going round:
   * each iteration yields a frame, so the gap between polls is one frame, not one
   * step. Anything older is a script that merely takes time (a door animation, a
   * walk), and a click made during THAT is exactly what the queue is for.
   */
  pollingInput(): boolean {
    return this.clock.now - this.lastInputPoll <= 4 * ENGINE_STEP_MS;
  }

  /** update the cursor position scripts see (called by the viewer on move/click) */
  setPointer(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
  }

  /** the pointer as the engine's packed point — see engine/point.ts */
  pointerPoint(): number {
    return packPoint(this.pointerX, this.pointerY);
  }
  /** rebuild the unqualified-call fallback chain (stage main + boot scripts) */
  refreshFallbacks(): void {
    this.interp.fallbackScripts = [this.stageScript, ...this.bootScripts].filter(
      (x): x is ScriptInstance => !!x,
    );
  }

  /**
   * STG stage layer: flats, click regions, and transtoflat/transfromflat
   * overlays. StageController owns the logic and is addressed directly
   * (`session.stageCtrl.gotoFlat(...)`); the session keeps the shared fields
   * (stageName, currentFlat, setVisible, flatScripts, flatNames).
   */
  readonly stageCtrl = new StageController(this);
  /**
   * Enter/leave a full-screen overlay stage — by running the GAME's own
   * `transtoflat`/`transfromflat`, which is where that whole sequence lives:
   * pausing the walks and crickets, fading out, hiding the departing stage's
   * props, stacking it in savestage1..3, opening the new one and running its
   * setup, then fading back in.
   *
   * The port used to reimplement it, which meant transcribing its two per-stage
   * switches into tables of TAOOT stage names — and reimplementing it less well:
   * TAOOT's shipped `restorescreen` handles a dead player, the unlit cabin, the
   * guided tour and the long fade after the Vlad fight, none of which the
   * transcription had.
   *
   * These stay as methods rather than becoming bare `runGlobal` calls at each
   * caller because the host, the dev bar and the suite all reach the overlay
   * system through them, and what they mean ("go to this flat") is stable even
   * though what performs it has moved into the data.
   */
  transToFlat(fileName: string) { return this.runGlobal("transtoflat", [fileName]); }
  transFromFlat() { return this.runGlobal("transfromflat"); }
  /** host hook: default directional navigation from boot's keydown — the
   * currentscene("strait"/"left"/"right") setter (walk/turn). */
  onNavigate: (direction: string) => void = () => {};
  /**
   * host hook: the currentscene("sceneNNN")/currentview("viewNNN") teleport
   * setters. Unlike a direction, these name a specific scene+view to cut to —
   * the hall "cross to the other side of the ship" move toggles hallside then
   * currentscene(...)/currentview(...) to the mirrored view (HALLC.SET keydown).
   * The viewer buffers the scene and executes the jump on the paired view call.
   */
  onSceneJump: (scene: string) => void = () => {};
  onViewJump: (view: string) => void = () => {};
  /**
   * Persistent nav drivers: the viewer's real turn/walk/teleport functions,
   * always bound (unlike the on* hooks above, which are no-ops outside a
   * gesture). The scheduler arms these around a SCENE loop so a scripted camera
   * pan (BEDSIT1 gotowin turning to face the bomb) drives the camera without a
   * user gesture in flight. Set by the viewer's constructor.
   */
  navDriver: (direction: string) => void = () => {};
  sceneJumpDriver: (scene: string) => void = () => {};
  viewJumpDriver: (view: string) => void = () => {};
  /**
   * True while a user gesture (keyDown / click) is being dispatched — the window
   * in which the nav hooks above are armed. A `changeset` mid-gesture (a door
   * that leads to another set: gstair3's grand-staircase exit) builds a NEW
   * viewer; it reads this to re-arm the hooks on itself so boot's default walk
   * (`currentscene("strait")`, run later in the SAME keydown chain after the
   * script passcodes) drives the NEW viewer instead of the old, discarded one.
   */
  navGestureActive = false;
  /**
   * True while the SCHEDULER is driving navigation for a scene loop, as opposed
   * to a player's keydown or click. Only a script's moves are deferred when one
   * is already running (SetViewer.navigate): a script means every step it asks
   * for, while a player leaning on a key means the one that lands.
   */
  navFromScript = false;
  /**
   * Player setting: land a right turn on the hi-res standpoint instead of the
   * low-res one the ring ends with (SetViewer.turnFrameImage).
   *
   * OFF is the original's behaviour and so the default — a right turn sharpens as
   * it settles, a left turn lands sharp, because that is how the two rings are
   * shipped (#68). On is the opt-in for players who would rather never see the
   * low-detail frame. It cannot make the turn ITSELF sharp: in-motion frames are
   * quarter-resolution in both rings and have no hi-res twin.
   *
   * Lives on the session rather than the viewer because a `changeset` builds a
   * fresh viewer and the setting has to outlive the room.
   */
  sharpLanding = false;
  /**
   * Set by the nav hooks when any navigation (walk/turn/teleport) happens during
   * a gesture. Session-scoped (not per-viewer) so it survives a mid-gesture set
   * change: the walk fires on the new viewer but keyDown, running on the old
   * viewer, still reads it to report "we navigated" and suppress the caller's
   * default walk fallback. Reset at the start of each gesture.
   */
  navHappened = false;
  /**
   * host hook: playmovie builtin. Returns a promise that resolves when the
   * whole movie (including any chained sub-movies) finishes, so the script
   * BLOCKS on playmovie the way TI.EXE's modal movie loop does — essential for
   * interactive movies (the purser window: knock -> lid opens -> only then does
   * the script read actionframe() and open the conversation). Headless / the
   * default no-op resolve at once (movies don't render in tests).
   */
  onPlayMovie: (fileName: string, startFrame?: number) => void | Promise<void> = () => {};

  /**
   * Action-frame indices the currently/most-recently played movie reached — the
   * nonzero `action` field of every frame the movie passed through. Cleared at
   * the start of each top-level playmovie and accumulated across a chain; the
   * `actionframe(n)` opcode queries membership. (The purser's knock frame sets 1.)
   */
  movieActions = new Set<number>();

  /**
   * host hook: clut/mixclut palette effect. `dim` null restores the target's
   * normal palette (clut(target)); a spec darkens entries lo..hi toward black
   * by amt/255 (mixclut(target,"black",lo,hi,amt)). Targets: "set", "stage",
   * "current". The viewer rebuilds the rendered CLUT. (Darkroom light switch.)
   */
  onClut: (target: string, dim: { lo: number; hi: number; amt: number } | null) => void = () => {};

  // ---- save / load game (.ti) ---------------------------------------------

  /**
   * host hook: the `savegame` builtin. Present the produced `.ti` bytes to the
   * user (browser: download; native: a Save As dialog). Resolves when done.
   */
  onSaveGame: (bytes: Uint8Array, version: string) => void | Promise<void> = () => {};
  /**
   * host hook: the `opengame` builtin. Return the chosen `.ti` file's bytes, or
   * null if the user cancelled (the CTL load lever treats null as "stay put").
   */
  onLoadGame: (version: string) => Promise<Uint8Array | null> = () => Promise.resolve(null);
  /**
   * host hook: raw bytes of a base `.ti` to patch when writing a save for a game
   * that was never loaded from a file (a fresh playthrough). Saving reproduces
   * bytes by patching a real save (see `docs/formats/savegame.md`); once a game
   * has been loaded, {@link lastSave} supersedes this.
   */
  saveTemplate: (() => Uint8Array | null) | null = null;
  /**
   * The container skeleton of the most recently loaded save — reused as the base
   * for the next {@link snapshotSave} so untouched containers round-trip exactly.
   */
  lastSave: RawSaveFile | null = null;

  /** produce the bytes of a save capturing the current progress — the
   *  patch-a-base-save logic lives in engine/saveload.ts */
  snapshotSave(): Uint8Array | null {
    return snapshotSave(this);
  }

  /** load a `.ti` save (restore globals, travel to the saved room) — the
   *  restore choreography lives in engine/saveload.ts */
  loadGame(bytes: Uint8Array): Promise<boolean> {
    return loadGame(this, bytes);
  }

  /**
   * Invoke a globally-callable handler (stage/boot standard library) the way
   * unqualified script calls resolve — first fallback script that defines it.
   */
  async runGlobal(handler: string, args: Value[] = []): Promise<Value> {
    for (const inst of this.interp.fallbackScripts) {
      if (inst.script.codes.has(handler)) {
        return (await this.interp.runHandler(inst, handler, args, { me: inst.name, target: "" }))
          .value;
      }
    }
    this.onLog(`runGlobal: no handler "${handler}"`);
    return 0;
  }

  /**
   * Fire a lifecycle handler (openshop/opencast/openstage/openflat/…) on a
   * script that may not define it: run it with `me` = the owning object and
   * log — never throw — a script error under `label`. The one idiom every
   * resource open/close shares. This is NOT event traversal: an event walks a
   * chain and honours passcode/exitcode ({@link sendEvent}); a lifecycle fire
   * addresses exactly one script and only needs to survive its errors.
   */
  async fireHandler(
    inst: ScriptInstance | null | undefined,
    handler: string,
    me: string,
    label = `${me}.${handler}`,
  ): Promise<void> {
    if (!inst?.script.codes.has(handler)) return;
    try {
      await this.interp.runHandler(inst, handler, [], { me, target: "" });
    } catch (e) {
      this.onLog(`${label}: ${(e as Error).message}`);
    }
  }

  /**
   * Canonical name of the set being opened = the FILE basename. The
   * internal setName field can differ (TAOOT's DECKBD.SET says "decka"), but
   * scripts bind actors/props/crickets to the name they opened.
   */
  currentSetFile = "";

  /** engine primitive behind boot's changeset(): switch to another set */
  async openSetFile(fileName: string, sceneName = "", viewName = ""): Promise<void> {
    const key = fileName.toLowerCase();
    this.onLog(`opensetfile("${key}", "${sceneName}", "${viewName}")`);
    this.lastRotation = this.currentRotation ? this.currentRotation() : null;
    this.currentSetFile = key.replace(/\.set$/, "");
    await this.onSetChange(key, sceneName.toLowerCase(), viewName.toLowerCase());
  }

  /** try to parse a set through the provider (null if not available yet) */
  loadSet(fileName: string): SetFile | null {
    const data = this.files(fileName.toLowerCase());
    if (!data) return null;
    try {
      return readSetFile(data);
    } catch (e) {
      this.onLog(`${fileName}: ${(e as Error).message}`);
      return null;
    }
  }

  async openTrackFile(fileName: string): Promise<boolean> {
    const key = toStr(fileName).toLowerCase();
    // A title may name theme tracks by REGION rather than by set — TAOOT names
    // them by deck: recept1c's theme is deckd.trk, halla's is decka.trk (see
    // its BOOTFILE setupsound/themetype). The set-change prefetch only pulls
    // <setName>.trk, so the real theme bank is usually absent here. Fetch it on
    // demand (browser provider), exactly as opensetfile/puppets/casts do —
    // otherwise playnewtheme finds no theme and the room is silent (or the
    // wrong theme keeps playing).
    await this.ensureFile(key);
    const data = this.files(key);
    if (!data) {
      this.onLog(`opentrackfile: "${fileName}" not available`);
      return false;
    }
    return this.audioLib.openBank(key, data);
  }

  /** prop-group script instances of loaded shops, by lowercase prop name */
  readonly propScripts = new Map<string, ScriptInstance>();
  private shopMains = new Map<string, ScriptInstance | null>();

  /** per-character script instances of loaded casts, by actor name */
  readonly castScripts = new Map<string, ScriptInstance>();
  private castMains = new Map<string, ScriptInstance | null>();

  /**
   * Give an `actorinstance(src, dst)` copy its own script, so events can reach
   * it — a copy shares the source's sprite AND its behaviour.
   *
   * `castScripts` is keyed by CAST MEMBER name and built once at cast load, so a
   * copy had no entry at all: `sendtoactor("stok3", setupactor("boil"))` found
   * no chain and was dropped as "target not loaded", and the copy was therefore
   * never placed, scaled or made visible. TAOOT's boiler rooms are one member
   * (`stok1`) plus up to nine copies of him, so eight of the nine stokers were
   * missing from the shovel line (user-reported). The lifeboat crowd on the boat
   * deck is built the same way.
   *
   * A copy gets its OWN instance rather than a second reference to the source's:
   * the two share the parsed script, but `me` comes from the instance's name, and
   * every line of the shared handler is written against it — `actorpose(me, …)`,
   * `makeloop("actor", me, "stokidle", …)`. Pointing the copy at the source's
   * instance would make all ten stokers drive `stok1`.
   */
  instanceCastScript(src: string, dst: string): void {
    const from = this.castScripts.get(src.toLowerCase());
    if (!from) return;
    const key = dst.toLowerCase();
    const inst = new ScriptInstance(key, from.script);
    inst.parent = from.parent; // the cast main: stdactor, endwalk, runpuppet
    this.castScripts.set(key, inst);
    this.instancedActors.add(key);
  }

  /**
   * Drop the script of an `actordelete`d copy.
   *
   * Only a COPY's: a cast member deleted from the world keeps its script, which
   * is what lets TAOOT's stokers put themselves back — `putdownactor` deletes
   * stok2…stok10 and the next `setupactor` re-instances them from `stok1`, who
   * was never a copy and must still answer.
   */
  dropInstancedScript(name: string): void {
    const key = name.toLowerCase();
    if (!this.instancedActors.delete(key)) return;
    this.castScripts.delete(key);
  }

  /** which castScripts entries came from actorinstance() rather than a cast */
  private instancedActors = new Set<string>();

  // ---- puppet mode (PUP conversation close-ups) ---------------------------
  // Conversation state + playback live in PuppetController, addressed directly
  // (`session.puppetCtrl.puppetSpeak(...)`). Only the active-conversation STATE
  // keeps a session accessor: `session.puppet` is read in two dozen places for
  // "is a close-up holding the screen?".
  readonly puppetCtrl = new PuppetController(this);
  get puppet() { return this.puppetCtrl.puppet; }

  /**
   * Load a CST cast file session-wide: register its characters (actors) and
   * their scripts. Idempotent — sets call opencastfile("extra.cst") freely.
   */
  async openCastFile(fileName: string): Promise<boolean> {
    const key = fileName.toLowerCase();
    if (this.castMains.has(key)) return true;
    await this.ensureFile(key);
    const data = this.files(key);
    if (!data) {
      this.onLog(`opencastfile: "${fileName}" not available`);
      return false;
    }
    let cst;
    try {
      cst = readCstFile(data);
    } catch (e) {
      this.onLog(`opencastfile: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    this.actorRuntime.addCast(key, cst);
    const main = this.instanceFrom(cst.file.containers[1]?.data, key);
    this.castMains.set(key, main);
    for (const m of cst.members) {
      const inst = this.instanceFrom(cst.file.containers[m.scriptLocation]?.data, m.name);
      if (inst) {
        inst.parent = main; // stdactor/stdscale/endwalk live in the cast main
        this.castScripts.set(m.name, inst);
      }
    }
    await this.fireHandler(main, "opencast", key, `opencast ${key}`);
    this.onLog(`cast loaded: ${key} (${cst.members.length} characters)`);
    return true;
  }

  closeCastFile(fileName: string): void {
    const key = fileName.toLowerCase();
    const cast = this.actorRuntime.casts.get(key);
    if (cast) {
      for (const m of cast.cst.members) this.castScripts.delete(m.name);
      // ...and the actorinstance() copies, which are not members and so are not
      // on that list. removeCast below drops them from the world by cast; their
      // scripts have to go with them or the next cast to use those names
      // (stok2…stok10, life1…) inherits the old one.
      for (const [name, a] of this.actorRuntime.actors) {
        if (a.cast === cast) this.dropInstancedScript(name);
      }
    }
    this.castMains.delete(key);
    this.actorRuntime.removeCast(key);
  }

  /** main script of a loaded shop (sendtoshop target), by file name */
  shopMain(name: string): ScriptInstance | null {
    return this.shopMains.get(name.toLowerCase()) ?? null;
  }

  /** session-scoped sendto* targets (usable before any set is open) */
  findGlobalInstance(name: string): ScriptInstance | null {
    const lower = name.toLowerCase();
    return (
      this.puppet?.scripts.get(lower) ??
      this.propScripts.get(lower) ??
      this.castScripts.get(lower) ??
      this.shopMains.get(lower) ??
      this.castMains.get(lower) ??
      this.flatScripts.get(lower) ??
      (this.stageScript && this.stageScript.name.toLowerCase() === lower ? this.stageScript : null) ??
      (lower === "boot" ? this.boot : null)
    );
  }

  /**
   * Load a SHP file session-wide: register its props + prop scripts and fire
   * its openshop handler. Shops opened by the boot script (house.shp,
   * inven.shp) stay loaded across set changes.
   */
  async openShop(fileName: string): Promise<boolean> {
    const key = fileName.toLowerCase();
    // Already loaded: re-run its openshop handler without rebuilding the props
    // (which would drop their state). A stage opens its shop on entry via
    // open<basename>() — TAOOT: openwireless -> openshopfile("wireless.shp") —
    // and openshop() ends by pushing the per-entry view setup to the active
    // flat (setupsmallprops). Re-firing it here makes that run in the stage's
    // context even when the shop was first opened at set-load.
    if (this.shopMains.has(key)) {
      await this.fireHandler(this.shopMains.get(key), "openshop", key, `openshop ${key} (re-entry)`);
      return true;
    }
    await this.ensureFile(key); // lazy browser provider: fetch before first read
    const data = this.files(key);
    if (!data) {
      this.onLog(`openshopfile: "${fileName}" not available`);
      return false;
    }
    let shp;
    try {
      shp = readShpFile(data);
    } catch (e) {
      this.onLog(`openshopfile: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    this.propRuntime.addShop(key, shp);
    // a boot-UI shop's screen props draw over the room view, however it was
    // opened — by the port's stand-in boot or by the game's own openshopfile
    const loaded = this.propRuntime.shops.get(key);
    if (loaded && BOOT_UI_SHOPS.includes(key)) loaded.persistent = true;
    const main = this.instanceFrom(shp.file.containers[shp.mainScriptLocation]?.data, key);
    this.shopMains.set(key, main);
    for (const g of shp.groups) {
      const inst = this.instanceFrom(shp.file.containers[g.scriptContainerLocation]?.data, g.name);
      if (inst) {
        inst.parent = main; // unqualified calls resolve via the shop main
        this.propScripts.set(g.name.toLowerCase(), inst);
      }
    }
    await this.fireHandler(main, "openshop", key, `openshop ${key}`);
    this.onLog(`shop loaded: ${key} (${shp.groups.length} props)`);
    return true;
  }

  async closeShop(fileName: string): Promise<void> {
    const key = fileName.toLowerCase();
    const main = this.shopMains.get(key);
    if (main) {
      try {
        await this.interp.runHandler(main, "closeshop", [], { me: key, target: "" });
      } catch {
        /* tolerated */
      }
    }
    this.shopMains.delete(key);
    const shop = this.propRuntime.shops.get(key);
    if (shop) {
      for (const g of shop.shp.groups) this.propScripts.delete(g.name.toLowerCase());
    }
    this.propRuntime.removeShop(key);
  }

  /**
   * Replay the resource openings this game's `boot()` performs, without its game
   * flow — the movies it plays and the day it advances into.
   *
   * Derived, not listed. This used to name TAOOT's `inven.trk`, `unilib.trk`,
   * `inven.shp`, `house.shp`, `gang.cst` and `main.stg`, which is one game's boot
   * transcribed into the engine; {@link bootPlan} reads the same six out of the
   * BOOTFILE that opens them, so a different title's stand-in opens ITS resources
   * instead. The order is the boot's own, which is also more faithful than the
   * grouping this replaced (banks, then shops, then the cast).
   *
   * Dispatch is by extension, because that is what the primitive the boot called
   * is determined by: `.cst` was an `opencastfile`, `.shp` an `openshopfile`. A
   * MOVIE is skipped — `playmovie("logo.mov")` is game flow, and the whole point
   * of a stand-in is to reach a running game without playing the intro.
   */
  async loadBootResources(): Promise<void> {
    for (const file of this.bootPlan().resources) {
      if (!this.files(file)) continue; // a name this tree does not carry
      if (file.endsWith(".trk")) this.audioLib.openBank(file, this.files(file)!);
      else if (file.endsWith(".shp")) await this.openShop(file);
      else if (file.endsWith(".cst")) await this.openCastFile(file);
      else if (file.endsWith(".stg")) await this.stageCtrl.openStageFile(file);
    }
  }
}
