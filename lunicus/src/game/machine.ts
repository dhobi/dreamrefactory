/**
 * Lunicus's machine: the DreamFactory 0 machine every part of the game runs on
 * (engine/src/v0/machine.ts — the clock, the files, the input, the sound and the
 * screen) with what is Lunicus's own on top: its 8.3 file names, its sound
 * bank's ambience, the menu bar's settings and LUNICUS.SCO.

 */
import { MachineV0, type Co } from "@dreamfactory/engine/v0/machine";
import { actionOf, defaultSco, type Sco } from "./sco";

export { SILENT, rng, type Co, type GameFiles, type InputEvent, type Speaker } from "@dreamfactory/engine/v0/machine";

/**
 * The game's names → the rip's 8.3 names: `lowerbase` is `lowerbas.`,
 * `intro.move` is `intro.mov`, `heisenstein.1` is `heisenst.1`. The EXE asks
 * for a file in the day's folder first, then in `shared\` (0x40a63a).
 */
export function dosName(name: string): string {
  const dot = name.indexOf(".");
  const base = (dot < 0 ? name : name.slice(0, dot)).slice(0, 8);
  const ext = dot < 0 ? "" : name.slice(dot + 1).slice(0, 3);
  return `${base}.${ext}`.toLowerCase();
}

export class Machine extends MachineV0 {
  /** the day's folder, then `shared/`, by the file's 8.3 name (0x40a63a) */
  resolve(name: string, day: number): string | null {
    const file = dosName(name);
    for (const dir of [`day${day}/`, "shared/"]) if (this.files.has(dir + file)) return dir + file;
    return null;
  }

  /* ---- the menu bar's settings (src/menu.ts) --------------------------- */

  /**
   * Sound ▸ Sound Off … Sound Level 7, `[0x42c160]`, 0 to 7: the DEVICE's
   * volume (0x4209a8 → waveOutSetVolume(n × 0xFFFF / 7)), not the samples'.
   * The EXE starts from the device's own (0x4209c3), 7 where it cannot read
   * one — which a page never can.
   */
  volume = 7;
  /**
   * Settings ▸ Cache Mazes, `[0x42c16c]`: the EXE copied the mazes to the hard
   * disk (0x40a795). A page has nothing to copy them to; the mark is kept.
   */
  cacheMazes = true;
  /**
   * Menu commands for the level to take between one thing and the next, as the
   * EXE's queue holds event 7 for the state's handler (0x417412) — a film or
   * a conversation leaves them waiting.
   */
  commands: { menu: number; item: number }[] = [];
  /** File ▸ Exit in a game (0x41745e): the title again, and not for a death */
  quitAsked = false;
  /** LUNICUS.SCO's block (src/game/sco.ts): the key table and the high scores */
  sco: Sco = defaultSco();
  /**
   * Settings ▸ Keys (0x418b50), for a level to wait on between one thing and
   * the next; the game (game.ts) puts its dialog here
   */
  keysDialog: () => Co = function* () {};

  /** 0x4173ff: the action a key is in the key table — 0 none, 1–3 a step, 4–7 a mode */
  action(key: string): number {
    return actionOf(this.sco.keys, key);
  }

  setVolume(level: number): void {
    this.volume = level;
    this.speaker.volume?.(level / 7);
  }
}
