/**
 * captions/index.html's entry: a small editor for the captions of the voice
 * clips Titanic never prints (#50; taoot/src/captions/*.json).
 *
 * Those files are NOT original data — a speech recogniser's transcript of the
 * game's audio, corrected by hand — and this page is how they get corrected:
 * by listening. It plays each clip out of the chosen edition's own sound bank
 * or film (fetched through the same manifest the play page uses, so it works wherever
 * the game does), shows what the recogniser heard, and lets whoever speaks the
 * language write what is really said, mark a line as a guess, and mark it as
 * listened to.
 *
 * An edition with no file yet starts from the English file's list of clips —
 * the clips have the same names in every edition — with the text empty and
 * the English line beside it for reference.
 *
 * Nothing leaves the browser on its own. Edits are kept as a draft in this
 * browser's storage, and Export writes the whole file in the repository's own
 * layout (one clip per line), so a contribution is a file to attach to an issue
 * or drop into `taoot/src/captions/` as a pull request, and its diff shows
 * exactly the lines that changed.
 */
import { readContainerFile, type DFContainerFile } from "@dreamfactory/engine/df/container";
import { readAudioBank } from "@dreamfactory/engine/df/banks";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { decodeAudioContainer, type DecodedAudio } from "@dreamfactory/engine/df/audio";
import { installLanguageMenu } from "@dreamfactory/site/lang-menu";
import { installPlayMenu } from "@dreamfactory/site/play-menu";
import { installVersion } from "@dreamfactory/site/version";
import { installI18n } from "@dreamfactory/site/locales";
import { siteUrl } from "@dreamfactory/site/site";
import { gamefileManifest, editionsIn, chosenEdition, inChosenEdition, installEditionPicker } from "./editions";
import { CAPTION_FILES, formatCaptions, VOICES_OF, type CaptionFile, type Clip, type TrackLine } from "./captions";
import { AudioLibrary } from "@dreamfactory/engine/runtime/audio";

void installI18n();
void installLanguageMenu();
void installPlayMenu();
installVersion();

/** every caption file in the repository, by edition */
const REPO = CAPTION_FILES;

/**
 * The file an edition starts from when the repository has none: the English
 * clips and track lines, nothing written yet — the speakers kept, the radio's
 * timings kept as a starting point. Its notice says so.
 */
function blankFor(edition: string): CaptionFile {
  const en = REPO.en;
  const banks: CaptionFile["banks"] = {};
  for (const [bank, clips] of Object.entries(en.banks)) {
    banks[bank] = Object.fromEntries(Object.entries(clips).map(([c, e]) => [c, { text: "", who: e.who }]));
  }
  const films: NonNullable<CaptionFile["films"]> = {};
  for (const [film, clips] of Object.entries(en.films ?? {})) {
    films[film] = Object.fromEntries(Object.entries(clips).map(([c, e]) => [c, { text: "", who: e.who }]));
  }
  const tracks: NonNullable<CaptionFile["tracks"]> = {};
  for (const [bank, lines] of Object.entries(en.tracks ?? {})) {
    tracks[bank] = lines.map((l) => ({ from: l.from, to: l.to, text: "", who: l.who }));
  }
  return {
    notice: [
      "NOT ORIGINAL DATA. None of the text in this file comes from the game's files; only the bank, film and clip names do.",
      `Titanic: Adventure Out of Time voices these clips and never prints them. This is a transcript of the ${edition} edition's audio, written by ear, so that a player who cannot hear them can read them (#50).`,
      "'who' names the speaker. 'guess': true marks a line whose wording is uncertain. 'listened': true marks a line someone has checked by ear.",
      "'tracks' are looping tracks that talk, timed in seconds from the start of the loop; the timings were taken from the English edition and may need moving.",
      "Corrections are welcome, and should be made by listening to the clip, not by editing the wording.",
    ],
    edition,
    made: "written by ear in the caption editor (taoot/captions/)",
    // speaker names are words to translate too; English's to start from
    speakers: { ...en.speakers },
    banks,
    films,
    tracks,
  };
}

/** what a contributor changed, as an issue carries it */
interface Changes {
  banks?: CaptionFile["banks"];
  films?: NonNullable<CaptionFile["films"]>;
  /** track lines by bank, then by their index in the track */
  tracks?: Record<string, Record<string, TrackLine>>;
}

