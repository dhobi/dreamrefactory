import type { PlayHandle } from "./audio";
import type { GameSession } from "./session";

/** which of DF.EXE's play rules a v1 sound builtin uses */
export type SoundRuleV1 = "single" | "multiple" | "both";
/** ...and DreamFactory 4's, whose `dualsound` is a rule of its own */
export type SoundRule = SoundRuleV1 | "dual";

/**
 * A 0..255 pan as the sink's -1..1: TI.EXE's balance (0x424b90) is linear on
 * each side of the centre, 128 wide on the left and 127 on the right — below
 * 128 the right ear gets p/128, above it the left gets (255 − p)/127, and 128
 * is full in both. The sink's law ({@link PlayOpts.pan}) is the same balance in
 * these units.
 */
export function panFrom255(p: number): number {
  if (p < 128) return Math.max(-1, (p - 128) / 128);
  if (p > 128) return Math.min(1, (p - 128) / 127);
  return 0;
}

/** a sound effect channel's clip: the record it plays, its handle, and (v1, v4) the priority it took the channel with */
export interface ChannelClip {
  name: string;
  handle: PlayHandle;
  priority?: number;
}

/**
 * What the sound effects hold, whichever engine plays them. Its own object
 * because a session learns its engine as it boots (the BOOTFILE says v5, the
 * first set v1), so the {@link SoundChannels} it plays through may change while
 * what has been set and played must not.
 */
export class SoundBoard {
  /**
   * The two sound effect channels. Scripts test both (`currentsound(1)=x |
   * currentsound(2)=x`) to ask "is x still playing?"; a slot reads back as its
   * name only while its handle is live.
   */
  readonly channels: (ChannelClip | null)[] = [null, null];
  /** sound names flagged by soundloop(name, true): they LOOP when played */
  readonly loopFlags = new Set<string>();
  /** a looping play held by its name (DF.EXE's and RedJack.exe's loops; TI.EXE's are the channels') */
  readonly namedLoops = new Map<string, PlayHandle>();
  /**
   * Per-sound-name volume and pan (0..255), set by soundvol()/soundpan() just
   * before the matching singlesound()/etc. — scripts configure a sound then play
   * it (windgust: `soundpan(n,..); soundvol(n,..); singlesound(n)`). Unset names
   * play at full and centre.
   */
  readonly volume = new Map<string, number>();
  readonly pan = new Map<string, number>();
}

/**
 * The sound effect builtins over the two channels. What is the same in DF.EXE
 * (Dust), TI.EXE (Titanic) and RedJack.exe is here; each engine's own way of
 * playing, looping, halting and placing a sound is its subclass
 * (sound-channels-v1.ts, -v4.ts, -v5.ts). Where DF.EXE and RedJack.exe agree
 * and TI.EXE differs, the default is theirs and SoundChannelsV4 overrides it.
 */
export abstract class SoundChannels {
  constructor(
    protected readonly board: SoundBoard,
    protected readonly session: GameSession,
  ) {}

  /** play a named sound on the channels, honouring its loop flag (the play builtins) */
  abstract play(name: string, overlap: boolean, rule?: SoundRule): void;

  // ---- what each engine may do its own way: DF.EXE's and RedJack.exe's here ----

  /**
   * soundloop(name, on/off): flag a sound as looping — it does NOT start
   * anything itself. Every call in the TAOOT corpus pairs the flag with a play
   * that follows (`soundloop("hissloop", true); singlesound("hissloop")`, or a
   * makecricket for positional ambience). Off ends a looping play at once.
   */
  setLoop(name: string, on: boolean): void {
    const key = name.toLowerCase();
    if (on) {
      this.board.loopFlags.add(key);
      return;
    }
    this.board.loopFlags.delete(key);
    this.board.namedLoops.get(key)?.stop();
    this.board.namedLoops.delete(key);
  }

  /** `haltsound`: both channels (DF.EXE 0x4072f0), and every looping play */
  halt(_which?: number): void {
    this.session.audio.halt("sound");
    // a channel's clip is an overlapping play the sink does not hold: stop both
    // channels by hand (0x4072f0 halts channels 1 and 2)
    for (const c of this.board.channels) c?.handle.stop();
    for (const h of this.board.namedLoops.values()) h.stop();
    this.board.namedLoops.clear();
  }

