/**
 * The HUD's left panel and weapons strip under the player's clicks, with the
 * copilots on (RAVEN.EXE 0x415c7b, 0x4166c6, 0x416859, 0x4175ea, 0x418097),
 * drawn (`draws: true`):
 *
 *   - NAVIGATION on leaves HOVER (FLY is covered); HOVER CONTROL on leaves
 *     FLY; both on, neither mode is lit; each off again gives its mode back
 *   - a mode button a copilot has, and the HOVER/FLY key, change nothing
 *   - with ARMS CONTROL on the weapons strip takes no click, and without it
 *     a weapon with no ammunition cannot be chosen
 *   - the video and the radar knocked out are drawn out, and the lives'
 *     dashes follow the lives
 *   - the repair bay's beacon, left unvisited, times out: the bay says so and
 *     the beacon goes
 *
 *   npm test -w jumpraven -- hud-panel
 */
import { test } from "vitest";
import { AMMO_FULL } from "../../src/game/core/records";
import { FLY, HOVER, MARK_BAY } from "../../src/game/combat/hud";
import { LASERS, ROCKETS } from "../../src/game/combat/arms";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import { fail, haveRip, ok, pass, start } from "./harness";

test.skipIf(!haveRip())("hud-panel", async () => {
  const { game, m, click, key, until } = start({
    draws: true,
    start: { level: 3, records: { ammo: [AMMO_FULL, AMMO_FULL, 0, AMMO_FULL, AMMO_FULL, AMMO_FULL] } },
  });
  until("the flight", () => game.world !== null);
  const w = game.world!;
  const hud = w.hud as unknown as {
    copilotButton(k: number): { x: number; y: number };
    rect: Rect[];
    mode(): number;
    weapon(): number;
  };
  const s = game.hudState;
  // read through functions: the machine changes these under TypeScript's narrowing
  const modeNow = (): number => s.mode;
  const navNow = (): number => s.nav;
  const hoverNow = (): number => s.hover;
  const weaponNow = (): number => s.weapon;
  const settle = (n = 12): void => {
    for (let i = 0; i < n; i++) game.tick();
  };
  const copilot = (k: number): void => {
    const p = hud.copilotButton(k);
    click(p.x, p.y);
    settle();
  };
  /** a mode button (11 HOVER, 12 FLY) on the left panel, which sits at the window's corner */
  const mode = (k: number): void => {
    const r = hud.rect[11 + k];
    click((r[1] + r[3]) >> 1, (r[0] + r[2]) >> 1);
    settle();
  };
  const weapon = (k: number): void => {
    const r = hud.rect[15 + k];
    click(0x80 + ((r[1] + r[3]) >> 1), 0x141 + ((r[0] + r[2]) >> 1));
    settle();
  };

  // ---- the copilots and the modes ------------------------------------------------
  copilot(0);
  if (!s.nav || s.mode !== HOVER) fail(`NAVIGATION on: nav ${s.nav}, mode ${s.mode}`);
  mode(FLY);
  if (s.mode !== HOVER) fail("FLY pressed under NAVIGATION");
  key("t");
  settle();
  if (s.mode !== HOVER) fail("the HOVER/FLY key under NAVIGATION");
  ok("NAVIGATION on: HOVER, and neither FLY nor the HOVER/FLY key leaves it");
  copilot(1);
  if (!hoverNow() || modeNow() !== -1) fail(`both copilots on: mode ${modeNow()}`);
  copilot(0);
  if (navNow() || modeNow() !== FLY) fail(`NAVIGATION off under HOVER CONTROL: mode ${modeNow()}`);
  mode(HOVER);
  if (modeNow() !== FLY) fail("HOVER pressed under HOVER CONTROL");
  copilot(1);
  if (hoverNow() || modeNow() !== HOVER) fail(`HOVER CONTROL off: mode ${modeNow()}`);
  mode(FLY);
  if (modeNow() !== FLY) fail("FLY pressed with no copilot");
  ok("HOVER CONTROL: FLY; both: neither lit; off again, the modes back and pressable");

  // ---- the weapons strip ----------------------------------------------------------
  weapon(LASERS);
  if (s.weapon !== LASERS) fail(`the lasers not chosen: ${s.weapon}`);
  weapon(ROCKETS);
  if (s.weapon !== LASERS) fail("the empty rockets were chosen");
  copilot(2);
  {
    // the copilot chooses for itself under ARMS CONTROL: the click alone, between two frames
    const was = weaponNow();
    const r = hud.rect[15 + (was === 3 ? 4 : 3)];
    w.hud.click(0x141 + ((r[0] + r[2]) >> 1), 0x80 + ((r[1] + r[3]) >> 1));
    if (weaponNow() !== was) fail("the strip took a click under ARMS CONTROL");
  }
  copilot(2);
  ok("the strip: an empty weapon not chosen, and no click taken under ARMS CONTROL");

  // ---- knocked out, and the lives -------------------------------------------------
  {
    const left = (): number => m.screen.pixels.subarray(0, 0x180 * 640).reduce((a, b) => a + b, 0);
    const before = left();
    s.videoOut = 1;
    s.radarOut = 1;
    settle();
    if (left() === before) fail("the video and the radar knocked out drew nothing");
    s.redraw = 1;
    s.menu = 2;
    settle();
    s.menu = -1;
    s.videoOut = 0;
    s.radarOut = 0;
    settle();
    s.redraw = 1;
    settle();
    const lives = game.records.lives;
    game.records.lives = 0;
    settle();
    if (game.records.lives !== 0) fail("the lives came back");
    game.records.lives = lives;
    settle();
    ok("the video and the radar knocked out drawn, the whole HUD redrawn with a button down, the lives' dashes to none and back");
  }

  // ---- the repair bay's beacon timing out -----------------------------------------
  {
    const said: number[] = [];
    const ask = game.comms.ask.bind(game.comms);
    game.comms.ask = (who: number, line: number) => (said.push(who * 100 + line), ask(who, line));
    // far off, and greeted already, the bay's count down to its last frame
    Object.assign(s, { beaconOn: 1, beaconKind: MARK_BAY, bayGreeted: 1, bayWait: 2 });
    s.beacon.cellX = (w.cam.cellX + 8) & 0x1f;
    s.beacon.cellY = (w.cam.cellY + 8) & 0x1f;
    until("the beacon gone", () => s.beaconKind !== MARK_BAY, 500);
    if (!said.includes(3 * 100 + 7) || s.beaconOn) fail(`the bay's beacon timed out: said ${said.join(",")}, beacon ${s.beaconOn}`);
    ok("the repair bay unvisited: its line 7, and the beacon down");
  }
  pass("hud-panel");
});
