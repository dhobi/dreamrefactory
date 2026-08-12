import { decodeAudioContainer } from "../df/audio";
import { PupAnimFrame, PupDialogue, PupFile, readAnimLogic, readPupFile } from "../df/pup";
import { ScriptInstance, toStr } from "./interp";
import type { GameSession } from "./session";

/**
 * PUP conversation close-ups. While a puppet is active, the viewer renders the
 * puppet screen (stance layers + subtitle + choice bevels) instead of the
 * world; puppetspeak() suspends the running script for the line's duration and
 * puppetevent() until the player clicks a bevel. Extracted from GameSession,
 * which delegates to it; shared state (files, audio, clock, script parsing) is
 * reached back through the session reference.
 */

/**
 * How long a bevel's press box stays up at minimum: TI.EXE's tracker will not
 * return before `TickCount() + 10`, and TickCount runs at 60 Hz (0x41de90 is
 * `GetTickCount() * 3 / 50`).
 */
const PRESS_FLOOR_MS = (10 / 60) * 1000;

/**
 * Does this line's text get printed? TI.EXE 0x440810, the gate the speak path
 * consults (0x4406d4) before 0x441ef0 draws the record's text field — and a
 * record answers it for itself, which is why each edition gets what its own
 * translators decided rather than a rule we impose on all six.
 *
 * Four ways to print nothing:
 *
 *     0x440828  movzx di, byte ptr [esi+0x18]   the text's Pascal length is 0
 *     0x440839  cmp byte ptr [esi+0x19], 0x2a   its first character is '*'
 *     0x44084c  ...                             the ident is "idle 1".."idle 4"
 *     0x4408e9  cmp byte ptr [..+0x18], cl      every character is a space (0x20)
 *
 * +0x18 is the text field and +0x118 the ident, the same offsets df/pup.ts reads
 * at +24 and +280.
 *
 * A leading '*' marks the text as a NOTE rather than a line, and the corpus says
 * what kind. Of the 284 starred records in the English tree — all 284 of which
 * have a voice recording, so the player always hears something — 169 are an
 * `idle 1`..`idle 4` animation pose whose "text" is an animator's label
 * (`*blink`, `*gesture`, `*idlespeak`), 104 are lines a script really speaks, and
 * 11 are named by no `puppetspeak` at all. Of those 104, 95 carry a `*NAME.MOV`
 * studio note and 9 are non-verbal or voice-over (`*TRADEMARK LAUGH`,
 * `*HE DRINKS.`, `*SOUND OF CRASHING GLASS…`, `*Purser holds the cufflink.`,
 * `*VO--Ahem...Excuse me.`).
 *
 * `*NAME.MOV` does NOT reliably mean "read over that movie". PENNY1's case 105
 * runs `spotmovie("sasha.mov")` — which blocks — and speaks `penny1.079` and
 * `penny1.071` after it has closed; case 106 speaks the same two with no movie
 * anywhere near. The note is a leftover from when they were meant to be read
 * over one, which is why the Japanese and Dutch translators simply deleted the
 * prefixes (penny1.pup: 21 starred in English, 13 in Japanese, 8 in Dutch) and
 * why those two editions show these lines and the other four do not (#48).
 *
 * NOT implemented: 0x440810 opens on `cmp word ptr [0x48a018], 0`, a runtime
 * enable that suppresses every subtitle in the game when clear. Nothing in the
 * port sets it, and nothing in the shipped corpus writes it.
 */
/**
 * The volume digits, shared by the two waits that take keys — the spoken-line
 * filter (0x441d80) and the movie one (0x44a460), whose jump tables are
 * byte-identical: `0`..`9` each call the wave-volume setter with their own value,
 * and report "not an interrupt" so the line or the clip carries on.
 *
 * DEVIATION, and a forced one. The original requires the Ctrl marker on every arm
 * of those tables (the window proc sets it from `GetKeyState(VK_CONTROL)` alone,
 * 0x41ad08), so these are Ctrl+0..Ctrl+9 there. A browser cannot have them:
 * Ctrl+0 is zoom reset and Ctrl+1..Ctrl+9 switch tabs, and `preventDefault()`
 * does not stop either. #115's brightness keys had no such problem — the manual
 * named Ctrl+F1 but the code tested the virtual key alone, so bare F1 was
 * faithful AND reachable. Here the two disagree, so the digits are bound bare and
 * the chord is simply unavailable (#129).
 *
 * NOT bound: `T`, the other arm these tables share. It sets the filter's
 * out-param rather than acting, and of the three call sites only the movie loop
 * reads it (0x44a3e9) — so during a spoken line it does nothing at all in the
 * original either. What it does in a movie is toggle an audio latch (0x48c510)
 * whose stream is unidentified, so it stays out until it is named.
 */