/** the inner record under `key`, made on first use */
function slot<T>(rec: Record<string, Record<string, T>>, key: string): Record<string, T> {
  rec[key] ??= {};
  return rec[key];
}

/**
 * Only what this browser changed, in the files' own shapes — what an issue
 * needs to carry, and all a maintainer needs to apply it.
 */
export function changedEntries(mine: CaptionFile, repo: CaptionFile): Changes {
  const out: Changes = {};
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  for (const [bank, clips] of Object.entries(mine.banks)) {
    for (const [name, c] of Object.entries(clips)) {
      if (!same(c, repo.banks[bank]?.[name])) {
        out.banks ??= {};
        slot(out.banks, bank)[name] = c;
      }
    }
  }
  for (const [film, clips] of Object.entries(mine.films ?? {})) {
    for (const [name, c] of Object.entries(clips)) {
      if (!same(c, repo.films?.[film]?.[name])) {
        out.films ??= {};
        slot(out.films, film)[name] = c;
      }
    }
  }
  for (const [bank, lines] of Object.entries(mine.tracks ?? {})) {
    lines.forEach((l, i) => {
      if (!same(l, repo.tracks?.[bank]?.[i])) {
        out.tracks ??= {};
        slot(out.tracks, bank)[String(i)] = l;
      }
    });
  }
  return out;
}

const countChanges = (c: Changes): number =>
  Object.values(c.banks ?? {}).reduce((a, b) => a + Object.keys(b).length, 0) +
  Object.values(c.films ?? {}).reduce((a, b) => a + Object.keys(b).length, 0) +
  Object.values(c.tracks ?? {}).reduce((a, b) => a + Object.keys(b).length, 0);

// --- the page ----------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const statusEl = $("status");
const listEl = $("clips");
const countEl = $("count");

/** v2: the draft holds tracks and speakers too; a v1 draft (clips only) is left behind */
const draftKey = (edition: string): string => `taoot.captions.draft2.${edition}`;

let edition = "en";
let file: CaptionFile;
/** bank file (or film) → its path in the manifest, for the chosen edition */
let bankPaths = new Map<string, string>();
interface Bank {
  file: DFContainerFile;
  bytes: Uint8Array;
  singles: Map<string, number>;
}
const banks = new Map<string, Promise<Bank | null>>();
/** the banks that have arrived, so a click can play without waiting for one */
const ready = new Map<string, Bank>();
/**
 * One `<audio>` element plays every clip, not Web Audio. The click has to START
 * the sound — browsers only let a page make a noise inside the user's gesture,
 * and the first version made its AudioContext after awaiting the bank's fetch,
 * where a browser may treat the gesture as over and leave the context silent.
 * Banks are loaded up front for the same reason. And an iPhone's silent switch
 * mutes Web Audio but not media.
 */
const player = new Audio();
/** where a track line's play stops (seconds), or null for a whole clip */
let stopAt: number | null = null;
player.addEventListener("timeupdate", () => {
  if (stopAt !== null && player.currentTime >= stopAt) {
    player.pause();
    stopAt = null;
  }
});
/** each clip, and each whole track, as a WAV, made once */
const wavs = new Map<string, string>();

function say(text: string): void {
  statusEl.textContent = text;
}

function loadDraft(): CaptionFile {
  const base = structuredClone(REPO[edition] ?? blankFor(edition));
  try {
    const raw = localStorage.getItem(draftKey(edition));
    if (raw) {
      const draft = JSON.parse(raw) as Pick<CaptionFile, "banks" | "films" | "tracks">;
      for (const [bank, clips] of Object.entries(draft.banks ?? {})) {
        for (const [name, c] of Object.entries(clips)) {
          if (base.banks[bank]?.[name]) base.banks[bank][name] = c;
        }
      }
      for (const [film, clips] of Object.entries(draft.films ?? {})) {
        for (const [name, c] of Object.entries(clips)) {
          if (base.films?.[film]?.[name]) base.films[film][name] = c;
        }
      }
      for (const [bank, lines] of Object.entries(draft.tracks ?? {})) {
        const mine = base.tracks?.[bank];
        // the words are the draft's, the timings the repository's: the editor
        // cannot move a line, and a draft kept from before a timing fix would
        // otherwise go on cutting the line off where the old timing did
        if (mine?.length === lines.length) base.tracks![bank] = lines.map((l, i) => ({ ...l, from: mine[i].from, to: mine[i].to }));
      }
    }
  } catch {
    /* no storage, or a draft from another layout: start from the repository's */
  }
  return base;
}

