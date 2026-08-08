/**
 * Track Editor (tracks.html) — the sound half of what the puppet editor does
 * for conversation puppets: load a .TRK/.SFX/.11K audio bank (upload,
 * drag-and-drop, or pick one from the dev server's gamefiles manifest), take it
 * apart into the two things a bank holds — the ordered loop chunks that make up
 * a looping theme, and the named one-shots a script fires by name — play them,
 * edit what is editable, and export the repacked file.
 *
 * Editable: the bank's track name, every chunk's identifier, the theme's
 * playback order (reorder, repeat, drop), and any chunk's audio (replaced from
 * a WAV/MP3/OGG, resampled to the chunk's rate and re-encoded with the v41
 * codec). Reading is the same code path the game uses (readBankTables /
 * decodeAudioContainer); writing is the patches in src/df/banks.ts plus
 * encodeAudioContainer / writeContainerFile, so an untouched load exports the
 * file it read (see tests/auto/trk-editor.ts).
 */
import { DFContainerFile, readContainerFile, writeContainerFile } from "../src/df/container";
import { installLanguageMenu } from "../src/lang-menu";
import { installVersion } from "../src/version";
import { chosenEdition, editionsIn, gamefileManifest, inChosenEdition, installEditionPicker } from "../src/editions";
import { siteUrl } from "../src/site";
import { t as tr, formatNumber } from "../src/locales";
import { installI18n } from "../src/locales";
import {
  DecodedAudio,
  decodeAudioContainer,
  encodeAudioContainer,
  readAudioHeader,
} from "../src/df/audio";
import {
  BankChunk,
  BankTables,
  CHUNK_ID_FIELD,
  LOOP_ORDER_MAX,
  patchChunkIdentifier,
  patchLoopOrder,
  patchTrackName,
  readAudioBank,
  readBankTables,
} from "../src/df/banks";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const dirtyEl = $("dirty");

// --- editor state -----------------------------------------------------------

let file: DFContainerFile | null = null;
let tables: BankTables | null = null;
let fileName = "bank.trk";
/** human-readable notes of every edit, shown next to the export button */
const edits: string[] = [];
/** decoded audio by container location (one bank open at a time) */
const decoded = new Map<number, DecodedAudio | null>();
/** substring filter over the one-shot list */
let soundFilter = "";

function log(text: string): void {
  statusEl.textContent = text;
}

function markEdit(note: string): void {
  edits.push(note);
  dirtyEl.textContent = tr("counts.unexportedEdits", { n: edits.length });
}

window.addEventListener("beforeunload", (e) => {
  if (edits.length) e.preventDefault();
});

// --- loading ----------------------------------------------------------------

function loadBank(bytes: Uint8Array, name: string): void {
  stopPlayback();
  let parsed: DFContainerFile;
  let parsedTables: BankTables;
  try {
    parsed = readContainerFile(bytes);
    parsedTables = readBankTables(parsed);
  } catch (e) {
    log(tr("tracks.notReadableBank", { message: (e as Error).message }));
    return;
  }
  if (!parsedTables.loopRecords.length && !parsedTables.singles.length) {
    log(tr("tracks.notABank", { name }));
    return;
  }
  file = parsed;
  tables = parsedTables;
  fileName = name;
  decoded.clear();
  edits.length = 0;
  dirtyEl.textContent = "";
  soundFilter = "";
  $<HTMLInputElement>("soundFilter").value = "";

  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  log("");
  refresh();
}

