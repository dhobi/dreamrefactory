/**
 * The language chooser, played the way a player plays it — headless, over the
 * bytes tools/mklangstg.ts generates, through a real {@link GameSession}.
 *
 * No gamefiles/ and no BOOTFILE: that is the claim being tested. The chooser has
 * to run *before* a language is chosen, so it cannot depend on anything inside a
 * language tree, and a stage with no set behind it and no boot library under it
 * is exactly what the engine has to be willing to open. If this suite ever needs
 * game data to pass, the screen has stopped being able to come first.
 */
import { test, expect } from "vitest";
import { NullAudioSink } from "../../src/engine/audio";
import { GameSession } from "../../src/engine/session";
import { LangChooser, chooserOrder, preselectedEdition } from "../../src/lang-chooser";
import { LANGUAGES, LANG_GLOBAL, LANG_STAGE } from "../../src/languages";
import { readStgFile, readStgRegions } from "../../src/df/stg";
import { FrameBuffer, decodeFrame } from "../../src/df/image";
import { sniffScript } from "../../src/df/script";
import { SCREEN_H, SCREEN_W } from "../../src/screen";
import { buildLangStage } from "../../tools/mklangstg";

const STAGE = buildLangStage();

/** a session whose only file is the chooser stage */
function newSession(): GameSession {
  const session = new GameSession(
    (name) => (name.toLowerCase() === LANG_STAGE ? STAGE : null),
    new NullAudioSink(),
  );
  session.onLog = () => {};
  return session;
}

async function openChooser(available = LANGUAGES.map((l) => l.code)) {
  const session = newSession();
  const chooser = new LangChooser(session, available);
  expect(await chooser.open()).toBe(true);
  return { session, chooser };
}