export function volumeKey(session: GameSession, name: string): boolean {
  if (name.length !== 1 || name < "0" || name > "9") return false;
  session.setWaveVolume(name.charCodeAt(0) - 0x30);
  return true;
}

export function subtitled(line: PupDialogue): boolean {
  if (!line.raw.length) return false;
  if (line.raw.startsWith("*")) return false;
  if (/^idle [1-4]$/i.test(line.ident)) return false;
  return !/^ *$/.test(line.raw);
}

export class PuppetController {
  constructor(private readonly session: GameSession) {}

  /** The active conversation, or null when none is running (see module docblock). */
  puppet: {
    name: string;
    pup: PupFile;
    scripts: Map<string, ScriptInstance>;
    /**
     * The stance the layer frames are being read out of — a property of the
     * LINE being played, not of the file (see PupDialogue.stance in
     * src/df/pup.ts, which is where the evidence for that lives). Every
     * place that names a line sets it, exactly where TI.EXE calls its stance
     * loader: puppetspeak, puppetbase, and the opening pose.
     */
    stanceIdx: number;
    /**
     * puppetvisible: whether the conversation close-up is drawn. A puppet stays
     * LOADED (so its scripts keep running) while hidden — blackjack hides the
     * dealer with puppetvisible(false) to reveal the table during a hand, then
     * puppetvisible(true) to bring Buick back for the "play again?" prompt.
     */
    visible: boolean;
    subtitle: string;
    bevels: { text: string; id: number }[];
    /**
     * The bevel the player clicked, still framed on screen.
     *
     * Answering does NOT take the choices down: TI.EXE frames the row you
     * picked and leaves the whole list standing until the script's next
     * `puppetclear` (0x441af7 sets the index at 0x48a6ea, and only 0x43f8c0
     * resets the count), so you read your own answer while the character
     * replies to it. Scripts loop `puppetclear` → bevels → `puppetevent`, so
     * nothing depends on the engine clearing them for them.
     */
    chosen: number | null;
    /**
     * The press-feedback box on the row under the button, and when it may go.
     *
     * TI.EXE tracks a bevel press the way QuickDraw tracks a button (0x435260):
     * PenSize(3), PenMode(1) — the INVERT mode — a FrameRect on, toggled off and
     * on again as the pointer slides out of the row and back, a second FrameRect
     * to erase it, and a `TickCount() + 10` deadline it will not return before.
     * That floor is what makes the box a thing you see at all: without it a
     * normal click would draw and erase it inside one frame.
     */
    press: { index: number; until: number } | null;
    /** puppetevent resolver — a bevel click ends the wait */
    eventWaiter: ((id: number) => void) | null;
    /** ESC resolver for the line currently being spoken (see {@link skipLine}) */
    speakSkip: (() => void) | null;
    /**
     * ESC has been pressed and the current speech run is over (TI.EXE 0x48ac00).
     *
     * Skipping is not per line. Once the flag is up, every following
     * `puppetspeak` queues its line and returns WITHOUT playing or waiting
     * (0x43f887) — so one press gets you past the whole speech, not past one
     * sentence of it. Only `puppetevent` lifts it (0x43f718), which is the
     * original's way of saying "the skip ends where you get a say again".
     *
     * The plaque wait's four idle-speech timers read it too (0x4417ab and its
     * three siblings), and a repeat clears it when it finishes (0x441a6c).
     */
    interrupted: boolean;
    /**
     * The lines spoken since the last `puppetevent`, at most three — TI.EXE's
     * voice queue at 0x48a6e0 with its count at 0x48ac04, capped by
     * `cmp cx, 3` at 0x43f86d. This is what a repeat replays.
     */
    voiceQueue: PupDialogue[];
    /**
     * The exchange before this one: the rows that were up and the one the player
     * picked. `puppetevent` copies its plaque aside as it answers (0x43f767's
     * 1304-byte `rep movsd` into 0x48ac08 — four bytes of count and chosen
     * index, then five 260-byte rows), and the repeat puts it back on screen.
     */
    lastPlaque: { bevels: { text: string; id: number }[]; chosen: number | null } | null;
    /** a repeat is playing; a second click must not start another */
    repeating: boolean;
    /** animLogic playback of the line being spoken (~30 records/s) */
    anim: { frames: PupAnimFrame[]; start: number } | null;
    /** layer state held between lines (the last played record) */
    pose: PupAnimFrame | null;
    /** the neutral opening pose (puppetbase("") reverts to it) */
    defaultPose: PupAnimFrame | null;
    /** the stance {@link defaultPose} was authored against */
    defaultStance: number;
  } | null = null;