async function loadFromFile(f: File): Promise<void> {
  loadBank(new Uint8Array(await f.arrayBuffer()), f.name);
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

/** dev-server mode: offer every audio bank in the gamefiles manifest */
async function initServerBanks(): Promise<void> {
  // Only the chosen EDITION's copies: an install with six of them holds six
  // `bedsit1.set`, and listing all six lists the same room six times under
  // names that cannot be told apart. The edition row at the top of the page is
  // what chooses, and it is the same choice the game reads (src/editions.ts).
  const all = await gamefileManifest();
  if (!all.length) return; // production / no dev server: upload only
  const paths = inChosenEdition(all, chosenEdition(editionsIn(all)));
  const banks = paths.filter((p) => /\.(trk|sfx|11k)$/i.test(p)).sort();
  if (!banks.length) return;
  const wrap = $("serverBanks");
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = tr("common.pickFromGamefiles");
  wrap.appendChild(note);
  const row = document.createElement("div");
  row.className = "row banks";
  for (const p of banks) {
    const b = document.createElement("button");
    b.className = "bank";
    const base = p.split("/").pop()!;
    b.textContent = base.toLowerCase();
    b.title = p;
    b.addEventListener("click", async () => {
      log(tr("common.loading", { path: p }));
      const r = await fetch(siteUrl(p));
      if (!r.ok) {
        log(tr("common.fetchFailed", { path: p, status: r.status }));
        return;
      }
      loadBank(new Uint8Array(await r.arrayBuffer()), base);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}
void initServerBanks();

$("closeBtn").addEventListener("click", () => {
  if (edits.length && !confirm(tr("counts.discardEdits", { n: edits.length }))) return;
  stopPlayback();
  file = null;
  tables = null;
  edits.length = 0;
  editor.style.display = "none";
  landing.style.display = "block";
});

// --- chunks -----------------------------------------------------------------

function audioAt(loc: number): DecodedAudio | null {
  const data = file?.containers[loc]?.data;
  if (!data) return null;
  if (!decoded.has(loc)) {
    let a: DecodedAudio | null = null;
    try {
      a = decodeAudioContainer(data);
    } catch {
      a = null;
    }
    decoded.set(loc, a);
  }
  return decoded.get(loc) ?? null;
}

const seconds = (a: DecodedAudio): number => a.samples.length / Math.max(1, a.sampleRate);

/** the meta line of a chunk row: what the header says plus what it cost */
function chunkMeta(loc: number): string {
  const data = file?.containers[loc]?.data;
  if (!data) return tr("tracks.noSuchContainer", { loc });
  const bytes = data.length;
  const header = readAudioHeader(data);
  const a = audioAt(loc);
  if (!header || !a) return tr("tracks.notDecodableSound", { loc, bytes });
  return (
    `@${loc} · ${seconds(a).toFixed(2)}s · ${(header.sampleRate / 1000).toFixed(1)} kHz · ` +
    `${header.codec === 1 ? "v40" : "v41"} · ${(bytes / 1024).toFixed(1)} KB`
  );
}

/** peak-to-peak waveform, the shape tools/dumpaudio.ts draws as a PNG */
function drawWave(canvas: HTMLCanvasElement, samples: Float32Array): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#01152c";
  ctx.fillRect(0, (h >> 1) - 1, w, 1);
  if (!samples.length) return;
  ctx.fillStyle = "#60c0f0";
  for (let x = 0; x < w; x++) {
    const from = Math.floor((x / w) * samples.length);
    const to = Math.max(Math.floor(((x + 1) / w) * samples.length), from + 1);
    let lo = 1;
    let hi = -1;
    for (let i = from; i < to && i < samples.length; i++) {
      lo = Math.min(lo, samples[i]);
      hi = Math.max(hi, samples[i]);
    }
    const y0 = Math.round(((1 - hi) * h) / 2);
    const y1 = Math.round(((1 - lo) * h) / 2);
    ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

/**
 * Decoding and drawing every chunk of a bank up front is wasted work —
 * UNILIB.TRK carries hundreds of voice lines. Rows fill themselves in when they
 * first scroll into view.
 */
let observer: IntersectionObserver | null = null;
const pending = new Map<Element, () => void>();

function whenVisible(el: Element, fill: () => void): void {
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      pending.get(e.target)?.();
      pending.delete(e.target);
      observer!.unobserve(e.target);
    }
  });
  pending.set(el, fill);
  observer.observe(el);
}

function resetObserver(): void {
  observer?.disconnect();
  observer = null;
  pending.clear();
}

// --- playback ---------------------------------------------------------------

let audioCtx: AudioContext | null = null;
/** the one playback at a time, and the button showing it as stoppable */
let playing: { btn: HTMLButtonElement; stop: () => void } | null = null;

function context(): AudioContext {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function stopPlayback(): void {
  playing?.stop();
  playing = null;
}

/** play one waveform, taking over the button that started it as a stop button */
function play(audio: DecodedAudio, btn: HTMLButtonElement, loop = false): void {
  const again = playing?.btn === btn;
  stopPlayback();
  if (again || !audio.samples.length) return;

  const ctx = context();
  const buf = ctx.createBuffer(1, audio.samples.length, Math.max(3000, audio.sampleRate));
  buf.getChannelData(0).set(audio.samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  src.connect(ctx.destination);
  src.start();

  const label = btn.textContent;
  btn.textContent = "◼";
  const handle = {
    btn,
    stop: () => {
      btn.textContent = label;
      try {
        src.stop();
      } catch {
        /* already ended */
      }
    },
  };
  // only the play that is still current clears the state — a stopped source
  // fires "ended" after its successor has already started
  src.addEventListener("ended", () => {
    if (playing === handle) stopPlayback();
  });
  playing = handle;
}

/**
 * The theme as the engine plays it: the loop chunks concatenated in play order,
 * then looped. Chunks that don't decode are dropped and a mixed-rate bank is
 * joined at its highest rate — both exactly what the runtime's
 * AudioLibrary.theme() does, so what you hear here is what the game plays.
 */
function themeAudio(): DecodedAudio | null {
  if (!tables) return null;
  const parts = tables.loopOrder
    .map((o) => tables!.loopRecords[o - 1])
    .filter((c): c is BankChunk => c !== undefined)
    .map((c) => audioAt(c.containerLoc))
    .filter((a): a is DecodedAudio => a !== null);
  if (!parts.length) return null;
  const samples = new Float32Array(parts.reduce((n, p) => n + p.samples.length, 0));
  let off = 0;
  for (const p of parts) {
    samples.set(p.samples, off);
    off += p.samples.length;
  }
  return { sampleRate: Math.max(...parts.map((p) => p.sampleRate)), samples };
}

// --- WAV in and out ---------------------------------------------------------

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** 16-bit mono PCM — the same WAV tools/dumpaudio.ts writes */
function wavBlob(audio: DecodedAudio): Blob {
  const n = audio.samples.length;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, audio.sampleRate, true);
  v.setUint32(28, audio.sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(audio.samples[i] * 32767))), true);
  }
  return new Blob([out.buffer as ArrayBuffer], { type: "audio/wav" });
}

