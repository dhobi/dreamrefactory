/// <reference types="vite/client" />
/**
 * Where Titanic's uncaptioned voice has words (#50; GameSession.captionSources).
 *
 * Two sources, and they are not alike:
 *
 *  - the ending's narration, whose words ARE on the disc — NARRATE.PUP, a
 *    puppet no script opens (./narration.ts);
 *  - everything else that speaks without text — the Sasha/Zeitel gossip, the
 *    London landlady, the voices behind cabin doors, the fencing master —
 *    whose words are NOT: ./captions/<edition>.json is a transcript of the
 *    audio, a speech recogniser's draft corrected by ear in the caption
 *    editor (taoot/captions/). Each file says so at the top, and nothing here
 *    pretends otherwise; an edition without a file simply gets no transcript.
 *
 * Both only ever reach the screen with the player's "every line that is heard"
 * setting on (GameSession.everyLineSubtitled).
 */
import type { GameSession } from "@dreamfactory/engine/runtime/session";
import { NARRATION_BANK, NARRATION_WORDS } from "./narration";
import MOVIE_SOUNDS from "./movie-lines.json";

/** one clip's caption, as the transcript files store it */
export interface Clip {
  text: string;
  /** who says it, shown before the words — captions can be up together */
  who?: string;
  /** what the recogniser wrote, where the text differs from it */
  heard?: string;
  /** the wording is uncertain even after correction */
  guess?: boolean;
  /** someone has checked it by ear */
  listened?: boolean;
}

/** one stretch of a looping track: seconds from the start of the loop */
export interface TrackLine extends Clip {
  from: number;
  to: number;
}

/** a transcript file, taoot/src/captions/<edition>.json */
export interface CaptionFile {
  notice: string[];
  edition: string;
  made: string;
  /** one-shot clips, by bank file and clip name */
  banks: Record<string, Record<string, Clip>>;
  /** looping tracks that talk (the bedsit radio's news), by bank file */
  tracks?: Record<string, TrackLine[]>;
  /**
   * Who speaks a puppet's lines, for the captions read from puppets (the
   * ending, the films): `"penny1.pup": "Penny"`, and `"narrate.pup#01"` for
   * one line of a puppet that more than one person speaks.
   */
  speakers?: Record<string, string>;
}

/**
 * The file in the repository's own layout: two-space JSON, but each clip and
 * each track line on one line, so that a contributor's export diffs line for
 * line against the file.
 */
export function formatCaptions(file: CaptionFile): string {
  const q = (v: unknown): string => JSON.stringify(v);
  const entry = (c: Clip | TrackLine): string => {
    const parts: string[] = [];
    if ("from" in c) parts.push(`"from": ${q(c.from)}`, `"to": ${q(c.to)}`);
    parts.push(`"text": ${q(c.text)}`);
    if (c.who) parts.push(`"who": ${q(c.who)}`);
    // what the recogniser heard is only worth keeping where the text differs from it
    if (c.heard !== undefined && c.heard !== c.text) parts.push(`"heard": ${q(c.heard)}`);
    if (c.guess) parts.push(`"guess": true`);
    if (c.listened) parts.push(`"listened": true`);
    return `{ ${parts.join(", ")} }`;
  };
  const banks = Object.entries(file.banks).map(([bank, clips]) => {
    const rows = Object.entries(clips).map(([name, c]) => `      ${q(name)}: ${entry(c)}`);
    return `    ${q(bank)}: {\n${rows.join(",\n")}\n    }`;
  });
  const tracks = Object.entries(file.tracks ?? {}).map(([bank, lines]) => {
    const rows = lines.map((l) => `      ${entry(l)}`);
    return `    ${q(bank)}: [\n${rows.join(",\n")}\n    ]`;
  });
  return [
    "{",
    `  "notice": [\n${file.notice.map((n) => `    ${q(n)}`).join(",\n")}\n  ],`,
    `  "edition": ${q(file.edition)},`,
    `  "made": ${q(file.made)},`,
    ...(file.speakers ? [`  "speakers": {\n${Object.entries(file.speakers).map(([k, v]) => `    ${q(k)}: ${q(v)}`).join(",\n")}\n  },`] : []),
    `  "banks": {\n${banks.join(",\n")}\n  }${tracks.length ? "," : ""}`,
    ...(tracks.length ? [`  "tracks": {\n${tracks.join(",\n")}\n  }`] : []),
    "}",
    "",
  ].join("\n");
}

/** every transcript in the repository, by edition */
export const CAPTION_FILES = Object.fromEntries(
  Object.entries(import.meta.glob<CaptionFile>("./captions/*.json", { eager: true, import: "default" })).map(
    ([path, file]) => [path.replace(/^.*\/(\w+)\.json$/, "$1"), file],
  ),
) as Record<string, CaptionFile>;

/**
 * The one film whose voice-over is its SOUNDTRACK rather than its frame sounds:
 * `cash.mov`, Conk on Beatrix's dresses, which CASH1.PUP files under
 * `*CONK.MOV: (VO)` in a `soundfx()` routine nothing calls. A soundtrack has no
 * per-line timing, so the lines are stepped through the film by length
 * (GameSession.movieCaption). Every other film that talks plays its lines as
 * frame sounds named by the line (./movie-lines.json), and is captioned line
 * by line as each one plays.
 */
export const MOVIE_LINES: Record<string, { puppet: string; lines: string[] }> = {
  "cash.mov": { puppet: "cash1.pup", lines: ["cash01.42", "cash01.43", "cash01.44", "cash01.45", "cash01.46"] },
};

/** tell the session where an edition's words are — once the edition is known, before any bank opens */
export function installCaptions(session: GameSession, edition: string): void {
  // speaker names are words like any other: the edition's own, else English's
  const speakers = CAPTION_FILES[edition]?.speakers ?? CAPTION_FILES.en?.speakers ?? {};
  const speakerOf = (puppet: string, line: string): string | undefined =>
    speakers[`${puppet}#${line}`] ?? speakers[puppet];
  session.speakerOf = speakerOf;
  session.captionSources.set(NARRATION_BANK, { ...NARRATION_WORDS, who: speakerOf(NARRATION_WORDS.puppet, "") });
  for (const [movie, source] of Object.entries(MOVIE_LINES)) {
    session.movieCaptionSources.set(movie, { ...source, who: speakerOf(source.puppet, "") });
  }
  for (const [movie, sounds] of Object.entries(MOVIE_SOUNDS.films)) session.movieSoundSources.set(movie, sounds);
  for (const [bank, clips] of Object.entries(CAPTION_FILES[edition]?.banks ?? {})) {
    const words = Object.fromEntries(
      Object.entries(clips)
        .filter(([, c]) => c.text.trim())
        .map(([name, c]) => [name, { who: c.who, text: c.text }]),
    );
    session.captionSources.set(bank, { words });
  }
  for (const [bank, lines] of Object.entries(CAPTION_FILES[edition]?.tracks ?? {})) {
    session.themeCaptionSources.set(
      bank,
      lines.filter((l) => l.text.trim()).map((l) => ({ from: l.from, to: l.to, who: l.who, text: l.text })),
    );
  }
}
