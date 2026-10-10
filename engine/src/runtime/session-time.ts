import { ENGINE_STEP_MS, passDue } from "./clock";
import type { GameSession } from "./session";

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
    const held =
      this.blockedOnFiles > 0 ||
      (this.sheetClock && (!this.session.bootCtrl.coreLoaded || (this.runningHolds() === 0 && this.pausePasses === 0)));
    if (held && this.lastRaw !== null) this.blockedTotal += raw - this.lastRaw;
    this.lastRaw = raw;
    this.rawNow = raw;
    const real = (this.frozenSince ?? raw) - this.frozenTotal - this.blockedTotal;
    this.realNow = real;
    if (!this.nominalTime && !this.sheetClock) {
      this.gameNow = real;
      return real;
    }
    // Stepped: one 50 ms pass of game time per due pass of real time, never
    // more (passDue) — so everything timed off this reading counts passes, not
    // milliseconds, whatever the machine managed in between (#508).
    if (this.stepAnchor === null) {
      this.stepAnchor = real;
      this.gameNow = Math.max(this.gameNow, real);
    } else {
      const pass = passDue(this.stepAnchor, real, ENGINE_STEP_MS);
      if (pass.due) {
        this.stepAnchor = pass.next;
        this.gameNow += ENGINE_STEP_MS;
        if (this.runningHolds() === 0 && this.pausePasses > 0) {
          if (this.sheetHalted) this.sheetWatchPasses--;
          else this.sheetPasses--;
        }
      }
    }
    return this.gameNow;
  }

  /**
   * Speedrun time: game time advances by exactly one 50 ms pass per pass the
   * engine runs, instead of following the real clock (#508).
   *
   * Everything the engine times is a delta off {@link gameTime} — the service
   * pass, `delay`, the fade and wipe ramps, prop animation, film pacing — so
   * under this switch each of them costs the same number of passes on a slow
   * machine as on a fast one: a slow machine runs fewer passes a second, not
   * different ones. What the real clock still decided — speech and sound
   * effects, which the original waits on through the sound card — is answered
   * from the clip's own length in game time instead ({@link TimedAudio}).
   *
   * Off for play: there the original's real-time waits stay real time.
   */
  nominalTime = false;

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
  sheetClock = false;
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
