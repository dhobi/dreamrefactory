import { SoundChannels, type SoundRule, type SoundRuleV1 } from "./sound-channels";

/**
 * DreamFactory 1's two sound-effect channels: which one a clip of priority `p`
 * takes, 0 or 1, or -1 for none. `p1`/`p2` are the channels' priorities, 0
 * when idle. Every rule works on the LOWER channel (channel 2 on a tie):
 *
 *   single   (`singlesound`, 0x42a070; `dualsound` is a call to it, 0x42a250)
 *            only a clip that outranks it, and never one whose priority the
 *            other channel holds — a clip playing is not started again
 *   multiple (`multiplesound`, 0x42a160) a clip at least its rank; one whose
 *            priority the other channel holds restarts THAT channel
 *   both     (`bothsound`, 0x42a260) always
 *
 * A priority is `bank << 16 | record` (`AudioLibrary.soundPriorityV1`),
 * so "the same priority" is "the same clip".
 */
export function pickSoundChannelV1(rule: SoundRuleV1, p: number, p1: number, p2: number): number {
  const lower = p1 < p2 ? 0 : 1;
  const low = lower === 0 ? p1 : p2;
  const high = lower === 0 ? p2 : p1;
  if (rule === "both") return lower;
  if (rule === "single") return p > low && p !== high ? lower : -1;
  if (p < low) return -1;
  return p === high ? 1 - lower : lower;
}

/**
 * DF.EXE's (Dust): two channels taken by priority ({@link pickSoundChannelV1}),
 * a looping clip held by its name as well, `currentsound ()` with no channel,
 * and soundvol/soundpan that wait for the next play — DF.EXE's setters are not
 * read, so a playing clip is not re-placed.
 */
export class SoundChannelsV1 extends SoundChannels {
  play(name: string, overlap: boolean, rule: SoundRule = overlap ? "multiple" : "single"): void {
    const found = this.clip(name);
    if (!found) return;
    const { key, audio } = found;
    const { volume, pan } = this.place(key);
    const priority = this.session.audioLib.soundPriorityV1(key);
    const slot = pickSoundChannelV1(rule === "dual" ? "single" : rule, priority, this.channelPriority(0), this.channelPriority(1));
    if (slot < 0) return;
    // the channel's clip is replaced (0x408fd0); the other plays on
    this.board.channels[slot]?.handle.stop();
    const loop = this.board.loopFlags.has(key);
    const handle = this.session.audio.play("sound", audio, { loop, overlap: true, volume, pan });
    this.board.channels[slot] = { name: key, handle, priority };
    if (loop) this.board.namedLoops.set(key, handle);
    else this.session.captionClip(key, handle); // #50
  }

  /**
   * DreamFactory 1's `currentsound()`, which takes no channel (0x407b10 ->
   * 0x429e10): channel 2's sound when only it is busy, channel 1's when only
   * it is, and with both busy the one whose priority is greater — channel 2 on
   * a tie (`jle` at 0x429e6a).
   */
  override current(_channel: number): string {
    const [one, two] = this.board.channels;
    const busy1 = !!one && !one.handle.done;
    const busy2 = !!two && !two.handle.done;
    if (busy1 && busy2) return (one.priority ?? 0) > (two.priority ?? 0) ? one.name : two.name;
    if (busy2) return two!.name;
    return busy1 ? one!.name : "none";
  }

  protected override replace(_key: string): void {
    // DF.EXE's soundvol/soundpan are not read: the next play takes them
  }
}
