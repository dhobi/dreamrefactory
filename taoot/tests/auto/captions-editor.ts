/**
 * The caption editor (`src/captions-editor.ts`, taoot/captions/), in node: its
 * real page parsed by linkedom, with the manifest, the edition picker, the
 * engine's bank readers, `fetch` and `<audio>` standing in for the browser's.
 *
 *   npx vitest run --project taoot taoot/tests/auto/captions-editor.ts
 *
 * The captions are NOT original data, and this page is how they get corrected:
 * by listening. What is pinned is that loop — a row per clip and per track
 * line, ▶ playing the clip (a track only from its line's start to its end),
 * Enter going on to the next line and playing it, an edit kept as a draft and
 * counted against the repository's file, a draft's track timings giving way to
 * the repository's, and the three ways out: Save, Copy, and an issue opened
 * with only the changed lines — or, too long for a link, the file saved and the
 * issue asking for it. The banks are made up; no rip is read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTION_FILES, type CaptionFile } from "../../src/captions";
import { openDom, type TestPage } from "../page-dom";

/* ---------------------------------------------------------------- the fakes */

interface World {
  /** the manifest's paths */
  paths: string[];
  edition: string;
  /** clips a bank leaves out, by bank */
  without: Record<string, string[]>;
  /** banks whose fetch fails */
  broken: string[];
  /** banks AudioLibrary finds no track in */
  noTrack: string[];
  playFails: boolean;
}
let world: World;
const plays: { src: string; from: number; what?: string }[] = [];
let players: FakeAudio[] = [];

class FakeAudio extends EventTarget {
  src = "";
  currentTime = 0;
  paused = true;
  constructor() {
    super();
    players.push(this);
  }
  play(): Promise<void> {
    if (world.playFails) return Promise.reject(new Error("not allowed"));
    this.paused = false;
    plays.push({ src: this.src, from: this.currentTime });
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

const decoded = { samples: new Float32Array([0, 0.5, -0.5, 1, -1, 2]), sampleRate: 11025 };
/** a fetched bank is its own name, so the readers below know which it is */
const nameOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const clipsOf = (bank: string): string[] => {
  const f = CAPTION_FILES.en as CaptionFile;
  const names = Object.keys(f.banks[bank] ?? f.films?.[bank] ?? {});
  return names.filter((n) => !(world.without[bank] ?? []).includes(n));
};

vi.mock("@dreamfactory/site/lang-menu", () => ({ installLanguageMenu: async () => {} }));
vi.mock("@dreamfactory/site/play-menu", () => ({ installPlayMenu: async () => {} }));
vi.mock("@dreamfactory/site/version", () => ({ installVersion: () => {} }));
vi.mock("@dreamfactory/site/locales", () => ({ installI18n: async () => {} }));
vi.mock("@dreamfactory/site/site", () => ({ siteUrl: (p: string) => `/site/${p}` }));
vi.mock("../../src/editions", () => ({
  gamefileManifest: async () => world.paths,
  editionsIn: (paths: string[]) => [...new Set(paths.map((p) => p.split("/")[0]))],
  chosenEdition: () => world.edition,
  inChosenEdition: (paths: string[], e: string) => paths.filter((p) => p.startsWith(`${e}/`)),
  installEditionPicker: async () => {},
}));
vi.mock("@dreamfactory/engine/df/container", () => ({
  readContainerFile: (bytes: Uint8Array) => ({ name: nameOf(bytes), containers: [{ data: new Uint8Array(8) }], order: "le" }),
}));
vi.mock("@dreamfactory/engine/df/banks", () => ({
  readAudioBank: (f: { name: string }) => ({ singles: new Map(clipsOf(f.name).map((n) => [n, { containerLoc: 0 }])) }),
}));
vi.mock("@dreamfactory/engine/df/mov", () => ({
  readMovFile: (bytes: Uint8Array) => ({ file: { containers: [{ data: new Uint8Array(8) }], order: "le" }, sounds: new Map(clipsOf(nameOf(bytes)).map((n) => [n, 0])) }),
}));
vi.mock("@dreamfactory/engine/df/audio", () => ({ decodeAudioContainer: () => decoded }));
vi.mock("@dreamfactory/engine/runtime/audio", () => ({
  AudioLibrary: class {
    private name = "";
    openBank(name: string): void {
      this.name = name;
    }
    theme(): typeof decoded | null {
      return world.noTrack.includes(this.name) ? null : decoded;
    }
  },
}));

/* ----------------------------------------------------------------- the page */

const BANKS = ["zgossip1.sfx", "zgossip2.sfx", "zgossip3.sfx", "bedsit1.trk", "unilib.trk", "fence.trk", "bedrad1.trk", "ocredits.mov"];
const opened: string[] = [];
let clipboard: { text: string | null; fails: boolean };
let confirmAnswer = true;

async function openEditor(w: Partial<World> = {}, storage: Record<string, string> = {}): Promise<TestPage> {
  vi.resetModules();
  plays.length = 0;
  players = [];
  opened.length = 0;
  clipboard = { text: null, fails: false };
  world = { paths: BANKS.map((b) => `en/data/${b}`), edition: "en", without: {}, broken: [], noTrack: [], playFails: false, ...w };
  const p = openDom("captions/index.html", { storage });
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: async (t: string) => {
        if (clipboard.fails) throw new Error("denied");
        clipboard.text = t;
      },
    },
  });
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("open", (url: string) => void opened.push(url));
  vi.stubGlobal("confirm", () => confirmAnswer);
  vi.stubGlobal("fetch", async (url: string) => {
    const name = url.split("/").pop()!;
    if (world.broken.includes(name)) return { ok: false };
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(name).buffer };
  });
  await import("../../src/captions-editor");
  return p;
}

