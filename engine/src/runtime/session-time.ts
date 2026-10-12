import { passDue } from "./clock";
import type { GameSession } from "./session";

/** one TI.EXE tick, 50/3 ms — the unit stepped game time moves in */
const TICK_MS = 50 / 3;
/**
 * Tick `n` in whole milliseconds: `ceil(n × 50/3)`. Whole, so three ticks are
 * exactly one 50 ms pass whatever tick they start on, and the pass, the road
 * frame and the pause land on the same tick on every machine; rounded UP, so
 * `ticksAt` reads back `n` itself (the rounding adds under a millisecond, less
 * than a tenth of a tick).
 */
const tickMs = (n: number): number => Math.ceil((n * 50) / 3);
/**
 * How early a host call may come and still be the next tick. A page is called
 * on the display's refresh, which at 60 Hz lands a hair either side of 1/60 s;
 * held to the exact tick, every early one would be skipped and the game would
 * play at a stutter well under 60 ticks a second. Early by this much is on time.
 */
const TICK_SLACK_MS = 2;

/**
 * The game's clock: the host's raw time less freezes and file loads, stepped
 * one pass at a time under speedrun time and held between a sheet's holds and
 * pauses (#508), and the run's in-game time counted off it. Owned by
 * GameSession, which forwards its methods and the fields read outside here.
 */
export class SessionTime {
  constructor(private readonly session: GameSession) {}

  /** the host's last raw clock reading, and how much of it the game has slept through */
  private rawNow = 0;
  private frozenSince: number | null = null;
  private frozenTotal = 0;

  /**
   * The host's clock as the GAME should see it: real time, less every stretch
   * the world was frozen for. Every timed thing in the engine — the service
   * pass, `delay`, the fade and wipe ramps, prop animation, movies — is a delta
   * off this one reading, so holding it still holds all of them, and nothing
   * needs a resume path or a catch-up cap: the deltas are simply zero while
   * frozen and continue unbroken afterwards.
   *
   * TI.EXE freezes the same way and for the same reason, though it doesn't have
   * to ask: `GetOpenFileNameA` runs its own modal message loop, so the game's
   * loop is not running at all while the dialog is up — no service pass, no
   * frame counter, no wave buffer refilled. See {@link freezeTime}.
   */
  gameTime(raw: number): number {
    this.closeSheetHolds();
    // Under a sheet's clock, nothing before the boot is the game's: the page's
    // own intro and its question run on the page, not on passes (#508)
    // …and not while a gesture the engine is about to take is still queued: it
    // is taken in a frame of its own, at no game time (ScreenDirector.inputDrainable)
    const held =
      this.blockedOnFiles > 0 ||
      (this.sheetClock &&
        (!this.session.bootCtrl.coreLoaded ||
          (this.runningHolds() === 0 && this.pausePasses === 0) ||
          this.session.inputWaiting()));
    if (held && this.lastRaw !== null) this.blockedTotal += raw - this.lastRaw;
    this.lastRaw = raw;
    this.rawNow = raw;
    const real = (this.frozenSince ?? raw) - this.frozenTotal - this.blockedTotal;
    this.realNow = real;
    if (!this.nominalTime && !this.sheetClock) {
      this.gameNow = real;
      this.stepAnchor = null; // stepping again starts from here
      this.releaseTickWaiters(); // not stepping: nobody waits on a tick
      return real;
    }
    // Stepped: one TICK of game time per due tick of real time, never more
    // (passDue) — so everything timed off this reading counts ticks, not
    // milliseconds, whatever the machine managed in between (#508).
    //
    // A tick (1/60 s) and not a 50 ms pass, because the tick is TI.EXE's unit
    // (#542): its throttle (0x43a940) waits `framerate` ticks, and a script that
    // drops `framerate` below 3 — the turbine's valves to 0, the fencing to 2 —
    // runs its loop that much faster; a film frame holds its own ticks
    // (mov-pace.frameHoldMs); a fade ramps one step a tick. Stepped in passes,
    // every one of those was held to 20 a second.
    //
    // The first frame after the game stood still — a sheet thinking, a file
    // arriving — runs NO tick, and the rhythm starts from it. Input made while
    // it stood still is taken in that frame (a queued click is popped after the
    // tick, SetViewer.advanceRoom), so it always lands on the tick it was made
    // on. Ticked at once if the frame happened to be due, it landed on the
    // next one in some runs and not in others: a spoken answer a tick apart.
    const resumed = this.wasHeld && !held;
    this.wasHeld = held;
    if (this.stepAnchor === null) {
      this.startStepping(real);
    } else if (resumed) {
      this.stepAnchor = real;
    } else {
      const tick = passDue(this.stepAnchor, real + TICK_SLACK_MS, TICK_MS);
      if (tick.due) {
        // a stall starts the rhythm over from the reading itself, not from the
        // reading plus the slack — or every later tick sits on the slack's edge
        this.stepAnchor = tick.next === real + TICK_SLACK_MS ? real : tick.next;
        this.stepTicks++;
        this.gameNow = tickMs(this.stepTicks);
        // a poll waits out a fade ramp another script is blocked in: TI.EXE runs
        // nothing else until it is over (SessionTransitions.ramp, #541)
        if (!this.session.fade.ramping) this.releaseTickWaiters();
        // a pause between presses is still counted in 50 ms passes: every third tick
        if (this.pausePasses === 0) this.pauseTicks = 0;
        else if (this.runningHolds() === 0 && ++this.pauseTicks >= 3) {
          this.pauseTicks = 0;
          if (this.sheetHalted) this.sheetWatchPasses--;
          else this.sheetPasses--;
        }
      }
    }
    return this.gameNow;
  }

