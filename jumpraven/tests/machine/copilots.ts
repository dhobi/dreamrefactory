/**
 * Each of the six copilots at the controls (RAVEN.EXE 0x404d26, 0x4051a4,
 * 0x405b6b, 0x406040): with NAVIGATION, HOVER CONTROL and ARMS CONTROL on,
 * the copilot flies the city, holds HOVER and fires on what it finds — and
 * every shot it fires and hits is the copilot's in the tally, none the
 * player's. The tiers differ by pilot, so that between them every tier of
 * every weapon is fired from the copilot's hand.
 *
 *   npm test -w jumpraven -- copilots
 */
import { test } from "vitest";
import { AMMO_FULL } from "../../src/game/core/records";
import { PILOTS } from "../../src/game/pilots";
import { fail, haveRip, ok, pass, start } from "./harness";

/** each pilot's tiers, lasers … defensive */
const TIERS = [
  [0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2, 2],
  [3, 3, 3, 3, 3, 3],
  [3, 2, 3, 3, 2, 1],
  [1, 3, 2, 1, 3, 0],
];

test.skipIf(!haveRip())("copilots", async () => {
  for (let pilot = 0; pilot < 6; pilot++) {
    const { game, until } = start({
      seed: 1994 + pilot,
      start: { level: 2 * (pilot % 3) + 3, records: { pilot, lives: 4, ammo: Array(6).fill(AMMO_FULL), tier: TIERS[pilot] } },
    });
    until("the flight", () => game.world !== null);
    const w = game.world!;
    const hud = w.hud as unknown as { copilotButton(k: number): { x: number; y: number } };
    for (const k of [0, 1, 2]) {
      const p = hud.copilotButton(k);
      game.m.events.push({ kind: "down", x: p.x, y: p.y }, { kind: "up", x: p.x, y: p.y });
      for (let i = 0; i < 8; i++) game.tick();
    }
    const [nav, hover, arms] = w.hud.x417617();
    if (!nav || !hover || !arms) fail(`${PILOTS[pilot]}: the copilot buttons ${nav} ${hover} ${arms}`);
    const t = game.records.tally;
    for (let i = 0; i < 6000 && game.world && w.state > 0; i++) {
      game.tick();
      // keep the craft whole and fuelled, so the run is all copilot
      game.records.bars[0] = AMMO_FULL;
      game.records.bars[2] = AMMO_FULL;
    }
    const shots = t.copilotShots.reduce((a, b) => a + b, 0);
    const hits = t.copilotHits.reduce((a, b) => a + b, 0);
    if (!shots) fail(`${PILOTS[pilot]} fired nothing`);
    if (t.shots.some((n) => n) || t.hits.some((n) => n)) fail(`${PILOTS[pilot]}'s fire was counted as the player's: ${t.shots.join(",")}`);
    ok(`${PILOTS[pilot]} at the controls, day ${(game.level - 1) >> 1}: ${shots} shots (${t.copilotShots.join(",")}), ${hits} hits, all the copilot's`);
  }
  pass("copilots");
});