const status = (p: TestPage): string => p.el("status").textContent ?? "";
/** the row whose name is `name` */
const rowOf = (p: TestPage, name: string): HTMLElement =>
  [...p.document.querySelectorAll(".clip")].find((r) => r.querySelector(".name")?.textContent === name) as HTMLElement;
const words = (r: HTMLElement): HTMLInputElement => r.querySelector("input.words") as HTMLInputElement;
const ready = (p: TestPage) => vi.waitFor(() => expect(status(p)).toContain("Click ▶"));

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- the tests */

describe("the editor", () => {
  it("lists every clip, film sound and track line of the edition's file", async () => {
    const p = await openEditor();
    await ready(p);
    const en = CAPTION_FILES.en as CaptionFile;
    const lines =
      Object.values(en.banks).reduce((a, b) => a + Object.keys(b).length, 0) +
      Object.values(en.films ?? {}).reduce((a, b) => a + Object.keys(b).length, 0) +
      Object.values(en.tracks ?? {}).reduce((a, b) => a + b.length, 0);
    expect(p.document.querySelectorAll(".clip")).toHaveLength(lines);
    expect(p.el("fileNote").textContent).toBe("Editing taoot/src/captions/en.json.");
    expect(p.el("count").textContent).toMatch(new RegExp(`^${lines} lines · \\d+ listened to · 0 changed`));
  });

  it("plays a clip when its ▶ is pressed, as a WAV, inside the click", async () => {
    const p = await openEditor();
    await ready(p);
    const r = rowOf(p, "z3.01");
    p.on(r.querySelector("button")!, "click");
    expect(plays).toHaveLength(1);
    expect(plays[0].src).toMatch(/^blob:/);
    await vi.waitFor(() => expect(status(p)).toBe("zgossip1.sfx z3.01"));
    // the WAV is made once, and the same clip plays it again
    p.on(r.querySelector("button")!, "click");
    expect(plays[1].src).toBe(plays[0].src);
  });

  it("plays a track line from its start and stops it at its end", async () => {
    const p = await openEditor();
    await ready(p);
    const line = (CAPTION_FILES.en as CaptionFile).tracks!["bedrad1.trk"][1];
    p.on(rowOf(p, `${line.from}–${line.to} s`).querySelector("button")!, "click");
    expect(plays[0].from).toBe(line.from);
    const player = players[0];
    player.currentTime = line.to - 0.1;
    player.dispatchEvent(new Event("timeupdate"));
    expect(player.paused).toBe(false);
    player.currentTime = line.to;
    player.dispatchEvent(new Event("timeupdate"));
    expect(player.paused).toBe(true);
  });

  it("says why a clip will not play", async () => {
    const p = await openEditor({ without: { "zgossip1.sfx": ["z3.02"] }, noTrack: ["bedrad1.trk"], broken: ["fence.trk"] });
    await ready(p);
    // a clip the bank has not got: its button is off, and the row says so
    const r = rowOf(p, "z3.02");
    expect(r.querySelector("button")!.disabled).toBe(true);
    expect(r.querySelector(".notes")!.textContent).toContain('zgossip1.sfx has no clip called "z3.02" in this edition');
    // a bank that did not arrive
    p.on(rowOf(p, "en guard").querySelector("button")!, "click");
    expect(status(p)).toBe("fence.trk is still loading — try again in a moment.");
    // a looping bank with no track in it
    const line = (CAPTION_FILES.en as CaptionFile).tracks!["bedrad1.trk"][0];
    p.on(rowOf(p, `${line.from}–${line.to} s`).querySelector("button")!, "click");
    expect(status(p)).toBe("bedrad1.trk has no track in this edition's files");
    expect(plays).toHaveLength(0);
  });

  it("asks for another click when the browser will not play", async () => {
    const p = await openEditor({ playFails: true });
    await ready(p);
    p.on(rowOf(p, "z3.01").querySelector("button")!, "click");
    await vi.waitFor(() => expect(status(p)).toBe("The browser would not play zgossip1.sfx z3.01: not allowed. Click ▶ once more."));
  });

  it("goes on to the next line with Enter and plays it, back with Shift, again with Ctrl", async () => {
    const p = await openEditor();
    await ready(p);
    const first = words(rowOf(p, "z3.01"));
    p.on(first, "keydown", { key: "Enter" });
    expect(plays).toHaveLength(1);
    await vi.waitFor(() => expect(status(p)).toBe("zgossip1.sfx z3.02"));
    p.on(words(rowOf(p, "z3.02")), "keydown", { key: "Enter", shiftKey: true });
    await vi.waitFor(() => expect(status(p)).toBe("zgossip1.sfx z3.01"));
    p.on(first, "keydown", { key: "Enter", ctrlKey: true });
    expect(plays).toHaveLength(3);
    p.on(first, "keydown", { key: "a" });
    expect(plays).toHaveLength(3);
  });

  it("says when there are no game files to play", async () => {
    const p = await openEditor({ paths: [] });
    await vi.waitFor(() => expect(status(p)).toBe("No game files are served here, so the clips cannot be played."));
    p.on(rowOf(p, "z3.01").querySelector("button")!, "click");
    expect(status(p)).toBe("zgossip1.sfx: not in this edition's files (no game files are served here)");
  });
});

