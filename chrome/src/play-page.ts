/**
 * The page around a DreamFactory game: what RedJack's, Timelapse's and Dust's
 * `src/main.ts` each did line for line before it was here.
 *
 *   - the controls every play page carries ({@link installPageControls}):
 *     fullscreen and its stretch, and the bug report that arrives with the
 *     screen attached — and the version and the Play menu in the band
 *   - the picture: the game's screen composed on a plate and blitted up into a
 *     canvas twice its size, so the page only ever shrinks it
 *   - the Details column and the log in it, and the input log behind its box
 *   - the boot: the gauge, the prefetch weighed in bytes, the frame loop, the
 *     handle the speedrun driver reads (`window.dbg`), and the Enter press the
 *     audio waits for, then the tracked cold boot
 *
 * What stays in each game's page is what differs: its files, what it fetches
 * that the BOOTFILE does not name, where you stand (the readout), its cursors,
 * and how its hands reach the game. Titanic's page keeps its own boot, which
 * picks an edition and a language first, and Dust's, which reads its panel and
 * a room before the file store exists; both share the controls.
 *
 * Here and not in the engine because the controls are the site's (the version,
 * the menu, the issue tracker), and not in a game because a game may not import
 * another (site/tests/layering.ts).
 */
import { GameHost } from "@dreamfactory/engine/web/host";
import { installFullscreen } from "@dreamfactory/engine/web/fullscreen";
import { installStretch } from "@dreamfactory/engine/web/stretch";
import {
  BootBar,
  GestureAudio,
  PageLog,
  brandFallback,
  screenPlate,
  titleRise,
  untilStarted,
  waitForStart,
} from "@dreamfactory/engine/web/page-shell";
import { DetailsColumn } from "@dreamfactory/engine/web/details-column";
import { InputLog } from "@dreamfactory/engine/web/input-log";
import { loadClock, watchLoads } from "@dreamfactory/engine/web/load-clock";
import type { RipFiles } from "@dreamfactory/engine/web/rip-files";
import type { SpineVar } from "@dreamfactory/engine/web/debug-panel";
import { installBugReport, type ShotWent } from "./bug-report";
import type { GameEditions } from "./games";
import { installPlayMenu } from "./play-menu";
import { VERSION, installVersion } from "./version";

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/** how long the screenshot's fate stays on screen before it is taken down, unless a page says */
const BUG_NOTE_MS = 6000;

export interface PageControlsOptions {
  /** the game, as games.ts lists it: its folder names the stretch box's memory and the screenshot */
  game: Pick<GameEditions, "short" | "dir">;
  canvas: HTMLCanvasElement;
  /** what fullscreen fills: the STAGE, not the canvas (see #stage.fs) */
  stage: HTMLElement;
  /** the log, for what fullscreen has to report */
  say(line: string): void;
  /** which files the game is running from, as an issue should say it */
  edition(): string;
  /** where the player stands, as the readout says it */
  where(): string;
  /** the log's last `n` lines */
  log(n: number): readonly string[];
  /** the screenshot's fate, in the reader's language — asked at the press, so a page that changes language says it in the new one */
  note?(how: ShotWent): string;
  /** how long that stays */
  noteMs?: number;
  /** the screenshot's name, where the game's folder is not what it is called by */
  shotName?: string;
}

/**
 * The controls every play page carries under its picture. Fullscreen, of the
 * STAGE: fullscreening the canvas hands the letterbox to the UA, and a class
 * rather than the `:fullscreen` pseudo, because an iPhone has no element
 * fullscreen to match and the page fills itself there instead
 * (engine/src/web/fullscreen.ts). Whether the picture keeps its 4:3 there
 * (engine/src/web/stretch.ts). And the bug report, which arrives with the
 * screen attached; the issue itself is English, because it is read by whoever
 * fixes it. A page without one of the buttons — the workbench carries the
 * stage and none of the settings strip — goes without.
 */
export function installPageControls(o: PageControlsOptions): void {
  installFullscreen($<HTMLButtonElement>("fsBtn"), o.stage, { report: o.say, landscape: true });
  installStretch($<HTMLInputElement>("stretchBox"), o.stage, `${o.game.dir}.picture.stretch`);
  const bugBtn = $<HTMLButtonElement>("bugBtn");
  if (!bugBtn) return;
  const bugNote = $("bugNote");
  const shotName = o.shotName ?? `${o.game.dir}-bug.png`;
  const said =
    o.note ??
    ((how: ShotWent): string =>
      how === "clipboard" ? "screen copied — paste it into the issue" : `screen saved — attach ${shotName} to the issue`);
  installBugReport(bugBtn, {
    game: o.game.short,
    canvas: o.canvas,
    shotName,
    version: VERSION,
    where: o.where,
    edition: o.edition,
    log: (n) => [...o.log(n)],
    note: (how) => {
      if (!bugNote) return;
      bugNote.textContent = said(how);
      window.setTimeout(() => (bugNote.textContent = ""), o.noteMs ?? BUG_NOTE_MS);
    },
  });
}

