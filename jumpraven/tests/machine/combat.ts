/**
 * Day one's combat (RAVEN.EXE 0x40b190 with its modules, src/game/combat/):
 * the enemies come in and fire at a craft sitting still (the shields go
 * down), and a jeep in the view, clicked on with the lasers chosen, is shot
 * until it blows up — paid for (0x19) and counted in the tally the damage
 * screen reads.
 *
 *   npx tsx tests/machine/combat.ts        (from jumpraven/)
 */
import { AMMO_FULL } from "../../src/game/records";
import { KIND } from "../../src/game/combat/world";
import { fail, ok, pass, start } from "./harness";

const { game, m, until, click } = start({ start: { level: 3, records: { ammo: [AMMO_FULL, 0, 0, 0, 0, 0] } } });
until("the flight", () => game.world !== null);
const w = game.world!;
w.hud.choose(0);
const shields0 = game.records.bars[0];

/**
 * The first jeep ahead in the craft's own street (the view shows no other:
 * the blocks hide them), and the window's point to click to hit it. A
 * straight shot turns a sixth of a pixel and pitches a seventh of one from
 * the craft's own picture to the pointer (0x419fd8), so the point is worked
 * back from the heading and the pitch from the craft to the jeep.
 */
const jeepInView = (): { x: number; y: number } | null => {
  const n = w.targetCount();
  for (let k = 0; k < n; k++) {
    const t = w.target(k);
    if (t.kind !== KIND.jeep || t.dying) continue;
    const street = w.cam.angle === 0x40 || w.cam.angle === 0xc0 ? t.obj.x >> 8 === w.cam.x >> 8 : t.obj.y >> 8 === w.cam.y >> 8;
    const p = w.project(t.obj);
    if (!street || p.depth < 0x140) continue;
    const c = w.project(w.cam);
    const dx = t.obj.x - w.cam.x;
    const dy = t.obj.y - w.cam.y;
    const dz = t.obj.z + 0x10 - w.cam.z;
    const turn = Math.round((Math.atan2(dy, dx) * 128) / Math.PI) - w.cam.angle;
    const pitch = Math.round((Math.atan2(dz, Math.hypot(dx, dy)) * 128) / Math.PI);
    const x = c.x + 6 * (((turn + 0x180) & 0xff) - 0x80);
    const y = c.y - 7 * pitch;
    if (x < 0 || x >= 0x100 || y < 0 || y >= 0x136) continue;
    return { x: x + 0x80, y: y + 0x0b };
  }
  return null;
};

until("a jeep in the view", () => jeepInView() !== null, 60_000);
ok(`a jeep in the view at tick ${m.ticks}; ${w.targetCount()} targets up`);
const t0 = m.ticks;
until(
  "the jeep shot",
  () => {
    if (game.records.tally.kills.jeep > 0) return true;
    const at = jeepInView();
    if (at && m.ticks % 6 === 0) click(at.x, at.y);
    return false;
  },
  30_000,
);
if (game.records.score !== 1000 + 0x19) fail(`the kill paid ${game.records.score - 1000}, not 0x19`);
if (game.records.tally.shots[0] <= 0 || game.records.tally.hits[0] <= 0) fail(`lasers ${game.records.tally.shots[0]} shots, ${game.records.tally.hits[0]} hits`);
ok(`a jeep shot in ${m.ticks - t0} ticks: ${game.records.tally.shots[0]} laser shots, ${game.records.tally.hits[0]} hits, cash ${game.records.score}`);
if (game.records.bars[0] >= shields0) fail(`the shields never went down (${game.records.bars[0]})`);
ok(`the shields ${shields0} → ${game.records.bars[0]} under fire`);
pass("combat");
