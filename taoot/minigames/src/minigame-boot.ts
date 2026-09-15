/**
 * The two games inside Titanic that are games on their own, booted without the ship.
 *
 * Blackjack in the smoking room and the fencing bout with Willie in the squash
 * court are each a STAGE with its own shapes and its own audio track — not a
 * room — and each keeps its own state in globals nothing else on the ship reads.
 * That is what makes this file short: there is no world to build, only a stage to
 * open, and the engine has run stage-only games since Timelapse (which has no
 * `.SET` on any of its four discs) forced {@link ScreenDirector} out of
 * `SetViewer`.
 *
 * ## What each one needed, measured from its own scripts
 *
 * `FENCE.STG`'s `openstage ()` writes every global it will read — `attacktot`,
 * `fighting`, `willieside`, `playerblock`, `willieblock` — opens `fence.shp` and
 * `fence.trk`, places its props, lands on `fence 8`, starts the theme and calls
 * "en guard". It asks the ship for nothing, so `openstagefile` IS its launch.
 *
 * `BLKJACK.STG`'s `openstage ()` opens only its track and shop; the game is
 * started by the DEALER's conversation (`BLKJACK1.PUP/0005 runyoself`), which
 * reads real ship state — `buickvalue`, `metzeitel`, `buickphase` — and ends by
 * setting `firsthand = true`. `initgame ()` is called from nowhere on the disc,
 * and `newgame ()` reads `firsthand` before anything writes it. So this seeds
 * that one global and calls `initgame` itself: the two lines the conversation
 * would have left behind.
 *
 * ## What is NOT modelled, and is the ship's
 *
 * Both games end by handing a result back — fencing `sendtoset (fence ())` after
 * `actorowner ("willie", "won")`, blackjack through the dealer's own bevels — and
 * neither has anywhere to hand it to here. The exit paths are left to run: the
 * `sendtoset` finds no set and the `actorowner` no actor, which is a message in
 * the log rather than a fault, and the page's own result line is what the player
 * reads.
 */
import { DeferredAudioSink, WebAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameHost } from "@dreamfactory/engine/web/host";
import { CursorSheet } from "@dreamfactory/engine/web/cursors";
import { TI_CURSORS } from "../../src/cursor-art";
import { FileStore } from "../../src/files";
import { gamefileManifest } from "../../src/editions";
import { siteUrl } from "@dreamfactory/site/site";

/** Titanic's screen, which both of these stages are drawn for */
const SCREEN = { width: 512, height: 384 };

/**
 * Both stages live on the SECOND disc.
 *
 * `BLKJACK/` and `FENCE/` are under `titanic2/`, and 93 basenames ship on both
 * discs — so a store left on disc 1 resolves some of what these open to the
 * other CD's copy. The ship reaches this point through the BOOTFILE's own
 * `setpath (disk)`; there is no boot here to run one, so it is said outright.
 */
const DISC = 2;

export interface Minigame {
  /** the stage file the game lives in — `fence.stg`, `blkjack.stg` */
  readonly stage: string;
  /** what it is called, for the page's own chrome and its log lines */
  readonly title: string;
  /**
   * Anything the stage's own `openstage ()` does not do for itself, run once the
   * stage is open. Fencing needs none; blackjack needs the two lines its dealer's
   * conversation would have left behind.
   */
  readonly start?: (host: GameHost) => Promise<void> | void;
}

/** the edition to read the files from — `?edition=de` for a localised tree */
function edition(): string {
  const asked = new URLSearchParams(window.location.search).get("edition");
  return asked && /^[a-z]{2,6}$/.test(asked) ? asked : "en";
}

/**
 * Boot one of them onto a canvas.
 *
 * The shape is the one every shell here uses — a `FileStore` fed from the
 * manifest, a `GameHost` over it, a real frame source so `playmovie` and the
 * game's own `while stilldown ()` poll loops advance, and the engine's own frame
 * loop blitted up. What is missing compared with the play page is everything
 * about a WORLD: no boot plan, no sets, no saves, no editions chooser.
 */