describe("an edit", () => {
  it("is kept as a draft, counted, flagged and given a speaker", async () => {
    const p = await openEditor();
    await ready(p);
    const r = rowOf(p, "z3.01");
    const text = words(r);
    text.value = "Something else entirely.";
    p.on(text, "input");
    p.on(text, "focus");
    expect(r.classList.contains("here")).toBe(true);
    p.on(text, "blur");
    expect(r.classList.contains("here")).toBe(false);
    const [guess, listened] = [...r.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[];
    guess.checked = true;
    p.on(guess, "change");
    listened.checked = true;
    p.on(listened, "change");
    const who = r.querySelector("input.who") as HTMLInputElement;
    who.value = "  ";
    p.on(who, "input");
    expect(p.el("count").textContent).toMatch(/· 1 changed from the repository's file$/);
    const draft = JSON.parse(p.storage.get("taoot.captions.draft2.en")!);
    expect(draft.banks["zgossip1.sfx"]["z3.01"]).toMatchObject({ text: "Something else entirely.", guess: true, listened: true });
    expect(draft.banks["zgossip1.sfx"]["z3.01"]).not.toHaveProperty("who");
    // unticked, a flag goes again, and a speaker comes back
    guess.checked = false;
    p.on(guess, "change");
    who.value = " Zeitel ";
    p.on(who, "input");
    const again = JSON.parse(p.storage.get("taoot.captions.draft2.en")!).banks["zgossip1.sfx"]["z3.01"];
    expect(again).toMatchObject({ text: "Something else entirely.", listened: true, who: "Zeitel" });
    expect(again).not.toHaveProperty("guess");
  });

  it("comes back from the draft, but a track keeps the repository's timings", async () => {
    const en = CAPTION_FILES.en as CaptionFile;
    const lines = en.tracks!["bedrad1.trk"].map((l) => ({ ...l, from: 0, to: 1, text: `${l.text}!` }));
    const draft = {
      banks: { "zgossip1.sfx": { "z3.01": { text: "Kept." } }, "nowhere.sfx": { x: { text: "dropped" } } },
      films: { "ocredits.mov": { [Object.keys(en.films!["ocredits.mov"])[0]]: { text: "Film kept." } }, "gone.mov": { y: { text: "dropped" } } },
      tracks: { "bedrad1.trk": lines, "short.trk": [] },
    };
    const p = await openEditor({}, { "taoot.captions.draft2.en": JSON.stringify(draft) });
    await ready(p);
    expect(words(rowOf(p, "z3.01")).value).toBe("Kept.");
    const first = en.tracks!["bedrad1.trk"][0];
    const r = rowOf(p, `${first.from}–${first.to} s`);
    expect(words(r).value).toBe(`${first.text}!`);
    expect(p.el("count").textContent).toMatch(new RegExp(`· ${2 + lines.length} changed`));
  });

  it("starts from the repository's file when the draft will not read", async () => {
    const p = await openEditor({}, { "taoot.captions.draft2.en": "{not json" });
    await ready(p);
    expect(p.el("count").textContent).toMatch(/· 0 changed/);
  });
});

describe("the ways out", () => {
  it("saves the whole file in the repository's layout", async () => {
    const p = await openEditor();
    await ready(p);
    p.click("save");
    expect(status(p)).toBe("Saved en.json — attach it to issue #50, or put it in taoot/src/captions/ in a pull request.");
  });

  it("copies it, or says the clipboard was refused", async () => {
    const p = await openEditor();
    await ready(p);
    p.click("copy");
    await vi.waitFor(() => expect(status(p)).toBe("en.json is on the clipboard."));
    expect(JSON.parse(clipboard.text!).edition).toBe("en");
    clipboard.fails = true;
    p.click("copy");
    await vi.waitFor(() => expect(status(p)).toBe("The browser would not allow the clipboard; use Save instead."));
  });

  it("opens an issue with only the changed lines, or none when nothing changed", async () => {
    const p = await openEditor();
    await ready(p);
    p.click("send");
    expect(status(p)).toBe("Nothing has changed from the repository's file yet.");
    expect(opened).toHaveLength(0);
    const text = words(rowOf(p, "z3.01"));
    text.value = "Changed.";
    p.on(text, "input");
    p.click("send");
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]);
    expect(url.searchParams.get("labels")).toBe("captions");
    expect(url.searchParams.get("title")).toBe("Captions (en): 1 line");
    const body = url.searchParams.get("body")!;
    const changed = JSON.parse(body.slice(body.indexOf("```json") + 7, body.lastIndexOf("```")));
    expect(Object.keys(changed)).toEqual(["banks"]);
    expect(changed.banks["zgossip1.sfx"]["z3.01"].text).toBe("Changed.");
    expect(status(p)).toBe("A new issue with your 1 line is open in another tab — submit it there.");
  });

  it("saves the file and asks for it to be attached when the issue is too long for a link", async () => {
    const p = await openEditor();
    await ready(p);
    for (const r of p.document.querySelectorAll(".clip")) {
      const t = words(r as HTMLElement);
      t.value = "ありがとうございます。".repeat(8);
      p.on(t, "input");
    }
    p.click("send");
    expect(opened).toHaveLength(1);
    expect(new URL(opened[0]).searchParams.get("body")).toContain("please attach the saved `en.json` here.");
    expect(status(p)).toBe("Saved en.json. It is too long for a link, so please attach it to the issue that just opened.");
  });

  it("throws the edits away only when asked twice", async () => {
    const p = await openEditor();
    await ready(p);
    const text = words(rowOf(p, "z3.01"));
    text.value = "Changed.";
    p.on(text, "input");
    confirmAnswer = false;
    p.click("reset");
    expect(p.storage.has("taoot.captions.draft2.en")).toBe(true);
    confirmAnswer = true;
    p.click("reset");
    expect(p.storage.has("taoot.captions.draft2.en")).toBe(false);
    expect(status(p)).toBe("Back to the repository's file.");
    expect(words(rowOf(p, "z3.01")).value).not.toBe("Changed.");
  });
});

