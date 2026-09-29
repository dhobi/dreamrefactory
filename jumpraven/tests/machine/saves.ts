/**
 * The saved games, `.RVN` (src/game/rvn.ts): the HUD's SAVE in a flight
 * writes the record (0x4218a8) and the flight goes on; the file read back
 * writes the same bytes; opened before the run (0x422489) it is the game
 * the run starts at, with no intro; opened by File ▸ Open on the high scores
 * screen (0x4222fb(2), 0x421199) it is the file's level, its records and its
 * pilot.
 *
 *   npx tsx tests/machine/saves.ts        (from jumpraven/)
 */
import { PILOTS } from "../../src/game/pilots";
import { readRvn, RVN_SIZE, writeRvn } from "../../src/game/rvn";
import { fail, ok, pass, start } from "./harness";

const records = { score: 4321, pilot: 2, lives: 3, tier: [2, 1, 0, 0, 1, 0], ammo: [0x4380, 0x1000, 0, 0, 0x200, 0] };

// a flight, and its SAVE
let saved: { bytes: Uint8Array; name: string } | null = null;
{
  const a = start({ start: { level: 5, difficulty: 3, records }, saver: (bytes, name, done) => ((saved = { bytes, name }), done()) });
  a.until("day two's flight", () => a.game.world !== null);
  const hud = a.game.world!.hud as unknown as { menuButton(k: number): { x: number; y: number } };
  const p = hud.menuButton(0);
  a.click(p.x, p.y);
  a.until("SAVE", () => saved !== null);
  a.until("the button up again", () => a.game.world?.hud.menu() === -1);
  if (!a.game.world) fail("the flight did not go on after SAVE");
  const s = saved!;
  if (s.bytes.length !== RVN_SIZE || s.name !== "Day 2") fail(`saved ${s.bytes.length} bytes as ${s.name}`);
  const r = readRvn(s.bytes);
  const want = { difficulty: 3, level: 5, pilot: 2, score: 4321, lives: 3, tier: "2,1,0,0,1,0", ammo: "17280,4096,0,0,512,0" };
  const got = { difficulty: r.difficulty, level: r.level, pilot: r.pilot, score: r.records.score, lives: r.records.lives, tier: String(r.records.tier), ammo: String(r.records.ammo) };
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`the record read back ${JSON.stringify(got)}`);
  if (String(writeRvn(r)) !== String(s.bytes)) fail("the record read and written again is not the same bytes");
  ok(`the HUD's SAVE: ${RVN_SIZE} bytes as "${s.name}", level 5, Advanced, ${PILOTS[2]}, the flight on after it`);
}
const bytes = saved!.bytes;

// opened before the run: the game starts at the file's level
{
  const b = start();
  if (!b.game.canOpen) fail("File ▸ Open refused before the run");
  b.game.openGame(bytes);
  b.until("the saved game's flight", () => b.game.world !== null);
  const g = b.game;
  if (g.level !== 5 || g.difficulty !== 3 || g.records.score !== 4321 || g.records.pilot !== 2 || g.records.lives !== 3) {
    fail(`opened at level ${g.level}, difficulty ${g.difficulty}, cash ${g.records.score}, pilot ${g.records.pilot}, lives ${g.records.lives}`);
  }
  if (g.played.includes("intro.move")) fail(`the intro played first: ${g.played.join(", ")}`);
  if (!/CHABLIS\.MUP$/.test(g.comms.headFile(0) ?? "")) fail(`the comms box's pilot is ${g.comms.headFile(0)}`);
  ok(`opened before the run: straight to level 5's flight, no intro, ${PILOTS[2]} in the comms box`);
}

// File ▸ Open on the high scores screen
{
  const c = start();
  const skip = (): void => void ((c.m.film || c.game.talkState.talk) && c.m.ticks % 20 === 0 && c.key("Escape"));
  c.until("the high scores screen", () => (skip(), c.game.phase === "scores" && c.game.titleUp));
  if (c.game.command(202)) fail("File ▸ Open was not left to the page's dialog");
  if (!c.game.canOpen) fail("File ▸ Open refused on the high scores screen");
  c.game.openGame(bytes);
  c.until("the saved game's flight", () => c.game.world !== null);
  if (c.game.level !== 5 || c.game.records.score !== 4321 || c.game.titleUp) fail(`opened at level ${c.game.level}, cash ${c.game.records.score}, bar ${c.game.titleUp}`);
  if (c.game.canOpen) fail("File ▸ Open was still taken in a flight");
  ok("File ▸ Open on the high scores screen: level 5's flight, the bar down, Open refused in it");
}
pass("saves");