const wavName = (id: string): string =>
  `${fileName.replace(/\.[^.]+$/, "").toLowerCase()}.${(id || "chunk").replace(/[^\w.-]/g, "_")}.wav`;

/**
 * Decode any audio file the browser can read (WAV, MP3, OGG, …) down to the
 * mono waveform at `rate` this format wants — the resampling and the downmix
 * are the platform's, rendered offline.
 */
async function decodeToMono(f: File, rate: number): Promise<DecodedAudio> {
  const buffer = await context().decodeAudioData(await f.arrayBuffer());
  const frames = Math.max(1, Math.round((buffer.length * rate) / buffer.sampleRate));
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return { sampleRate: rate, samples: rendered.getChannelData(0) };
}

/** the rate a replacement should land at: the one the chunk already plays at */
function rateOf(loc: number): number {
  const data = file?.containers[loc]?.data;
  return (data && readAudioHeader(data)?.sampleRate) || 22050;
}

/**
 * Replace a chunk's audio. The container being replaced is the template, so
 * whatever its header carries beyond the fields the format layer knows comes
 * along; the samples are re-encoded with the v41 codec, which is lossy — an
 * import is not a byte-for-byte round trip, and re-importing an exported WAV
 * will not reproduce the original bytes.
 */
async function importChunk(f: File, loc: number, what: string): Promise<void> {
  if (!file?.containers[loc]) return;
  let audio: DecodedAudio;
  try {
    audio = await decodeToMono(f, rateOf(loc));
  } catch {
    log(tr("tracks.notAudio", { file: f.name }));
    return;
  }
  const old = file.containers[loc];
  file.containers[loc] = { id: old.id, data: encodeAudioContainer(audio, old.data) };
  decoded.delete(loc);
  markEdit(tr("tracks.audioEdit", { loc, file: f.name }));
  log(
    tr("tracks.audioReplaced", {
      what,
      file: f.name,
      secs: seconds(audio).toFixed(2),
      khz: (audio.sampleRate / 1000).toFixed(1),
      kb: (file.containers[loc].data.length / 1024).toFixed(1),
      was: (old.data.length / 1024).toFixed(1),
    }),
  );
  refresh();
}

