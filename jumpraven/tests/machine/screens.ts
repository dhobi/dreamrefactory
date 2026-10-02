/**
 * The screens between the flights, drawn (`draws: true`): the other suites
 * follow the game with its pictures never decoded, so this one plays the
 * screens once with the drawing on and checks the window's pixels — each
 * picture of the rip where RAVEN.EXE put it, each number written where it
 * wrote it — and the buttons those suites never press.
 *
 *   - the Mart (0x410c29): the grid's icons, SORRY! OUT OF STOCK where a
 *     weapon is out, the player's own row, CASH and VALUE; one of the player's
 *     own selected is framed and SELL is up; SELL pays its worth; BUY with too
 *     little cash is the dealer's line 14 and no weapon; INFO and a double
 *     click play the weapon's film (0x41119a) and the screen comes back
 *   - COPILOT SELECTION (0x418f7b): ON ASSIGNMENT over each pilot away, the
 *     chosen framed; INTERVIEW is their talk and PROFILE their film
 *   - the music (0x414ec8): the band framed; INFO is its film
 *   - the repair bay (0x420318): each system out lit, the others WORKS, the
 *     cash; REPAIR short of cash is line 0xe, with it the system mended and a
 *     thank-you; INFO and a double click are the system's film
 *   - the damage and the accuracy (0x408a8d, 0x401118): the bounties and the
 *     percentages written, LEVEL BONUS shown at 60%
 *   - the high scores (0x420964): a score that belongs is asked a name for
 *     (DLOG2), written in its place, and RAVEN.SCO kept; QUIT ends the game
 *
 *   npm test -w jumpraven -- screens
 */
import { test } from "vitest";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import { textWidth } from "@dreamfactory/engine/v0/font";
import { DIFFICULTY_NAMES, SCORES_INK, SCORE_BUTTONS } from "../../src/game/data";
import { BANDS, DEFAULT_BAND, bandRect } from "../../src/game/music";
import { OWN, PRICES, cell, worth } from "../../src/game/mart";
import { PILOTS, portrait } from "../../src/game/pilots";
import { anchored } from "../../src/game/screens";
import { AMMO_FULL, newTally } from "../../src/game/records";
import { readPictures } from "../../src/game/combat/world";
import type { Hud } from "../../src/game/combat/hud";
import { fail, haveRip, ok, pass, start } from "./harness";
import { framed, pictures, shows, showsAt, wrote } from "./pixels";

const mid = (r: Rect): { x: number; y: number } => ({ x: (r[1] + r[3]) >> 1, y: (r[0] + r[2]) >> 1 });
/** the Mart's right panel, drawn from x 0x7a (0x41067c) */
const PANEL_LEFT = 0x7a;
const PANEL: Rect = [0, PANEL_LEFT, 384, 512];
/** CASH and VALUE on it (0x410731), and their inks */
const CASH: Rect = [0x118, 0x4e, 0x127, 0xa1];
const VALUE: Rect = [0x118, 0x10c, 0x127, 0x15f];
/** the frames' ink, on every screen here (0x410eac, 0x418f7b, 0x414ec8, 0x420318) */
const FRAME_INK = 0x28;
/** the debrief's figures' ink (src/game/debrief.ts) */
const INK = 0x19;

