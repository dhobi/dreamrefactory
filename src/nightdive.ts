/**
 * The intro film, and the question after it: `nightdive.mov` played before the
 * game boots.
 *
 * A MOV rather than a piece of HTML over the canvas, for the same reason the
 * language chooser is a stage and not a dialog (src/lang-chooser.ts): the file is
 * built by tools/mknightdive.ts, read by `readMovFile`, played by the engine's own
 * {@link MoviePlayer}, and its two buttons are real click regions hit-tested by
 * the movie loop. What this module adds is only what a movie normally borrows
 * from a room — something to draw it, and something to hand it clicks and ticks.
 *
 * **How the answer gets out.** Not by the page watching which rectangle was
 * clicked. The movie's second segment nominates its two answer frames as ACTION
 * FRAMES (`MovSegment.actionFrame1`/`2`), so entering one records a bit in
 * `session.movieActions` — the very thing a script reads back as
 * `actionframe(1)`, and the channel by which TAOOT's purser window tells its
 * script whether you knocked or walked away. {@link NightdiveIntro.answer} reads
 * the same set. The indirection is the point: nothing here reaches into the movie
 * player, and the file stays playable by anything that can play a MOV.
 *
 * The film itself is not in the repository and is not required — see
 * {@link NightdiveIntro.open}, which answers false when the file is not served
 * and leaves the boot exactly as it was.
 */
import { indexedToRGBA } from "./df/image";
import { DEFAULT_LANGUAGE } from "./languages";
import { GameSession } from "./engine/session";
import { MoviePlayer } from "./movie-player";

/** the film, served from `public/` — outside `gamefiles/`, like `lang.stg` */
export const NIGHTDIVE_MOVIE = "nightdive.mov";

/**
 * Which editions get the intro: **English only**.
 *
 * Not a preference — the question is drawn INTO the film, in English, by
 * tools/mknightdive.ts. There is no catalogue behind a MOV frame and no string
 * for `installI18n` to swap: a German player shown this screen would be shown an
 * English one. So the other five languages and the demo boot exactly as they did
 * before, and stay that way until there is a film per language to play them.
 *
 * A predicate rather than a `===` in the middle of the boot, because "only the
 * English edition" is the whole requirement and it should be somewhere a test can
 * put its finger on it.
 */
export const introPlaysFor = (edition: string): boolean =>
  edition.toLowerCase() === DEFAULT_LANGUAGE;

/** where "no" goes: the game this port needs a copy of, for sale */
export const GOG_URL = "https://www.gog.com/game/titanic_adventure_out_of_time";

/**
 * What the player said.
 *
 * `unanswered` is not a failure case, and as of #171 it is no longer ESC either.
 * The film carries the skip flag every shipped movie carries, so a player who
 * has seen it before can press past it — but the question segment does not, and
 * ESC lands there rather than taking it along (MoviePlayer.escapeSkipsSegment).
 * So the question is answered or it is still on screen.
 *
 * What is left is the two paths where nothing was ever asked: no film served
 * (`open()` answers false — a deployment without the asset boots as it always
 * did) and any edition but English ({@link introPlaysFor}). Only an action frame
 * the movie actually entered counts as an answer.
 */
export type Ownership = "owns" | "wants" | "unanswered";

/** the action-frame slots the movie's question segment declares, in order */
const OWNS = 1;
const WANTS = 2;

/**
 * Drives the intro. DOM-free apart from {@link render}'s context — a caller
 * feeds it clicks, keys and ticks and asks what was answered — so the headless
 * suite can play the screen the way a player does.
 */
export class NightdiveIntro {
  private readonly movies: MoviePlayer;
  /** resolves when the movie (both segments) has ended */
  private finished: Promise<void> | null = null;

  onLog: (line: string) => void = () => {};

  constructor(private readonly session: GameSession) {
    this.movies = new MoviePlayer(session, () => {});
    this.movies.onLog = (l) => this.onLog(l);
    // ESC presses past the FILM and lands on the question, instead of taking the
    // question with it the way it would for a film the game ships. The question
    // then has no skip flag of its own, so that is where ESC runs out — see
    // MoviePlayer.escapeSkipsSegment and issue #171.
    this.movies.escapeSkipsSegment = true;
  }

  /**
   * Fetch the film and start it. False if it is not served — a deployment that
   * never ran the generator has no intro, and that is a build without an asset
   * rather than a broken boot.
   */
  async open(files: { load(name: string): Promise<Uint8Array | null> }): Promise<boolean> {
    if (!(await files.load(NIGHTDIVE_MOVIE))) return false;
    this.session.movieActions.clear();
    this.finished = this.movies.play(NIGHTDIVE_MOVIE);
    // play() resolves immediately when the file will not parse, and a movie that
    // never started must not hold the boot behind a screen it is not drawing
    return this.movies.playing;
  }

  /** the whole film and its question, as one promise */
  get done(): Promise<void> {
    return this.finished ?? Promise.resolve();
  }

  /** advance the film — the caller's animation frame, in ms */
  tick(now: number): void {
    this.movies.tick(now);
  }

  /** a click at screen coordinates; only the question frame's regions answer */
  click(x: number, y: number): void {
    this.movies.click(x, y);
  }

  /** true where a click would do something — for the page's cursor */
  clickableAt(x: number, y: number): boolean {
    return this.movies.clickableAt(x, y);
  }

  /**
   * The buttons the question is parked on, empty while the film is still running.
   *
   * The port's answer to "is it waiting for me?", which `playing` cannot give —
   * see MoviePlayer.waitingRegions. Nothing on the page needs it; the suite drives
   * the screen through it rather than through coordinates it typed in, so moving a
   * button in the generator cannot quietly stop the tests clicking one.
   */
  regions(): readonly { target: string; x0: number; y0: number; x1: number; y1: number }[] {
    return this.movies.waitingRegions;
  }

  /**
   * A key, through the movie's own filter: ESC (translated to `.`, carrying the
   * marker the filter insists on) skips, and nothing else does. See
   * MoviePlayer.key — the rule is the movie's, not the page's.
   */
  key(keyName: string, special = false): boolean {
    return this.movies.key(keyName, special);
  }

  /** paint the current frame, with the movie's own palette */
  render(ctx: CanvasRenderingContext2D): void {
    const frame = this.movies.frame;
    if (!frame) return;
    const rgba = indexedToRGBA(frame.pixels, frame.width, frame.height, frame.palette);
    const img = ctx.createImageData(frame.width, frame.height);
    img.data.set(rgba);
    ctx.putImageData(img, frame.originX, frame.originY);
  }

  /** which answer frame the movie passed through, if either */
  answer(): Ownership {
    if (this.session.movieActions.has(WANTS)) return "wants";
    if (this.session.movieActions.has(OWNS)) return "owns";
    return "unanswered";
  }

  /**
   * Hand the screen back before the boot opens its own. The action-frame set
   * goes with it: `actionframe()` is the SCRIPT's channel, and boot() asks it
   * about `playmode.mov` (that is what decides `tour`) within a second of this
   * returning. Read {@link answer} first.
   */
  close(): void {
    this.session.movieActions.clear();
  }
}