  /**
   * Speedrun time: game time advances by exactly one tick (1/60 s) per tick
   * the engine runs, instead of following the real clock (#508, #542).
   *
   * Everything the engine times is a delta off {@link gameTime} — the service
   * pass, `delay`, the fade and wipe ramps, prop animation, film pacing — so
   * under this switch each of them costs the same number of ticks on a slow
   * machine as on a fast one: a slow machine runs fewer ticks a second, not
   * different ones. What the real clock still decided — speech and sound
   * effects, which the original waits on through the sound card — is answered
   * from the clip's own length in game time instead ({@link TimedAudio}).
   *
   * Off for play: there the original's real-time waits stay real time.
   */
  get nominalTime(): boolean {
    return this.nominal;
  }
  set nominalTime(on: boolean) {
    this.nominal = on;
    this.steppingSwitched();
  }
  private nominal = false;

  /**
   * A sheet's clock: the game stands still unless the runner is waiting on it
   * (#508). A speedrun sheet's own thinking — the round trip from the runner,
   * deciding the next line — is not the route's, and on a slow machine it is
   * longer; so under this switch time moves only inside a hold
   * ({@link sheetHolds}, until the condition the runner waits for comes
   * true, checked in the page every frame) or for a set number of passes
   * ({@link sheetPasses}, a pause between presses). Each step then ends on the
   * pass the game decided, whatever the machine. Off for a human, whose
   * waiting is theirs. Implies {@link nominalTime}.
   */
  get sheetClock(): boolean {
    return this.sheet;
  }
  set sheetClock(on: boolean) {
    this.sheet = on;
    this.steppingSwitched();
  }
  private sheet = false;

  /**
   * Stepped time starts the moment it is switched on, not at the next frame: a
   * runner reads the clock right after switching, and a start left to the next
   * frame landed before that reading or after it by real time — the jump to the
   * first whole pass in one run's total and not in another's (#542).
   */
  private steppingSwitched(): void {
    this.session.clock.ticked = this.nominal || this.sheet;
    if ((this.nominal || this.sheet) && this.stepAnchor === null) this.startStepping(this.realNow);
  }

