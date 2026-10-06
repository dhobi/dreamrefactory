/// <reference types="vite/client" />
/**
 * Where Titanic's uncaptioned voice has words (#50; GameSession.captionSources).
 *
 * The words, as this port uses them (#505):
 *  - SUBTITLES: what a puppet says, printed by the original itself, mid-canvas
 *    over the answer choices;
 *  - ORIGINAL CAPTIONS: text in the game's files the original never prints —
 *    a film's puppet lines, NARRATE.PUP — shown by the port at the bottom;
 *  - PORT CAPTIONS: our transcripts of audio that has no text anywhere in the
 *    game, ./captions/<edition>.json, shown at the bottom;
 *  - BURNT-IN CAPTIONS: the Japanese edition's text drawn into the film
 *    frames — speech at the bottom, on-screen writing at the right. Part of
 *    the picture: always there, and the settings below work the same over it.
 * A line is captioned from one source, never both: the original caption,
 * unless the player prefers port captions and the line has one
 * (GameSession.preferPortCaptions).
 *
 * Two sources, and they are not alike:
 *
 *  - the ending's narration, whose words ARE on the disc — NARRATE.PUP, a
 *    puppet no script opens (./narration.ts);
 *  - everything else that speaks without text — the Sasha/Zeitel gossip, the
 *    London landlady, the voices behind cabin doors, the fencing master, the
 *    gramophone's briefing in Carlson's trunk (#471), the opening credits'
 *    narration that ocredits.mov keeps in its own sound table — whose words
 *    are NOT: ./captions/<edition>.json is a transcript
 *    of the audio, a speech recogniser's draft corrected by ear in the
 *    caption editor (taoot/captions/). Each file says so at the top, and
 *    nothing here pretends otherwise; an edition without a file simply gets
 *    no transcript.
 *
 * Both only ever reach the screen with the player's "every line that is heard"
 * setting on (GameSession.everyLineSubtitled).
 *
 * What is captioned (#470): what is said, and the sounds that carry something
 * a deaf or hard-of-hearing player would otherwise miss — as subtitles for the
 * deaf and hard of hearing do — not every sound in the game. Such a sound is
 * written in square brackets with no speaker, "[air-raid siren wailing]", and
 * goes where its sound plays from: the London siren is BEDSIT1.TRK's TRACK
 * (the bomb() handler's playnewtheme), so it is a track line spanning the
 * loop, after which the flat's hotspots stop answering. The game's own sound
 * cues, the starred puppet lines in capitals, arrive bracketed the same way
 * (heardSubtitle in the engine's puppet.ts).
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
  /**
   * Clips kept in a film's own sound table, by film and sound name — the
   * voice-over that is no puppet's line (ocredits.mov's opening narration)
   */
  films?: Record<string, Record<string, Clip>>;
  /**
   * looping tracks that talk, or that sound a cue worth a caption, by bank
   * file: the bedsit radio's news, the gramophone's briefing (oldboss.trk),
   * the air-raid siren (bedsit1.trk)
   */
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
  const clipGroups = (groups: Record<string, Record<string, Clip>>): string[] =>
    Object.entries(groups).map(([group, clips]) => {
      const rows = Object.entries(clips).map(([name, c]) => `      ${q(name)}: ${entry(c)}`);
      return `    ${q(group)}: {\n${rows.join(",\n")}\n    }`;
    });
  const banks = clipGroups(file.banks);
  const films = clipGroups(file.films ?? {});
  const tracks = Object.entries(file.tracks ?? {}).map(([bank, lines]) => {
    const rows = lines.map((l) => `      ${entry(l)}`);
    return `    ${q(bank)}: [\n${rows.join(",\n")}\n    ]`;
  });
  const notice = file.notice.map((n) => "    " + q(n));
  const speakers = Object.entries(file.speakers ?? {}).map(([k, v]) => `    ${q(k)}: ${q(v)}`);
  return [
    "{",
    `  "notice": [\n${notice.join(",\n")}\n  ],`,
    `  "edition": ${q(file.edition)},`,
    `  "made": ${q(file.made)},`,
    ...(file.speakers ? [`  "speakers": {\n${speakers.join(",\n")}\n  },`] : []),
    `  "banks": {\n${banks.join(",\n")}\n  }${films.length || tracks.length ? "," : ""}`,
    ...(films.length ? [`  "films": {\n${films.join(",\n")}\n  }${tracks.length ? "," : ""}`] : []),
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

/**
 * The one film whose voice is its BED, chunk by chunk: penote.mov, Smethells
 * reading Pringle's telegram. Its frames name `smeth1.096` and `smeth1.097`,
 * but the film has no clip by either name — the two lines are the bed's first
 * two chunks and its third is the paper, looping while the telegram is up
 * (GameSession.captionMovieBed).
 */
export const MOVIE_BED_LINES: Record<string, { puppet: string; chunks: (string | null)[] }> = {
  "penote.mov": { puppet: "smeth1.pup", chunks: ["smeth1.096", "smeth1.097", null] },
};

/**
 * Editions that speak another edition's voices, and are captioned from its
 * transcript. The Dutch edition ships the English recordings byte for byte and
 * translates only what the game prints. The Japanese one does too, except two
 * files it carries in its own copies — unilib.trk's door voices and the opening
 * credits' narration — whose words are the English ones all the same (speech
 * recognition on the Japanese files hears "The past, forever locked in
 * regret…" and "Jack, is that you? I'll be right out").
 */
export const VOICES_OF: Record<string, string> = { nl: "en", ja: "en" };

/** tell the session where an edition's words are — once the edition is known, before any bank opens */
export function installCaptions(session: GameSession, edition: string): void {
  const file = CAPTION_FILES[edition] ?? CAPTION_FILES[VOICES_OF[edition] ?? ""];
  // speaker names are words like any other: the edition's own, else English's
  const speakers = file?.speakers ?? CAPTION_FILES.en?.speakers ?? {};
  const speakerOf = (puppet: string, line: string): string | undefined =>
    speakers[`${puppet}#${line}`] ?? speakers[puppet];
  session.speakerOf = speakerOf;
  session.captionSources.set(NARRATION_BANK, { ...NARRATION_WORDS, who: speakerOf(NARRATION_WORDS.puppet, "") });
  for (const [movie, source] of Object.entries(MOVIE_LINES)) {
    session.movieCaptionSources.set(movie, { ...source, who: speakerOf(source.puppet, "") });
  }
  for (const [movie, sounds] of Object.entries(MOVIE_SOUNDS.films)) session.movieSoundSources.set(movie, sounds);
  for (const [movie, source] of Object.entries(MOVIE_BED_LINES)) session.movieBedSources.set(movie, source);
  for (const [bank, clips] of Object.entries(file?.banks ?? {})) {
    const words = Object.fromEntries(
      Object.entries(clips)
        .filter(([, c]) => c.text.trim())
        .map(([name, c]) => [name, { who: c.who, text: c.text }]),
    );
    session.captionSources.set(bank, { words });
  }
  for (const [movie, clips] of Object.entries(file?.films ?? {})) {
    const words = Object.entries(clips).filter(([, c]) => c.text.trim());
    session.movieSoundWords.set(movie, Object.fromEntries(words.map(([name, c]) => [name, { who: c.who, text: c.text }])));
  }
  for (const [bank, lines] of Object.entries(file?.tracks ?? {})) {
    session.themeCaptionSources.set(
      bank,
      lines.filter((l) => l.text.trim()).map((l) => ({ from: l.from, to: l.to, who: l.who, text: l.text })),
    );
  }
}
