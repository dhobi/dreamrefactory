/**
 * Cast Editor (casts.html) — the sixth of the browser editors over the DF
 * library, and the other half of a character: the puppet editor has the brains
 * (PUP — what they say, how their face moves), this has the body. Load a .CST
 * cast (upload, drag-and-drop, or pick one from the dev server's gamefiles
 * manifest — GANG.CST is the 25 named story characters, EXTRA.CST the background
 * passengers), take it apart into members → poses → the 8 view directions of
 * each animation step, walk a cycle at the engine's cadence, edit what is
 * editable, and export the repacked file.
 *
 * Editable: every member's name, every pose name, every sprite's stored anchor
 * offset, and any sprite's art via PNG round-trip. Reading is the same code path
 * the game uses (readCstFile/decodeShpFrame); writing is the patches in
 * src/df/cst.ts plus encodeShpFrame/writeContainerFile, so an untouched load
 * exports the file it read (see tests/auto/cst-editor.ts).
 */
import { indexedToRGBA, paletteToRGBA } from "../src/df/image";
import { ENGINE_STEP_MS } from "../src/engine/clock";
import { installLanguageMenu } from "../src/lang-menu";
import { chosenEdition, editionsIn, gamefileManifest, inChosenEdition, installEditionPicker } from "../src/editions";
import { siteUrl } from "../src/site";
import { t, formatNumber } from "../src/locales";
import { installI18n } from "../src/locales";
import { scriptToText, sniffScript } from "../src/df/script";
import { writeContainerFile } from "../src/df/container";
import {
  CastPose,
  CstFile,
  MEMBER_NAME_FIELD,
  POSE_NAME_FIELD,
  patchMemberName,
  patchPoseName,
  readCstFile,
} from "../src/df/cst";
import { ShpFrame, decodeShpFrame, encodeShpFrame, patchFrameAnchor } from "../src/df/shp";
import { SCREEN_H, SCREEN_W } from "../src/screen";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const dirtyEl = $("dirty");

/**
 * A walk cycle advances one step per service tick — the master heartbeat the
 * scheduler runs actors on (src/engine/scheduler.ts).
 *
 * Imported rather than copied, which is the whole point: this was its own `66`,
 * and the heartbeat has been 50 ms since the "bomb falls seconds too late" fix
 * (src/engine/clock.ts, confirmed against TI.EXE's own frame throttle). So the
 * preview here was playing every walk 32% slow while claiming to match the engine.
 */
const STEP_MS = ENGINE_STEP_MS;
/** the 8 stored directions, and what each one shows (0 = facing the viewer) */
const DIRECTIONS = [
  "front",
  "front-left",
  "left",
  "back-left",
  "back",
  "back-right",
  "right",
  "front-right",
];
/** where the preview puts the actor's world point */
const GROUND_X = 256;
const GROUND_Y = 300;
/** the most the preview canvas will grow past the screen on any one side, so a
 *  hand-typed depth scale cannot ask for a canvas the size of a wall */
const MAX_PAD = 512;
/** breathing room past the overhang, so a head that reaches off the top of the
 *  screen is not drawn flush against the edge of the canvas either */
const AIR = 16;

// --- editor state -----------------------------------------------------------

let cst: CstFile | null = null;
let fileName = "cast.cst";
let palette: Uint8ClampedArray = new Uint8ClampedArray(1024);
/** decoded sprites by container location (one cast open at a time) */
const frameCache = new Map<number, ShpFrame>();
/** human-readable notes of every edit, shown next to the export button */
const edits: string[] = [];
let memberIdx = 0;
let poseIdx = 0;
let stepIdx = 0;
let dirIdx = 0;
/** the depth scale the preview draws at — k in the engine's own formula */
let scaleK = 1;
/** the running walk cycle, if any */
let playing: { stop: () => void } | null = null;

function log(text: string): void {
  statusEl.textContent = text;
}

function markEdit(note: string): void {
  edits.push(note);
  dirtyEl.textContent = t("counts.unexportedEdits", { n: edits.length });
}

window.addEventListener("beforeunload", (e) => {
  if (edits.length) e.preventDefault();
});

