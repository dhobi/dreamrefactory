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
import { ESCAPE_KEY, focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { TI_CURSORS } from "../../src/cursor-art";
import { FileStore } from "../../src/files";
import { editionsIn, gamefileManifest } from "../../src/editions";
import { siteUrl } from "@dreamfactory/site/site";
import { installI18n, t, uiLanguage } from "@dreamfactory/site/locales";
import type { Key } from "@dreamfactory/site/locales/en";
import { installLanguageMenu } from "@dreamfactory/site/lang-menu";
import { installPlayMenu } from "@dreamfactory/site/play-menu";
import { installVersion } from "@dreamfactory/site/version";

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
  /** the catalogue key for what it is called — shown when the boot is done */
  readonly title: Key;
  /**
   * Anything the stage's own `openstage ()` does not do for itself, run once the
   * stage is open. Fencing needs none; blackjack needs the two lines its dealer's
   * conversation would have left behind.
   */
  readonly start?: (host: GameHost) => Promise<void> | void;
  /**
   * What happens when the game's own scripts LEAVE the stage — which is how both
   * of these end. Blackjack's `closecards ()` and fencing's post-bout
   * `transfromflat ()` both pop the overlay, so "the stage is no longer ours" is
   * the one signal that means "the player is done with this hand/bout", whichever
   * game it is.
   *
   * Answer `"again"` to have the stage reopened and {@link start} run over it —
   * fencing's rematch, which aboard is the squash court reopening the flat.
   * Answer `"done"`, or leave this out, and the page goes back to the chooser:
   * declining is the only way out of a game that has no ship to be put back on.
   */
  readonly onLeave?: (host: GameHost) => Promise<"again" | "done"> | "again" | "done";
}

/**
 * Mark which of a page's options is the one in force.
 *
 * The rows on these two pages are a choice the game's own conversation would
 * have asked for, and a row of links says nothing about which one you are
 * playing under — the fencing page offered three difficulties and looked
 * identical at all three. The page knows its own answer as a query string, so
 * that is what is matched; a defaulted choice passes the query it WOULD have
 * been asked with, which is why this takes a string rather than reading
 * `location.search`.
 */
