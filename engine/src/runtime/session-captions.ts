import { MOV_NAME_FIELD } from "../df/mov";
import type { GameSession, CaptionLine, TimedCaption } from "./session";

/**
 * Captions for the lines the original only lets you hear (#50): where each
 * sound bank, theme, film and film bed finds its words, and which of them the
 * screen should be showing right now. Owned by GameSession, which forwards its
 * methods and tables here.
 */
export class SessionCaptions {
  constructor(private readonly session: GameSession) {}

  /** subtitles-enabled (puppetparam slot 7); the viewer gates subtitle text on it */
  subtitlesOn(): boolean {
    return (this.session.puppetParams.get(7) ?? 1) !== 0;
  }
  /**
   * Subtitle the lines the original only lets you hear, too (#50; see
   * {@link import("./puppet").heardSubtitle}). The port's own setting, not a
   * puppetparam: a save does not carry it, and the subtitles switch above still
   * turns every line off.
   */
  everyLineSubtitled = false;
  /**
   * Where a line has both, caption it from the port's transcript rather than
   * the game's own text (#505). The game's text is a script, not the
   * recording: TAOOT's `bedcards.mov` plays the boss's dismissal as English
   * recorded it, sombre, over NARRATE.PUP's earlier draft ("It's war!"). Off,
   * the game's files win; a line with no transcript is captioned from them
   * either way. The port's own setting, like the one above.
   */
  preferPortCaptions = false;
  /**
   * Sound bank → where the words of its clips are (#50). A game's own
   * knowledge, set by its page, in one of two forms:
   *
   *  - `puppet`: a puppet file whose lines are the clips' words, line ident =
   *    clip name unless `line` says otherwise. TAOOT's ending plays
   *    `voicesound("n.05")` out of NARREND.SFX, and NARRATE.PUP — a puppet no
   *    script ever opens — holds `n.05` as text. Read when the bank is opened
   *    by `opentrackfile` ({@link openTrackFile}), before the first clip.
   *  - `words`: the clips' words outright — a transcript the game does not
   *    ship (TAOOT: taoot/src/captions/*.json, which says so at length).
   *    Taken whichever way the bank is opened ({@link AudioLibrary.onBankOpened}).
   *
   * `who` names the speaker, because captions can be up at the same time —
   * the London flat's radio reads the news while the landlady shouts through
   * the door — and two lines with no names on them read as one conversation.
   * See {@link captionLines} for what is done with them.
   */
  readonly captionSources = new Map<
    string,
    { puppet: string; line?: (clip: string) => string; who?: string } | { words: Readonly<Record<string, CaptionLine>> }
  >();
  /**
   * Sound bank → timed lines for its THEME, the looping track (#50): TAOOT's
   * bedsit radio reads the news on the first station, and that bulletin is the
   * track, not a clip. Seconds from the start of the loop, as the track is
   * assembled ({@link AudioLibrary.theme}); see {@link themeStarted}.
   */
  readonly themeCaptionSources = new Map<string, readonly TimedCaption[]>();
  /** the theme playing, if its bank has timed lines: where it started, and how long a loop is */
  private themeNow: { bank: string; lines: readonly TimedCaption[]; at: number; seconds: number } | null = null;
  /**
   * A theme has started (`bank` = the FILE it is from, which for TAOOT's radio
   * is not the track's own name — all three stations call themselves
   * "bedrad1.trk") or stopped (`null`). Every place a theme starts calls it —
   * the `playtheme` opcode, a room's own music, each loader's restore — and
   * {@link captionLines} checks besides that the track playing is still this
   * bank's, so a start that forgot to say would leave no caption rather than
   * a wrong one (#50: the London radio's news, read out over the gymnasium).
   */
  themeStarted(bank: string | null, seconds = 0): void {
    const key = bank?.toLowerCase();
    const lines = key ? this.themeCaptionSources.get(key) : undefined;
    this.themeNow = key && lines && seconds > 0 ? { bank: key, lines, at: this.session.clock.now, seconds } : null;
  }
  /**
   * Movie → the puppet lines its voice-over was recorded from (#50). TAOOT's
   * `cash.mov` speaks CASH1.PUP's starred `*CONK.MOV: (VO)` lines word for
   * word, and nothing prints them. A game's own knowledge, set by its page.
   * The lines are read the first time the movie plays ({@link movieCaption}).
   */
  readonly movieCaptionSources = new Map<string, { puppet: string; lines: string[]; who?: string }>();
  /** movie → its lines' words, once read; null while being read */
  private readonly movieWords = new Map<string, string[] | null>();
  /**
   * The caption for a movie at a point in it (0..1), or null. A movie carries
   * no timing for its words, so each line is given a share of the movie by its
   * length: near enough for a few short lines of one speaker, and the reason
   * this is only used where a movie IS a few short lines.
   */
  movieCaption(movie: string, progress: number): CaptionLine | null {
    if (!this.everyLineSubtitled || !this.session.subtitlesOn() || progress < 0) return null;
    const key = movie.toLowerCase();
    const source = this.movieCaptionSources.get(key);
    if (!source) return null;
    const lines = this.movieWords.get(key);
    if (lines === undefined) {
      this.movieWords.set(key, null);
      void this.session.puppetCtrl.spokenWords(source.puppet).then((words) => {
        this.movieWords.set(key, source.lines.map((l) => words.get(l.toLowerCase()) ?? "").filter(Boolean));
      });
      return null;
    }
    if (!lines?.length) return null;
    const total = lines.reduce((a, l) => a + l.length, 0);
    let at = progress * total;
    for (const line of lines) {
      if (at < line.length) return { who: source.who, text: line };
      at -= line.length;
    }
    return { who: source.who, text: lines.at(-1)! };
  }
  /**
   * Film → { its frame sound → the puppet whose line that sound is } (#50).
   * TAOOT's films play voice lines out of their own sound tables, named by the
   * line's ident — `zeit.mov` plays Penny's `penny1.132` over the photograph —
   * and the words are that puppet line's. A game's own index, set by its page.
   */
  readonly movieSoundSources = new Map<string, Readonly<Record<string, string>>>();
  /**
   * Film → { its frame sound → words } for the sounds that are NO puppet's
   * line: clips kept in the film's own sound table with no text anywhere in
   * the game — TAOOT's `ocredits.mov` voices its opening narration as
   * `voice.1`…`voice.5`. A game's own transcript, set by its page.
   */
  readonly movieSoundWords = new Map<string, Readonly<Record<string, CaptionLine>>>();
  /** who a puppet line is said by, for its caption — the game's own answer, if it has one */
  speakerOf: (puppet: string, line: string) => string | undefined = () => undefined;
  /** each puppet's lines as caption words, read once ({@link import("./puppet").PuppetController.spokenWords}) */
  private readonly puppetWords = new Map<string, Map<string, string> | Promise<Map<string, string>>>();
  private wordsOf(puppet: string): Map<string, string> | null {
    const got = this.puppetWords.get(puppet);
    if (got instanceof Map) return got;
    if (!got) {
      this.puppetWords.set(
        puppet,
        this.session.puppetCtrl.spokenWords(puppet).then((words) => {
          this.puppetWords.set(puppet, words);
          return words;
        }),
      );
    }
    return null;
  }
  /**
   * A film is starting: read the puppets its sounds are lines of, so the
   * first line is captioned the moment it plays. Only with the setting on —
   * TAOOT's NARRATE.PUP is 8 MB, and the game's first film (`bedcards.mov`,
   * the boss) is one of its users.
   */
  prepareMovieCaptions(movie: string): void {
    if (!this.everyLineSubtitled) return;
    for (const puppet of new Set(Object.values(this.movieSoundSources.get(movie.toLowerCase()) ?? {}))) this.wordsOf(puppet);
    const bed = this.movieBedSources.get(movie.toLowerCase());
    if (bed) this.wordsOf(bed.puppet);
  }
  /**
   * Film → the puppet lines its SOUNDTRACK speaks, one per distinct chunk in
   * the order they play (null for a chunk that says nothing). TAOOT's
   * penote.mov names Smethells' `smeth1.096` and `smeth1.097` on its frames,
   * but has no clip by either name: the voice is the bed, the two lines and a
   * rustle of paper, looping while the telegram is up. A game's own index,
   * set by its page.
   */
  readonly movieBedSources = new Map<string, { puppet: string; chunks: readonly (string | null)[] }>();
  /** the bed now speaking puppet lines, timed from when it started ({@link captionMovieBed}) */
  private bedNow: { lines: readonly TimedCaption[]; at: number; seconds: number; loop: boolean; handle: { done: boolean } } | null = null;
  /**
   * A film's bed has started: if its chunks are puppet lines, caption each
   * while its chunk plays — by the clock, since the bed runs on whatever the
   * player clicks. `chunkSecs` are the lengths of the chunks as played.
   */
  captionMovieBed(movie: string, chunkSecs: readonly number[], loop: boolean, handle: { done: boolean }): void {
    this.bedNow = null;
    if (!this.everyLineSubtitled) return;
    const source = this.movieBedSources.get(movie.toLowerCase());
    if (!source) return;
    const at = this.session.clock.now;
    let t = 0;
    const spans = chunkSecs.map((sec, i) => {
      const span = { from: t, to: t + sec, line: source.chunks[i] ?? null };
      t += sec;
      return span;
    });
    const seconds = t;
    const start = (words: Map<string, string>): void => {
      if (handle.done) return;
      const lines = spans.flatMap((sp) => {
        const text = sp.line ? words.get(sp.line) : undefined;
        return text ? [{ from: sp.from, to: sp.to, who: this.session.speakerOf(source.puppet, sp.line!), text }] : [];
      });
      this.bedNow = { lines, at, seconds, loop, handle };
    };
    const ready = this.wordsOf(source.puppet);
    if (ready) start(ready);
    else void (this.puppetWords.get(source.puppet) as Promise<Map<string, string>>).then(start);
  }
  /** a film has played one of its sounds: caption it if it is a puppet line, or has a transcript ({@link preferPortCaptions} picks between them) */
  captionMovieSound(movie: string, sound: string, handle: { done: boolean }): void {
    if (!this.everyLineSubtitled) return;
    const line = sound.toLowerCase();
    const transcript = this.movieSoundWords.get(movie.toLowerCase())?.[line];
    const puppet = transcript && this.preferPortCaptions ? undefined : this.movieSoundSources.get(movie.toLowerCase())?.[line];
    if (!puppet) {
      if (!transcript) return;
      this.captions = this.captions.filter((c) => !c.handle.done);
      this.captions.push({ ...transcript, handle });
      return;
    }
    const show = (words: Map<string, string>): void => {
      // a film's name field holds 15 characters (MOV_NAME_FIELD), so a longer
      // ident arrives cut short: TAOOT's brncl.mov plays "Burns Correctio"
      const text =
        words.get(line) ??
        (line.length === MOV_NAME_FIELD ? [...words].find(([ident]) => ident.startsWith(line))?.[1] : undefined);
      if (!text || handle.done) return;
      this.captions = this.captions.filter((c) => !c.handle.done);
      this.captions.push({ who: this.session.speakerOf(puppet, line), text, handle });
    };
    const ready = this.wordsOf(puppet);
    if (ready) show(ready);
    else void (this.puppetWords.get(puppet) as Promise<Map<string, string>>).then(show);
  }
  /** clip name → its words and speaker, from {@link captionSources} */
  readonly soundWords = new Map<string, CaptionLine>();
  /**
   * The clips playing that have words, while they play: added by
   * {@link captionClip}, each over when its handle is done — the clip's end,
   * `haltvoice`/`haltsound`, or the next clip on its channel.
   */
  captions: (CaptionLine & { handle: { done: boolean } })[] = [];
  /**
   * A clip has started: caption it if it has words (#50). Called from every
   * place a clip can start — `voicesound`, the sound channel, and a cricket,
   * which is how TAOOT's London landlady shouts through the door. Answers
   * whether it had any.
   */
  captionClip(name: string, handle: { done: boolean }): boolean {
    const line = this.soundWords.get(name.toLowerCase());
    this.captions = this.captions.filter((c) => !c.handle.done && c.handle !== handle);
    if (line) this.captions.push({ ...line, handle });
    return !!line;
  }
  /**
   * What the screen should caption right now (#50), top to bottom: the theme's
   * line, then the clips in the order they started. Only with
   * {@link everyLineSubtitled}, and the game's own subtitles switch still wins.
   * (A playing movie's line is added by the screen, which knows where the film
   * is — {@link movieCaption}.)
   */
  captionLines(): CaptionLine[] {
    if (!this.everyLineSubtitled || !this.session.subtitlesOn()) return [];
    const out: CaptionLine[] = [];
    const t = this.themeNow;
    if (t?.bank === this.session.audioLib.bankOf(this.session.currentThemeName)) {
      const sec = ((this.session.clock.now - t.at) / 1000) % t.seconds;
      const line = t.lines.find((l) => sec >= l.from && sec < l.to);
      if (line) out.push({ who: line.who, text: line.text });
    }
    const bed = this.bedNow;
    if (bed && !bed.handle.done && bed.seconds > 0) {
      const sec = (this.session.clock.now - bed.at) / 1000;
      const at = bed.loop ? sec % bed.seconds : sec;
      const line = bed.lines.find((l) => at >= l.from && at < l.to);
      if (line) out.push({ who: line.who, text: line.text });
    }
    for (const c of this.captions) if (!c.handle.done) out.push({ who: c.who, text: c.text });
    return out;
  }
}