/** the middle of a button, in screen coordinates */
function centre(chooser: LangChooser, code: string): { x: number; y: number } {
  const button = chooser.buttons().find((b) => b.code === code);
  if (!button) throw new Error(`no button for ${code}`);
  const { left, right, top, bottom } = button.region;
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

// --- the file ---------------------------------------------------------------

test("the generated stage is a stage: two flats, a button per language", () => {
  const stg = readStgFile(STAGE);
  expect(stg.flats.map((f) => f.name)).toEqual(["choose", "wait"]);
  for (const flat of stg.flats) {
    expect([flat.width, flat.height]).toEqual([SCREEN_W, SCREEN_H]);
    // the art decodes, at full screen size
    const fb = new FrameBuffer();
    const d = decodeFrame(stg.file.containers[flat.locationFrame].data, fb);
    expect([d.width, d.height]).toEqual([SCREEN_W, SCREEN_H]);
  }
  const regions = readStgRegions(stg.file.containers[stg.flats[0].locationClickLogic].data);
  expect(regions.map((r) => r.name)).toEqual(LANGUAGES.map((l) => l.code));
  // every button carries its own compiled handler, and the buttons don't overlap
  for (const r of regions) expect(sniffScript(stg.file.containers[r.script].data)).toBeTruthy();
  for (const a of regions) {
    for (const b of regions) {
      if (a === b) continue;
      const disjoint = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      expect(disjoint, `${a.name} overlaps ${b.name}`).toBe(true);
    }
  }
  // and they are all on screen
  for (const r of regions) {
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(SCREEN_W);
    expect(r.bottom).toBeLessThanOrEqual(SCREEN_H);
  }
});

// --- the stage, running -----------------------------------------------------

test("opening it needs no set and no boot library", async () => {
  const { session, chooser } = await openChooser();
  // the stage main's openstage picked the flat (nothing else could have)
  expect(session.currentFlat).toBe("choose");
  expect(session.setVisible).toBe(false);
  expect(session.stageCtrl.flatImage()).not.toBeNull();
  expect(chooser.buttons().map((b) => b.code)).toEqual(LANGUAGES.map((l) => l.code));
  expect(chooser.chosen()).toBeNull();
});

test("a click runs the button's own script: the global, then the wait flat", async () => {
  const { session, chooser } = await openChooser();
  const { x, y } = centre(chooser, "de");
  await chooser.click(x, y);
  expect(session.interp.globals.get(LANG_GLOBAL)).toBe("de");
  expect(session.currentFlat).toBe("wait"); // the script's own gotoflat("wait")
  expect(chooser.chosen()).toBe("de");
});

test("every button picks its own language", async () => {
  for (const lang of LANGUAGES) {
    const { chooser } = await openChooser();
    const { x, y } = centre(chooser, lang.code);
    await chooser.click(x, y);
    expect(chooser.chosen()).toBe(lang.code);
  }
});

test("a click that misses every button chooses nothing", async () => {
  const { chooser } = await openChooser();
  await chooser.click(4, 4); // the border, above the menu
  expect(chooser.chosen()).toBeNull();
});

test("the number keys are mapped by the flat's own keydown handler", async () => {
  const { session, chooser } = await openChooser();
  await chooser.key("4"); // the fourth language in the stage's order
  expect(chooser.chosen()).toBe(LANGUAGES[3].code);
  expect(session.currentFlat).toBe("wait");

  const other = await openChooser();
  await other.chooser.key("9"); // no such button
  expect(other.chooser.chosen()).toBeNull();
  expect(other.session.currentFlat).toBe("choose");
});

test("a language with no data behind it does not answer", async () => {
  // an install with two of the six: the other four are dimmed and inert
  const { session, chooser } = await openChooser(["en", "de"]);
  expect(chooser.buttons().filter((b) => b.available).map((b) => b.code)).toEqual(["en", "de"]);

  const ja = centre(chooser, "ja");
  await chooser.click(ja.x, ja.y);
  expect(chooser.chosen()).toBeNull();
  expect(session.currentFlat).toBe("choose"); // it never even left the menu

  await chooser.key("6"); // the same refusal by keyboard, after the script ran
  expect(chooser.chosen()).toBeNull();

  const en = centre(chooser, "en");
  await chooser.click(en.x, en.y);
  expect(chooser.chosen()).toBe("en");
});

test("closing it hands the stage back, and leaves no global behind", async () => {
  const { session, chooser } = await openChooser();
  const { x, y } = centre(chooser, "nl");
  await chooser.click(x, y);
  expect(chooser.chosen()).toBe("nl"); // read the choice BEFORE closing
  await chooser.close();
  expect(session.stageName).toBe("none");
  expect(session.currentFlat).toBe("none");
  expect(session.setVisible).toBe(true); // every room afterwards needs it on
  // and the global is gone: snapshotSave writes globals into the .ti, where free
  // variable slots are scarce, and a language choice is not game state
  expect(session.interp.globals.has(LANG_GLOBAL)).toBe(false);
});

// --- picking without asking -------------------------------------------------

test("an explicit choice beats a remembered one, which beats asking", () => {
  const available = ["en", "de", "fr"];
  expect(preselectedEdition({ query: "de", remembered: "fr", available })).toBe("de");
  expect(preselectedEdition({ query: null, remembered: "fr", available })).toBe("fr");
  expect(preselectedEdition({ available })).toBeNull(); // more than one: ask
  // a query or memory naming something not installed is ignored, not obeyed
  expect(preselectedEdition({ query: "ja", remembered: "de", available })).toBe("de");
  expect(preselectedEdition({ query: "klingon", available })).toBeNull();
  // one language installed is not a choice worth a screen
  expect(preselectedEdition({ available: ["nl"] })).toBe("nl");
  expect(preselectedEdition({ available: [] })).toBeNull();
});

// The demo is an edition and not a language: English-only data in its own tree,
// so `?edition=demo` has nothing left to ask and the chooser — whose art carries
// buttons for the six languages and nothing else — must not open over it. While
// this function checked `isLanguageCode`, "demo" was a code it could not recognise
// AND one the chooser could not offer, so clicking Demo showed lang.stg and sat
// there.
test("the demo counts as chosen, though the chooser could never offer it", () => {
  const available = ["en", "de", "demo"];
  expect(preselectedEdition({ query: "demo", available })).toBe("demo");
  expect(preselectedEdition({ remembered: "demo", available })).toBe("demo");
  // and an install that is ONLY the demo is not a choice worth a screen either
  expect(preselectedEdition({ available: ["demo"] })).toBe("demo");
  // what the chooser can draw is still the six, in the stage's order
  expect(chooserOrder(available)).toEqual(["en", "de"]);
});

test("the chooser offers the stage's order, not the manifest's", () => {
  expect(chooserOrder(["ja", "de", "en"])).toEqual(["en", "de", "ja"]);
  expect(chooserOrder(["xx"])).toEqual([]);
});