export function markOption(query: string): void {
  for (const a of document.querySelectorAll<HTMLAnchorElement>(".options a")) {
    const own = new URL(a.href, window.location.href).search;
    if (own === query) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
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
  /*
   * The page's own words first, and before anything is written to the status
   * line: `installI18n` rewrites every `data-i18n` node from the catalogue, and
   * a status set before it ran would be replaced by "loading…" in the reader's
   * language a moment later.
   */
  await installI18n();
  void installLanguageMenu();
  void installPlayMenu();
  installVersion();

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

  /**
   * THE FIRST CLICK, where the game cannot wait for one of its own.
   *
   * Two things need it. A browser will not start audio without a trusted
   * gesture, so a stage that opens its theme in `openstage ()` plays to a muted
   * sink until the player happens to touch the canvas; and both of these games
   * begin the instant their stage is open — blackjack deals and the fight has
   * Vlad throwing punches before the page has finished settling — so a player
   * who looked away has missed the start of it.
   *
   * Fencing needs neither: its own buttonbar carries a START, which is a click
   * on the canvas and therefore a gesture, and nothing moves until it is pressed.
   * So this is not a property of the boot but of the page: a page that needs
   * holding carries a `#begin` button and the others do not.
   */
  const begin = document.getElementById("begin") as HTMLButtonElement | null;
  if (begin) {
    begin.hidden = false;
    say("");
    await new Promise<void>((go) =>
      begin.addEventListener("click", () => go(), { once: true }),
    );
    begin.hidden = true;
    // the click that got us here is the gesture the sink was waiting for
    ensureAudio();
  }

  const paths = await gamefileManifest();
  if (!paths.length) {
    say(t("minigames.noData"));
    return;
  }
  for (const p of paths) files.registerServerFile(p.split("/").pop()!, siteUrl(p));
  /**
   * WHICH TREE THE GAME ITSELF IS READ FROM — and here, uniquely, it is the
   * page's own language.
   *
   * Everywhere else on this site the two are deliberately separate questions:
   * which of the six the CHROME is written in, and which edition of the GAME is
   * installed and played. The play page keeps them apart on purpose — a reader
   * who has chosen a German game and an English interface gets exactly that, and
   * `chosenEdition` answers the remembered edition before it ever looks at the
   * UI language.
   *
   * These three pages are the exception, and asked for as one. They have no
   * edition row of their own, so there is nothing here for a reader to have
   * chosen; the only language they have expressed on this page is the one the
   * page is written in, and a French page dealing an English hand reads as a
   * bug rather than as a preference honoured. So the UI language leads, and the
   * edition a reader picked over on the play page is deliberately NOT consulted.
   *
   * `?edition=` still wins, because it is the explicit instruction. And the
   * answer is sized against what the manifest actually carries, so a reader
   * whose UI is Japanese and whose install is English gets the English tree
   * rather than a page of missing files.
   */
  const available = editionsIn(paths);
  const pick = (code: string | null): string | null =>
    code && available.includes(code.toLowerCase()) ? code.toLowerCase() : null;
  const edition =
    pick(new URLSearchParams(window.location.search).get("edition")) ??
    pick(uiLanguage()) ??
    pick("en") ??
    available[0] ??
    "en";
  files.setEdition(edition);
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
  /**
   * ...AND THE TWO LINES OF `boot ()` THAT ARE ABOUT THE SCREEN, which not
   * running it left out.
   *
   * `boot ()` opens with `puppetparam (9, 1)` and `puppetparam (10, 25)` and
   * never puts either back, so aboard they hold for every conversation in the
   * game. Slot 10 is the left margin of the answer rows, and 25 is the number
   * that clears the SCREWS: the answer band is a picture inside every PUP with a
   * rivet drawn at each end of all five plaques, and at the un-booted default of
   * 8 the text starts on top of the left one — reported against all three of
   * these pages, and visible in the shot on #391 as Buick's "Yes, I'll play
   * another hand." beginning inside the screw.
   *
   * Read from the BOOTFILE rather than written here, because 25 is TAOOT's
   * number and not the port's — see BootPlan.puppetParams. Applied AFTER
   * `bootedByGame`, which is where the file is parsed, and before any puppet is
   * opened.
   */
  for (const [slot, value] of plan.puppetParams) host.session.puppetParams.set(slot, value);

  say(`opening ${game.stage}…`);
  if (!(await host.session.stageCtrl.openStageFile(game.stage))) {
    say(`could not open ${game.stage} — is the ${edition} tree installed?`);
    return;
  }
  /** the stage this page is the game of, as the session names it */
  const ours = game.stage.toLowerCase();
  /**
   * KEEP THE PICTURE THE GAME IS PLAYED ON, for the conversation that comes
   * after it.
   *
   * A close-up is a cutout, and what fills the 512×264 around it is the room
   * behind the character. These pages have no room, so until this existed the
   * end of a fencing bout put Willie in the dark: `transfromflat ()` puts the
   * stage down — which is the very thing `watchForLeaving` is watching for — and
   * the flat he was standing on goes with it, half a second before he asks for a
   * rematch (#391). Aboard there is no gap, because the squash court is
   * underneath the whole time.
   *
   * So the flat is held while it is ours to hold and handed to the director as
   * the conversation's backdrop. Deliberately NOT cleared when the stage closes:
   * the last picture of the bout is precisely the one wanted, and it is wanted
   * at the moment there is no longer a stage to read it from.
   *
   * Cheap enough for the frame loop — `flatBackdrop` is two memoised lookups —
   * but guarded on the flat's NAME anyway, so the common frame does no work at
   * all and the director's field keeps one stable pair of references for
   * `PuppetView.composite` to cache against.
   */
  let backdropOf = "";
  const holdBackdrop = (): void => {
    const s = host.session;
    if (s.stageName !== ours) {
      // No stage of ours: keep what is held — that is the whole point — but
      // forget WHICH it was, so a rematch's reopened stage is taken afresh
      // rather than matched against a name whose pixels have been dropped
      // (closeStageFile clears the flat cache these references come out of).
      backdropOf = "";
      return;
    }
    if (s.currentFlat === backdropOf) return;
    const held = host.director.flatBackdrop();
    if (!held) return;
    host.director.puppetBackdrop = held;
    backdropOf = s.currentFlat;
  };

  /**
   * THE FRAME LOOP FIRST, and then whatever the game needs said to it.
   *
   * `start` runs the game's own scripts, and a DreamFactory script that deals
   * cards waits for frames while it does: `dealcards ()` walks the shoe a card at
   * a time and every step of it is a tick this loop has to provide. Started after
   * `start` instead, the two wait for each other for ever — measured as a
   * blackjack page whose `render` had run exactly 0 times, frameValid false, and
   * a canvas that was simply black. Fencing hid it completely, because fencing
   * needs nothing said to it and so never awaited anything.
   */
  const loop = (now: number): void => {
    holdBackdrop();
    host.director.tick(now);
    host.director.render(ctx);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  await game.start?.(host);
  /*
   * Only NOW is the game running: the stage is open, its `openstage ()` has run
   * and whatever shim it needed has been applied. A probe that waits on
   * `stageName` instead reads the world half a boot early and finds the globals
   * empty — which is what the first run of taoot/tests/browser/minigames.ts did,
   * and reported as blackjack not booting.
   */
  dbg.ready = true;
  say(t(game.title));

  /**
   * ...and watch for the game letting go of its own stage.
   *
   * Polled rather than hooked because the thing being watched is the GAME's
   * decision, taken inside its own scripts several calls deep — `newgame ()`
   * reaching `closecards ()` when the dealer is told no, or the bout's last hit
   * reaching `transfromflat ()`. Neither announces itself; both put the stage
   * down, and that is visible from here.
   */
  const watchForLeaving = (): void => {
    const watch = window.setInterval(() => {
      if (host.session.stageName === ours) return;
      window.clearInterval(watch);
      void (async () => {
        const verdict = (await game.onLeave?.(host)) ?? "done";
        if (verdict === "done") {
          window.location.href = "../";
          return;
        }
        // Another go: the stage again, whatever had to be said to it, and the
        // watch re-armed — the rematch has an end of its own, and a watch that
        // fired once would leave the second bout with no way out but the tab.
        if (!(await host.session.stageCtrl.openStageFile(game.stage))) {
          say(`could not reopen ${game.stage}`);
          return;
        }
        await game.start?.(host);
        say(t(game.title));
        watchForLeaving();
      })();
    }, 250);
  };
  watchForLeaving();


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

  /**
   * THE ONE KEY THESE PAGES HAVE, and they had none at all.
   *
   * Everything in all three games is done with the pointer — a buttonbar, two
   * plates, a fist — so the boot wired pointers and stopped, and the conversation
   * that ends a game was therefore unskippable: Willie's and Buick's lines play
   * out in full, with no way past them (#391). ESC is what the original gives you
   * there, and the engine has always been ready for it —
   * `ScreenDirector.keyDown` hands it to `PuppetCtrl.key`, which skips the line
   * being spoken or, at the plaque, answers the script's own `case -1` arm.
   *
   * `ESCAPE_KEY` and not `"Escape"`: the engine spells the key the way TI.EXE
   * does (`"."` plus the 0x1fa0 marker, which is `special`), and a shell that
   * invents a name of its own gets a key that reaches the script chain and skips
   * nothing.
   *
   * ESC alone, deliberately. The play page routes every key the focus does not
   * own, because there it means something — the movement keys are the game's own
   * bindings and SPACE opens doors. Here there is no room to walk and no door: of
   * the BOOTFILE's `keydown`, only the branches gated on `currentset ()` and
   * `stagevisible ()` could fire, and the one that could would be forwarding
   * letters to a fencing flat that has never defined a handler for them.
   *
   * On `window`, because there is nothing on these pages to focus — and
   * `focusOwnsKey` all the same, so the language menu's own keyboard still works
   * while a game is up.
   */
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || focusOwnsKey(e.target, e.key)) return;
    e.preventDefault();
    void host.session.track(host.director.keyDown(ESCAPE_KEY, true), "escape");
  });
}
