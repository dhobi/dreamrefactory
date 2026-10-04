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
 * engine/src/df/cst.ts plus encodeShpFrame/writeContainerFile, so an untouched load
 * exports the file it read (see taoot/tests/auto/cst-editor.ts).
 */
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { ENGINE_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import { byExtension, chosenSource, filesIn, listSources, screenOf, V5_READ_ONLY, isV5File } from "./sources";
import {
  artSizes,
  drawScreenBands,
  exportContainerFile,
  fillSwatches,
  installEditorPage,
  paintFrame,
  readImage,
  savePng,
  serverNote,
  serverRow,
  spriteFromImage,
  wireFileOpen,
  wirePngImport,
} from "./editor-kit";
import { detectVersion } from "@dreamfactory/engine/df/version";
import { t, formatNumber } from "@dreamfactory/site/locales";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import { decodeAudioContainer, type DecodedAudio } from "@dreamfactory/engine/df/audio";
import { wavBlob } from "./wav";
import {
  CastPose,
  CstFile,
  MEMBER_NAME_FIELD,
  POSE_NAME_FIELD,
  patchMemberName,
  patchPoseName,
  readCstFile,
} from "@dreamfactory/engine/df/cst";
import { ShpFrame, decodeShpFrame, encodeShpFrame, patchFrameAnchor } from "@dreamfactory/engine/df/shp";
import type { GameScreen } from "@dreamfactory/site/games";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const dirtyEl = $("dirty");

/**
 * A walk cycle advances one step per service tick — the master heartbeat the
 * scheduler runs actors on (engine/src/runtime/scheduler.ts).
 *
 * Imported rather than copied, which is the whole point: this was its own `66`,
 * and the heartbeat has been 50 ms since the "bomb falls seconds too late" fix
 * (engine/src/runtime/clock.ts, confirmed against TI.EXE's own frame throttle). So the
 * preview here was playing every walk 32% slow while claiming to match the engine.
 */
const STEP_MS = ENGINE_STEP_MS;
/**
 * The compass, at the 32-apart spacing eight stored pictures give (0 = facing
 * the viewer). Named from the picture's own depicted ANGLE rather than from its
 * column, because a pose is not obliged to store eight: `stok1` stores nine and
 * `life1` seventeen, both across the half circle 0..128 only.
 */
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
const compassOf = (angle: number): string => DIRECTIONS[Math.round((angle & 0xff) / 32) & 7];
/**
 * The screen this rip's actors are composited over.
 *
 * A CST records no screen size either, so it is the GAME's — see `screenOf`, and
 * the note on the same field in `shp-editor.ts`.
 */
let screen: GameScreen = screenOf(null);

/**
 * Where the preview puts the actor's world point: the middle of the screen, low
 * enough down that a full-height sprite has headroom above it.
 *
 * The preview's own choice rather than anything the data says — 256,300 on the
 * 512×384 screen every CST in the corpus is authored for — but written as a
 * fraction of {@link screen} so it stays in the middle of a screen of another
 * size, which is where "the middle" means the same thing.
 */
const groundX = (): number => Math.floor(screen.width / 2);
const groundY = (): number => Math.round(screen.height * (300 / 384));
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

/** a DreamFactory 5 file, open read-only (see `isV5File`) */
let readOnly = false;

function loadCst(bytes: Uint8Array, name: string): void {
  stopPlayback();
  let parsed: CstFile;
  try {
    parsed = readCstFile(bytes);
  } catch (e) {
    // Say WHICH engine wrote it when the read fails.
    //
    // Dust's own casts do NOT fail: this format did not change between
    // DreamFactory 1 and 4, so the reader above opens them directly, with no
    // conversion and nothing to add here (extra.cst: 12 members, 40 poses).
    // SET and MOV did change and go through the engine's v1->v4 conversion
    // instead; see the note on `readOnlyV1` in the set and movie editors.
    //
    // So this branch is for a container that is neither — and there, "not
    // readable" alone reads as a corrupt file rather than an unimplemented
    // format. The version is one i32 at a known offset, so asking costs nothing.
    const why =
      detectVersion(bytes) === 1
        ? `DreamFactory 1 container — this port reads DreamFactory 4 casts only`
        : (e as Error).message;
    log(t("common.notReadable", { ext: ".cst", message: why }));
    return;
  }
  cst = parsed;
  fileName = name;
  palette = paletteToRGBA(parsed.paletteRaw, 256);
  frameCache.clear();
  edits.length = 0;
  // a v5 file reads but cannot be written yet (sources.ts)
  readOnly = isV5File(bytes);
  dirtyEl.textContent = readOnly ? V5_READ_ONLY : "";
  // a button that refuses when pressed is worse than one that says so first
  ($("exportBtn") as HTMLButtonElement).disabled = readOnly;
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

wireFileOpen(async (f) => loadCst(new Uint8Array(await f.arrayBuffer()), f.name));

/** dev-server mode: offer every .cst in the gamefiles manifest */
async function initServerCasts(): Promise<void> {
  // Only the chosen EDITION's copies: an install with six of them holds six
  // `bedsit1.set`, and listing all six lists the same room six times under
  // names that cannot be told apart. The edition row at the top of the page is
  // what chooses, and it is the same choice the game reads (taoot/src/editions.ts).
  const source = chosenSource(await listSources());
  // before any of this rip's actors are drawn — see the note on `screen`
  if (source) screen = screenOf(source);
  if (!source) return; // production / no dev server: upload only
  const casts = filesIn(source, byExtension(".cst", ".cast"));
  if (!casts.length) return;
  const wrap = $("serverCasts");
  serverNote(wrap, t("common.pickFromGamefiles"));
  serverRow(wrap, {
    source,
    files: casts,
    rowClass: "casts",
    buttonClass: "cast",
    log,
    open: (bytes, f) => loadCst(bytes, f.base),
  });
}
const serverListed = initServerCasts();

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
const frameToCanvas = (f: ShpFrame, canvas: HTMLCanvasElement): void => paintFrame(f, canvas, palette);

// --- preview ----------------------------------------------------------------

/** where a sprite lands on the screen, at the current depth scale */
function spriteRect(f: ShpFrame): { x: number; y: number; w: number; h: number } {
  return {
    x: groundX() - Math.round(f.posXraw * scaleK),
    y: groundY() - Math.round(f.posYraw * scaleK),
    w: Math.max(1, Math.round(f.width * scaleK)),
    h: Math.max(1, Math.round(f.height * scaleK)),
  };
}

/**
 * Room the canvas needs OUTSIDE the screen, per side.
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
      pad.bottom = Math.max(pad.bottom, r.y + r.h - screen.height);
      pad.right = Math.max(pad.right, r.x + r.w - screen.width);
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
 * refScale / (1000 × depth) in ActorRuntime.rect (engine/src/runtime/actors.ts). So the
 * stored offset is measured in sprite pixels and shrinks with the sprite, which
 * is why a character's feet stay on the floor as they walk away. Here the world
 * point is fixed and k is a field, so the two effects can be seen apart.
 */
function drawScreen(f: ShpFrame | null): void {
  const canvas = $<HTMLCanvasElement>("preview");
  const pad = poseOverhang();
  canvas.width = screen.width + pad.left + pad.right;
  canvas.height = screen.height + pad.top + pad.bottom;
  const ctx = canvas.getContext("2d")!;
  // off the screen entirely: flatter and darker than either band, so the strip a
  // sprite hangs into reads as "the engine would not draw this"
  ctx.fillStyle = "#02040a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(pad.left, pad.top); // from here on, screen coordinates
  // the band, and the line that ends the room view, only where the game has one
  drawScreenBands(ctx, screen);

  if (f?.width && f.height) {
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
  ctx.moveTo(groundX() - 8, groundY() + 0.5);
  ctx.lineTo(groundX() + 8, groundY() + 0.5);
  ctx.moveTo(groundX() + 0.5, groundY() - 8);
  ctx.lineTo(groundX() + 0.5, groundY() + 8);
  ctx.stroke();
  // ...and where the screen ends, whenever anything reaches past it
  if (pad.top || pad.right || pad.bottom || pad.left) {
    ctx.strokeStyle = "rgba(122,168,214,0.5)";
    ctx.strokeRect(-0.5, -0.5, screen.width + 1, screen.height + 1);
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
  if (!p) {
    $("previewInfo").innerHTML = t("casts.noPoses");
    return;
  }
  let info = t("casts.previewHead", {
    name: member().name,
    pose: p.name,
    step: stepIdx + 1,
    steps: p.steps.length,
    dir: dirIdx,
    compass: compassOf(cf?.angle ?? dirIdx * 32),
  });
  if (!cf?.location) {
    info += t("casts.previewNoSprite");
  } else {
    info += t("casts.previewContainer", { loc: cf.location });
    if (f) {
      info +=
        t("casts.previewSize", { w: f.width, h: f.height, y: f.posYraw, x: f.posXraw }) +
        t("casts.previewPacked", { bytes: formatNumber(packed), angle: cf.angle, ref: cf.refScale }) +
        t("casts.previewDrawn", {
          k: scaleK,
          w: Math.round(f.width * scaleK),
          h: Math.round(f.height * scaleK),
          x: groundX() - Math.round(f.posXraw * scaleK),
          y: groundY() - Math.round(f.posYraw * scaleK),
        });
    } else {
      info += t("casts.previewNotSprite");
    }
  }
  $("previewInfo").innerHTML = info;
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
 * Play the pose the way the engine plays it: one step of its PLAY SCRIPT per
 * 50 ms service pass, looping.
 *
 * Through the script, not through the pictures — the two are not the same
 * length, and a preview that walks the pictures directly is the same bug the
 * runtime had (#181). Every walk in the game lists its ten pictures twice, so a
 * stride takes a second here as well; `stok1`'s `dig` is the same and every
 * `stand` lists one step, which is why those do not offer a cycle at all.
 */
$("playBtn").addEventListener("click", () => {
  if (playing) {
    stopPlayback();
    renderPreview();
    return;
  }
  const p = pose();
  if (!p || p.play.length < 2) {
    log(t("casts.singleStepNotCycle"));
    return;
  }
  const start = performance.now();
  let raf = 0;
  $("playBtn").textContent = "◼ Stop";
  const step = (): void => {
    const at = Math.floor((performance.now() - start) / STEP_MS) % p.play.length;
    stepIdx = p.play[at];
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
  buildSounds();
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

    // a pose CYCLES when its play script has more than one step, which is not
    // the same question as how many pictures it stores: `stok1`'s `stand` keeps
    // two and plays one of them for ever
    const cycles = p.play.length > 1;
    const kind = document.createElement("span");
    kind.className = "badge " + (cycles ? "anim" : "sel");
    kind.textContent = cycles ? "cycle" : "stand";
    kind.title = cycles ? t("casts.manySteps") : t("casts.oneStep");
    row.appendChild(kind);

    const meta = document.createElement("span");
    meta.className = "meta grow";
    // a hole is a slot with no art behind it, not a step short of eight views —
    // a pose stores as many views as it stores
    const views = Math.max(0, ...p.steps.map((s) => s.length));
    const holes = p.steps.reduce((n, s) => n + s.filter((f) => !f.location).length, 0);
    meta.textContent =
      t("counts.steps", { n: p.steps.length }) +
      " × " +
      t("counts.views", { n: views }) +
      " · " +
      t("counts.sprites", { n: p.frameCount }) +
      (holes ? t("casts.missing", { n: holes }) : "") +
      t("casts.setContainer", { loc: p.location });
    row.appendChild(meta);

    if (cycles) {
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
 * The selected pose as a grid: one row per animation step, one column per stored
 * view. That is the shape the file stores, and the shape that makes a hole
 * visible — a step short of a view shows as a dash rather than silently falling
 * back the way the runtime does.
 *
 * The width is the WIDEST step's, not eight: `stok1` stores nine views and
 * `life1` seventeen, and a fixed eight columns hid the rest.
 */
function buildFrames(): void {
  const wrap = $("frames");
  wrap.replaceChildren();
  const p = pose();
  $("framesInfo").textContent = p
    ? t("casts.gridHead", { name: p.name })
    : "";
  if (!p) return;

  const width = Math.max(1, ...p.steps.map((s) => s?.length ?? 0));
  const head = document.createElement("div");
  head.className = "gridrow head";
  head.appendChild(document.createElement("span"));
  for (let d = 0; d < width; d++) {
    const cell = document.createElement("span");
    cell.className = "dirhead";
    cell.textContent = `${d}`;
    const angle = p.steps.find((s) => s?.[d])?.[d]?.angle;
    cell.title = angle === undefined ? `${d}` : `${compassOf(angle)} (${angle})`;
    head.appendChild(cell);
  }
  wrap.appendChild(head);

  p.steps.forEach((step, s) => {
    const row = document.createElement("div");
    row.className = "gridrow";
    const lead = document.createElement("span");
    lead.className = "lead";
    lead.textContent = `${s}`;
    row.appendChild(lead);
    for (let d = 0; d < width; d++) {
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
      if (f?.width && f.height) {
        frameToCanvas(f, c);
        const scale = Math.min(56 / f.width, 56 / f.height, 2);
        c.style.width = `${Math.max(1, Math.round(f.width * scale))}px`;
        c.style.height = `${Math.max(1, Math.round(f.height * scale))}px`;
      } else {
        c.width = c.height = 16;
        c.style.width = c.style.height = "16px";
      }
      cell.title =
        `step ${s}, view ${d} — ${compassOf(cf.angle)} (${cf.angle}) @${cf.location}` +
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

/**
 * The sounds a cast keeps among its sprites (#464). Only RedJack's
 * `bfight.cast` has one: a DreamFactory 5 `SOUN` container, 0.65 s, with no
 * name and nothing in the cast that names it, so it is listed by where it is.
 * The section hides for a cast without any.
 */
const castSound = new Audio();
function buildSounds(): void {
  const wrap = $("sounds");
  wrap.replaceChildren();
  castSound.pause();
  const c = cst!;
  const isSound = (d: Uint8Array): boolean =>
    d.length > 24 && d[2] === 5 && d[3] === 0 && String.fromCharCode(d[7], d[6], d[5], d[4]) === "SOUN";
  const sounds = c.file.containers.flatMap((x, loc) => (isSound(x.data) ? [loc] : []));
  $("soundsSection").style.display = sounds.length ? "" : "none";
  for (const loc of sounds) {
    const row = document.createElement("div");
    const label = document.createElement("span");
    let audio: DecodedAudio;
    try {
      audio = decodeAudioContainer(c.file.containers[loc].data, c.file.order);
    } catch (e) {
      label.textContent = t("casts.soundBroken", { loc, message: (e as Error).message });
      row.append(label);
      wrap.append(row);
      continue;
    }
    const url = URL.createObjectURL(wavBlob(audio));
    const play = document.createElement("button");
    play.className = "mini";
    play.textContent = "▶";
    play.onclick = () => {
      castSound.src = url;
      castSound.currentTime = 0;
      void castSound.play();
    };
    const save = document.createElement("a");
    save.className = "mini";
    save.href = url;
    save.download = `${fileName.replace(/\.[^.]+$/, "")}.sound${loc}.wav`;
    save.textContent = "⬇ WAV";
    label.textContent = ` ${t("casts.soundRow", { loc, secs: (audio.samples.length / audio.sampleRate).toFixed(2), rate: audio.sampleRate })} `;
    row.append(play, label, save);
    wrap.append(row);
  }
}

function buildPalette(): void {
  fillSwatches($("palette"), palette);
  $("paletteInfo").textContent =
    t("casts.paletteInfo");
}

// --- PNG round trip ---------------------------------------------------------

const baseName = (): string => fileName.replace(/\.cst$/i, "").toLowerCase();

$("pngExportBtn").addEventListener("click", () => {
  const loc = frameLoc();
  const f = loc === undefined ? null : frameAt(loc);
  if (!f) return;
  const c = document.createElement("canvas");
  frameToCanvas(f, c);
  savePng(c, `${baseName()}.${member().name}.${pose()!.name}.s${stepIdx}.d${dirIdx}.png`);
});

wirePngImport((file) => {
  const loc = frameLoc();
  if (loc !== undefined) void importPng(file, loc);
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
  const img = await readImage(file, log);
  if (!img) return;
  const frame = spriteFromImage(img, palette, old);
  const container = cst.file.containers[loc];
  const data = encodeShpFrame(frame);
  cst.file.containers[loc] = { id: container.id, data };
  frameCache.delete(loc);
  markEdit(t("casts.artEdit", { loc, file: file.name }));
  log(
    t("casts.artReplaced", {
      loc,
      ...artSizes(file, img, data, container.data),
    }) +
      (old && (old.width !== img.width || old.height !== img.height)
        ? t("casts.artSizeWarn", { w: old.width, h: old.height })
        : ""),
  );
  buildFrames();
  renderPreview();
}

// --- export -----------------------------------------------------------------

$("exportBtn").addEventListener("click", () => {
  if (!cst) return;
  if (readOnly) {
    log(V5_READ_ONLY);
    return;
  }
  // sanity: the export must read back as a cast
  exportContainerFile(cst.file, readCstFile, fileName, edits, log);
});

void installEditorPage();
await serverListed;
