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
    /** click-to-skip resolver for the line currently being spoken */
    speakSkip: (() => void) | null;
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
    p.subtitle = line.text;
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
      this.session.onLog(`puppetspeak ${ident}: ${(e as Error).message}`);
    }
    // lip-sync/gesture playback: the line's animLogic records run at
    // ~30/s alongside the voice; the last record stays as the idle pose
    const frames = readAnimLogic(p.pup, line.animLogicLocation);
    if (frames.length) p.anim = { frames, start: this.session.clock.now };
    // a click skips the rest of the line
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

  /** modal wait for a choice; resolves with the clicked bevel's id */
  puppetEvent(): Promise<number> {
    const p = this.puppet;
    if (!p) return Promise.resolve(-1);
    if (!p.bevels.length) return Promise.resolve(-1);
    return new Promise<number>((resolve) => {
      p.eventWaiter = (id) => {
        p.eventWaiter = null;
        resolve(id);
      };
    });
  }

  /**
   * Viewer hook: the button went down over bevel index i (or -1 = off the rows).
   *
   * A press does not answer — it starts the tracker (see `press`), and only a
   * release inside the same row does. A press with nothing to answer is the
   * click that skips a spoken line.
   */
  puppetPress(i: number): void {
    const p = this.puppet;
    if (!p) return;
    if (i >= 0 && i < p.bevels.length && p.eventWaiter) {
      p.press = { index: i, until: this.session.clock.now + PRESS_FLOOR_MS };
      return;
    }
    p.speakSkip?.(); // click during speech: skip the line
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
  puppetChoose(i: number): void {
    this.puppetPress(i);
    this.puppetRelease(i);
  }
}
