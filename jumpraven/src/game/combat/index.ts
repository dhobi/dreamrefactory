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

 */
import { readContainerFile } from "@dreamfactory/engine/df/container";
import type { Co, Machine } from "../machine";
import type { Comms } from "../comms";
import type { Module } from "./world";
import { World, readPictures } from "./world";
import { Hud, type HudState } from "./hud";
import { Pyro } from "./pyro";
import { Jeep } from "./jeep";
import { Tank } from "./tank";
import { Bike } from "./bike";
import { Copter } from "./copter";
import { Boss } from "./boss";
import { Fuel } from "./fuel";
import { Weap } from "./weap";
import { Copilot } from "./copilot";

/** the band's bank by `[0x43b304]` (0x40ba15) */
export const BANKS = ["hiphop", "tek", "grunge", "metal"];

export function* assemble(m: Machine, w: World, band: number, comms: Comms, hudState: HudState): Co<Hud> {
  const day = w.day;
  const file = function* (name: string): Co<Uint8Array> {
    return (yield* m.file(name, day)).data;
  };
  // 0x422ef6: the band's bank — its sounds, and its pieces strung into the
  // flight's theme tune, which 0x4233ba plays round and round (game.ts)
  const bankName = BANKS[band] ?? BANKS[1];
  const bank = readContainerBank(yield* file(bankName));
  w.setBank(bank);
  m.setAmbience(bankName, bank);
  w.comms = comms;
  const pyro = new Pyro(w, yield* file("play"), yield* file("pyro"));
  const hud = new Hud(w, readPictures(yield* file("panel")), comms, hudState);
  w.pyro = pyro;
  w.hud = hud;
  w.bike = new Bike(w, yield* file("bike"));
  w.jeep = new Jeep(w, yield* file("jeep"));
  w.tank = new Tank(w, yield* file("tank"));
  w.copter = new Copter(w, yield* file("copt"));
  w.boss = new Boss(w, yield* file("boss"));
  w.fuel = new Fuel(w, yield* file("fuel"));
  w.weap = new Weap(w, yield* file("weap"));
  w.copilot = new Copilot(w);
  const mods = (list: unknown[]): Module[] => list as Module[];
  w.frameList = mods([w.bike, w.jeep, w.tank, w.copter, w.boss, w.fuel, w.weap, pyro, w.copilot]);
  w.shiftList = mods([pyro, w.bike, w.jeep, w.tank, w.copter, w.boss, w.fuel, w.weap, hud, w.copilot]);
  w.targetList = [w.jeep, w.tank, w.copter, w.boss, w.bike, w.fuel, w.weap, pyro.craftTargets, pyro.wreckTargets];
  w.hitList = [w.bike, w.tank, w.copter, w.boss, w.jeep, w.fuel, w.weap];
  w.resetList = mods([pyro, w.bike, w.jeep, w.tank, w.copter, w.boss, w.fuel, w.weap]);
  for (const r of w.resetList) r.reset();
  w.copilot.reset();
  return hud;
}

const readContainerBank = (data: Uint8Array): Uint8Array[] => readContainerFile(data).containers.map((c) => c.data);
