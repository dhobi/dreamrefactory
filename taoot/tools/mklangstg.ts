/**
 * Build `lang.stg` — the language chooser, as a DreamFactory stage.
 *
 *   npm run mklang            # writes public/lang.stg
 *   npm run mklang -- out/    # somewhere else (e.g. a copy under gamefiles/ so
 *                             # the editors' file picker lists it)
 *
 * Everything the file needs is authored here: the palette, both flats' art (an
 * indexed 512×384 image drawn with tools/pixelart.ts), the click regions, and
 * the scripts — compiled to real token streams by engine/src/df/script-asm.ts, so the
 * engine loads this stage through `openstagefile` like any shipped one and its
 * buttons run their own `mousedown` handlers.
 *
 * Nothing in the output derives from the game's data: no CyberFlix art, palette
 * or script is read, which is why the result can live in the repository while
 * `gamefiles/` cannot.
 *
 * The generator is the source of truth, but it is not the end of the line — open
 * the result in `/editors/stages.html`, replace a flat's art by PNG import, move
 * the button rectangles, export, and the exported file still boots. That round
 * trip is the point of building the chooser this way.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { decodeScript } from "@dreamfactory/engine/df/script";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { buildStgBytes } from "@dreamfactory/engine/df/stg-build";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { LANGUAGES, LANG_FLAT, LANG_GLOBAL, LANG_STAGE } from "../src/languages";
import { SCREEN_H, SCREEN_W } from "@dreamfactory/engine/web/screen";
import { Canvas, canvas, drawText, drawTextCentered, fillRect, strokeRect, textWidth } from "../../tools/pixelart";
import { type DecodedPNG, decodePNG } from "../../tools/png";

// ---------------------------------------------------------------------------
// The palette: named slots, and a ramp for the background
// ---------------------------------------------------------------------------

/**
 * Index 0 renders black and index 255 white no matter what the table says
 * (`paletteToRGBA` forces both, mirroring dfet), so the palette says the same
 * thing itself rather than depending on that.
 *
 * The colours are the website's, from site/src/theme.css — abyss for the water, hull
 * for borders, ice for anything interactive, brass sparingly. That sheet's own
 * palette was sampled from globe.png, which is also what the backdrop now draws,
 * so the chooser and the page around it are the same picture twice.
 */
const RAMP_FROM = 1;
const RAMP_TO = 96;

/** the site palette, as the generator needs it: plain RGB triples */
const SITE = {
  abyss900: [0x00, 0x06, 0x0f],
  abyss800: [0x00, 0x0d, 0x1f],
  abyss600: [0x04, 0x1e, 0x3c],
  hull400: [0x0e, 0x3a, 0x66],
  hull300: [0x17, 0x50, 0x7f],
  hull200: [0x2a, 0x6c, 0x9e],
  ice400: [0x60, 0xc0, 0xf0],
  ice100: [0xcc, 0xe4, 0xfc],
  frost: [0xe4, 0xf0, 0xfc],
  brass500: [0xc0, 0x84, 0x24],
  textDim: [0x7f, 0xa3, 0xc4],
  textMute: [0x4f, 0x7a, 0x9c],
} as const;

const C = {
  black: 0,
  plate: 100,
  plateEdge: 101,
  plateMark: 102,
  rule: 103,
  title: 104,
  label: 105,
  labelDim: 106,
  code: 107,
  accent: 108,
  shadow: 109,
  white: 255,
} as const;

const mix = (a: readonly number[], b: readonly number[], t: number): number[] =>
  a.map((v, i) => Math.round(v + (b[i] - v) * t));

/**
 * The background ramp, and the reason there is only one of them.
 *
 * The page's gradient and the globe behind it are both drawn through this — the
 * backdrop computes a single brightness per pixel (how far down the screen it
 * is, plus how bright the logo is there) and looks the colour up here. Two
 * ramps would mean the logo's dark edges sat in a different blue from the water
 * they are supposed to disappear into, and the watermark would read as a
 * rectangle. One ramp cannot have that seam.
 */
const rampColour = (t: number): number[] =>
  t < 0.5
    ? mix(SITE.abyss900, SITE.abyss600, t / 0.5)
    : mix(SITE.abyss600, SITE.hull300, (t - 0.5) / 0.5);

