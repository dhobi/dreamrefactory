import { ScriptError } from "./interp";
import { SoundChannels, panFrom255, type SoundRule } from "./sound-channels";
import { pickSoundChannelV1 } from "./sound-channels-v1";

/**
 * DreamFactory 4's two sound-effect channels: which a clip of priority `p`
 * plays on, in order. `single` and `multiple` are DreamFactory 1's rules
 * (TI.EXE 0x425150 and 0x425240 are DF.EXE's 0x42a070 and 0x42a160 to the
 * branch); `dual` (0x425330) plays on EVERY channel the clip outranks and
 * `both` (0x425400) on both. tl.exe the same (0x433850..0x433b30).
 */
export function pickSoundChannelsV4(rule: SoundRule, p: number, p1: number, p2: number): number[] {
  if (rule === "both") return [0, 1];
  if (rule === "dual") return [...(p > p1 ? [0] : []), ...(p > p2 ? [1] : [])];
  const slot = pickSoundChannelV1(rule, p, p1, p2);
  return slot < 0 ? [] : [slot];
}

/**
 * TI.EXE's (Titanic, and tl.exe's Timelapse): two channels taken by priority
 * ({@link pickSoundChannelsV4}), a loop that is the channel's own flag, a
 * `haltsound` that takes the channels, and the engine's balance for a pan.
 */
export class SoundChannelsV4 extends SoundChannels {
  /**
   * TI.EXE 0x425150 / 0x425240 / 0x425330 / 0x425400 (singlesound,
   * multiplesound, dualsound, bothsound; tl.exe 0x433850..0x433b30), the
   * priority the record's (+0, tl.exe +0x39), a finished channel's zeroed first
   * (0x424c90)
   */
  play(name: string, overlap: boolean, rule: SoundRule = overlap ? "multiple" : "single"): void {
    const found = this.clip(name);
    if (!found) return;
    const { key, audio } = found;
    const { volume, pan } = this.place(key);
    const priority = this.session.audioLib.soundPriorityV4(key);
    const loop = this.board.loopFlags.has(key);
    for (const slot of pickSoundChannelsV4(rule, priority, this.channelPriority(0), this.channelPriority(1))) {
      this.board.channels[slot]?.handle.stop();
      const handle = this.session.audio.play("sound", audio, { loop, overlap: true, volume, pan });
      this.board.channels[slot] = { name: key, handle, priority };
      if (!loop) this.session.captionClip(key, handle); // #50
    }
  }

  /**
   * DreamFactory 4's loops live on the channels: TI.EXE (0x425740, en) sets the
   * sound's flag and then the loop flag of every channel playing it (0x401d40),
   * and does nothing else — off, the sound plays out the time round it is in
   * (Titanic's BOMB stage stops its tick with soundloop(off) alone); on, one
   * already playing goes on round.
   */
  override setLoop(name: string, on: boolean): void {
    const key = name.toLowerCase();
    if (on) this.board.loopFlags.add(key);
    else this.board.loopFlags.delete(key);
    for (const c of this.board.channels) if (c?.name === key && !c.handle.done) c.handle.setLoop?.(on);
  }

  /**
   * `haltsound` takes the channels as a number — 1, 2, or 3 for both, anything
   * else error 0xe (TI.EXE 0x44d0d0 -> 0x424d80, which stops the mixer channel
   * and with it a loop playing there). Without one, both.
   */
  override halt(which?: number): void {
    if (which === undefined) return super.halt();
    if (which !== 1 && which !== 2 && which !== 3) throw new ScriptError(0xe, `haltsound (${which})`);
    if (which & 1) this.board.channels[0]?.handle.stop();
    if (which & 2) this.board.channels[1]?.handle.stop();
  }

  /**
   * Setting a record's volume or pan re-places every mixer channel playing it
   * (TI.EXE 0x425540 / 0x425640 walk channels 0..3 for it).
   */
  protected override replace(key: string): void {
    const { volume, pan } = this.place(key);
    for (const c of this.board.channels) if (c?.name === key && !c.handle.done) c.handle.place?.(volume, pan);
  }

  protected override panOf(p: number): number {
    return panFrom255(p);
  }
}
