/**
 * What every editor page does the same way: open a file, list the chosen
 * source's files, draw a sprite, take a PNG back in, export, and boot the page.
 *
 * The pages differ in what a file IS — a cast, a shop, a stage — and that stays
 * in each of them. What is here is the furniture they share, so it cannot
 * drift: copied into each page, one fix to the drop handler, or to the
 * nearest-colour match, would have to be made ten times. Every piece takes what differs
 * (the loader, the palette, the names) as an argument, and reads the page's
 * elements by the ids every editor's markup already uses (`openBtn`,
 * `fileInput`, `pngImportBtn`, `pngInput`, `editionPicker`).
 */
import type { Container, DFContainerFile } from "@dreamfactory/engine/df/container";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { indexedToRGBA } from "@dreamfactory/engine/df/image";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import type { ShpFrame } from "@dreamfactory/engine/df/shp";
import type { DfEncoding } from "@dreamfactory/engine/df/text";
import type { GameScreen } from "@dreamfactory/site/games";
import { installGamesMenu } from "@dreamfactory/site/games-menu";
import { installLanguageMenu } from "@dreamfactory/site/lang-menu";
import { formatNumber, installI18n, t } from "@dreamfactory/site/locales";
import { installVersion } from "@dreamfactory/site/version";
import { installSourcePicker, type Source, type SourceFile } from "./sources";

/** the page's status line */
export type Log = (text: string) => void;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// --- opening ----------------------------------------------------------------

/**
 * The Open button, its hidden file input, and a file dropped anywhere on the
 * page. A drop hands its first file to `open` unless the page says otherwise
 * (the maze viewer takes a maze and its DLL in one drop).
 */
export function wireFileOpen(
  open: (file: File) => Promise<void>,
  drop: (files: FileList | undefined) => void = (files) => {
    const f = files?.[0];
    if (f) void open(f);
  },
): void {
  const fileInput = byId<HTMLInputElement>("fileInput");
  byId("openBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) void open(fileInput.files[0]);
    fileInput.value = "";
  });

  document.body.addEventListener("dragover", (e) => {
    e.preventDefault();
    document.body.classList.add("dragover");
  });
  document.body.addEventListener("dragleave", () => document.body.classList.remove("dragover"));
  document.body.addEventListener("drop", (e) => {
    e.preventDefault();
    document.body.classList.remove("dragover");
    drop(e.dataTransfer?.files);
  });
}

/** a file off the dev server, or null — and the status line saying why */
export async function fetchBytes(url: string, path: string, log: Log): Promise<Uint8Array | null> {
  const r = await fetch(url);
  if (!r.ok) {
    log(t("common.fetchFailed", { path, status: r.status }));
    return null;
  }
  return new Uint8Array(await r.arrayBuffer());
}

/** the line above a dev-server listing, saying where its buttons come from */
export function serverNote(wrap: HTMLElement, text: string): void {
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = text;
  wrap.appendChild(note);
}

/** one row of dev-server files, a button each; a click fetches the file and opens it */
export interface ServerRow {
  source: Source;
  files: SourceFile[];
  /** the row's class after `row`, and each button's */
  rowClass: string;
  buttonClass: string;
  log: Log;
  open: (bytes: Uint8Array, f: SourceFile) => void;
  /** what the button says, the basename by default */
  label?: (f: SourceFile) => string;
  /** what its tooltip adds after the path */
  more?: (f: SourceFile) => string;
}