/**
 * Replace the whole theme from one file, split across the loop chunks it is
 * made of in proportion to their current lengths — so a bank keeps the chunk
 * sizes it was built with (the format splits long sound across containers for
 * 1996's sake, and the engine loads a theme chunk at a time).
 */
async function importTheme(f: File): Promise<void> {
  if (!file || !tables) return;
  const distinct = [...new Set(tables.loopOrder)]
    .map((o) => tables!.loopRecords[o - 1])
    .filter((c): c is BankChunk => c !== undefined);
  if (!distinct.length) {
    log(tr("tracks.noLoopChunks"));
    return;
  }
  let audio: DecodedAudio;
  try {
    audio = await decodeToMono(f, rateOf(distinct[0].containerLoc));
  } catch {
    log(tr("tracks.notAudio", { file: f.name }));
    return;
  }
  const weights = distinct.map((c) => audioAt(c.containerLoc)?.samples.length ?? 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let at = 0;
  distinct.forEach((c, i) => {
    const take =
      i === distinct.length - 1
        ? audio.samples.length - at
        : Math.round((weights[i] / total) * audio.samples.length);
    const slice = audio.samples.subarray(at, Math.max(at, at + take));
    at += take;
    const old = file!.containers[c.containerLoc];
    file!.containers[c.containerLoc] = {
      id: old.id,
      data: encodeAudioContainer({ sampleRate: audio.sampleRate, samples: slice }, old.data),
    };
    decoded.delete(c.containerLoc);
  });
  markEdit(tr("tracks.themeEdit", { file: f.name }));
  const repeats = tables.loopOrder.length - distinct.length;
  log(
    tr("tracks.themeReplaced", { file: f.name, secs: seconds(audio).toFixed(1) }) +
      tr("counts.chunks", { n: distinct.length }) +
      (repeats > 0 ? tr("tracks.themeRepeats", { n: repeats }) : ""),
  );
  refresh();
}

/** wire a file input to a handler, clearing it so the same pick fires again */
function onPickFile(input: HTMLInputElement, onPick: (f: File) => void): HTMLInputElement {
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    input.value = "";
    if (f) onPick(f);
  });
  return input;
}

/** a hidden file input for a chunk row — one per row, so they don't share state */
function rowPicker(onPick: (f: File) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*";
  input.style.display = "none";
  return onPickFile(input, onPick);
}

const themeInput = onPickFile($<HTMLInputElement>("themeInput"), (f) => void importTheme(f));

// --- rendering --------------------------------------------------------------

function refresh(): void {
  if (!file) return;
  // the rows are rebuilt, and with them the button a playback is showing on
  stopPlayback();
  resetObserver();
  tables = readBankTables(file);
  buildFileBar();
  buildBank();
  buildMusic();
  buildSounds();
}

function buildFileBar(): void {
  const t = tables!;
  const chunks = t.loopRecords.length + t.singles.length;
  $("fileStats").textContent =
    tr("counts.containers", { n: file!.containers.length }) +
    " · " +
    tr("counts.loopChunks", { n: t.loopRecords.length }) +
    tr("tracks.inStepOrder", { n: t.loopOrder.length }) +
    tr("counts.oneShots", { n: t.singles.length }) +
    tr("tracks.fileStatsTail", { n: chunks });
}

function buildBank(): void {
  const t = tables!;
  const name = $<HTMLInputElement>("trackName");
  name.value = t.trackName;
  name.maxLength = t.trackNameLimit;
  $("bankInfo").textContent =
    tr("tracks.bankInfo", { max: t.trackNameLimit });
  name.onchange = () => {
    if (name.value === t.trackName) return;
    const stored = patchTrackName(file!, name.value);
    markEdit(tr("tracks.trackNameEdit", { name: stored }));
    log(tr("tracks.trackNameNow", { name: stored }));
    refresh();
  };
}