  /**
   * Begin stepped time on a whole pass: the scheduler's pass and the frame
   * counter fall on tick numbers that are multiples of their period (#542).
   */
  private startStepping(real: number): void {
    this.stepAnchor = real;
    this.stepTicks = 3 * Math.ceil(Math.max(this.gameNow, real) / 50);
    this.gameNow = tickMs(this.stepTicks);
  }
  /**
   * Holds open — what the runner is waiting for, by id. The ENGINE asks them,
   * each time it is about to decide whether a pass may run — which is just
   * after the last pass's work — and closes each the moment it holds: so the clock stops on the
   * very pass the condition came true, not a frame later when a driver
   * polling on its own beat noticed — which is what left runs a frame or
   * three apart.
   */
  readonly sheetHolds = new Map<number, () => boolean>();
  /** passes still to run with no hold open */
  sheetPasses = 0;
  /**
   * A sheet's standing watches (`watchFor`), by id, asked beside the holds
   * (#509). A watch never runs the game; RISING, it stops it — on the very pass
   * its condition came true — until the runner has acted on it. Polled from the
   * runner's own beat instead, a watch would press its key some passes after the
   * film it watches for began, and how many would be the machine's.
   */
  readonly sheetWatches = new Map<number, { met: () => boolean; was: boolean; rose: boolean }>();
  /**
   * A watch has risen and the runner has not acted on it yet: the interrupted
   * line stands still — its holds neither run the game nor close, its pauses
   * do not count down — and only the watch's own action moves the game, through
   * {@link sheetWatchHolds} and {@link sheetWatchPasses}. The runner clears it
   * when the action is done.
   */
  sheetHalted = false;
  /** the holds a watch's action opened — the only ones that count while halted */
  readonly sheetWatchHolds = new Set<number>();
  /** a watch's action's pause, in passes — the only one that counts while halted */
  sheetWatchPasses = 0;

  /** the open holds that may run the game: the watch's own while halted, else all */
  private runningHolds(): number {
    if (!this.sheetHalted) return this.sheetHolds.size;
    let n = 0;
    for (const id of this.sheetHolds.keys()) if (this.sheetWatchHolds.has(id)) n++;
    return n;
  }
  /** the pause in passes that counts right now */
  private get pausePasses(): number {
    return this.sheetHalted ? this.sheetWatchPasses : this.sheetPasses;
  }

  /** close every hold whose condition now holds, and note every watch that rose */
  closeSheetHolds(): void {
    const asked = (met: () => boolean): boolean => {
      try {
        return met();
      } catch {
        return false; // a throwing condition counts as not yet
      }
    };
    if (this.blockedOnFiles > 0) return; // not while a file is coming — see loadingFiles
    for (const [id, met] of this.sheetHolds) {
      if (this.sheetHalted && !this.sheetWatchHolds.has(id)) continue;
      if (asked(met)) this.sheetHolds.delete(id);
    }
    for (const w of this.sheetWatches.values()) {
      const now = asked(w.met);
      if (now && !w.was) {
        w.rose = true;
        this.sheetHalted = true;
      }
      w.was = now;
    }
  }
  /** the game time {@link gameTime} last returned */
  gameNow = 0;
  /** the real time it was read off, less loads and freezes — what a waiting player spends */
  private realNow = 0;

  /**
   * A run's in-game time, in ms, counted on from whenever: a timer takes the
   * difference of two readings (#508). The host calls {@link countRun} once
   * a frame, saying whether the game is waiting for the player.
   *
   * While the game is busy — a film, a walk, a line being spoken — it counts
   * the game time that went by, which under speedrun time is passes, the same
   * on any machine. While it waits for a PERSON, it counts the real time they
   * took, at full speed whatever the machine: that wait is theirs, and a slow
   * machine running fewer passes must not shrink it. A sheet's waiting is
   * counted as game time too, which under a sheet's clock is none. Loads the
   * engine waited on are out of both.
   */
  runMs = 0;
  private runFrom: { real: number; game: number } | null = null;