function palette(): Uint8Array {
  const p = new Uint8Array(256 * 3);
  const set = (i: number, rgb: readonly number[]): void => {
    p[i * 3] = rgb[0];
    p[i * 3 + 1] = rgb[1];
    p[i * 3 + 2] = rgb[2];
  };
  for (let i = RAMP_FROM; i <= RAMP_TO; i++) {
    set(i, rampColour((i - RAMP_FROM) / (RAMP_TO - RAMP_FROM)));
  }
  set(C.plate, SITE.abyss800);
  set(C.plateEdge, SITE.hull400);
  set(C.plateMark, SITE.hull200);
  set(C.rule, SITE.brass500);
  set(C.title, SITE.frost);
  set(C.label, SITE.ice100);
  set(C.labelDim, SITE.textMute);
  set(C.code, SITE.textDim);
  set(C.accent, SITE.ice400);
  set(C.shadow, SITE.abyss900);
  set(C.white, [255, 255, 255]);
  return p;
}

// ---------------------------------------------------------------------------
// Layout — the same numbers draw the art and place the click regions
// ---------------------------------------------------------------------------

/** a button: where it is drawn, and therefore where it is clickable */
interface Plate {
  code: string;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const PLATE = { w: 200, h: 44, gapX: 24, gapY: 14, cols: 2 } as const;
const MENU_TOP = 156;

function plates(): Plate[] {
  const rows = Math.ceil(LANGUAGES.length / PLATE.cols);
  const totalW = PLATE.cols * PLATE.w + (PLATE.cols - 1) * PLATE.gapX;
  const left0 = Math.round((SCREEN_W - totalW) / 2);
  const totalH = rows * PLATE.h + (rows - 1) * PLATE.gapY;
  const top0 = MENU_TOP + Math.round((SCREEN_H - 60 - MENU_TOP - totalH) / 2);
  return LANGUAGES.map((lang, i) => ({
    code: lang.code,
    label: lang.label,
    left: left0 + (i % PLATE.cols) * (PLATE.w + PLATE.gapX),
    top: top0 + Math.floor(i / PLATE.cols) * (PLATE.h + PLATE.gapY),
    width: PLATE.w,
    height: PLATE.h,
  }));
}

/** how bright the logo is allowed to get, as a fraction of the ramp */
const GLOBE_STRENGTH = 0.62;

/** the page's own gradient, top to bottom, as ramp fractions */
const GRADIENT = { top: 0.04, bottom: 0.34 } as const;

/**
 * Where the globe itself is in `globe.png`, in source pixels.
 *
 * The image is not the globe: the sphere sits in the top two thirds and the
 * bottom third is the soft shadow it casts on nothing. Centring the IMAGE
 * therefore hangs the globe high — the shadow claims half the vertical space
 * and pushes the disc up out of the middle. So measure the disc instead, and
 * centre that.
 *
 * The sphere is a circle, so its widest opaque row is its diameter and its
 * first opaque row is its top: centre = top + radius. That reads the geometry
 * out of the file rather than hard-coding numbers a new logo would falsify.
 * The shadow is soft enough that its own half-opaque rows are never as wide as
 * the disc, so they cannot win `widest`; they sit below the disc, so they
 * cannot move `top` either.
 */
function globeDisc(png: DecodedPNG): { cx: number; cy: number } {
  let top = -1;
  let widest = 0;
  let cx = (png.width - 1) / 2;
  for (let y = 0; y < png.height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < png.width; x++) {
      if (png.rgba[(y * png.width + x) * 4 + 3] > 128) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left < 0) continue;
    if (top < 0) top = y;
    if (right - left + 1 > widest) {
      widest = right - left + 1;
      cx = (left + right) / 2;
    }
  }
  return { cx, cy: top + widest / 2 };
}

/**
 * The logo, as a brightness field the size of the screen.
 *
 * Scaled to the screen's height by area-averaging rather than nearest-neighbour
 * — the source is 504×434 for a 512×384 frame, so nearest drops every ninth row
 * and the globe's meridians come out aliased. Alpha multiplies the luminance, so
 * the transparent surround contributes nothing and the disc fades at its own
 * edge instead of at a bounding box.
 *
 * Placed by its {@link globeDisc}, not by its bounding box: the disc's centre
 * lands on the screen's centre and whatever that pushes past an edge is
 * clipped. What gets clipped is the tail of the shadow, worth a couple of ramp
 * steps in the bottom rows the footer text sits on anyway.
 */
