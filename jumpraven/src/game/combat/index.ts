/**
 * A flight's modules, made and put in the world's lists in the EXE's orders
 * (src/game/combat/world.ts): the files read (0x40b85f's 0x40c4de; the
 * shared ones at startup, 0x4191ec, 0x4099b8, 0x429314), each module made,
 * and the lists
 *
 *   frame    0x40c517  bike, jeep, tank, copter, boss, fuel, weap, pyro, copilot
 *   shift    0x40c184  pyro, bike, jeep, tank, copter, boss, fuel, weap, hud, copilot
 *   targets  0x40c545  jeep, tank, copter, boss, bike, fuel, weap, the craft, the wreckage
 *   hits     0x41b70b  bike, tank, copter, boss, jeep, fuel, weap
 *   reset    0x40c4b5  pyro, bike, jeep, tank, copter, boss, fuel, weap
 *
 * A module not ported yet stands in as {@link quiet}: nothing of it is up.
 */
import { readContainerFile } from "@dreamfactory/engine/df/container";
import type { Co, Machine } from "../machine";
import type { Comms } from "../comms";
import type { Module } from "./world";
import { World, readPictures } from "./world";
import { Hud, type HudState } from "./hud";
import { Pyro } from "./pyro";

/**
 * A module that is not there: a count of 0, no hits, nothing where anything
 * is asked for
 */
function quiet<T>(name: string): T {
  return new Proxy({} as object, {
    get: (_, k) => {
      if (k === "then") return undefined;
      if (k === "toString") return () => `(no ${name})`;
      return k === "where" || k === "pick" ? () => null : () => 0;
    },
  }) as T;
}

/** the band's bank by `[0x43b304]` (0x40ba15) */
export const BANKS = ["hiphop", "tek", "grunge", "metal"];

export function* assemble(m: Machine, w: World, band: number, comms: Comms, hudState: HudState): Co<Hud> {
  const day = w.day;
  const file = function* (name: string): Co<Uint8Array> {
    return (yield* m.file(name, day)).data;
  };
  w.setBank(readContainerBank(yield* file(BANKS[band] ?? BANKS[1])));
  w.comms = comms;
  const pyro = new Pyro(w, yield* file("play"), yield* file("pyro"));
  const hud = new Hud(w, readPictures(yield* file("panel")), comms, hudState);
  w.pyro = pyro;
  w.hud = hud;
  w.bike = quiet("bike");
  w.jeep = quiet("jeep");
  w.tank = quiet("tank");
  w.copter = quiet("copter");
  w.boss = quiet("boss");
  w.fuel = quiet("fuel");
  w.weap = quiet("weap");
  w.copilot = quiet("copilot");
  const mods = (list: unknown[]): Module[] => list.filter((x) => !String(x).startsWith("(no ")) as Module[];
  w.frameList = mods([w.bike, w.jeep, w.tank, w.copter, w.boss, w.fuel, w.weap, pyro, w.copilot]);
  w.shiftList = mods([pyro, w.bike, w.jeep, w.tank, w.copter, w.boss, w.fuel, w.weap, hud, w.copilot]);
  w.targetList = [w.jeep, w.tank, w.copter, w.boss, w.bike, w.fuel, w.weap, pyro.craftTargets, pyro.wreckTargets].filter((x) => !String(x).startsWith("(no "));
  w.hitList = [w.bike, w.tank, w.copter, w.boss, w.jeep, w.fuel, w.weap].filter((x) => !String(x).startsWith("(no "));
  w.resetList = mods([pyro, w.bike, w.jeep, w.tank, w.copter, w.boss, w.fuel, w.weap]);
  for (const r of w.resetList) r.reset();
  w.copilot.reset();
  return hud;
}

const readContainerBank = (data: Uint8Array): Uint8Array[] => readContainerFile(data).containers.map((c) => c.data);