function saveDraft(): void {
  try {
    localStorage.setItem(draftKey(edition), JSON.stringify({ banks: file.banks, films: file.films, tracks: file.tracks }));
  } catch {
    /* the edits still hold for this tab; Export is what keeps them */
  }
  updateCount();
}

function updateCount(): void {
  const all = [
    ...[...Object.values(file.banks), ...Object.values(file.films ?? {})].flatMap((b) => Object.values(b)),
    ...Object.values(file.tracks ?? {}).flat(),
  ];
  const listened = all.filter((c) => c.listened).length;
  const n = countChanges(changedEntries(file, REPO[edition] ?? blankFor(edition)));
  countEl.textContent = `${all.length} lines · ${listened} listened to · ${n} changed from the repository's file`;
}

async function bank(name: string): Promise<Bank | null> {
  let got = banks.get(name);
  if (!got) {
    got = (async () => {
      const path = bankPaths.get(name);
      if (!path) return null;
      const r = await fetch(siteUrl(path));
      if (!r.ok) return null;
      const bytes = new Uint8Array(await r.arrayBuffer());
      let loaded: Bank;
      if (/\.mov$/i.test(name)) {
        // a film keeps its sounds in its own table, by the names its frames play
        const mov = readMovFile(bytes);
        loaded = { file: mov.file, bytes, singles: mov.sounds };
      } else {
        const f = readContainerFile(bytes);
        const b = readAudioBank(f);
        loaded = { file: f, bytes, singles: new Map([...b.singles].map(([k, c]) => [k, c.containerLoc])) };
      }
      ready.set(name, loaded);
      return loaded;
    })().catch(() => null);
    banks.set(name, got);
  }
  return got;
}

/** a decoded clip as a 16-bit mono WAV, which every browser's `<audio>` plays */
function wavUrl(decoded: DecodedAudio): string {
  const n = decoded.samples.length;
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (at: number, t: string): void => [...t].forEach((ch, k) => v.setUint8(at + k, ch.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, decoded.sampleRate, true);
  v.setUint32(28, decoded.sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) v.setInt16(44 + k * 2, Math.max(-32768, Math.min(32767, Math.round(decoded.samples[k] * 32767))), true);
  return URL.createObjectURL(new Blob([v.buffer], { type: "audio/wav" }));
}

/** start a WAV, from a point and to a point; the status says what is playing */
function start(url: string, what: string, from = 0, to: number | null = null): void {
  player.pause();
  if (player.src !== url) player.src = url;
  player.currentTime = from;
  stopAt = to;
  player.play().then(
    () => say(what),
    (e: Error) => say(`The browser would not play ${what}: ${e.message}. Click ▶ once more.`),
  );
}

function notLoaded(bankName: string): boolean {
  if (ready.has(bankName)) return false;
  if (bankPaths.has(bankName)) say(`${bankName} is still loading — try again in a moment.`);
  else say(`${bankName}: not in this edition's files` + (bankPaths.size ? "" : " (no game files are served here)"));
  return true;
}

/**
 * Play a clip — synchronously when its bank is in, so the sound starts inside
 * the click that asked for it (see {@link player}).
 */
function playClip(bankName: string, clip: string): void {
  if (notLoaded(bankName)) return;
  const b = ready.get(bankName)!;
  const loc = b.singles.get(clip);
  if (loc === undefined) {
    say(`${bankName} ${clip}: not in this edition's files`);
    return;
  }
  const key = `${bankName}/${clip}`;
  let url = wavs.get(key);
  if (!url) {
    url = wavUrl(decodeAudioContainer(b.file.containers[loc].data, b.file.order));
    wavs.set(key, url);
  }
  start(url, `${bankName} ${clip}`);
}

/**
 * Play a stretch of a looping track — the track assembled exactly as the game
 * assembles it (AudioLibrary.theme), so the seconds here are the seconds the
 * captions are timed in.
 */
function playTrack(bankName: string, line: TrackLine): void {
  if (notLoaded(bankName)) return;
  const key = `${bankName}/track`;
  let url = wavs.get(key);
  if (!url) {
    const lib = new AudioLibrary();
    lib.openBank(bankName, ready.get(bankName)!.bytes);
    const theme = lib.theme(bankName);
    if (!theme) {
      say(`${bankName} has no track in this edition's files`);
      return;
    }
    url = wavUrl(theme);
    wavs.set(key, url);
  }
  start(url, `${bankName} ${line.from}–${line.to} s`, line.from, line.to);
}

/** one editable row, for a clip or a track line */
function row(c: Clip | TrackLine, label: string, play: () => void, english: Clip | undefined, absent: string | null, rows: HTMLInputElement[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "clip";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "▶";
  btn.title = "Play it";
  btn.disabled = !!absent;
  btn.addEventListener("click", play);
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = label;
  const field = (value: string, cls: string, title: string, set: (v: string) => void): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = cls;
    input.title = title;
    input.value = value;
    input.addEventListener("input", () => {
      set(input.value);
      saveDraft();
    });
    input.addEventListener("focus", () => el.classList.add("here"));
    input.addEventListener("blur", () => el.classList.remove("here"));
    return input;
  };
  const text = field(c.text, "words", "What is said", (v) => (c.text = v));
  text.spellcheck = true;
  text.lang = edition;
  const who = field(c.who ?? "", "who", "Who says it — shown before the words", (v) => {
    if (v.trim()) c.who = v.trim();
    else delete c.who;
  });
  who.placeholder = "who";
  const flag = (key: "guess" | "listened", title: string): HTMLLabelElement => {
    const l = document.createElement("label");
    l.title = title;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!c[key];
    box.addEventListener("change", () => {
      if (box.checked) c[key] = true;
      else delete c[key];
      saveDraft();
    });
    l.append(box, ` ${key}`);
    return l;
  };
  const notes = document.createElement("div");
  notes.className = "notes";
  if (absent) notes.append(note("missing", absent));
  if (c.heard !== undefined && c.heard !== c.text) notes.append(note("heard", c.heard));
  if (edition !== "en" && english) notes.append(note("English", english.text));
  el.append(btn, name, text, who, flag("guess", "The wording is uncertain"), flag("listened", "You have checked this line by ear"), notes);
  rows.push(text);
  // Enter: on to the next line, and play it; Shift+Enter back; Ctrl+Enter again
  text.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      play();
      return;
    }
    const next = rows[rows.indexOf(text) + (e.shiftKey ? -1 : 1)];
    if (next) {
      next.focus();
      next.closest(".clip")?.querySelector("button")?.click();
    }
  });
  return el;
}