  async openPuppetFile(fileName: string): Promise<boolean> {
    const key = toStr(fileName).toLowerCase();
    await this.session.ensureFile(key);
    const data = this.session.files(key);
    if (!data) {
      this.session.onLog(`openpuppetfile: "${fileName}" not available`);
      return false;
    }
    let pup: PupFile;
    try {
      pup = readPupFile(data, this.session.textEncoding());
    } catch (e) {
      this.session.onLog(`openpuppetfile: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    const scripts = new Map<string, ScriptInstance>();
    let main: ScriptInstance | null = null;
    for (const s of pup.scripts) {
      const inst = this.session.instanceFrom(pup.file.containers[s.location]?.data, s.name);
      if (!inst) continue;
      scripts.set(s.name, inst);
      if (s.name === "boot script") main = inst;
    }
    // branch scripts resolve shared helpers through the boot script
    for (const inst of scripts.values()) if (inst !== main) inst.parent = main;
    // Neutral opening pose: the first record of the first line's animLogic, in
    // that line's own stance. TI.EXE gets there by clearing the puppetbase
    // ident on open (0x42972a) and letting the base routine's not-found path
    // fall back to line 0 (0x440556) — stance and all.
    let pose: PupAnimFrame | null = null;
    const firstLine = pup.dialogue.values().next().value;
    if (firstLine) pose = readAnimLogic(pup, firstLine.animLogicLocation)[0] ?? null;
    const stance = firstLine?.stance ?? 0;
    this.puppet = {
      name: key,
      pup,
      scripts,
      stanceIdx: stance,
      visible: true,
      subtitle: "",
      bevels: [],
      chosen: null,
      press: null,
      eventWaiter: null,
      speakSkip: null,
      // 0x43f2b0 zeroes the queue, its count and the interrupt flag on open
      interrupted: false,
      voiceQueue: [],
      lastPlaque: null,
      repeating: false,
      anim: null,
      pose,
      defaultPose: pose,
      defaultStance: stance,
    };
    this.session.onLog(`puppet opened: ${key} (${pup.dialogue.size} lines, ${pup.scripts.length} scripts)`);
    return true;
  }

  closePuppetFile(): void {
    if (!this.puppet) return;
    this.puppet.eventWaiter?.(-1);
    this.puppet.speakSkip?.();
    this.session.audio.halt("voice");
    this.puppet = null;
  }

  /**
   * A line named by its SUBTITLE rather than its ident, for the one authoring
   * convention that does that — built on the first miss and cached, so a file
   * whose script names lines properly never pays for it.
   *
   * The 1996 demo's `dpenny.pup` is why. Its script says
   * `puppetspeak("No, that's not Mr. Conkling.")` where every other puppet in
   * every tree says `puppetspeak("penny1.007")`: all 36 of its calls match a
   * subtitle and none match an ident, so Penny — the demo's own contact — stood
   * there silent while the log filled with `puppetspeak: no line`.
   */
  private linesByText(p: NonNullable<PuppetController["puppet"]>): Map<string, PupDialogue> {
    if (!this.byText.has(p.pup)) {
      const index = new Map<string, PupDialogue>();
      // first definition wins, matching the ident map's own precedence
      for (const line of p.pup.dialogue.values()) {
        const key = line.text.toLowerCase().trim();
        if (key && !index.has(key)) index.set(key, line);
      }
      this.byText.set(p.pup, index);
    }
    return this.byText.get(p.pup)!;
  }

  /** subtitle indexes, per parsed puppet file — see {@link linesByText} */
  private readonly byText = new WeakMap<PupFile, Map<string, PupDialogue>>();

  /** play one dialogue line: voice + subtitle, suspend until it ends */
  async puppetSpeak(ident: string): Promise<void> {
    const p = this.puppet;
    if (!p) return;
    const asked = toStr(ident).toLowerCase();
    // by ident first, which is what every shipped script but one uses — so the
    // fallback below cannot change what any of them resolve to
    const line = p.pup.dialogue.get(asked) ?? this.linesByText(p).get(asked.trim());
    if (!line) {
      this.session.onLog(`puppetspeak: no line "${ident}" in ${p.name}`);
      return;
    }
    // queued BEFORE the skip test, exactly as 0x43f866 queues ahead of 0x43f887:
    // a line skipped past is still a line the character said, and a repeat says
    // the whole batch back
    if (p.voiceQueue.length < 3) p.voiceQueue.push(line);
    if (p.interrupted) return; // ESC already ended this speech run — see `interrupted`
    await this.playLine(p, line);
  }

  /**
   * Say one line and wait it out: voice, subtitle, lip-sync.
   *
   * Split off {@link puppetSpeak} because a repeat replays from the queue and
   * must NOT queue again — the original replays by calling the same play-and-wait
   * (0x440620) that puppetspeak calls, one queue entry at a time (0x441a41).
   */
  private async playLine(p: NonNullable<PuppetController["puppet"]>, line: PupDialogue): Promise<void> {
    // The line is always HEARD; whether its text is printed is a separate
    // question, and one the record answers — see {@link subtitled}.
    p.subtitle = subtitled(line) ? line.text : "";
    // the line's stance first, before a single frame of it is drawn: the layer
    // tables the animLogic records index are the ones it was animated against
    // (0x4406c7, before the playback loop). In a two-character puppet this is
    // which of the two faces the mouth belongs to.
    p.stanceIdx = line.stance;
    // TI paces a missing-audio line by text length (min 1 s) — by the BYTE
    // count it read, which is what a 1996 strlen() saw and what keeps a
    // Japanese line, half as many characters as its English original, from
    // being given half the time to be said
    let seconds = Math.max(1, line.raw.length / 15);
    try {
      const audio = decodeAudioContainer(p.pup.file.containers[line.audioLocation].data);
      seconds = audio.samples.length / audio.sampleRate;
      this.session.audio.play("voice", audio);
    } catch (e) {
      this.session.onLog(`puppetspeak ${line.ident}: ${(e as Error).message}`);
    }
    // lip-sync/gesture playback: the line's animLogic records run at
    // ~30/s alongside the voice; the last record stays as the idle pose
    const frames = readAnimLogic(p.pup, line.animLogicLocation);
    if (frames.length) p.anim = { frames, start: this.session.clock.now };
    // ESC cuts the rest of the line short — and only ESC. A click cannot: the
    // wait's filter (0x441d80) drops any event that is not a KEY on its first
    // instruction, so the original has no click-to-skip at all. See {@link key}.
    await Promise.race([
      this.session.clock.sleep(seconds * 1000 + 150),
      new Promise<void>((resolve) => (p.speakSkip = resolve)),
    ]);
    p.speakSkip = null;
    // ...and silences it. Only the NEXT puppetspeak would otherwise cut it (a
    // non-overlapping play halts the channel first), and what follows a line is
    // often not another line: PENNY2.PUP's Lenin beat runs `puppetspeak(28)`,
    // `puppetclear()`, `spotmovie("lenin.mov")` — skip line 28 and it used to
    // keep talking under the movie. Waiting the line out makes this a no-op:
    // the race outlasts the audio by 150 ms.
    this.session.audio.halt("voice");
    if (this.puppet === p) {
      p.subtitle = "";
      if (p.anim) {
        p.pose = p.anim.frames[p.anim.frames.length - 1];
        p.anim = null;
      }
    }
  }

  /** the layer state to draw right now (animLogic playback or held pose) */
  puppetFrame(): PupAnimFrame | null {
    const p = this.puppet;
    if (!p) return null;
    if (p.anim) {
      const idx = Math.floor((this.session.clock.now - p.anim.start) / 33.3);
      return p.anim.frames[Math.max(0, Math.min(idx, p.anim.frames.length - 1))];
    }
    return p.pose;
  }

  puppetClear(): void {
    if (!this.puppet) return;
    this.puppet.bevels = [];
    this.puppet.chosen = null;
    this.puppet.press = null;
    this.puppet.subtitle = "";
  }

  /**
   * puppetbase(ident): seat the character in a resting pose taken from a
   * dialogue line's first animLogic record (the game calls this before a
   * branch — e.g. bx2 posed with vs without the baby). "" reverts to the
   * neutral opening pose. Unknown idents are ignored (some scenarios name a
   * line from a companion puppet we don't have loaded).
   */
  puppetBase(ident: string): void {
    const p = this.puppet;
    if (!p) return;
    if (!ident) {
      p.pose = p.defaultPose;
      p.stanceIdx = p.defaultStance;
      p.anim = null;
      return;
    }
    const line = p.pup.dialogue.get(toStr(ident).toLowerCase());
    if (!line) {
      this.session.onLog(`puppetbase: no line "${ident}" in ${p.name}`);
      return;
    }
    p.stanceIdx = line.stance; // a base pose changes stance too (0x4405c4)
    const frames = readAnimLogic(p.pup, line.animLogicLocation);
    if (frames.length) {
      p.pose = frames[0];
      p.anim = null;
    }
  }

  puppetBevel(text: string, id: number): void {
    const p = this.puppet;
    if (!p) return;
    // a sixth choice does not fit the five-row band: TI.EXE refuses it outright
    // (error 0x2e at 0x43f676) rather than shrinking the rows
    if (p.bevels.length >= 5) {
      this.session.onLog(`puppetbevel: ${p.name} offered a sixth choice ("${text}") — dropped`);
      return;
    }
    p.chosen = null;
    p.bevels.push({ text, id });
  }

  /**
   * A key while the puppet is waiting — true if the wait consumed it.
   *
   * The original's filter (0x441d80) is reached from inside the two waits and
   * nowhere else, so a key means something here only while a line is being
   * spoken or the choices are up. It takes only events carrying the 0x1fa0
   * marker — the key is ESC, or was held with Ctrl — which is `special`.
   *
   * Both waits answer it, and they answer it DIFFERENTLY: a spoken line is
   * skipped, a plaque is abandoned with -1. So a caller cannot hammer this key —
   * see {@link SetViewer.speaking}, which is what the playthrough drivers aim
   * with.
   *
   * DEVIATION, deliberate: the original's wait pops EVERY key off the queue, so
   * an unmarked one is swallowed and the scripts never see it. This returns
   * false for those and lets them through, because nothing in the port needs
   * them eaten and a conversation is not where to find out otherwise.
   *
   * The one arm still unbound is `T`, and #129 says why: it sets the filter's
   * out-param rather than acting, and of the three call sites only the movie loop
   * reads it — so during a spoken line it does nothing in the original either.
   */
  key(name: string, special: boolean): boolean {
    const p = this.puppet;
    if (!p || !p.visible) return false;
    if (!p.speakSkip && !p.eventWaiter) return false;
    // the volume digits first, because they are the arms that do NOT interrupt:
    // the filter answers 0 for them and the line plays on (see volumeKey)
    if (volumeKey(this.session, name)) return true;
    if (!special || name !== ".") return false;
    if (p.speakSkip) {
      this.skipLine();
      return true;
    }
    // The PLAQUE wait answers ESC too, and its answer is -1 (0x4418a7) — which is
    // how a player walks out of a conversation. Every one of the 516 puppetevent
    // calls in the tree is `puppetevent (-1)` followed by a `switch` with a
    // `case -1` arm, so this is a branch the authors wrote and nothing could
    // reach until now (#131).
    //
    // Deliberately NOT setting the skip flag: unlike a spoken-line ESC this must
    // not swallow what comes next, because the script's own -1 arm may have a
    // parting line to say. TI.EXE agrees — the plaque pump's ESC path writes the
    // -1 and returns without touching 0x48ac00.
    p.eventWaiter?.(-1);
    return true;
  }

  /**
   * ESC: end the line being spoken, and the rest of the speech run with it.
   *
   * Setting the flag is the whole of the second half — see {@link puppet.interrupted}.
   */
  skipLine(): void {
    const p = this.puppet;
    if (!p) return;
    p.interrupted = true;
    p.speakSkip?.();
  }

  /** modal wait for a choice; resolves with the clicked bevel's id */
  puppetEvent(): Promise<number> {
    const p = this.puppet;
    if (!p) return Promise.resolve(-1);
    // a plaque is where a skip ends: the flag comes down before the wait (0x43f718)
    p.interrupted = false;
    if (!p.bevels.length) return Promise.resolve(-1);
    return new Promise<number>((resolve) => {
      p.eventWaiter = (id) => {
        p.eventWaiter = null;
        // 0x43f767: the answered plaque is copied aside for the repeat, and the
        // voice queue emptied — what the character says next is a new exchange.
        // A plaque nobody answered (ESC, or the file closing under us) has no
        // picked row, and must not inherit the last one's: `chosen` outlives its
        // own plaque until the script's next puppetclear, so recording it here
        // would frame a row of this list that was never touched.
        p.lastPlaque = { bevels: [...p.bevels], chosen: id === -1 ? null : p.chosen };
        p.voiceQueue.length = 0;
        resolve(id);
      };
    });
  }

  /**
   * Say the last exchange again — the original's answer to a click on the
   * picture while the choices are up (0x44197a).
   *
   * It is not a re-run of the script: nothing here re-enters it, so the stage
   * directions a scenario prints around a line (`message("ACT--…")`) do not come
   * back. What comes back is what was HEARD. And it is the exchange, not a line:
   * the current rows come down, the ones you chose from go back up with your own
   * row framed (0x44199c, 0x4419b5), your line is said again if the plaque's text
   * names a dialogue record (0x441cb0 matches bevel text against the line table,
   * 0x441ba0 speaks the hit), and then the queue of replies plays through.
   */
  private async repeatLastExchange(): Promise<void> {
    const p = this.puppet;
    if (!p || p.repeating) return;
    const last = p.lastPlaque;
    if (!last && !p.voiceQueue.length) return;
    p.repeating = true;
    const shown = { bevels: p.bevels, chosen: p.chosen };
    p.bevels = last?.bevels ?? [];
    p.chosen = last?.chosen ?? null;
    try {
      const mine = last?.chosen != null ? last.bevels[last.chosen] : undefined;
      const line = mine ? this.linesByText(p).get(mine.text.toLowerCase().trim()) : undefined;
      if (line) await this.playLine(p, line);
      // 0x441a35: the first queued reply always plays; the flag is only read
      // after one has finished, so ESC stops the NEXT one rather than this one
      for (const queued of [...p.voiceQueue]) {
        if (this.puppet !== p) return;
        await this.playLine(p, queued);
        if (p.interrupted) break;
      }
    } finally {
      if (this.puppet === p) {
        p.interrupted = false; // 0x441a6c
        p.bevels = shown.bevels;
        p.chosen = shown.chosen;
        p.repeating = false;
      }
    }
  }

  /**
   * Viewer hook: the button went down over bevel index i (or -1 = off the rows),
   * `inPicture` when the point was above the answer band rather than in it.
   *
   * A press does not answer — it starts the tracker (see `press`), and only a
   * release inside the same row does. A press on the PICTURE is the repeat: the
   * original tests the point against the rect (0,0)-(W, H-120), the screen above
   * the band, before it reaches the rows (0x44193f), and only then against each
   * row (0x441aa7). A press in the band but on no row does nothing either way.
   */
  puppetPress(i: number, inPicture = false): void {
    const p = this.puppet;
    if (!p) return;
    if (i >= 0 && i < p.bevels.length && p.eventWaiter) {
      p.press = { index: i, until: this.session.clock.now + PRESS_FLOOR_MS };
      return;
    }
    // Only while the choices are up. During a spoken line the wait ignores the
    // mouse outright, which is why this no longer skips — see {@link key}.
    if (inPicture && p.eventWaiter) void this.repeatLastExchange();
  }

  /**
   * Viewer hook: the button came up over bevel index i.
   *
   * Answers only if it is the row the press started on — TI.EXE's tracker
   * returns its `inside` flag, and the caller ignores the bevel entirely when
   * that flag is false (0x441ad3), so sliding off the row before letting go
   * cancels the answer. The press box is left standing: its tick floor may not
   * have run out yet, and the original waits that out before erasing it.
   */
  puppetRelease(i: number): void {
    const p = this.puppet;
    if (!p) return;
    const press = p.press;
    if (!press || press.index !== i) {
      p.press = null; // released off the row: box goes, nothing answered
      return;
    }
    if (!p.eventWaiter) return;
    p.chosen = i; // stays framed until the script clears the list
    p.eventWaiter(p.bevels[i].id);
  }

  /** press and release in one place — a synthetic click (tests, scripts) */
  puppetChoose(i: number, inPicture = false): void {
    this.puppetPress(i, inPicture);
    this.puppetRelease(i);
  }
}