export async function bootMinigame(game: Minigame): Promise<void> {
  const canvas = document.getElementById("screen") as HTMLCanvasElement;
  const statusEl = document.getElementById("status");
  const say = (line: string): void => {
    if (statusEl) statusEl.textContent = line;
  };

  const files = new FileStore();
  const audio = new DeferredAudioSink();
  /**
   * The real sink can only be built from a user gesture, so it is attached on the
   * first press — and attaching starts whatever loops the stage began meanwhile,
   * which for both of these is a theme opened in `openstage ()`.
   */
  const ensureAudio = (): void => {
    if (audio.attached) return;
    try {
      audio.attach(new WebAudioSink());
    } catch {
      /* a browser with no audio still plays the game */
    }
  };

  const paths = await gamefileManifest();
  if (!paths.length) {
    say("no game data — the rip belongs under taoot/gamefiles/");
    return;
  }
  for (const p of paths) files.registerServerFile(p.split("/").pop()!, siteUrl(p));
  files.setEdition(edition());
  files.setDisc(DISC);

  const host = new GameHost(
    files,
    audio,
    {
      // the status line shows the latest; the console keeps the whole boot, which
      // is what a probe reads (taoot/tests/browser/minigames.ts)
      log: (l) => {
        say(l);
        console.log(l);
      },
      hud: () => {},
    },
    { screen: SCREEN },
  );
  host.session.nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  host.session.hasRealFrames = true;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = SCREEN.width;
  canvas.height = SCREEN.height;

  /**
   * The game's own cursors, which its props ask for by name (`cursor ("watch")`,
   * and the fencing buttonbar's own `setcursor` handlers). Scaled by how big the
   * PICTURE is drawn: the canvas is the 512x384 framebuffer and CSS stretches it,
   * so a 1x cursor would be half the size the artist drew it against a doubled
   * screen.
   */
  const cursors = new CursorSheet(TI_CURSORS);
  let shown = "";
  const showCursor = (name: string): void => {
    shown = name;
    const r = canvas.getBoundingClientRect();
    canvas.style.cursor = cursors.css(name || "arrow", r.width / canvas.width);
  };
  host.director.onCursor = showCursor;
  new ResizeObserver(() => showCursor(shown)).observe(canvas);

  /**
   * What a driver can reach, and the reason it exists: these pages are the only
   * two here whose boot has no world in it, so "did it start?" cannot be asked
   * of a room or a standpoint. A probe asks the STAGE
   * (taoot/tests/browser/minigames.ts), and a handle is how it asks.
   */
  const dbg = { session: host.session, host, game, ready: false };
  (window as unknown as { dbgMini: typeof dbg }).dbgMini = dbg;

  /**
   * THE GAME'S OWN SCRIPT LIBRARY, before its stage asks for it.
   *
   * `playnewtheme (name)` is not a builtin and deliberately is not one: it has no
   * opcode, it is two lines of BOOTFILE script — `playtheme (name); themevol
   * (currenttheme (2), themevolume)` — and registering a builtin of that name
   * would shadow the game's own (see engine/src/runtime/builtins/audio.ts). So a
   * page that never reads the BOOTFILE has no `playnewtheme`, and `FENCE.STG`'s
   * `openstage ()` calls it to start the bout's music: measured here as
   * `[interp] no semantics for: playnewtheme("fence.trk")`, and a silent piste.
   *
   * `bootedByGame` parses the file and installs its library. It does NOT run
   * `boot ()` — there is no voyage to begin, and these two stages are not part of
   * one.
   *
   * The plan is read first for a second reason: it names the game's VOLUMES, and
   * the store needs them to tell the two discs' copies of a basename apart.
   */
  const plan = await host.bootPlan();
  files.setVolumes(plan.volumes);
  if (!(await host.session.bootedByGame())) {
    say("no BOOTFILE in this edition — the stage will run, its music will not");
  }

  say(`opening ${game.stage}…`);
  if (!(await host.session.stageCtrl.openStageFile(game.stage))) {
    say(`could not open ${game.stage} — is the ${edition()} tree installed?`);
    return;
  }
  await game.start?.(host);
  /*
   * Only NOW is the game running: the stage is open, its `openstage ()` has run
   * and whatever shim it needed has been applied. A probe that waits on
   * `stageName` instead reads the world half a boot early and finds the globals
   * empty — which is what the first run of taoot/tests/browser/minigames.ts did,
   * and reported as blackjack not booting.
   */
  dbg.ready = true;
  say(game.title);

  /** the engine's own frame loop, on the engine's own screen */
  const loop = (now: number): void => {
    host.director.tick(now);
    host.director.render(ctx);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  /** where a pointer event lands in the engine's 512x384, whatever the CSS size */
  const at = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * SCREEN.width),
      y: Math.round(((e.clientY - r.top) / r.height) * SCREEN.height),
    };
  };
  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    const p = at(e);
    host.session.pointerDown = true;
    // `stilldown ()` is what both of these poll while a button is held — the
    // fencing buttonbar and the blackjack hit/stand plates are both press-and-
    // release controls, so the flag has to be up for the whole gesture.
    void host.session.track(host.director.press(p.x, p.y), `press ${p.x},${p.y}`);
  });
  const up = (e: PointerEvent): void => {
    const p = at(e);
    host.session.pointerDown = false;
    host.director.release(p.x, p.y);
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  // ...and what is under the pointer decides the cursor, which is how both of
  // these show a control is a control: `FENCE.STG`'s fourteen button regions each
  // carry their own `setcursor`.
  canvas.addEventListener("pointermove", (e) => {
    const p = at(e);
    void host.director.hover(p.x, p.y).then(showCursor);
  });
}