function render(): void {
  listEl.replaceChildren();
  const english = REPO.en;
  const rows: HTMLInputElement[] = [];
  const heading = (text: string): void => {
    const h = document.createElement("h2");
    h.textContent = text;
    listEl.append(h);
  };
  for (const [bankName, lines] of Object.entries(file.tracks ?? {})) {
    heading(`${bankName} — a looping track, timed in seconds`);
    lines.forEach((l, i) => {
      listEl.append(row(l, `${l.from}–${l.to} s`, () => playTrack(bankName, l), english.tracks?.[bankName]?.[i], null, rows));
    });
  }
  type Group = [name: string, clips: Record<string, Clip>, english: Record<string, Clip> | undefined, title: string];
  const groups: Group[] = [
    ...Object.entries(file.banks).map(([b, clips]): Group => [b, clips, english.banks[b], b]),
    // no English line beside a film's clip: the German ocredits.mov cuts its
    // narration in other places, so a clip's English namesake says something else
    ...Object.entries(file.films ?? {}).map(([f, clips]): Group => [f, clips, undefined, `${f} — sounds the film keeps itself`]),
  ];
  for (const [bankName, clips, englishClips, title] of groups) {
    heading(title);
    for (const [name, c] of Object.entries(clips)) {
      // a caption whose clip this edition's bank does not have can only be a
      // wrong name in the file — say so, rather than offer a button that is silent
      const loaded = ready.get(bankName);
      const absent = loaded && !loaded.singles.has(name) ? `${bankName} has no clip called "${name}" in this edition` : null;
      listEl.append(row(c, name, () => playClip(bankName, name), englishClips?.[name], absent, rows));
    }
  }
  updateCount();
}

function note(what: string, text: string): HTMLElement {
  const s = document.createElement("span");
  const b = document.createElement("b");
  b.textContent = `${what}: `;
  s.append(b, text);
  return s;
}