test.skipIf(!haveRip())("screens", async () => {
  // ---- day one's screens, from its first briefing ------------------------------
  {
    const records = { score: 100, tier: [1, 0, 0, 0, 0, 0], ammo: [AMMO_FULL / 2, 0, 0, 0, 0, 0] };
    const { game, m, until, click, key } = start({ draws: true, start: { level: 2, records } });
    const s = m.screen;
    const font = () => m.font!;
    const skip = (): void => void ((m.film || game.talkState.talk) && m.ticks % 10 === 0 && key("Escape"));
    /** a click, and the ticks for the screen to take it */
    const press = (p: { x: number; y: number }, done: () => boolean, what: string): void => {
      click(p.x, p.y);
      until(what, done, 2_000);
    };
    /** the film a button asked for, skipped, and the screen it played over again */
    const film = (name: string, back: () => boolean): void => {
      until(name, () => m.film === name, 2_000);
      key("Escape");
      until(`back from ${name}`, () => m.film === null && back(), 2_000);
    };

    // the Mart
    until("the Mart", () => (skip(), game.screen === "mart" && m.film === null));
    const mart = game.martScreen!;
    const stock = game.mart!.stock;
    const mp = pictures(m, "mart", 1);
    const grid = (): string[] => {
      const bad: string[] = [];
      for (let tier = 0; tier < 4; tier++) {
        for (let kind = 0; kind < 6; kind++) {
          const [t, l] = cell(tier, kind);
          // the cells are 0x3f apart and 0x40 square, so the next one over and the one below cover a cell's last
          // column and row, and a selection's frame is 2 pixels inside a cell's edge: the inside of each is checked
          if (shows(s, mp[stock[tier][kind] ? 6 + 6 * tier + kind : 30], t, l, [t + 2, l + 2, t + 0x3d, l + 0x3d]) !== 1) bad.push(`${tier}/${kind}`);
        }
      }
      return bad;
    };
    const wrongCells = grid();
    if (wrongCells.length) fail(`the Mart's grid: cells ${wrongCells.join(" ")} not their icon or SORRY! OUT OF STOCK`);
    const [ot, ol] = cell(OWN, 0);
    if (shows(s, mp[6 + 6 * 1 + 0], ot, ol, PANEL) !== 1) fail("the player's second-tier lasers are not in their own row");
    const cashAt = (r: Rect): [number, number] => [r[1] + PANEL_LEFT + 3, r[0] + 14];
    if (!wrote(s, font(), ...cashAt(CASH), "100", 0x19)) fail("CASH does not say 100");
    ok(`the Mart drawn: the grid's ${24 - stock.flat().filter(Boolean).length} out of stock among the icons, the lasers in the own row, CASH 100`);

    // one of the player's own: framed, SELL up, VALUE its worth; SELL pays it
    const value = worth(game.records, 0);
    press(mid(cell(OWN, 0)), () => game.mart?.selected?.tier === OWN, "the lasers selected");
    if (!framed(s, cell(OWN, 0), 2, FRAME_INK)) fail("the selected lasers are not framed in 0x28");
    if (showsAt(s, mp[2], 0, 0) !== 1) fail("SELL is not up with one of the player's own selected");
    if (!wrote(s, font(), ...cashAt(VALUE), String(value), 0x28)) fail(`VALUE does not say ${value}`);
    press(mid(mart.targets().buy), () => game.records.ammo[0] === 0, "SELL");
    if (game.records.score !== 100 + value) fail(`SELL paid ${game.records.score - 100}, not the lasers' worth ${value}`);
    if (!wrote(s, font(), ...cashAt(CASH), String(100 + value), 0x19)) fail(`CASH does not say ${100 + value} after SELL`);
    ok(`SELL: the lasers framed with SELL up and VALUE ${value}, sold for it, CASH ${game.records.score}`);

    // BUY with too little: the dealer's line 14, and nothing bought
    const dear = stock[3].findIndex((x) => x);
    press(mid(cell(3, dear)), () => game.mart?.selected?.tier === 3, "a fourth-tier weapon selected");
    if (!framed(s, cell(3, dear), 2, FRAME_INK) || showsAt(s, mp[1], 0, 0) !== 1) fail("the weapon in stock is not framed with BUY up");
    if (!wrote(s, font(), ...cashAt(VALUE), String(PRICES[dear][3]), 0x28)) fail(`VALUE does not say its price ${PRICES[dear][3]}`);
    // the dealer's hello (line 9) outranks line 14 (0x4142b9): BUY once he is quiet
    until("the dealer quiet", () => game.comms.spoken.includes("2:9") && game.comms.talking() === -1, 2_000);
    press(mid(mart.targets().buy), () => game.comms.spoken.includes("2:14"), "the dealer's NO CASH");
    if (game.records.ammo[dear] !== 0 || game.records.score !== 100 + value) fail("BUY short of cash bought it");
    ok(`BUY at ${PRICES[dear][3]} with ${game.records.score}: the dealer's line 14, nothing bought`);

    // INFO, and a double click: the weapon's film, then the screen again
    const films = ["laser", "gun", "rock", "miss", "bomb", "def"];
    press(mid(anchored(mp[3])), () => m.film !== null, "INFO");
    film(`${films[dear]}4.move`, () => game.screen === "mart");
    const cheap = stock[0].findIndex((x) => x);
    click(mid(cell(0, cheap)).x, mid(cell(0, cheap)).y);
    until("selected", () => game.mart?.selected?.tier === 0, 100);
    click(mid(cell(0, cheap)).x, mid(cell(0, cheap)).y);
    film(`${films[cheap]}1.move`, () => game.screen === "mart");
    if (grid().length || !framed(s, cell(0, cheap), 2, FRAME_INK)) fail(`the Mart was not drawn again after the film: ${grid()}`);
    ok(`INFO plays ${films[dear]}4.move, a double click ${films[cheap]}1.move, and the Mart is drawn again after each`);
    press(mid(mart.targets().cont), () => game.screen !== "mart", "CONTINUE");

    // COPILOT SELECTION
    until("the pilots", () => (skip(), game.screen === "pilots" && m.film === null));
    const pp = pictures(m, "pilot", 1);
    const here = game.pilots!.here;
    for (let k = 0; k < 6; k++) {
      const [t, l] = portrait(k);
      if (!here[k] && shows(s, pp[6], t + 2, l + 2) !== 1) fail(`${PILOTS[k]} is away without ON ASSIGNMENT over them`);
    }
    if (!framed(s, portrait(game.records.pilot), 2, FRAME_INK)) fail(`the chosen, ${PILOTS[game.records.pilot]}, is not framed`);
    const pick = here.findIndex((h, k) => h && k !== game.records.pilot);
    press(mid(portrait(pick)), () => game.records.pilot === pick, "a pilot picked");
    if (!framed(s, portrait(pick), 2, FRAME_INK)) fail(`${PILOTS[pick]} picked is not framed`);
    ok(`COPILOT SELECTION drawn: ON ASSIGNMENT over ${here.map((h, k) => (h ? "" : PILOTS[k])).filter(Boolean).join(" and ")}, ${PILOTS[pick]} framed when picked`);
    press(mid(anchored(pp[1])), () => game.talkState.talk !== null, "INTERVIEW");
    if (game.talkState.talk!.file !== `SHARED/${PILOTS[pick].toUpperCase()}.PUP`) fail(`INTERVIEW talks ${game.talkState.talk!.file}`);
    key("Escape");
    until("back from the interview", () => game.talkState.talk === null && framed(s, portrait(pick), 2, FRAME_INK), 2_000);
    press(mid(anchored(pp[2])), () => m.film !== null, "PROFILE");
    film(`${PILOTS[pick]}.move`, () => framed(s, portrait(pick), 2, FRAME_INK));
    ok(`INTERVIEW is SHARED/${PILOTS[pick].toUpperCase()}.PUP and PROFILE ${PILOTS[pick]}.move, the screen drawn again after each`);
    press(mid(anchored(pp[3])), () => game.screen !== "pilots", "CONTINUE");

    // the music
    until("the music", () => (skip(), game.screen === "music" && m.film === null));
    const up = pictures(m, "music", 1);
    if (!framed(s, bandRect(DEFAULT_BAND), 2, FRAME_INK) || showsAt(s, up[1], 0, 0) !== 1) fail("the music: the band not framed, or INFO not up");
    press(mid(anchored(up[1])), () => m.film !== null, "INFO");
    film(`${BANDS[DEFAULT_BAND]}.move`, () => framed(s, bandRect(DEFAULT_BAND), 2, FRAME_INK));
    ok(`the music drawn, ${BANDS[DEFAULT_BAND]} framed; INFO plays ${BANDS[DEFAULT_BAND]}.move and the screen comes back`);
    press(mid(anchored(up[2])), () => game.screen !== "music", "CONTINUE");
  }

  // ---- the repair bay, landed at in day one's flight -----------------------------
  {
    const { game, m, until, click, key } = start({ draws: true, start: { level: 3, records: { score: 0x50 } } });
    const s = m.screen;
    until("the flight", () => game.world !== null);
    // four systems knocked out, and the craft on the bay's beacon (0x418254)
    Object.assign(game.hudState, { videoOut: 1, radarOut: 1, directionOut: 1, distanceOut: 1 });
    (game.world!.hud as unknown as Hud).bay = true;
    until("rbay.move", () => m.film === "rbay.move");
    key("Escape");
    until("the bay", () => game.screen === "rbay" && m.film === null);
    const bay = game.bay!;
    const rp = readPictures(m.files.get(m.resolve("rbay", 1)!)!);
    const t = bay.targets();
    const lit = t.systems.map((sys, k) => {
      const [v, h] = [sys.slot[0], sys.slot[1]];
      return showsAt(s, rp[sys.out ? 6 + k : 5]!, v, h) === 1;
    });
    if (lit.some((x) => !x)) fail(`the bay's panel: ${t.systems.map((x, k) => `${x.name} ${x.out ? "out" : "works"} ${lit[k] ? "drawn" : "WRONG"}`).join(", ")}`);
    const cash = (n: number): boolean => wrote(s, m.font!, 0x63 + 3, 0x15a + 0xe, String(n), 0x19);
    if (!cash(0x50)) fail("the bay's cash does not say 80");
    ok(`the bay drawn: ${t.systems.filter((x) => x.out).map((x) => x.name).join(", ")} lit, the shields and the engines WORKS, cash 80`);

    const video = t.systems[0];
    click(mid(video.slot).x, mid(video.slot).y);
    until("the video chosen", () => bay.state.chosen === 0, 100);
    if (!framed(s, video.slot, 2, FRAME_INK)) fail("the video chosen is not framed");
    // the bay's welcome (line 9) outranks line 0xe: REPAIR once it is quiet
    until("the bay quiet", () => game.comms.spoken.includes("3:9") && game.comms.talking() === -1, 2_000);
    click(mid(t.repair).x, mid(t.repair).y);
    until("REPAIR short of cash", () => game.comms.spoken.includes("3:14"), 2_000);
    if (!game.hudState.videoOut) fail("REPAIR mended the video on $80 of $95");
    ok("REPAIR on $80 of the video's $95: the bay's line 0xe, still out");

    // INFO and a double click: the system's film
    click(mid(video.slot).x, mid(video.slot).y);
    until("chosen", () => bay.state.chosen === 0, 100);
    const info = anchored(rp[2]!);
    click(mid(info).x, mid(info).y);
    until("video.move", () => m.film === "video.move", 2_000);
    key("Escape");
    until("back", () => m.film === null, 2_000);
    for (let n = 0; n < 2; n++) {
      click(mid(t.systems[1].slot).x, mid(t.systems[1].slot).y);
      until("the radar chosen", () => bay.state.chosen === 1, 100);
    }
    until("radar.move", () => m.film === "radar.move", 2_000);
    key("Escape");
    until("back", () => m.film === null, 2_000);
    ok("INFO plays the chosen video's video.move, a double click the radar's radar.move");

    // with the cash: each mended, a thank-you, the cash written down
    game.records.score = 1000;
    const thanks = (): number => game.comms.spoken.filter((x) => ["3:11", "3:12", "3:13"].includes(x)).length;
    for (const k of [0, 1, 3, 4]) {
      click(mid(t.systems[k].slot).x, mid(t.systems[k].slot).y);
      until(`${t.systems[k].name} chosen`, () => bay.state.chosen === k, 100);
      // 0x42077c: no thank-you over the bay's own talk
      until("the bay quiet", () => game.comms.talking() === -1, 2_000);
      click(mid(t.repair).x, mid(t.repair).y);
      until(`${t.systems[k].name} mended`, () => bay.state.chosen === -1, 100);
    }
    const left = 1000 - [0, 1, 3, 4].reduce((n, k) => n + t.systems[k].cost, 0);
    const h = game.hudState;
    if (h.videoOut || h.radarOut || h.directionOut || h.distanceOut) fail(`not all mended: ${JSON.stringify({ v: h.videoOut, r: h.radarOut, d: h.directionOut, x: h.distanceOut })}`);
    if (game.records.score !== left || !cash(left)) fail(`cash ${game.records.score} after the repairs, not ${left} written`);
    until("the fourth thank-you", () => thanks() === 4, 100);
    const said = game.comms.spoken.filter((x) => ["3:11", "3:12", "3:13"].includes(x));
    if (said.some((x, i) => i > 0 && x === said[i - 1])) fail(`the same thank-you twice running: ${said.join(" ")}`);
    if (!bay.targets().systems.every((x, k) => showsAt(s, rp[5]!, x.slot[0], x.slot[1]) === 1 || k === 2 || k === 5)) fail("a mended system is not WORKS");
    ok(`REPAIR with the cash: the video, the radar, the direction and the distance mended for ${1000 - left}, cash ${left}, a thank-you each (${said.join(" ")}), none twice running`);
    click(mid(t.cont).x, mid(t.cont).y);
    until("back in the flight", () => game.screen === null && game.bay === null, 2_000);
  }

  // ---- the damage and the accuracy, on the way back from day one -----------------
  {
    const tally = newTally();
    tally.kills = { jeep: 3, bike: 1, tank: 2, copter: 0 };
    tally.shots = [8, 2, 0, 0, 0, 0];
    tally.hits = [6, 1, 0, 0, 0, 0];
    tally.copilotShots = [4, 0, 0, 0, 0, 0];
    tally.copilotHits = [3, 0, 0, 0, 0, 0];
    const { game, m, until, click, key } = start({ draws: true, start: { level: 4, records: { tally, score: 500 } } });
    const s = m.screen;
    const skip = (): void => void ((m.film || game.talkState.talk) && m.ticks % 10 === 0 && key("Escape"));
    until("the damage", () => (skip(), game.screen === "damage" && m.film === null));
    const lines = [
      [0x46, 0xa1, "1 X $15 = $15"],
      [0x12e, 0xa1, "3 X $25 = $75"],
      [0x46, 0x13e, "2 X $55 = $110"],
      [0x12e, 0x13e, "0 X $35 = $0"],
    ] as const;
    const missing = lines.filter(([x, y, text]) => !wrote(s, m.font!, x, y, text, INK));
    if (missing.length) fail(`the damage screen's bounties not written: ${missing.map((l) => l[2]).join(", ")}`);
    ok(`the damage drawn: ${lines.map((l) => l[2]).join(", ")}`);
    click(8 + 50, 329 + 16);
    until("the accuracy", () => (skip(), game.screen === "accuracy" && m.film === null));
    // 7 of 10 the player's, 3 of 4 the copilot's: 10 of 14 is 71%, and the bonus
    const want = [
      [0x12c, 0x64, "75"],
      [0x12c + 0x2a, 0x64, "50"],
      [0x12c, 0xdc, "75"],
      [0x86, 0x64, "70"],
      [0x86, 0xdc, "75"],
      [0xaa, 0x109, "71"],
      [0x1c2, 0x109, "500"],
      [0x1c2, 0x140, "1000"],
      [0x1c2, 0x15e, "1500"],
    ] as const;
    const wrong = want.filter(([x, y, text]) => !wrote(s, m.font!, x, y, text, INK));
    if (wrong.length) fail(`the accuracy screen: ${wrong.map((w) => w[2]).join(", ")} not written`);
    const ap = pictures(m, "accuracy", 2);
    if (showsAt(s, ap[2], 0, 0) !== 1) fail("LEVEL BONUS not shown at 71%");
    ok(`the accuracy drawn: lasers 75%, shells 50%, the copilot 75%, the day 71%, LEVEL BONUS and 500 + 1000 = 1500`);
    click(8 + 50, 329 + 16);
    until("the bonus paid", () => game.records.score === 1500 && game.screen === null);
  }

  // ---- the high scores, with a score that belongs on them ------------------------
  {
    let kept: Uint8Array | null = null;
    const { game, m, until, click } = start({
      draws: true,
      start: { level: 1, records: { score: 999_999 } },
      askName: (done) => done("RAVEN TEST"),
      keepSco: (bytes) => void (kept = bytes),
    });
    const s = m.screen;
    until("the high scores", () => game.phase === "scores" && game.titleUp);
    if (!kept) fail("RAVEN.SCO was not kept after the name");
    const places = game.sco.places[game.difficulty - 1];
    if (places[0].name !== "RAVEN TEST" || places[0].score !== 999_999) fail(`the first place is ${JSON.stringify(places[0])}`);
    const font = m.font!;
    const heading = DIFFICULTY_NAMES[game.difficulty - 1];
    if (!wrote(s, font, 0x7d - (textWidth(font, heading) >> 1), 0x7c, heading, SCORES_INK)) fail(`"${heading}" not written over the places`);
    if (!wrote(s, font, 0x1d, 0x90, "RAVEN TEST", SCORES_INK) || !wrote(s, font, 0xcb - textWidth(font, "999999"), 0x90, "999999", SCORES_INK)) fail("the new first place is not written, its score right-aligned");
    const last = places.at(-1)!;
    const y = 0x90 + (places.length - 1) * 0x11;
    const lastScore = String(last.score);
    if (!wrote(s, font, 0xcb - textWidth(font, lastScore), y, lastScore, SCORES_INK)) fail(`the last place's ${lastScore} is not written`);
    ok(`a high score: DLOG2's name first of ${heading}'s ${places.length} places, written with its score right-aligned; RAVEN.SCO kept`);
    const quit = mid(SCORE_BUTTONS.find((b) => b.what === "quit")!.rect);
    click(quit.x, quit.y);
    until("QUIT", () => game.phase === "quit", 2_000);
    if (game.tick()) fail("the machine ran on after QUIT");
    ok(`QUIT ends the game: "${game.stopped}"`);
  }
  pass("screens");
});