function buildMusic(): void {
  const t = tables!;
  const section = $("musicSection");
  const theme = themeAudio();
  section.style.display = t.loopRecords.length ? "block" : "none";
  if (!t.loopRecords.length) return;

  $("musicInfo").textContent = theme
    ? tr("tracks.musicIn", { secs: seconds(theme).toFixed(1) }) +
      tr("counts.steps", { n: t.loopOrder.length })
    : tr("tracks.orderEmpty");

  const playBtn = $<HTMLButtonElement>("playTheme");
  playBtn.onclick = () => {
    const audio = themeAudio();
    if (!audio) {
      log(tr("tracks.nothingToPlay"));
      return;
    }
    play(audio, playBtn, true);
  };
  const wavBtn = $<HTMLButtonElement>("themeWav");
  wavBtn.onclick = () => {
    const audio = themeAudio();
    if (audio) download(wavBlob(audio), wavName("music"));
  };
  $<HTMLButtonElement>("themeImport").onclick = () => themeInput.click();

  // the play order: the sequence the chunks are heard in, with a repeat where
  // the theme repeats one
  const order = $("order");
  order.replaceChildren();
  if (!t.loopOrder.length) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = tr("tracks.emptyAddChunk");
    order.appendChild(empty);
  }
  t.loopOrder.forEach((o, pos) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const rec = t.loopRecords[o - 1];
    const label = document.createElement("span");
    label.textContent = `${pos + 1}. ${rec ? rec.identifier || `#${o}` : `#${o}?`}`;
    chip.appendChild(label);
    const move = (to: number): void => {
      const next = [...t.loopOrder];
      const [cut] = next.splice(pos, 1);
      next.splice(to, 0, cut);
      setOrder(next, tr("tracks.movedStep", { from: pos + 1, to: to + 1 }));
    };
    chip.appendChild(chipBtn("↑", "earlier", pos > 0, () => move(pos - 1)));
    chip.appendChild(chipBtn("↓", "later", pos < t.loopOrder.length - 1, () => move(pos + 1)));
    chip.appendChild(
      chipBtn("✕", tr("tracks.dropStep"), true, () =>
        setOrder(
          t.loopOrder.filter((_, i) => i !== pos),
          tr("tracks.droppedStep", { n: pos + 1 }),
        ),
      ),
    );
    order.appendChild(chip);
  });

  const rows = $("loopChunks");
  rows.replaceChildren();
  t.loopRecords.forEach((rec, i) => {
    const used = t.loopOrder.filter((o) => o === i + 1).length;
    rows.appendChild(
      chunkRow(rec, t.loopTable, {
        lead: `${i + 1}`,
        note: used ? tr("tracks.usedInOrder", { n: used }) : tr("tracks.notInOrder"),
        extra: chipBtn("＋", tr("tracks.appendToOrder"), t.loopOrder.length < LOOP_ORDER_MAX, () =>
          setOrder([...t.loopOrder, i + 1], tr("tracks.appendedChunk", { n: i + 1 })),
        ),
      }),
    );
  });
}

function setOrder(next: number[], note: string): void {
  const stored = patchLoopOrder(file!, next);
  markEdit(note);
  log(tr("tracks.playOrderLog", { order: stored.length ? stored.join(" → ") : tr("tracks.playOrderEmpty") }));
  stopPlayback();
  refresh();
}

function chipBtn(
  text: string,
  title: string,
  enabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "mini";
  b.textContent = text;
  b.title = title;
  b.disabled = !enabled;
  b.onclick = onClick;
  return b;
}

