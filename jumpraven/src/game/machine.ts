/**
 * Jump Raven's machine: the DreamFactory 0 machine (engine/src/v0/machine.ts —
 * the clock, the files, the input, the sound and the screen) with Jump Raven's
 * own way of naming its files.
 */
import { MachineV0 } from "@dreamfactory/engine/v0/machine";

export { SILENT, rng, type Co, type GameFiles, type InputEvent, type Speaker } from "@dreamfactory/engine/v0/machine";

/**
 * The game's names → the rip's 8.3 names, which on this disc are upper case:
 * `intro.move` is `INTRO.MOV`, `bati.pupp` is `BATI.PUP`, `puppet` is `PUPPET`.
 */
export function dosName(name: string): string {
  const dot = name.indexOf(".");
  const base = (dot < 0 ? name : name.slice(0, dot)).slice(0, 8);
  const ext = dot < 0 ? "" : name.slice(dot + 1).slice(0, 3);
  return (ext ? `${base}.${ext}` : base).toUpperCase();
}

export class Machine extends MachineV0 {
  /** the day's folder, then `SHARED\` (0x40ea4a, the day's folder named by 0x40e8df) */
  resolve(name: string, day: number): string | null {
    const file = dosName(name);
    for (const dir of [`DAY${day}/`, "SHARED/"]) if (this.files.has(dir + file)) return dir + file;
    return null;
  }

  /** a file of the install's own folder (`RAVEN\RAVEN.FON`, `RAVEN\RAVENRES.DLL`) */
  *own(name: string): Generator<void, Uint8Array, void> {
    const path = `RAVEN/${name}`;
    if (!this.files.has(path)) throw new Error(`${path} is not in the rip`);
    for (;;) {
      const data = this.files.get(path);
      if (data) return data;
      this.files.want(path);
      yield;
    }
  }
}