/** the band's version and its Play menu — in English: the games behind these pages are not translated */
function installBand(): void {
  installVersion();
  void installPlayMenu({ english: true });
}

export interface PlayPageOptions {
  /** the game, as games.ts lists it: its name, its folder, its screen */
  game: GameEditions;
  /** which files it runs from, for an issue ("RedJack 3CD (gamefiles/RJDisk1-3/)") */
  edition: string;
  /**
   * The page's shape, as its stylesheet's layer says it (chrome/src/play-*.css).
   * `pinned`: the card RISES into its band by FLIP (`titleRise`), once the full
   * bar has been held a moment (`untilStarted`). `flow`: the band is a class
   * the column's own transitions animate, and the button follows the bar.
   */
  shape: "pinned" | "flow";
  /** the gauge's accessible value, in whole percent: a `<progress>` or an `aria-valuenow` */
  value(pct: number): void;
  /** the caption under the gauge; the newest label wins */
  caption(label: string): void;
}

/** what {@link PlayPage.host} wires the game to */
export interface PlayHostOptions {
  /** the few script globals worth naming first in the Details column */
  spine: readonly SpineVar[];
  /** a workbench's `reset(seed: N)`, taken before the boot draws (speedrun/src/boot-seed.ts) */
  seed: number | null;
  /** what else the host is told: where this game's props stand */
  propAnchor?: { x: number; y: number };
}

export class PlayPage {
  readonly canvas = $<HTMLCanvasElement>("screen")!;
  /** the game's screen and the plate it is composed on (engine/src/web/page-shell.ts) */
  readonly plate: ReturnType<typeof screenPlate>;
  readonly errEl = $("err")!;
  readonly locEl = $("loc")!;
  readonly stageEl = $("stage")!;
  readonly bootEl = $("boot")!;
  readonly startEl = $<HTMLButtonElement>("start")!;
  /** the Details column the log sits in, behind x, b or the log button */
  readonly column: DetailsColumn;
  readonly log: PageLog;
  /** every press and click, what it hit and what it did — behind the column's `inputs` box */
  readonly inputs: InputLog;
  /** audio waits for a gesture — the Enter button — and what starts before then is held for it */
  readonly audio: GestureAudio;
  readonly bar: BootBar;
  /**
   * Boot without waiting for the Enter press, on a page that says so with
   * `<meta name="autostart">`: the speedrun workbench, which is reloaded for a
   * clean game far more often than it is opened to play one. The audio the
   * press would have bought waits for the run's first click instead.
   */
  readonly autostart = !!document.querySelector('meta[name="autostart"]');
  /** where the player stands, as the readout last said it — for an issue and the input log */
  where = "";
  /** the game, once there is one */
  current: GameHost | null = null;
  /** whether the cold boot has returned — `window.dbg.booted` */
  booted = false;
  private readonly rise: () => void;

  constructor(private readonly o: PlayPageOptions) {
    this.plate = screenPlate(this.canvas, o.game.screen);
    this.column = new DetailsColumn(o.game.dir);
    this.log = new PageLog($<HTMLPreElement>("log")!, $("logBtn"), 600, this.column);
    this.inputs = new InputLog({ say: (line) => this.say(line), where: () => this.where || "booting" });
    this.audio = new GestureAudio(this.say);
    installBand();
    installPageControls({
      game: o.game,
      canvas: this.canvas,
      stage: this.stageEl,
      say: this.say,
      edition: () => o.edition,
      where: () => this.where,
      log: (n) => this.log.lines.slice(-n),
    });
    const brandEl = $<HTMLImageElement>("brand");
    brandFallback(brandEl);
    this.rise =
      o.shape === "pinned"
        ? titleRise(this.bootEl, brandEl)
        : () => {
            document.body.classList.remove("booting");
            document.body.classList.add("playing");
          };
    this.bar = new BootBar($("charge")!, $("bootpct")!, o.value, o.caption);
  }

  /** one line of the log: `step` is something the boot did, `warn` a complaint */
  readonly say = (line: string, kind: "" | "step" | "warn" = ""): void => this.log.say(line, kind);

  /** the gauge, which only ever goes forwards */
  readonly progress = (f: number, label?: string): void => this.bar.set(f, label);

  /** the boot cannot go on: said in the controls as well as the log, which opens */
  noDisc(why: string): void {
    this.say(why, "warn");
    this.errEl.textContent = "no game data — press b for the log";
    this.progress(1, "no disc");
    this.log.show(true);
  }

  /**
   * The files, watched: the load remover's subscription (engine/src/web/load-clock.ts)
   * from the first fetch, because a clock armed when a timer starts has missed
   * the boot, and the spinner in the corner of the picture once a wait is long
   * enough to be one.
   */
  watch(files: RipFiles, spinner: (inFlight: number) => void): void {
    watchLoads(files);
    files.onBusyChange = spinner;
  }