/** one chunk: its name, what it sounds like, and the four things you can do */
function chunkRow(
  rec: BankChunk,
  tableLoc: number,
  opts: { lead: string; note: string; extra?: HTMLElement },
): HTMLElement {
  const row = document.createElement("div");
  row.className = "chunkrow";

  const lead = document.createElement("span");
  lead.className = "lead";
  lead.textContent = opts.lead;
  row.appendChild(lead);

  const id = document.createElement("input");
  id.type = "text";
  id.className = "ident";
  id.value = rec.identifier;
  id.maxLength = CHUNK_ID_FIELD;
  id.title = tr("tracks.identTitle", { max: CHUNK_ID_FIELD });
  id.addEventListener("change", () => {
    if (id.value === rec.identifier) return;
    const stored = patchChunkIdentifier(file!, tableLoc, rec.idOffset, id.value);
    markEdit(`id @${rec.containerLoc} → ${stored}`);
    log(`"${rec.identifier}" is now "${stored}"`);
    refresh();
  });
  row.appendChild(id);

  const wave = document.createElement("canvas");
  wave.className = "wave";
  wave.width = 260;
  wave.height = 34;
  row.appendChild(wave);

  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = "…";
  row.appendChild(meta);

  const buttons = document.createElement("span");
  buttons.className = "rowbtns";
  const playBtn = document.createElement("button");
  playBtn.className = "mini";
  playBtn.textContent = "▶";
  playBtn.title = tr("tracks.playChunk");
  playBtn.onclick = () => {
    const audio = audioAt(rec.containerLoc);
    if (audio) play(audio, playBtn);
    else log(tr("tracks.chunkNotSound", { loc: rec.containerLoc }));
  };
  buttons.appendChild(playBtn);
  const wavBtn = chipBtn("⬇", tr("tracks.exportChunkWav"), true, () => {
    const audio = audioAt(rec.containerLoc);
    if (audio) download(wavBlob(audio), wavName(rec.identifier));
  });
  buttons.appendChild(wavBtn);
  const p = rowPicker((f) =>
    void importChunk(f, rec.containerLoc, rec.identifier || `@${rec.containerLoc}`),
  );
  buttons.appendChild(
    chipBtn("⬆", tr("tracks.replaceChunkAudio"), true, () => p.click()),
  );
  buttons.appendChild(p);
  if (opts.extra) buttons.appendChild(opts.extra);
  row.appendChild(buttons);

  const note = document.createElement("span");
  note.className = "note";
  note.textContent = opts.note;
  row.appendChild(note);

  whenVisible(row, () => {
    meta.textContent = chunkMeta(rec.containerLoc);
    const audio = audioAt(rec.containerLoc);
    if (audio) drawWave(wave, audio.samples);
  });
  return row;
}

function buildSounds(): void {
  const t = tables!;
  const section = $("soundsSection");
  section.style.display = t.singles.length ? "block" : "none";
  if (!t.singles.length) return;
  const shown = t.singles.filter(
    (c) => !soundFilter || c.identifier.toLowerCase().includes(soundFilter),
  );
  $("soundsInfo").textContent =
    `${t.singles.length} one-shot${t.singles.length === 1 ? "" : "s"} in container @${t.oneShotTable}` +
    (shown.length === t.singles.length ? "" : ` · ${shown.length} shown`);

  const rows = $("singles");
  rows.replaceChildren();
  shown.forEach((rec) =>
    rows.appendChild(
      chunkRow(rec, t.oneShotTable, {
        lead: `${t.singles.indexOf(rec) + 1}`,
        note: "",
      }),
    ),
  );
}

$<HTMLInputElement>("soundFilter").addEventListener("input", (e) => {
  soundFilter = (e.target as HTMLInputElement).value.trim().toLowerCase();
  if (tables) buildSounds();
});

// --- export -----------------------------------------------------------------

$("exportBtn").addEventListener("click", () => {
  if (!file) return;
  const bytes = writeContainerFile(file);
  try {
    const back = readContainerFile(bytes);
    readBankTables(back);
    readAudioBank(back); // sanity: the export must read back as a bank
  } catch (e) {
    log(tr("common.exportFailed", { message: (e as Error).message }));
    return;
  }
  download(new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" }), fileName);
  log(
    tr("common.exported", { file: fileName, bytes: formatNumber(bytes.length) }) +
      (edits.length
        ? tr("common.exportedWithEdits", { n: edits.length, edits: edits.join(", ") })
        : tr("common.exportedUnmodified")),
  );
});

void installI18n();
void installLanguageMenu();
installVersion();
// Which edition's files the landing screen lists, and which copy of a basename an
// edit is written back into: the same row the play page and the collection carry
// (src/editions.ts). A click reloads, and this page's beforeunload guard is what
// stands between that and unexported edits.
void installEditionPicker(document.getElementById("editionPicker") as HTMLElement);