  /**
   * `currentsound (channel)`: the name on that channel, `"none"` when it is idle.
   *
   * IDLE IS `"none"`, not the empty string, and that is the engine's word rather
   * than a convenience. Every script that compares this against a NAME works
   * either way, which is why it read `""` for years. Dust asks it the other way
   * round in three places — `FLUTE.FLT/0001 mousedown`, its `evaluate ()`, and
   * `FLUTE.PRP/0001 hidestep ()` all open `while currentsound () != "none"
   * endwhile` — and against `""` that is a loop with no exit. `halttheme ()`
   * writes `currentThemeName = "none"` too, and nothing in either corpus
   * compares a sound or voice name to `""`, and nothing is named "none".
   */
  current(channel: number): string {
    return this.onChannel(channel);
  }

  /**
   * The volume and pan are the sound RECORD's, and setting either re-places every
   * mixer channel playing that record at once — which is how a cricket's level
   * follows the camera while it sounds. RedJack.exe's setters (0x471fc0,
   * 0x4721e0: the record, then SetVolume/SetPan on each mixer channel holding
   * it), a looping play among them.
   */
  protected replace(key: string): void {
    const { volume, pan } = this.place(key);
    for (const c of this.board.channels) if (c?.name === key && !c.handle.done) c.handle.place?.(volume, pan);
    this.board.namedLoops.get(key)?.place?.(volume, pan);
  }

  /** a 0..255 pan in sink units: DF.EXE's and RedJack.exe's scales are not read, so 128 a side, linear */
  protected panOf(p: number): number {
    return Math.max(-1, Math.min(1, (p - 128) / 128));
  }

  // ---- the same in every engine ----

  setVolume(name: string, v: number): void {
    this.board.volume.set(name.toLowerCase(), v);
    this.replace(name.toLowerCase());
  }
  getVolume(name: string): number {
    return this.board.volume.get(name.toLowerCase()) ?? 255;
  }
  setPan(name: string, v: number): void {
    this.board.pan.set(name.toLowerCase(), v);
    this.replace(name.toLowerCase());
  }
  getPan(name: string): number {
    return this.board.pan.get(name.toLowerCase()) ?? 128;
  }

  get loopFlags(): Set<string> {
    return this.board.loopFlags;
  }
  /** `soundloop (name)`, the getter: is the sound flagged to loop? (DF.EXE 0x407840 -> 0x42a500, a boolean) */
  isLooped(name: string): boolean {
    return this.board.loopFlags.has(name.toLowerCase());
  }

  /** the name sounding on channel 1 or 2, `"none"` when it is idle — what a save records */
  onChannel(channel: number): string {
    const slot = this.board.channels[channel - 1];
    return slot && !slot.handle.done ? slot.name : "none";
  }

  /** `sounddone ()`: both effect channels idle — DF.EXE 0x4078a0 -> 0x429c00, TI.EXE 0x424cc0 */
  done(): boolean {
    return this.board.channels.every((c) => !c || c.handle.done);
  }

  /** the live handle of a record playing on a channel, if it is (a cricket's shot) */
  liveHandle(name: string): PlayHandle | null {
    return this.board.channels.find((c) => c?.name === name && !c.handle.done)?.handle ?? null;
  }

  /**
   * Stop a sound record wherever it plays (TI.EXE 0x4257e0: every mixer channel
   * holding it) — a cricket walked out of earshot, or one of the looping ones
   * that is not among the two loudest.
   */
  stopRecord(key: string): void {
    for (const c of this.board.channels) if (c?.name === key) c.handle.stop();
    this.board.namedLoops.get(key)?.stop();
    this.board.namedLoops.delete(key);
  }

  /** a sound record's 0..255 volume and pan in sink units */
  protected place(key: string): { volume: number; pan: number } {
    return {
      volume: Math.max(0, Math.min(1, this.getVolume(key) / 255)),
      pan: this.panOf(this.getPan(key)),
    };
  }

  /**
   * A sound channel's priority as the play rules read it: 0 once its clip
   * is over (DF.EXE 0x429ba0, TI.EXE 0x424c90 zero a finished channel's before
   * every play).
   */
  protected channelPriority(slot: number): number {
    const c = this.board.channels[slot];
    return c && !c.handle.done ? (c.priority ?? 0) : 0;
  }

  /** the clip, by name, or a log line saying which banks were looked in */
  protected clip(name: string): { key: string; audio: NonNullable<ReturnType<GameSession["audioLib"]["sound"]>> } | null {
    const key = name.toLowerCase();
    const audio = this.session.audioLib.sound(key);
    if (!audio) {
      this.session.onLog(`sound not found: ${name} (banks: ${this.session.audioLib.bankNames.join(", ") || "none"})`);
      return null;
    }
    return { key, audio };
  }
}
