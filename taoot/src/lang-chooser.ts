/**
 * The language chooser: `lang.stg` run as a stage, before the game boots.
 *
 * It is a DreamFactory stage rather than a piece of HTML on purpose — the file is
 * built by taoot/tools/mklangstg.ts, read by `readStgFile`, opened with
 * `openstagefile`, hit-tested through the engine's own click routing, and its
 * buttons are compiled scripts that run in the interpreter. What this module adds
 * is only what a stage normally borrows from a room: something to draw it, and
 * something to deliver clicks and keys.
 *
 * Why it can't borrow the usual one: {@link SetViewer} renders a flat, but it
 * needs a SET to exist, and every SET lives inside a language tree — the choice
 * this screen is here to make. So no set, no BOOTFILE (the boot library is
 * per-language too), no theme: an engine session with nothing in it but a stage,
 * which is exactly what `openStageFile` and `stageClickAt` are willing to be.
 *
 * The button scripts set a global (`taootlang`) and switch to the "wait" flat;
 * {@link LangChooser.chosen} reads it back. That indirection is deliberate: there
 * is no builtin for "pick a language" and inventing an opcode the 1996 engine
 * never had would make this stage unopenable by anything but us.
 */
import { indexedToRGBA } from "@dreamfactory/engine/df/image";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { StgRegion } from "@dreamfactory/engine/df/stg";
import { LANGUAGES, LANG_FLAT, LANG_GLOBAL, LANG_STAGE, isEditionCode, isLanguageCode } from "./languages";
import { SCREEN_H, SCREEN_W } from "@dreamfactory/engine/web/screen";

/** a chooser button: the STG's region, and whether the data behind it exists */
export interface LangButton {
  code: string;
  region: StgRegion;
  available: boolean;
}

/**
 * Drives the chooser stage. DOM-free — a caller feeds it clicks and keys and
 * asks what was chosen — so the headless suite can play the screen the way a
 * player does (taoot/tests/auto/lang-chooser.ts).
 */
export class LangChooser {
  /** the languages that actually have a directory in the manifest */
  private readonly available: Set<string>;

  constructor(
    private readonly session: GameSession,
    available: Iterable<string>,
  ) {
    this.available = new Set([...available].map((c) => c.toLowerCase()));
  }

  /**
   * Open the stage. False if the file isn't there (a build without the authored
   * asset should fall back to a default, not stall on a black screen).
   */
  async open(): Promise<boolean> {
    this.session.interp.globals.set(LANG_GLOBAL, "");
    if (!(await this.session.stageCtrl.openStageFile(LANG_STAGE))) return false;
    // a full-screen flat owns the whole 512×384 frame; there is no room behind it
    this.session.setVisible = false;
    return true;
  }

  /** the buttons, in the order the stage lists them */
  buttons(): LangButton[] {
    return this.session
      .stageCtrl.currentFlatRegions()
      .filter((r) => isLanguageCode(r.name))
      .map((region) => ({
        code: region.name.toLowerCase(),
        region,
        available: this.available.has(region.name.toLowerCase()),
      }));
  }

  /**
   * A click at screen coordinates. Goes through the engine's stage routing, so
   * the region's own compiled `mousedown` is what sets the global — except on a
   * language with no data, where the click is dropped: the stage's art is fixed
   * at six buttons and an install with two shouldn't answer for the other four.
   */
  async click(x: number, y: number): Promise<void> {
    const button = this.buttons().find(
      (b) =>
        x >= b.region.left && x < b.region.right && y >= b.region.top && y < b.region.bottom,
    );
    if (button && !button.available) return;
    await this.session.stageCtrl.stageClickAt(x, y);
  }