const member = () => cst!.members[memberIdx];
const pose = (): CastPose | undefined => member()?.poses[poseIdx];
/** the selected sprite's container, or undefined for a direction the pose does
 *  not carry — a hole is either an absent slot or a stored 0, which is the file
 *  header container and so never a sprite */
const frameLoc = (): number | undefined => pose()?.steps[stepIdx]?.[dirIdx]?.location || undefined;

// --- loading ----------------------------------------------------------------

function loadCst(bytes: Uint8Array, name: string): void {
  stopPlayback();
  let parsed: CstFile;
  try {
    parsed = readCstFile(bytes);
  } catch (e) {
    log(t("common.notReadable", { ext: ".cst", message: (e as Error).message }));
    return;
  }
  cst = parsed;
  fileName = name;
  palette = paletteToRGBA(parsed.paletteRaw, 256);
  frameCache.clear();
  edits.length = 0;
  dirtyEl.textContent = "";
  memberIdx = 0;
  poseIdx = 0;
  stepIdx = 0;
  dirIdx = 0;

  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  log("");
  buildMemberSelect();
  refresh();
}

async function loadFromFile(f: File): Promise<void> {
  loadCst(new Uint8Array(await f.arrayBuffer()), f.name);
}

const fileInput = $<HTMLInputElement>("fileInput");
$("openBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files?.[0]) void loadFromFile(fileInput.files[0]);
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
  const f = e.dataTransfer?.files?.[0];
  if (f) void loadFromFile(f);
});

