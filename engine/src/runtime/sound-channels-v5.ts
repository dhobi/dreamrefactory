import { SoundChannels } from "./sound-channels";

/**
 * RedJack.exe's: no priorities — a clip takes channel 1, or channel 2 when it
 * overlaps; a looping clip plays once, held by its name on channel 2, and a
 * second play of it while it sounds is not a second loop.
 */
export class SoundChannelsV5 extends SoundChannels {
  play(name: string, overlap: boolean): void {
    const found = this.clip(name);
    if (!found) return;
    const { key, audio } = found;
    const { volume, pan } = this.place(key);
    if (this.board.loopFlags.has(key)) {
      const existing = this.board.namedLoops.get(key);
      if (existing && !existing.done) return;
      const handle = this.session.audio.play("sound", audio, { loop: true, overlap: true, volume, pan });
      this.board.namedLoops.set(key, handle);
      this.board.channels[1] = { name: key, handle };
      return;
    }
    const handle = this.session.audio.play("sound", audio, { overlap, volume, pan });
    this.board.channels[overlap ? 1 : 0] = { name: key, handle };
    this.session.captionClip(key, handle); // #50
  }

  /** `sounddone ()` asks the sound channel, not the effect pair (RedJack.exe's reads state, no wait) */
  done(): boolean {
    return this.session.audio.isDone("sound");
  }
}