export function serverRow(wrap: HTMLElement, o: ServerRow): void {
  const row = document.createElement("div");
  row.className = `row ${o.rowClass}`;
  for (const f of o.files) {
    const b = document.createElement("button");
    b.className = o.buttonClass;
    b.textContent = o.label ? o.label(f) : f.base;
    b.title = `${o.source.game.short} · ${f.path}${o.more ? o.more(f) : ""}`;
    b.addEventListener("click", async () => {
      o.log(t("common.loading", { path: f.path }));
      const bytes = await fetchBytes(f.url, f.path, o.log);
      if (bytes) o.open(bytes, f);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}

// --- drawing ----------------------------------------------------------------

/** paint a decoded sprite into a canvas at 1:1, transparent where masked */
export function paintFrame(f: ShpFrame, canvas: HTMLCanvasElement, palette: Uint8ClampedArray): void {
  canvas.width = Math.max(1, f.width);
  canvas.height = Math.max(1, f.height);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!f.width || !f.height) return;
  const img = ctx.createImageData(f.width, f.height);
  // a v5 sprite brings its own palette; a v4 one is drawn through the file's
  indexedToRGBA(f.indexed, f.width, f.height, f.palette ?? palette, img.data);
  for (let i = 0; i < f.width * f.height; i++) {
    if (!f.opaque[i]) img.data[i * 4 + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * The game's screen behind a sprite preview, in screen coordinates: the room
 * view, and below it the UI band and the line that ends the view — the band
 * only where the game has one.
 */
export function drawScreenBands(ctx: CanvasRenderingContext2D, screen: GameScreen): void {
  const band = screen.band ?? screen.height;
  ctx.fillStyle = "#00060f";
  ctx.fillRect(0, 0, screen.width, band);
  if (band < screen.height) {
    ctx.fillStyle = "#000d1f";
    ctx.fillRect(0, band, screen.width, screen.height - band);
    ctx.strokeStyle = "#0a2d52";
    ctx.beginPath();
    ctx.moveTo(0, band + 0.5);
    ctx.lineTo(screen.width, band + 0.5);
    ctx.stroke();
  }
}

/** the 256 swatches of a palette, each titled with its index and colour */
export function fillSwatches(wrap: HTMLElement, palette: Uint8ClampedArray): void {
  wrap.replaceChildren();
  for (let i = 0; i < 256; i++) {
    const d = document.createElement("div");
    d.style.background = `rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    d.title = `${i}: rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    wrap.appendChild(d);
  }
}

/** a region list's row: its index, and the overlay lighting it while hovered */
export function regionRow(i: number, hover: (i: number) => void): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "regionrow";
  row.onpointerenter = () => hover(i);
  row.onpointerleave = () => hover(-1);
  const lead = document.createElement("span");
  lead.className = "lead";
  lead.textContent = String(i);
  row.appendChild(lead);
  return row;
}

/**
 * The file's scripts, each decompiled the first time it is opened — a big file
 * carries dozens. `encoding` is the tree's code page (`encodingOf`): a script's
 * player-facing strings are in it, and the Japanese tree's are not one byte a
 * character.
 */
export function appendScripts(
  wrap: HTMLElement,
  entries: { label: string; loc: number }[],
  containers: Container[],
  encoding: DfEncoding,
): void {
  for (const e of entries) {
    const det = document.createElement("details");
    det.className = "script";
    const sum = document.createElement("summary");
    sum.textContent = `${e.label} (container @${e.loc})`;
    det.appendChild(sum);
    const pre = document.createElement("pre");
    let filled = false;
    det.ontoggle = () => {
      if (filled || !det.open) return;
      filled = true;
      const tokens = sniffScript(containers[e.loc]?.data ?? new Uint8Array(0));
      pre.textContent = tokens ? scriptToText(tokens, encoding) : t("common.notAScript");
    };
    det.appendChild(pre);
    wrap.appendChild(det);
  }
}

/**
 * Rows that fill themselves in when they first scroll into view: decoding and
 * drawing every one of a big file's up front is wasted work.
 */
export class LazyFill {
  private observer: IntersectionObserver | null = null;
  private readonly pending = new Map<Element, () => void>();

  whenVisible(el: Element, fill: () => void): void {
    this.observer ??= new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this.pending.get(e.target)?.();
        this.pending.delete(e.target);
        this.observer!.unobserve(e.target);
      }
    });
    this.pending.set(el, fill);
    this.observer.observe(el);
  }

  reset(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.pending.clear();
  }
}

// --- PNG round trip ---------------------------------------------------------

/** the PNG Import button and its hidden file input */
export function wirePngImport(take: (file: File) => void): void {
  const pngInput = byId<HTMLInputElement>("pngInput");
  byId("pngImportBtn").addEventListener("click", () => pngInput.click());
  pngInput.addEventListener("change", () => {
    const file = pngInput.files?.[0];
    pngInput.value = "";
    if (file) take(file);
  });
}

/** a canvas, saved as a PNG under `name` */
export function savePng(canvas: HTMLCanvasElement, name: string): void {
  canvas.toBlob((blob) => {
    if (blob) download(blob, name);
  }, "image/png");
}

/** an image file's pixels, or null — and the status line saying it is not one */
export async function readImage(file: File, log: Log): Promise<ImageData | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    log(t("common.notAnImage", { file: file.name }));
    return null;
  }
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

