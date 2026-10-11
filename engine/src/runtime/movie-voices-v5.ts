import type { DecodedAudio } from "../df/audio";
import type { MovSoundV5 } from "../df/mov";
import type { AudioSink, PlayHandle } from "./audio";

type Voice = { key: number; handle: PlayHandle };

/** RedJack 0x4721e0: DirectSound balance, not equal-power stereo panning. */
export function moviePanV5(pan: number): readonly [number, number] {
  let db100 = 0;
  if (pan <= 0) db100 = -10000;
  else if (pan >= 255) db100 = 10000;
  else if (pan < 128) db100 = Math.trunc(-1000 * Math.log(128 / pan));
  else if (pan > 128) db100 = Math.trunc(1000 * Math.log(127 / (255 - pan)));
  const gain = 10 ** (-Math.abs(db100) / 2000);
  return db100 < 0 ? [1, gain] : [gain, 1];
}

/** RedJack's named movie sounds. Slot 2 remains the player's separate bed. */
export class MovieVoicesV5 {
  private slots: (Voice | undefined)[] = new Array(4);

  play(sink: AudioSink, audio: DecodedAudio, sound: MovSoundV5): PlayHandle | null {
    const key = 0x08000000 + sound.index; //Redjack 0x4504f2, MSND catalog order
    let slot = 3;
    if (sound.flags & 8) {
      //Redjack 0x471720: completed, same key, free, then strictly higher priority.
      for (const i of [0, 1]) if (this.slots[i]?.handle.done) this.slots[i] = undefined;
      slot = [0, 1].find((i) => this.slots[i]?.key === key) ??
        [0, 1].find((i) => !this.slots[i]) ?? -1;
      if (slot === -1) {
        slot = this.slots[0]!.key < this.slots[1]!.key ? 0 : 1;
        if (key <= this.slots[slot]!.key) return null;
      }
    }
    this.slots[slot]?.handle.stop();
    const handle = sink.play("sound", audio, {
      overlap: true,
      loop: (sound.flags & 2) !== 0,
      stereoGains: moviePanV5(sound.pan),
    });
    this.slots[slot] = { key, handle };
    return handle;
  }

  /** MFRM bits 0 and 4 query slot 3 and slots 0/1 respectively. */
  busy(effects: boolean): boolean {
    return (effects ? [0, 1] : [3]).some((i) => {
      const voice = this.slots[i];
      return voice !== undefined && !voice.handle.done;
    });
  }

  /** Move_Main stops slots 0, 1 and 3 before releasing the scene's MSND. */
  stop(): void {
    for (const voice of this.slots) voice?.handle.stop();
    this.slots.fill(undefined);
  }
}
