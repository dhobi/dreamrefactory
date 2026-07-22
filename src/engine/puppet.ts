import { decodeAudioContainer } from "../df/audio";
import { PupAnimFrame, PupFile, readAnimLogic, readPupFile } from "../df/pup";
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
export class PuppetController {
  constructor(private readonly session: GameSession) {}

  /**
   * Active conversation. While set, the viewer renders the puppet screen
   * (stance layers + subtitle + choice bevels) instead of the world.
   * puppetspeak() suspends the running script for the line's duration;
   * puppetevent() suspends until the player clicks a bevel.
   */
  puppet: {
    name: string;
    pup: PupFile;
    scripts: Map<string, ScriptInstance>;
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
      pup = readPupFile(data);
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
    // neutral opening pose: the first record of the first line's animLogic
    let pose: PupAnimFrame | null = null;
    const firstLine = pup.dialogue.values().next().value;
    if (firstLine) pose = readAnimLogic(pup, firstLine.animLogicLocation)[0] ?? null;
    this.puppet = {
      name: key,
      pup,
      scripts,
      stanceIdx: 0,
      visible: true,
      subtitle: "",
      bevels: [],
      eventWaiter: null,
      speakSkip: null,
      anim: null,
      pose,
      defaultPose: pose,
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

  /** play one dialogue line: voice + subtitle, suspend until it ends */
  async puppetSpeak(ident: string): Promise<void> {
    const p = this.puppet;
    if (!p) return;
    const line = p.pup.dialogue.get(toStr(ident).toLowerCase());
    if (!line) {
      this.session.onLog(`puppetspeak: no line "${ident}" in ${p.name}`);
      return;
    }
    p.subtitle = line.text;
    // TI paces a missing-audio line by text length (min 1 s)
    let seconds = Math.max(1, line.text.length / 15);
    try {
      const audio = decodeAudioContainer(p.pup.file.containers[line.audioLocation]);
      seconds = audio.samples.length / audio.sampleRate;
      this.session.audio.play("voice", audio);
    } catch (e) {
      this.session.onLog(`puppetspeak ${ident}: ${(e as Error).message}`);
    }
    // lip-sync/gesture playback: the line's animLogic records run at
    // ~30/s alongside the voice; the last record stays as the idle pose
    const frames = readAnimLogic(p.pup, line.animLogicLocation);
    if (frames.length) p.anim = { frames, start: this.session.clock.now };
    // a click skips the rest of the line (halting the voice)
    await Promise.race([
      this.session.clock.sleep(seconds * 1000 + 150),
      new Promise<void>((resolve) => (p.speakSkip = resolve)),
    ]);
    p.speakSkip = null;
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
      p.anim = null;
      return;
    }
    const line = p.pup.dialogue.get(toStr(ident).toLowerCase());
    if (!line) {
      this.session.onLog(`puppetbase: no line "${ident}" in ${p.name}`);
      return;
    }
    const frames = readAnimLogic(p.pup, line.animLogicLocation);
    if (frames.length) {
      p.pose = frames[0];
      p.anim = null;
    }
  }

  puppetBevel(text: string, id: number): void {
    this.puppet?.bevels.push({ text, id });
  }

  /** modal wait for a choice; resolves with the clicked bevel's id */
  puppetEvent(): Promise<number> {
    const p = this.puppet;
    if (!p) return Promise.resolve(-1);
    if (!p.bevels.length) return Promise.resolve(-1);
    return new Promise<number>((resolve) => {
      p.eventWaiter = (id) => {
        p.eventWaiter = null;
        p.bevels = [];
        resolve(id);
      };
    });
  }

  /** viewer hook: player clicked bevel index i (or -1 = skip the line) */
  puppetChoose(i: number): void {
    const p = this.puppet;
    if (!p) return;
    if (i >= 0 && i < p.bevels.length && p.eventWaiter) {
      p.eventWaiter(p.bevels[i].id);
      return;
    }
    p.speakSkip?.(); // click during speech: skip the line
  }
}