function globeField(): Float32Array {
  const png = decodePNG(new Uint8Array(readFileSync(new URL("../public/globe.png", import.meta.url))));
  const scale = SCREEN_H / png.height;
  const drawW = Math.round(png.width * scale);
  const drawH = Math.round(png.height * scale);
  const disc = globeDisc(png);
  const x0 = Math.round(SCREEN_W / 2 - disc.cx * scale);
  const y0 = Math.round(SCREEN_H / 2 - disc.cy * scale);
  const field = new Float32Array(SCREEN_W * SCREEN_H);
  const step = png.height / SCREEN_H; // source pixels per destination pixel
  for (let y = 0; y < drawH; y++) {
    const sy0 = Math.floor(y * step);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * step));
    const dy = y0 + y;
    if (dy < 0 || dy >= SCREEN_H) continue;
    for (let x = 0; x < drawW; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= SCREEN_W) continue;
      const sx0 = Math.floor(x * step);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * step));
      let sum = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1 && sy < png.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < png.width; sx++) {
          const s = (sy * png.width + sx) * 4;
          const lum = (png.rgba[s] * 0.2126 + png.rgba[s + 1] * 0.7152 + png.rgba[s + 2] * 0.0722) / 255;
          sum += lum * (png.rgba[s + 3] / 255);
          n++;
        }
      }
      if (n) field[dy * SCREEN_W + dx] = sum / n;
    }
  }
  return field;
}

/**
 * Push a rectangle down the background ramp — the indexed-colour stand-in for a
 * translucent panel. Pixels that are not ON the ramp (text already drawn, a
 * border) are left alone, so this is safe to call over anything.
 */
function dimRect(c: Canvas, x: number, y: number, w: number, h: number, keep: number): void {
  const span = RAMP_TO - RAMP_FROM;
  for (let yy = y; yy < y + h; yy++) {
    if (yy < 0 || yy >= c.height) continue;
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || xx >= c.width) continue;
      const i = yy * c.width + xx;
      const v = c.pixels[i];
      if (v < RAMP_FROM || v > RAMP_TO) continue;
      c.pixels[i] = RAMP_FROM + Math.round((v - RAMP_FROM) * keep);
    }
  }
}

/**
 * The background both flats share: the page's gradient with the logo standing in
 * it, then the title block.
 *
 * Composed as ONE brightness per pixel and looked up in the one ramp
 * ({@link rampColour}), rather than drawn as a gradient with a picture laid over
 * it. A 256-colour file has no alpha to blend with, so a separate ramp for the
 * logo would put its dark edges in a different blue from the water behind them
 * and the watermark would show its bounding box.
 */
function backdrop(): Canvas {
  const c = canvas(SCREEN_W, SCREEN_H, C.black);
  const globe = globeField();
  const span = RAMP_TO - RAMP_FROM;
  for (let y = 0; y < SCREEN_H; y++) {
    const base = GRADIENT.top + (GRADIENT.bottom - GRADIENT.top) * (y / (SCREEN_H - 1));
    for (let x = 0; x < SCREEN_W; x++) {
      const t = Math.min(1, base + globe[y * SCREEN_W + x] * GLOBE_STRENGTH);
      c.pixels[y * SCREEN_W + x] = RAMP_FROM + Math.round(t * span);
    }
  }
  strokeRect(c, 0, 0, SCREEN_W, SCREEN_H, C.plateEdge);

  drawTextCentered(c, "TITANIC", SCREEN_W / 2, 40, C.shadow, 5);
  drawTextCentered(c, "TITANIC", SCREEN_W / 2 - 2, 38, C.title, 5);
  drawTextCentered(c, "ADVENTURE OUT OF TIME", SCREEN_W / 2, 86, C.label, 2);

  // one brass rule, the page's single warm accent, with the gap the game's own
  // panels are ruled with
  const ruleY = 112;
  const half = 150;
  fillRect(c, SCREEN_W / 2 - half, ruleY, half - 8, 1, C.rule);
  fillRect(c, SCREEN_W / 2 + 8, ruleY, half - 8, 1, C.rule);
  fillRect(c, SCREEN_W / 2 - 2, ruleY - 2, 5, 5, C.rule);
  return c;
}

/** the chooser: the backdrop, a plate per language, and the footer hint */
function chooseFlat(): Canvas {
  const c = backdrop();
  drawTextCentered(c, "CHOOSE YOUR LANGUAGE", SCREEN_W / 2, 128, C.title, 2);

  plates().forEach((p, i) => {
    // Recessed into the water rather than laid on top of it. An indexed image
    // has no alpha to be translucent with, but the whole backdrop is one ramp
    // ({@link rampColour}), so pushing every pixel in the rectangle DOWN that
    // ramp is a dimmer of exactly the kind alpha would give — the globe stays
    // visible through the plate as a ghost instead of being cut out by it, and
    // the label still has a dark field to sit on. A flat fill lost the logo
    // precisely where it is brightest, which is behind these six rectangles.
    dimRect(c, p.left, p.top, p.width, p.height, 0.42);
    strokeRect(c, p.left, p.top, p.width, p.height, C.plateEdge);
    fillRect(c, p.left, p.top, 2, p.height, C.accent);
    // the shortcut number, then the label, then the directory the data comes from
    drawText(c, String(i + 1), p.left + 10, p.top + Math.round((p.height - 8) / 2), C.plateMark, 1);
    drawTextCentered(c, p.label, p.left + p.width / 2, p.top + Math.round((p.height - 16) / 2), C.label, 2);
    const code = p.code.toUpperCase();
    drawText(
      c,
      code,
      p.left + p.width - 10 - textWidth(code, 1),
      p.top + Math.round((p.height - 8) / 2),
      C.code,
      1,
    );
  });

  drawTextCentered(c, "CLICK A LANGUAGE OR PRESS 1-6", SCREEN_W / 2, SCREEN_H - 38, C.labelDim, 1);
  drawTextCentered(c, "GAMEFILES/CODE/ - ONE DIRECTORY PER CD PER LANGUAGE", SCREEN_W / 2, SCREEN_H - 26, C.labelDim, 1);
  return c;
}