/** the nearest of the palette's first `count` entries to a colour, by RGB distance */
export function nearestPaletteIndex(palette: Uint8ClampedArray, r: number, g: number, b: number, count = 256): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const dr = palette[i * 4] - r;
    const dg = palette[i * 4 + 1] - g;
    const db = palette[i * 4 + 2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** every pixel matched to the palette's first `count` entries, alpha ignored */
export function indexPixels(img: ImageData, palette: Uint8ClampedArray, count = 256): Uint8Array {
  const pixels = new Uint8Array(img.width * img.height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = nearestPaletteIndex(palette, img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], count);
  }
  return pixels;
}

/**
 * A sprite made of an image: pixels matched to the palette (nearest RGB),
 * alpha < 128 transparent, and the stored offset of the sprite it replaces kept
 * so the art stays anchored where it was.
 */
export function spriteFromImage(img: ImageData, palette: Uint8ClampedArray, old: ShpFrame | null): ShpFrame {
  const indexed = new Uint8Array(img.width * img.height);
  const opaque = new Uint8Array(img.width * img.height);
  for (let i = 0; i < indexed.length; i++) {
    if (img.data[i * 4 + 3] < 128) continue;
    opaque[i] = 1;
    indexed[i] = nearestPaletteIndex(palette, img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
  }
  return {
    width: img.width,
    height: img.height,
    posYraw: old?.posYraw ?? 0,
    posXraw: old?.posXraw ?? 0,
    indexed,
    opaque,
  };
}

/** what an art replacement's status line reports: the new size, and the bytes before and after */
export function artSizes(file: File, img: ImageData, data: Uint8Array, was: Uint8Array): Record<string, string | number> {
  return {
    file: file.name,
    w: img.width,
    h: img.height,
    kb: (data.length / 1024).toFixed(1),
    was: (was.length / 1024).toFixed(1),
  };
}

// --- export -----------------------------------------------------------------

export function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/**
 * Repack a container file and save it — but only once `readBack` has read the
 * export back as what it claims to be, so a broken repack is a message and not
 * a download.
 */
export function exportContainerFile(
  file: DFContainerFile,
  readBack: (bytes: Uint8Array) => unknown,
  fileName: string,
  edits: readonly string[],
  log: Log,
): void {
  const bytes = writeContainerFile(file);
  try {
    readBack(bytes);
  } catch (e) {
    log(t("common.exportFailed", { message: (e as Error).message }));
    return;
  }
  download(new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" }), fileName);
  log(
    t("common.exported", { file: fileName, bytes: formatNumber(bytes.length) }) +
      (edits.length
        ? t("common.exportedWithEdits", { n: edits.length, edits: edits.join(", ") })
        : t("common.exportedUnmodified")),
  );
}

// --- the page ---------------------------------------------------------------

/**
 * The site's chrome, and the source row.
 *
 * The row decides which edition's files the landing screen lists, and which copy
 * of a basename an edit is written back into: the same row the play page and the
 * collection carry (taoot/src/editions.ts). A click reloads, and each page's
 * beforeunload guard is what stands between that and unexported edits.
 */
export function installEditorPage(): Promise<Source | null> {
  void installI18n();
  installGamesMenu();
  void installLanguageMenu();
  installVersion();
  return installSourcePicker(byId("editionPicker"));
}
