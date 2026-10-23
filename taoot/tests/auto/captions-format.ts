/**
 * The caption files' own writer (`formatCaptions` in `src/captions.ts`) on
 * files shaped other than the shipped ones, and `installCaptions` for an
 * edition with no transcript of its own.
 *
 *   npx vitest run taoot/tests/auto/captions-format.ts
 *
 * Every shipped transcript carries speakers, banks, films and tracks, so the
 * writer's commas between sections are only ever tried with all four present.
 * A draft from the captions editor can lack any of the optional three; what is
 * pinned is that the text written for each shape is JSON that reads back as the
 * same file, and that the per-line fields are kept only where they say
 * something (`heard` beside text it differs from, `guess` and `listened` when
 * set). And an edition nobody transcribed — the Dutch one speaks the English
 * recordings — is captioned from the edition it borrows its voices from, while
 * one that borrows from nobody gets no lines rather than somebody else's.
 */
import { expect, test } from "vitest";
import { CAPTION_FILES, formatCaptions, installCaptions, type CaptionFile } from "../../src/captions";
import type { GameSession } from "@dreamfactory/engine/runtime/session";

const base = (): CaptionFile => ({
  notice: ["NOT ORIGINAL DATA"],
  edition: "xx",
  made: "by hand",
  banks: { "conk1.pup": { "conk1.001": { text: "Hello.", who: "Conk" } } },
});

/** the text written reads back as the same file */
const roundTrip = (file: CaptionFile): CaptionFile => JSON.parse(formatCaptions(file)) as CaptionFile;

test("a file of banks alone is written with no trailing comma and no empty sections", () => {
  const file = base();
  const text = formatCaptions(file);
  expect(roundTrip(file)).toEqual(file);
  expect(text).not.toMatch(/"films"|"tracks"|"speakers"/);
  expect(text.endsWith("}\n")).toBe(true);
});

test("each optional section may be the last one, and is written only when present", () => {
  const tracksOnly: CaptionFile = { ...base(), tracks: { "unilib.trk": [{ from: 0, to: 1.5, text: "The past..." }] } };
  expect(roundTrip(tracksOnly)).toEqual(tracksOnly);

  const filmsOnly: CaptionFile = { ...base(), films: { "cash.mov": { "conk.01": { text: "Dresses." } } } };
  expect(roundTrip(filmsOnly)).toEqual(filmsOnly);
  expect(formatCaptions(filmsOnly)).not.toMatch(/"tracks"/);

  const all: CaptionFile = { ...filmsOnly, tracks: tracksOnly.tracks, speakers: { "conk1.pup": "Conk" } };
  expect(roundTrip(all)).toEqual(all);
});

test("a line keeps what the recogniser heard only where it differs, and its marks only when set", () => {
  const file = base();
  file.banks["conk1.pup"] = {
    a: { text: "Same.", heard: "Same." },
    b: { text: "Right.", heard: "Write.", guess: true, listened: true },
    c: { text: "Plain.", guess: false, listened: false },
  };
  const back = roundTrip(file).banks["conk1.pup"];
  expect(back.a).toEqual({ text: "Same." });
  expect(back.b).toEqual({ text: "Right.", heard: "Write.", guess: true, listened: true });
  expect(back.c).toEqual({ text: "Plain." });
});

/** the parts of a session `installCaptions` fills */
function session(): GameSession & Record<string, unknown> {
  return {
    speakerOf: undefined,
    captionSources: new Map(),
    movieCaptionSources: new Map(),
    movieSoundSources: new Map(),
    movieBedSources: new Map(),
    movieSoundWords: new Map(),
    themeCaptionSources: new Map(),
  } as unknown as GameSession & Record<string, unknown>;
}

const banksOf = (s: GameSession): string[] => [...(s.captionSources as Map<string, unknown>).keys()].filter((k) => k.endsWith(".pup"));

test("an edition that speaks English's voices is captioned from English's transcript", () => {
  const nl = session();
  installCaptions(nl, "nl");
  const en = session();
  installCaptions(en, "en");
  expect(banksOf(nl)).toEqual(banksOf(en));
  expect(banksOf(nl)).toEqual(Object.keys(CAPTION_FILES.en.banks).filter((k) => k.endsWith(".pup")));
  expect([...nl.themeCaptionSources.keys()]).toEqual(Object.keys(CAPTION_FILES.en.tracks!));
});

test("an edition with no transcript and no borrowed voices gets no lines, but English's speaker names", () => {
  const xx = session();
  installCaptions(xx, "xx");
  expect(banksOf(xx)).toEqual([]);
  expect(xx.movieSoundWords.size).toBe(0);
  expect(xx.themeCaptionSources.size).toBe(0);
  // the films and the narration are the game's own and are there all the same
  expect(xx.movieCaptionSources.has("cash.mov")).toBe(true);
  const [puppet, name] = Object.entries(CAPTION_FILES.en.speakers!).find(([k]) => !k.includes("#"))!;
  expect(xx.speakerOf!(puppet, "")).toBe(name);
});