describe("an edition", () => {
  it("with no file starts from the English clips, empty, the English beside each", async () => {
    const p = await openEditor({ paths: BANKS.map((b) => `it/data/${b}`), edition: "it" });
    await ready(p);
    expect(p.el("fileNote").textContent).toContain("There is no it.json yet");
    const r = rowOf(p, "z3.01");
    expect(words(r).value).toBe("");
    expect(words(r).lang).toBe("it");
    expect(r.querySelector(".notes")!.textContent).toContain("English: ");
    // and nothing written is nothing changed
    expect(p.el("count").textContent).toMatch(/· 0 changed/);
  });

  it("that speaks another's recordings says whose file captions it", async () => {
    const p = await openEditor({ paths: BANKS.map((b) => `nl/data/${b}`), edition: "nl" });
    await ready(p);
    expect(p.el("fileNote").textContent).toBe(
      "The nl edition speaks the en recordings, so the game captions it from en.json. A nl.json written here would be used instead.",
    );
  });

  it("leaves the demo out, and falls back to English with none", async () => {
    const p = await openEditor({ paths: ["demo/data/x.sfx"], edition: "en" });
    await vi.waitFor(() => expect(status(p)).toContain("No game files"));
    expect(p.el("fileNote").textContent).toBe("Editing taoot/src/captions/en.json.");
  });
});

describe("changedEntries", () => {
  it("carries only what differs, in the files' own shapes", async () => {
    await openEditor();
    const { changedEntries } = await import("../../src/captions-editor");
    const repo = CAPTION_FILES.en as CaptionFile;
    const mine = structuredClone(repo);
    expect(changedEntries(mine, repo)).toEqual({});
    mine.banks["fence.trk"]["allez"].text = "Allez, allez!";
    const film = Object.keys(mine.films!["ocredits.mov"])[0];
    mine.films!["ocredits.mov"][film].listened = true;
    mine.tracks!["bedrad1.trk"][2].text = "Different.";
    expect(changedEntries(mine, repo)).toEqual({
      banks: { "fence.trk": { allez: mine.banks["fence.trk"]["allez"] } },
      films: { "ocredits.mov": { [film]: mine.films!["ocredits.mov"][film] } },
      tracks: { "bedrad1.trk": { "2": mine.tracks!["bedrad1.trk"][2] } },
    });
  });
});