  /**
   * The game: the real host on the page's files, its log in this log, its live
   * state in the Details column — and a real frame source before the boot runs,
   * so a modal film and the game's own poll loops advance, which is the
   * difference between a boot that completed and a game that runs.
   */
  host(files: RipFiles, o: PlayHostOptions): GameHost {
    const host = new GameHost(
      files,
      this.audio.sink,
      {
        log: (l) => this.say(`  ${l}`),
        hud: (t) => t && this.say(`  hud: ${t}`),
      },
      { screen: this.o.game.screen, ...(o.propAnchor ? { propAnchor: o.propAnchor } : {}) },
    );
    this.column.install({ spine: o.spine, host, version: VERSION, lines: () => this.log.lines, inputs: this.inputs });
    this.current = host;
    host.session.nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    host.session.hasRealFrames = true;
    // the dice pinned before the boot draws its first one
    if (o.seed !== null) host.session.seedRandom(o.seed);
    return host;
  }

  /**
   * The prefetch, weighed in bytes rather than in files, from `from` to `to` of
   * the bar; the names that never arrived come back.
   *
   * A count of fetches would put a 100 KB file and a 27 MB film a step of the
   * bar apart each, which is a bar that races and then stops for a minute. And
   * the denominator GROWS rather than being fixed at the manifest's total: what
   * has landed plus what is still owed can only rise, so a name nothing could
   * weigh slows the bar down instead of letting it arrive while bytes are still
   * coming. It lands exactly on the truth when the last remainder reaches zero.
   */
  async prefetch(files: RipFiles, names: readonly string[], from: number, to: number): Promise<string[]> {
    let arrived = 0;
    const missing: string[] = [];
    await Promise.all(
      names.map(async (name) => {
        this.bar.say(`opening ${name}`);
        const bytes = await files.load(name, (n) => {
          arrived += n;
          this.progress(from + (to - from) * (arrived / Math.max(1, arrived + files.bytesLeft(names))));
        });
        if (!bytes) missing.push(name);
      }),
    );
    return missing;
  }

  /** the engine's own frame loop, on the engine's own screen, blitted up — and `each` after every frame */
  frameLoop(host: GameHost, each: () => void): void {
    const { ctx, plate, plateCtx } = this.plate;
    const loop = (now: number): void => {
      host.director.tick(now);
      host.director.render(plateCtx);
      ctx.drawImage(plate, 0, 0, this.canvas.width, this.canvas.height);
      each();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /**
   * `window.dbg`, the name every game's page publishes its handle under and so
   * the one the speedrun driver evaluates its predicates against.
   *
   * A game with no set viewer — Timelapse has no room layer, a DreamFactory 5
   * room is `session.maze` — is `roomless` to the shared predicates
   * (speedrun/src/driver.ts ROOMLESS), which ask the director instead of waiting
   * for a viewer that never comes; `booted` is "the game is up", `coldBoot` has
   * returned.
   */
  publish(host: GameHost): void {
    const booted = (): boolean => this.booted;
    (window as unknown as { dbg: unknown }).dbg = {
      host,
      session: host.session,
      director: host.director,
      get viewer() {
        return host.viewer;
      },
      roomless: true,
      get booted() {
        return booted();
      },
      /** the load remover's reading, in the shape the other pages publish (dust/src/main.ts) */
      loading: () => ({ ms: loadClock.ms, waiting: loadClock.waiting }),
    };
  }

  /**
   * The disc is read: wait for the Enter press (or not, on an `autostart`
   * page), start the audio it bought, raise the card, and boot — TRACKED, as
   * the speedrun's headless runner tracks every game's (speedrun/src/headless.ts):
   * a boot in flight is a script running, so the BOOTFILE idle waits for it here
   * as it does there, and a seeded sheet comes out on the same tick in both.
   * Whether the boot came up is returned; `lead` heads the summary the log
   * gets after it, for a game whose place is worth naming before its stage.
   */
  async play(host: GameHost, files: RipFiles, lead: () => string = () => ""): Promise<boolean> {
    this.progress(1, "ready");
    if (this.o.shape === "pinned") await untilStarted(this.bootEl, this.startEl, this.autostart);
    else await waitForStart(this.bootEl, this.startEl, this.autostart);
    this.audio.ensure();
    this.rise();
    const up = await host.session.track(this.log.coldBoot(host, this.errEl), "coldBoot");
    this.booted = true;
    if (!up) this.log.show(true);
    this.log.bootSummary(host, files, lead());
    return up;
  }

  /** the page's boot, and what is said when it throws: the log is the result, and the card must not be left over a bar that never finished */
  boot(main: () => Promise<void>): void {
    main().catch((e) => {
      this.log.fail(e, this.errEl);
      this.rise();
    });
  }
}