  countRun(waitingForPlayer: boolean): void {
    const at = { real: this.realNow, game: this.gameNow };
    if (this.runFrom) {
      const theirs = waitingForPlayer && !this.sheetClock;
      this.runMs += Math.max(0, theirs ? at.real - this.runFrom.real : at.game - this.runFrom.game);
    }
    this.runFrom = at;
  }
  private stepAnchor: number | null = null;
  /** ticks of stepped game time — {@link gameNow} is {@link tickMs} of it */
  private stepTicks = 0;
  /** ticks of the pass a pause is in, counted to three */
  private pauseTicks = 0;
  private tickWaiters: (() => void)[] = [];
  /** whether the last reading was taken with the game standing still */
  private wasHeld = false;

  /**
   * Resolves once the next tick of stepped time has gone by — after the whole of
   * the frame that ran it, because the frame is one synchronous call and the
   * promise settles after it (#542).
   *
   * What a script's poll waits on under speedrun time, in place of the next
   * screen refresh. A refresh is not a tick: in the frame that runs one, the
   * script's own refresh callback may come before the engine's or after it, so
   * a poll answered on the refresh saw the tick in one run and the tick before
   * it in the next, and went on a tick late — a spoken line that ended a tick
   * apart, measured. Waiting on the tick, the script always goes on from the
   * same one. While the game stands still (a sheet thinking, a file loading, a
   * dialog) no tick comes and the script waits too, as the original's would.
   */
  nextTick(): Promise<void> {
    return new Promise((resolve) => this.tickWaiters.push(resolve));
  }

  private releaseTickWaiters(): void {
    if (!this.tickWaiters.length) return;
    const waiting = this.tickWaiters;
    this.tickWaiters = [];
    for (const resolve of waiting) resolve();
  }

  /**
   * How many of the engine's own file loads it is stopped for right now — a
   * room and its casts, a film about to play, a file a script opened, a save
   * being restored ({@link whileLoading}).
   *
   * While any is open, {@link gameTime} stands still: no pass, no frame, no
   * `delay` running down. The original read its disc synchronously, so its
   * loop did nothing at all until the read returned, and a run's frame count
   * must not depend on how fast the file arrived — over the network or off a
   * slow disk (#508). Fetches nobody waits for (the boot's preload, background
   * warming) do not count: the game plays on through those, in the original's
   * intro too.
   */
  private blockedOnFiles = 0;
  private blockedTotal = 0;
  private lastRaw: number | null = null;

  /** run `load` with the game's clock stopped — see {@link blockedOnFiles} */
  async whileLoading<T>(load: Promise<T>): Promise<T> {
    this.blockedOnFiles++;
    try {
      return await load;
    } finally {
      this.blockedOnFiles--;
    }
  }

  get frozen(): boolean {
    return this.frozenSince !== null;
  }

  /**
   * Is the engine waiting on a file right now? A sheet's runner does not look
   * at the game while it is (#509): a pause is not over and a hold does not
   * close until the load has landed. Else a runner on a slow link would see a
   * film that is still downloading as no film at all, pause a pass, and the pass
   * would run the moment the file came — with the film on screen and nobody
   * pressing ESC at it — where a runner with the file to hand presses first.
   */
  get loadingFiles(): boolean {
    return this.blockedOnFiles > 0;
  }

  /**
   * Stop the world: hold the clock and suspend the sound, until {@link thawTime}.
   *
   * Nested calls are not tracked on purpose — the one caller is a host modal
   * (`opengame`/`savegame`), and two of those cannot be up at once.
   */
  freezeTime(): void {
    if (this.frozenSince !== null) return;
    this.frozenSince = this.rawNow;
    this.session.audio.setSuspended(true);
  }

  thawTime(): void {
    if (this.frozenSince === null) return;
    this.frozenTotal += this.rawNow - this.frozenSince;
    this.frozenSince = null;
    this.session.audio.setSuspended(false);
  }
}