function download(): void {
  const blob = new Blob([formatCaptions(file)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${edition}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  say(`Saved ${edition}.json — attach it to issue #50, or put it in taoot/src/captions/ in a pull request.`);
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(formatCaptions(file));
    say(`${edition}.json is on the clipboard.`);
  } catch {
    say("The browser would not allow the clipboard; use Save instead.");
  }
}

const ISSUE_URL = "https://github.com/dhobi/dreamrefactory/issues/new";
/**
 * The longest link GitHub is sent. The whole issue travels in the URL, and a
 * long enough one is answered with 414 and no issue (site/src/bug-report.ts);
 * what counts is the ENCODED length, which for Japanese is nine bytes a
 * character, so it is measured rather than estimated from the text.
 */
const URL_LIMIT = 7000;

/**
 * Hand the edits to the project as a new issue, prefilled: the changed lines as
 * JSON a maintainer can paste straight into the file. Nothing is sent by the
 * page itself — the contributor sees the issue and submits it, from their own
 * GitHub account. Too long for a link, the file is saved instead and the issue
 * asks for it to be attached.
 */
function sendToGitHub(): void {
  const changed = changedEntries(file, REPO[edition] ?? blankFor(edition));
  const n = countChanges(changed);
  if (!n) {
    say("Nothing has changed from the repository's file yet.");
    return;
  }
  const title = `Captions (${edition}): ${n} line${n === 1 ? "" : "s"}`;
  const head = [
    `Caption corrections for the **${edition}** edition, from the caption editor (taoot/captions/). See #50.`,
    "",
    "These are transcripts written by ear, not original game data.",
    "",
  ];
  const body = [...head, "```json", JSON.stringify(changed, null, 1), "```", ""].join("\n");
  const link = (b: string): string =>
    `${ISSUE_URL}?labels=captions&title=${encodeURIComponent(title)}&body=${encodeURIComponent(b)}`;
  if (link(body).length <= URL_LIMIT) {
    window.open(link(body), "_blank", "noopener");
    say(`A new issue with your ${n} line${n === 1 ? "" : "s"} is open in another tab — submit it there.`);
    return;
  }
  download();
  const attach = [...head, `The ${n} changed lines are too long for a link: **please attach the saved \`${edition}.json\` here.**`, ""].join("\n");
  window.open(link(attach), "_blank", "noopener");
  say(`Saved ${edition}.json. It is too long for a link, so please attach it to the issue that just opened.`);
}

function reset(): void {
  if (!window.confirm(`Throw away every edit to the ${edition} captions in this browser?`)) return;
  try {
    localStorage.removeItem(draftKey(edition));
  } catch {
    /* nothing stored */
  }
  file = loadDraft();
  render();
  say("Back to the repository's file.");
}

async function boot(): Promise<void> {
  const paths = await gamefileManifest();
  // the 1996 demo has none of these clips: it ends before the boat deck
  const editions = editionsIn(paths).filter((e) => e !== "demo");
  edition = chosenEdition(editions.length ? editions : ["en"]);
  await installEditionPicker($("editionPicker"), { available: editions.length ? editions : ["en"] });
  bankPaths = new Map(
    inChosenEdition(paths, edition)
      .filter((p) => /\.(sfx|trk|11k|mov)$/i.test(p))
      .map((p) => [p.split("/").pop()!.toLowerCase(), p]),
  );
  file = loadDraft();
  let note: string;
  if (REPO[edition]) note = `Editing taoot/src/captions/${edition}.json.`;
  else if (VOICES_OF[edition])
    note = `The ${edition} edition speaks the ${VOICES_OF[edition]} recordings, so the game captions it from ${VOICES_OF[edition]}.json. A ${edition}.json written here would be used instead.`;
  else note = `There is no ${edition}.json yet: these are the English lines, with nothing written. The English line is beside each one.`;
  $("fileNote").textContent = note;
  render();
  $("save").addEventListener("click", download);
  $("copy").addEventListener("click", () => void copy());
  $("send").addEventListener("click", sendToGitHub);
  $("reset").addEventListener("click", reset);
  if (!bankPaths.size) {
    say("No game files are served here, so the clips cannot be played.");
    return;
  }
  // every bank up front — a few MB — so no click ever waits on a fetch
  say("Loading the clips…");
  await Promise.all([...Object.keys(file.banks), ...Object.keys(file.tracks ?? {})].map((b) => bank(b)));
  render();
  // the films after: ocredits.mov alone is 22 MB, and the banks should not wait on it
  if (file.films) {
    await Promise.all(Object.keys(file.films).map((f) => bank(f)));
    render();
  }
  say("Click ▶ or press Enter in a line to hear the next one.");
}

await boot();