  /**
   * A key. The flat's own `keydown` handler maps "1".."6" — that mapping is in
   * the stage's script, not here — which means the script has already set the
   * global and switched to the "wait" flat by the time we can see what it chose.
   * So an uninstalled language is undone rather than pre-empted: clear the global
   * and put the menu back. (A click can be refused before the script runs, since
   * the region under the cursor is known first.)
   */
  async key(name: string): Promise<void> {
    const target = this.session.stageCtrl.keydownTarget();
    if (!target) return;
    await this.session.interp.runHandler(target, "keydown", [name], {
      me: target.name,
      target: "",
    });
    const picked = String(this.session.interp.globals.get(LANG_GLOBAL) ?? "").toLowerCase();
    if (picked && !this.available.has(picked)) {
      this.session.interp.globals.set(LANG_GLOBAL, "");
      if (this.session.currentFlat !== LANG_FLAT.choose) {
        await this.session.stageCtrl.gotoFlat(LANG_FLAT.choose);
      }
    }
  }

  /** the code a button set, once it names a language we can actually load */
  chosen(): string | null {
    const code = String(this.session.interp.globals.get(LANG_GLOBAL) ?? "").toLowerCase();
    if (!code || !isLanguageCode(code) || !this.available.has(code)) return null;
    return code;
  }

  /**
   * Draw the current flat, dimming the buttons whose language isn't installed.
   *
   * The dimming reads the STG's own region rectangles, so it follows the art
   * wherever the stage editor moves them — no second copy of the layout.
   */
  render(ctx: CanvasRenderingContext2D): void {
    const flat = this.session.stageCtrl.flatImage();
    if (!flat) return;
    const rgba = indexedToRGBA(flat.pixels, flat.width, flat.height, flat.palette);
    const img = ctx.createImageData(flat.width, flat.height);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.fillStyle = "rgba(6, 8, 12, 0.72)";
    for (const b of this.buttons()) {
      if (b.available) continue;
      const { left, top, right, bottom } = b.region;
      ctx.fillRect(left, top, right - left, bottom - top);
    }
    ctx.restore();
  }

  /**
   * Hand the stage back, so the boot's own `main.stg` opens into a clean slate —
   * including `setVisible`, which {@link open} turned off for a full-screen flat
   * and which every room afterwards needs on (the session's own default).
   *
   * The global goes too, and not for tidiness: `snapshotSave` writes every script
   * global into the `.ti`, and a base save has only a handful of free variable
   * slots and a finite string pool (see `poolIntern` — the route has already had
   * globals dropped for want of one). A language choice is the page's business,
   * not the game's, so it must not compete for that space. Read the choice
   * ({@link chosen}) before closing.
   */
  async close(): Promise<void> {
    await this.session.stageCtrl.closeStageFile();
    this.session.setVisible = true;
    this.session.interp.globals.delete(LANG_GLOBAL);
  }
}

/** the screen size the chooser draws at — the game's, since it IS a game screen */
export const CHOOSER_SIZE = { width: SCREEN_W, height: SCREEN_H } as const;

/**
 * The edition to boot without asking: an explicit `?edition=`, then what the player
 * picked last time, then — only when the install has exactly one — that one. Null
 * means the chooser has to run.
 *
 * Validated against every EDITION code and not just the six languages
 * ({@link isEditionCode}), which is the difference between the demo booting and
 * the demo bouncing off this function into a chooser whose art has no button for
 * it: `?edition=demo` was a code the chooser could not offer AND, while this
 * checked `isLanguageCode`, a code that did not count as already chosen — so the
 * one edition that can only be picked from the page's own row was the one edition
 * the page then refused to act on.
 */
export function preselectedEdition(opts: {
  query?: string | null;
  remembered?: string | null;
  available: string[];
}): string | null {
  const has = (c: string | null | undefined): boolean =>
    !!c && isEditionCode(c) && opts.available.includes(c.toLowerCase());
  const query = opts.query?.toLowerCase().trim();
  if (has(query)) return query!.toLowerCase();
  const remembered = opts.remembered?.toLowerCase().trim();
  if (has(remembered)) return remembered!.toLowerCase();
  const known = opts.available.filter((c) => isEditionCode(c));
  if (known.length === 1) return known[0].toLowerCase();
  return null;
}

/** the languages the chooser can offer, in the stage's order */
export const chooserOrder = (available: string[]): string[] =>
  LANGUAGES.map((l) => l.code).filter((c) => available.includes(c));