/** the second flat: what the player looks at while the boot resources arrive */
function waitFlat(): Canvas {
  const c = backdrop();
  drawTextCentered(c, "LOADING", SCREEN_W / 2, 196, C.title, 4);
  drawTextCentered(c, "OPENING THE GAME FILES", SCREEN_W / 2, 248, C.label, 1);
  return c;
}

// ---------------------------------------------------------------------------
// The scripts
// ---------------------------------------------------------------------------

/**
 * The stage main. `openstage` runs before any flat is current and picks one —
 * the same thing MAP.STG does to page itself to the player's deck — and clears
 * the global so a second visit to the chooser starts undecided.
 */
const STAGE_MAIN = `code openstage()
	global ${LANG_GLOBAL}
	${LANG_GLOBAL} = ""
	gotoflat("${LANG_FLAT.choose}")
endcode`;

/**
 * A button. Setting a global and switching flat is the whole of it: the host
 * watches the global (there is no builtin for "pick a language", and inventing
 * one would mean inventing an opcode the engine never had).
 */
const buttonScript = (code: string): string => `code mousedown()
	global ${LANG_GLOBAL}
	${LANG_GLOBAL} = "${code}"
	gotoflat("${LANG_FLAT.wait}")
endcode`;

/**
 * The chooser flat's own `keydown` — the number keys, in script rather than in
 * the page, because a stage's keyboard handler is the flat's when it has one
 * (StageController.keydownTarget) and this is what that mechanism is for.
 */
const chooseFlatScript = (): string => {
  const cases = LANGUAGES.map(
    (l, i) => `\tcase "${i + 1}"\n\t\t${LANG_GLOBAL} = "${l.code}"`,
  ).join("\n");
  return `code keydown(key)
	global ${LANG_GLOBAL}
	switch key
${cases}
	endswitch
	if ${LANG_GLOBAL} != ""
		gotoflat("${LANG_FLAT.wait}")
	endif
endcode`;
};

/** compile, and refuse to write a script the engine's own parser rejects */
function script(source: string, what: string): Uint8Array {
  const bytes = compileScript(source);
  try {
    parseScript(decodeScript(bytes));
  } catch (e) {
    throw new Error(`${what}: compiled script does not parse: ${(e as Error).message}`);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildLangStage(): Uint8Array {
  const choose = chooseFlat();
  const wait = waitFlat();
  return buildStgBytes({
    palette: palette(),
    main: script(STAGE_MAIN, "stage main"),
    flats: [
      {
        name: LANG_FLAT.choose,
        art: choose,
        script: script(chooseFlatScript(), "choose flat"),
        regions: plates().map((p) => ({
          name: p.code,
          top: p.top,
          left: p.left,
          bottom: p.top + p.height,
          right: p.left + p.width,
          script: script(buttonScript(p.code), `button ${p.code}`),
        })),
      },
      { name: LANG_FLAT.wait, art: wait },
    ],
  });
}

/** read the result back and describe it — the check that it is a stage at all */
function report(bytes: Uint8Array, path: string): void {
  const stg = readStgFile(bytes);
  const lines = [`${path}: ${(bytes.length / 1024).toFixed(1)} kB, ${stg.flats.length} flat(s)`];
  for (const flat of stg.flats) {
    const regions = readStgRegions(stg.file.containers[flat.locationClickLogic]?.data ?? new Uint8Array(0));
    lines.push(
      `  ${flat.name.padEnd(8)} ${flat.width}×${flat.height}` +
        (regions.length ? `  buttons: ${regions.map((r) => r.name).join(" ")}` : "  (no click logic)"),
    );
  }
  console.log(lines.join("\n"));
}

const isMain = process.argv[1] && basename(process.argv[1]).startsWith("mklangstg");
if (isMain) {
  const outDir = process.argv[2] ?? "public";
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, LANG_STAGE);
  const bytes = buildLangStage();
  writeFileSync(path, bytes);
  report(bytes, path);
}