/** dev-server mode: offer every .cst in the gamefiles manifest */
async function initServerCasts(): Promise<void> {
  // Only the chosen EDITION's copies: an install with six of them holds six
  // `bedsit1.set`, and listing all six lists the same room six times under
  // names that cannot be told apart. The edition row at the top of the page is
  // what chooses, and it is the same choice the game reads (src/editions.ts).
  const all = await gamefileManifest();
  if (!all.length) return; // production / no dev server: upload only
  const paths = inChosenEdition(all, chosenEdition(editionsIn(all)));
  const casts = paths.filter((p) => p.toLowerCase().endsWith(".cst")).sort();
  if (!casts.length) return;
  const wrap = $("serverCasts");
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = t("common.pickFromGamefiles");
  wrap.appendChild(note);
  const row = document.createElement("div");
  row.className = "row casts";
  for (const p of casts) {
    const b = document.createElement("button");
    b.className = "cast";
    const base = p.split("/").pop()!;
    b.textContent = base.toLowerCase();
    b.title = p;
    b.addEventListener("click", async () => {
      log(t("common.loading", { path: p }));
      const r = await fetch(siteUrl(p));
      if (!r.ok) {
        log(t("common.fetchFailed", { path: p, status: r.status }));
        return;
      }
      loadCst(new Uint8Array(await r.arrayBuffer()), base);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}
void initServerCasts();

$("closeBtn").addEventListener("click", () => {
  if (edits.length && !confirm(t("counts.discardEdits", { n: edits.length }))) return;
  stopPlayback();
  cst = null;
  edits.length = 0;
  frameCache.clear();
  editor.style.display = "none";
  landing.style.display = "block";
});

// --- sprites ----------------------------------------------------------------

function frameAt(loc: number): ShpFrame | null {
  if (!cst) return null;
  let f = frameCache.get(loc) ?? null;
  if (!f) {
    try {
      f = decodeShpFrame(cst.file.containers[loc].data);
    } catch {
      return null;
    }
    frameCache.set(loc, f);
  }
  return f;
}

/** paint a decoded sprite into a canvas at 1:1, transparent where masked */
function frameToCanvas(f: ShpFrame, canvas: HTMLCanvasElement): void {
  canvas.width = Math.max(1, f.width);
  canvas.height = Math.max(1, f.height);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!f.width || !f.height) return;
  const img = ctx.createImageData(f.width, f.height);
  indexedToRGBA(f.indexed, f.width, f.height, palette, img.data);
  for (let i = 0; i < f.width * f.height; i++) {
    if (!f.opaque[i]) img.data[i * 4 + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
}

// --- preview ----------------------------------------------------------------

/** where a sprite lands on the screen, at the current depth scale */
function spriteRect(f: ShpFrame): { x: number; y: number; w: number; h: number } {
  return {
    x: GROUND_X - Math.round(f.posXraw * scaleK),
    y: GROUND_Y - Math.round(f.posYraw * scaleK),
    w: Math.max(1, Math.round(f.width * scaleK)),
    h: Math.max(1, Math.round(f.height * scaleK)),
  };
}

/**
 * Room the canvas needs OUTSIDE the 512×384 screen, per side.
 *
 * A cast sprite is anchored at the actor's feet, so its stored offset is very
 * nearly its full height — GANG.CST's tallest is 392 px with the anchor at 383 —
 * and at k=1 the world point's 300 px of headroom is not enough: the top 83 px of
 * the sprite, which is the head, landed above y=0 and was simply cut off. The
 * screen is still drawn as the screen (that is the point of this preview), but the
 * canvas is grown so nothing is hidden, and the screen's own edge is outlined
 * where it falls.
 *
 * Measured over the WHOLE POSE rather than the frame on show, so stepping through
 * a walk cycle — or playing it — does not resize the canvas between frames.
 */
function poseOverhang(): { top: number; right: number; bottom: number; left: number } {
  const pad = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const step of pose()?.steps ?? []) {
    for (const cf of step) {
      const f = cf?.location ? frameAt(cf.location) : null;
      if (!f?.width || !f.height) continue;
      const r = spriteRect(f);
      pad.top = Math.max(pad.top, -r.y);
      pad.left = Math.max(pad.left, -r.x);
      pad.bottom = Math.max(pad.bottom, r.y + r.h - SCREEN_H);
      pad.right = Math.max(pad.right, r.x + r.w - SCREEN_W);
    }
  }
  // a side that overhangs gets its overhang plus AIR; a side that does not stays
  // flush, so a sprite that fits the screen is framed exactly as the screen
  for (const side of ["top", "right", "bottom", "left"] as const) {
    pad[side] = pad[side] > 0 ? Math.min(MAX_PAD, pad[side] + AIR) : 0;
  }
  return pad;
}

/**
 * Draw a sprite where the engine would put it. An actor is a WORLD-space sprite:
 * its world point projects to a screen point, and the sprite is drawn at that
 * point minus its stored offset TIMES the depth scale — k = actorscale ×
 * refScale / (1000 × depth) in ActorRuntime.rect (src/engine/actors.ts). So the
 * stored offset is measured in sprite pixels and shrinks with the sprite, which
 * is why a character's feet stay on the floor as they walk away. Here the world
 * point is fixed and k is a field, so the two effects can be seen apart.
 */
function drawScreen(f: ShpFrame | null): void {
  const canvas = $<HTMLCanvasElement>("preview");
  const pad = poseOverhang();
  canvas.width = SCREEN_W + pad.left + pad.right;
  canvas.height = SCREEN_H + pad.top + pad.bottom;
  const ctx = canvas.getContext("2d")!;
  // off the screen entirely: flatter and darker than either band, so the strip a
  // sprite hangs into reads as "the engine would not draw this"
  ctx.fillStyle = "#02040a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(pad.left, pad.top); // from here on, screen coordinates
  ctx.fillStyle = "#00060f";
  ctx.fillRect(0, 0, SCREEN_W, 264);
  ctx.fillStyle = "#000d1f";
  ctx.fillRect(0, 264, SCREEN_W, SCREEN_H - 264);
  ctx.strokeStyle = "#0a2d52";
  ctx.beginPath();
  ctx.moveTo(0, 264.5);
  ctx.lineTo(SCREEN_W, 264.5);
  ctx.stroke();

  if (f && f.width && f.height) {
    const r = spriteRect(f);
    const off = document.createElement("canvas");
    frameToCanvas(f, off);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, f.width, f.height, r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "rgba(176,138,62,0.75)";
    ctx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
  }

  // the world point the sprite hangs off — the actor's own position
  ctx.strokeStyle = "rgba(242,232,205,0.5)";
  ctx.beginPath();
  ctx.moveTo(GROUND_X - 8, GROUND_Y + 0.5);
  ctx.lineTo(GROUND_X + 8, GROUND_Y + 0.5);
  ctx.moveTo(GROUND_X + 0.5, GROUND_Y - 8);
  ctx.lineTo(GROUND_X + 0.5, GROUND_Y + 8);
  ctx.stroke();
  // ...and where the screen ends, whenever anything reaches past it
  if (pad.top || pad.right || pad.bottom || pad.left) {
    ctx.strokeStyle = "rgba(122,168,214,0.5)";
    ctx.strokeRect(-0.5, -0.5, SCREEN_W + 1, SCREEN_H + 1);
  }
  ctx.restore();
}

function renderPreview(): void {
  if (!cst) return;
  const p = pose();
  const cf = p?.steps[stepIdx]?.[dirIdx];
  const f = cf?.location ? frameAt(cf.location) : null;
  drawScreen(f);
  const packed = cf?.location ? (cst.file.containers[cf.location]?.data.length ?? 0) : 0;
  $("previewInfo").innerHTML = p
    ? t("casts.previewHead", {
        name: member().name,
        pose: p.name,
        step: stepIdx + 1,
        steps: p.steps.length,
        dir: dirIdx,
        compass: DIRECTIONS[dirIdx],
      }) +
      (cf?.location
        ? t("casts.previewContainer", { loc: cf.location }) +
          (f
            ? t("casts.previewSize", { w: f.width, h: f.height, y: f.posYraw, x: f.posXraw }) +
              t("casts.previewPacked", { bytes: formatNumber(packed), angle: cf.angle, ref: cf.refScale }) +
              t("casts.previewDrawn", {
                k: scaleK,
                w: Math.round(f.width * scaleK),
                h: Math.round(f.height * scaleK),
                x: GROUND_X - Math.round(f.posXraw * scaleK),
                y: GROUND_Y - Math.round(f.posYraw * scaleK),
              })
            : t("casts.previewNotSprite"))
        : t("casts.previewNoSprite"))
    : t("casts.noPoses");
}

$<HTMLInputElement>("scaleK").addEventListener("change", () => {
  const v = Number($<HTMLInputElement>("scaleK").value);
  scaleK = v > 0 ? v : 1;
  $<HTMLInputElement>("scaleK").value = String(scaleK);
  renderPreview();
});

// --- playback ---------------------------------------------------------------

function stopPlayback(): void {
  playing?.stop();
  playing = null;
  $("playBtn").textContent = t("casts.walkCycle");
}

/**
 * Cycle the pose's steps in the selected direction, at the cadence the walk
 * service uses (one step per 50 ms tick) and LOOPING, because that is what a
 * walk does: the scheduler advances `step` every tick for as long as the walk
 * runs and the runtime takes it modulo the step count.
 */
$("playBtn").addEventListener("click", () => {
  if (playing) {
    stopPlayback();
    renderPreview();
    return;
  }
  const p = pose();
  if (!p || p.steps.length < 2) {
    log(t("casts.singleStepNotCycle"));
    return;
  }
  const start = performance.now();
  let raf = 0;
  $("playBtn").textContent = "◼ Stop";
  const step = (): void => {
    stepIdx = Math.floor((performance.now() - start) / STEP_MS) % p.steps.length;
    const loc = p.steps[stepIdx]?.[dirIdx]?.location;
    drawScreen(loc ? frameAt(loc) : null);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  playing = {
    stop: () => {
      cancelAnimationFrame(raf);
      buildFrames();
      renderPreview();
    },
  };
});

// --- rendering --------------------------------------------------------------

function refresh(): void {
  if (!cst) return;
  buildFileBar();
  buildMemberFields();
  buildPoses();
  buildFrames();
  buildScripts();
  buildPalette();
  renderPreview();
}

function selectPose(idx: number): void {
  stopPlayback();
  poseIdx = idx;
  stepIdx = 0;
  buildPoses();
  buildFrames();
  renderPreview();
}

function buildFileBar(): void {
  const c = cst!;
  const poses = c.members.reduce((n, m) => n + m.poses.length, 0);
  const frames = c.members.reduce(
    (n, m) => n + m.poses.reduce((k, p) => k + p.frameCount, 0),
    0,
  );
  $("fileStats").textContent =
    t("counts.containers", { n: c.file.containers.length }) + " · " + t("counts.members", { n: c.members.length }) + " · " +
    t("casts.fileStatsTail", { poses, frames });
}

function buildMemberSelect(): void {
  const sel = $<HTMLSelectElement>("memberSel");
  sel.replaceChildren();
  cst!.members.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = `${i} ${m.name || "(unnamed)"} (${m.poses.length} poses)`;
    sel.appendChild(o);
  });
  sel.value = String(memberIdx);
  sel.onchange = () => {
    stopPlayback();
    memberIdx = Number(sel.value);
    poseIdx = 0;
    stepIdx = 0;
    dirIdx = 0;
    refresh();
  };
}

function buildMemberFields(): void {
  const m = member();
  const name = $<HTMLInputElement>("memberName");
  name.value = m?.name ?? "";
  name.maxLength = MEMBER_NAME_FIELD;
  name.title =
    t("casts.memberNameTitle", { max: MEMBER_NAME_FIELD });
  name.onchange = () => {
    if (!m || name.value === m.name) return;
    const stored = patchMemberName(cst!, memberIdx, name.value);
    name.value = stored;
    name.classList.add("edited");
    markEdit(t("casts.memberNameEdit", { i: memberIdx, name: stored }));
    log(
      t("casts.memberRenamed", { i: memberIdx, name: stored }),
    );
    buildMemberSelect();
    renderPreview();
  };
  $("memberInfo").innerHTML = m
    ? t("casts.memberInfo", { script: m.scriptLocation, logic: m.logicLocation })
    : "";
}

function buildPoses(): void {
  const wrap = $("poses");
  wrap.replaceChildren();
  const m = member();
  if (!m) return;
  $("posesInfo").textContent =
    t("counts.poses", { n: m.poses.length }) +
    t("casts.posesOf", { name: m.name }) +
    t("casts.posesInfoTail");

  const filter = $<HTMLInputElement>("poseFilter").value.trim().toLowerCase();
  let shown = 0;
  m.poses.forEach((p, i) => {
    if (filter && !p.name.includes(filter)) return;
    shown++;
    const row = document.createElement("div");
    row.className = "poserow" + (i === poseIdx ? " selected" : "");

    const pick = document.createElement("button");
    pick.className = "mini";
    pick.textContent = i === poseIdx ? "●" : "○";
    pick.title = t("casts.showThisPose");
    pick.onclick = () => selectPose(i);
    row.appendChild(pick);

    const name = document.createElement("input");
    name.type = "text";
    name.className = "ident";
    name.value = p.name;
    name.maxLength = POSE_NAME_FIELD;
    name.title = t("casts.poseNameTitle", { max: POSE_NAME_FIELD });
    name.onchange = () => {
      if (name.value === p.name) return;
      const stored = patchPoseName(cst!, memberIdx, i, name.value);
      name.value = p.name;
      name.classList.add("edited");
      markEdit(`pose ${memberIdx}/${i} → ${stored}`);
      renderPreview();
    };
    row.appendChild(name);

    const kind = document.createElement("span");
    kind.className = "badge " + (p.steps.length > 1 ? "anim" : "sel");
    kind.textContent = p.steps.length > 1 ? "cycle" : "stand";
    kind.title =
      p.steps.length > 1
        ? t("casts.manySteps")
        : t("casts.oneStep");
    row.appendChild(kind);

    const meta = document.createElement("span");
    meta.className = "meta grow";
    const holes = p.steps.reduce((n, s) => n + (8 - s.filter(Boolean).length), 0);
    meta.textContent =
      t("counts.steps", { n: p.steps.length }) +
      t("casts.byDirections") +
      t("counts.sprites", { n: p.frameCount }) +
      (holes ? t("casts.missing", { n: holes }) : "") +
      t("casts.setContainer", { loc: p.location });
    row.appendChild(meta);

    if (p.steps.length > 1) {
      const play = document.createElement("button");
      play.className = "mini";
      play.textContent = "▶";
      play.title = t("casts.walkThisCycle");
      play.onclick = () => {
        selectPose(i);
        $("playBtn").click();
      };
      row.appendChild(play);
    }

    wrap.appendChild(row);
  });
  if (!shown) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = filter ? t("casts.noPoseMatches", { filter }) : t("casts.noPoses");
    wrap.appendChild(empty);
  }
}

$<HTMLInputElement>("poseFilter").addEventListener("input", () => buildPoses());

/**
 * The selected pose as a grid: one row per animation step, one column per view
 * direction. That is the shape the file stores (frames group 8 at a time) and
 * the shape that makes a hole visible — a step missing a direction shows as a
 * dash rather than silently falling back the way the runtime does.
 */
function buildFrames(): void {
  const wrap = $("frames");
  wrap.replaceChildren();
  const p = pose();
  $("framesInfo").textContent = p
    ? t("casts.gridHead", { name: p.name })
    : "";
  if (!p) return;

  const head = document.createElement("div");
  head.className = "gridrow head";
  head.appendChild(document.createElement("span"));
  DIRECTIONS.forEach((label, d) => {
    const cell = document.createElement("span");
    cell.className = "dirhead";
    cell.textContent = `${d}`;
    cell.title = label;
    head.appendChild(cell);
  });
  wrap.appendChild(head);

  p.steps.forEach((step, s) => {
    const row = document.createElement("div");
    row.className = "gridrow";
    const lead = document.createElement("span");
    lead.className = "lead";
    lead.textContent = `${s}`;
    row.appendChild(lead);
    for (let d = 0; d < 8; d++) {
      const cf = step?.[d]?.location ? step[d] : undefined;
      const cell = document.createElement("div");
      cell.className =
        "framecell" + (s === stepIdx && d === dirIdx ? " selected" : "") + (cf ? "" : " empty");
      if (!cf) {
        cell.textContent = "—";
        row.appendChild(cell);
        continue;
      }
      const f = frameAt(cf.location);
      const c = document.createElement("canvas");
      c.className = "thumb";
      if (f && f.width && f.height) {
        frameToCanvas(f, c);
        const scale = Math.min(56 / f.width, 56 / f.height, 2);
        c.style.width = `${Math.max(1, Math.round(f.width * scale))}px`;
        c.style.height = `${Math.max(1, Math.round(f.height * scale))}px`;
      } else {
        c.width = c.height = 16;
        c.style.width = c.style.height = "16px";
      }
      cell.title =
        `step ${s}, direction ${d} (${DIRECTIONS[d]}) @${cf.location}` +
        (f ? ` — ${f.width}×${f.height}` : " — undecodable");
      cell.onclick = () => {
        stopPlayback();
        stepIdx = s;
        dirIdx = d;
        buildFrames();
        renderPreview();
      };
      cell.appendChild(c);
      row.appendChild(cell);
    }
    wrap.appendChild(row);
  });
  buildFramePanel();
}

function buildFramePanel(): void {
  const loc = frameLoc();
  const f = loc === undefined ? null : frameAt(loc);
  const panel = $("framePanel");
  panel.style.display = loc === undefined ? "none" : "flex";
  if (loc === undefined) return;

  const posY = $<HTMLInputElement>("posY");
  const posX = $<HTMLInputElement>("posX");
  posY.value = String(f?.posYraw ?? 0);
  posX.value = String(f?.posXraw ?? 0);
  const apply = (): void => {
    if (!f) return;
    const y = Number(posY.value) || 0;
    const x = Number(posX.value) || 0;
    if (y === f.posYraw && x === f.posXraw) return;
    if (!patchFrameAnchor(cst!.file, loc, y, x)) return;
    frameCache.delete(loc);
    markEdit(t("casts.offsetEdit", { loc, y, x }));
    log(
      t("casts.offsetMoved", { loc, x, y }),
    );
    buildFrames();
    renderPreview();
  };
  posY.onchange = apply;
  posX.onchange = apply;
}

function buildScripts(): void {
  const wrap = $("scripts");
  wrap.replaceChildren();
  const c = cst!;
  for (const m of c.members) {
    if (!m.scriptLocation) continue;
    const det = document.createElement("details");
    det.className = "script";
    const sum = document.createElement("summary");
    sum.textContent = `${m.name} (container @${m.scriptLocation})`;
    det.appendChild(sum);
    const pre = document.createElement("pre");
    // decompiling is only worth it when opened — GANG.CST carries 25
    let filled = false;
    det.ontoggle = () => {
      if (filled || !det.open) return;
      filled = true;
      const tokens = sniffScript(c.file.containers[m.scriptLocation]?.data ?? new Uint8Array(0));
      pre.textContent = tokens ? scriptToText(tokens) : t("common.notAScript");
    };
    det.appendChild(pre);
    wrap.appendChild(det);
  }
}

function buildPalette(): void {
  const wrap = $("palette");
  wrap.replaceChildren();
  $("paletteInfo").textContent =
    t("casts.paletteInfo");
  for (let i = 0; i < 256; i++) {
    const d = document.createElement("div");
    d.style.background = `rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    d.title = `${i}: rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    wrap.appendChild(d);
  }
}

// --- PNG round trip ---------------------------------------------------------

const baseName = (): string => fileName.replace(/\.cst$/i, "").toLowerCase();

$("pngExportBtn").addEventListener("click", () => {
  const loc = frameLoc();
  const f = loc === undefined ? null : frameAt(loc);
  if (!f) return;
  const c = document.createElement("canvas");
  frameToCanvas(f, c);
  c.toBlob((blob) => {
    if (!blob) return;
    download(blob, `${baseName()}.${member().name}.${pose()!.name}.s${stepIdx}.d${dirIdx}.png`);
  }, "image/png");
});

const pngInput = $<HTMLInputElement>("pngInput");
$("pngImportBtn").addEventListener("click", () => pngInput.click());
pngInput.addEventListener("change", () => {
  const file = pngInput.files?.[0];
  pngInput.value = "";
  const loc = frameLoc();
  if (file && loc !== undefined) void importPng(file, loc);
});

/**
 * Replace a sprite with an image file: pixels are matched to the cast's palette
 * (nearest RGB), alpha < 128 becomes transparent, and the stored offset is kept
 * so the character stays on the floor. One direction of one step at a time —
 * which is the honest granularity, because that is how the file stores them.
 */
async function importPng(file: File, loc: number): Promise<void> {
  if (!cst) return;
  const old = frameAt(loc);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    log(t("common.notAnImage", { file: file.name }));
    return;
  }
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);

  const indexed = new Uint8Array(bmp.width * bmp.height);
  const opaque = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0; i < indexed.length; i++) {
    if (img.data[i * 4 + 3] < 128) continue;
    opaque[i] = 1;
    indexed[i] = nearestPaletteIndex(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
  }
  const frame: ShpFrame = {
    width: bmp.width,
    height: bmp.height,
    posYraw: old?.posYraw ?? 0,
    posXraw: old?.posXraw ?? 0,
    indexed,
    opaque,
  };
  const container = cst.file.containers[loc];
  const data = encodeShpFrame(frame);
  cst.file.containers[loc] = { id: container.id, data };
  frameCache.delete(loc);
  markEdit(t("casts.artEdit", { loc, file: file.name }));
  log(
    t("casts.artReplaced", {
      loc,
      file: file.name,
      w: bmp.width,
      h: bmp.height,
      kb: (data.length / 1024).toFixed(1),
      was: (container.data.length / 1024).toFixed(1),
    }) +
      (old && (old.width !== bmp.width || old.height !== bmp.height)
        ? t("casts.artSizeWarn", { w: old.width, h: old.height })
        : ""),
  );
  buildFrames();
  renderPreview();
}

function nearestPaletteIndex(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 256; i++) {
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

// --- export -----------------------------------------------------------------

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

$("exportBtn").addEventListener("click", () => {
  if (!cst) return;
  const bytes = writeContainerFile(cst.file);
  try {
    readCstFile(bytes); // sanity: the export must read back as a cast
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
});

void installI18n();
void installLanguageMenu();
// Which edition's files the landing screen lists, and which copy of a basename an
// edit is written back into: the same row the play page and the collection carry
// (src/editions.ts). A click reloads, and this page's beforeunload guard is what
// stands between that and unexported edits.
void installEditionPicker(document.getElementById("editionPicker") as HTMLElement);
