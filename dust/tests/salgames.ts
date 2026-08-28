/**
 * Dust's saloon games — the two engine contracts SALGAMES.FLT's own scripts
 * are built on, checked by running those scripts.
 *
 *   npx vitest run dust/tests/salgames.ts
 *
 * Both games are written against a primitive the port had, under a name it did
 * not answer to:
 *
 *   1. `indextoprop` walks the ONE prop table and `result()` names the FILE the
 *      prop came from. Blackjack and poker both start a round by clearing the
 *      table with it —
 *
 *          for count = 1 to countprops ()
 *              temp = indextoprop (count)
 *              if result () = "salgames.prp"
 *                  propvisible (temp, false)
 *
 *      — and `result()` was set by `hittest` alone, so the comparison was never
 *      true, nothing was hidden, and a second round of blackjack was dealt on
 *      top of the first one's cards and its WINNER banner. The name it
 *      answers is the one the prop is registered under, which is not its sprite
 *      group's for a `propinstance` copy: the dealer's score readout is one, and
 *      reporting it as `bjscores` left the dealer's last total on the table.
 *
 *   2. `variable (name)` resolves the name the way any other read does: the
 *      running block's LOCALS first, then the globals. Poker's hand classifier
 *      counts faces into thirteen locals and reads them back by computed name —
 *
 *          local card2, card3, … card14
 *          …
 *          for count = 2 to 14
 *              if variable ("card" @ numtostring (count)) = num
 *
 *      — and a globals-only `variable` answered 0 for every one of them. So
 *      `hasxkind` never found a pair: every hand at the showdown scored as its
 *      high card, four aces included, and the hand-name prop under it read
 *      "nopair". The winner still looked right, because all four hands were
 *      being mis-scored the same way and the comparison is between them.
 *
 * Skipped, not failed, without the disc (the same bargain dust/tests/saves.ts
 * makes).
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript } from "@dreamfactory/engine/df/script";
import { assembleScript } from "@dreamfactory/engine/df/script-asm";
import { parseScript } from "@dreamfactory/engine/runtime/parser";
import { ScriptInstance, type Value } from "@dreamfactory/engine/runtime/interp";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";

/* anchored to this file, not the working directory — see dust/tests/movies.ts */
const SALGAMES = fileURLToPath(new URL("../gamefiles/dustcd/SALGAMES", import.meta.url));
const HOUSE_PRP = fileURLToPath(new URL("../gamefiles/dustcd/DATA/HOUSE.PRP", import.meta.url));

const file = (path: string): Uint8Array | null =>
  existsSync(path) ? new Uint8Array(readFileSync(path)) : null;

/** a session that serves the saloon's shop and the boot UI's, by name */
function newSession(): GameSession {
  const shops = new Map<string, Uint8Array | null>([
    ["salgames.prp", file(`${SALGAMES}/SALGAMES.PRP`)],
    ["house.prp", file(HOUSE_PRP)],
  ]);
  const session = new GameSession((name) => shops.get(name.toLowerCase()) ?? null, new NullAudioSink());
  session.onLog = () => {};
  return session;
}

/** the code blocks of every script container in a DreamFactory file */
function scripts(path: string, name: string): ScriptInstance[] {
  const container = readContainerFile(new Uint8Array(readFileSync(path)));
  const out: ScriptInstance[] = [];
  for (let i = 0; i < container.containers.length; i++) {
    const tokens = sniffScript(container.containers[i].data);
    if (!tokens) continue;
    try {
      out.push(new ScriptInstance(`${name}:${i}`, parseScript(tokens)));
    } catch {
      /* a picture that sniffed as a script — the parse is the real filter */
    }
  }
  return out;
}

// --- 1. clearing the table between rounds ----------------------------------

test("indextoprop + result() clear one file's props and leave the rest", async () => {
  if (!existsSync(`${SALGAMES}/SALGAMES.PRP`) || !existsSync(HOUSE_PRP)) {
    console.warn(`no ${SALGAMES} — skipping (needs the Dust rip)`);
    return;
  }
  const session = newSession();
  expect(await session.openShop("salgames.prp"), "salgames.prp opens").toBe(true);
  expect(await session.openShop("house.prp"), "house.prp opens").toBe(true);

  // blackjack's newgame() loop, verbatim, over a table with two shops on it
  const inst = new ScriptInstance(
    "cleartable",
    parseScript(
      assembleScript(`
code cleartable ()
	local temp

	for count = 1 to countprops ()
		temp = indextoprop (count)
		if result () = "salgames.prp"
			propvisible (temp, false)
		endif
	endfor
endcode
`),
    ),
  );

  // the dealer's score readout, as initgame() makes it: salgames.prp ships one
  // `bjscores` group and the second seat is an instance of it
  expect(session.propRuntime.get("bjscores2"), "bjscores2 is not a group of its own").toBeNull();
  session.propRuntime.instance("bjscores", "bjscores2");

  // every prop answers to the name the walk gives for it — the invariant the
  // clear loop rests on, since it hides what `indextoprop` hands back
  const props = [...session.propRuntime.props.entries()];
  const walk = session.interp.builtins.get("indextoprop")!;
  for (let i = 1; i <= props.length; i++) {
    const name = String(await walk(session.interp, [i], null as never, null as never));
    expect
      .soft(session.propRuntime.get(name), `prop ${i} answers to "${name}"`)
      .toBe(props[i - 1][1]);
  }

  // a round in progress: both seats' cards, both score readouts and the banner
  const dealt = ["ah", "10s", "bjscores", "bjscores2", "winner"];
  const bystanders = [...session.propRuntime.props.values()]
    .filter((p) => p.shop.name === "house.prp")
    .slice(0, 4)
    .map((p) => p.group.name.toLowerCase());
  expect(dealt.every((n) => session.propRuntime.get(n)), `${dealt} are salgames props`).toBe(true);
  expect(bystanders.length, "house.prp contributes props of its own").toBeGreaterThan(0);
  for (const n of [...dealt, ...bystanders]) session.propRuntime.get(n)!.visible = true;

  await session.interp.runHandler(inst, "cleartable", [], { me: "flat 2", target: "" });

  for (const n of dealt) {
    expect.soft(session.propRuntime.get(n)!.visible, `${n} cleared off the table`).toBe(false);
  }
  for (const n of bystanders) {
    expect.soft(session.propRuntime.get(n)!.visible, `${n} is not the saloon's to hide`).toBe(true);
  }
});

// --- 2. the poker showdown's hand names ------------------------------------

/** score -> the prop name the showdown draws under the hand (SALGAMES.FLT) */
const HAND_NAMES: readonly [number, string][] = [
  [900, "strflush"],
  [800, "4kind"],
  [700, "fullhouse"],
  [600, "flush"],
  [500, "straight"],
  [400, "3kind"],
  [300, "2pair"],
  [200, "1pair"],
  [0, "nopair"],
];

const handName = (score: number): string =>
  HAND_NAMES.find(([floor]) => score >= floor)![1];

test("poker scores a hand as the hand it is", async () => {
  const flt = `${SALGAMES}/SALGAMES.FLT`;
  if (!existsSync(flt)) {
    console.warn(`no ${flt} — skipping (needs the Dust rip)`);
    return;
  }
  const all = scripts(flt, "salgames.flt");
  const poker = all.find((s) => s.script.codes.has("calcscore"));
  const stage = all.find((s) => s.script.codes.has("nametoface"));
  expect(poker, "calcscore() is in the file").toBeTruthy();
  expect(stage, "nametoface() is in the file").toBeTruthy();

  const session = newSession();
  const interp = session.interp;
  // nametoface/nametosuit live in the stage's own script, which is where an
  // unqualified call from a flat resolves next
  interp.fallbackScripts = [stage!];
  // initgame() declares the classifier's nine outputs global — fullh() and
  // str() read what onepair()/threekind() wrote, in a frame of their own
  for (const g of [
    "hasnopair", "has1pair", "has2pair", "has3kind", "hasstr",
    "hasflush", "hasfullh", "has4kind", "hasstrflush",
  ]) {
    interp.globals.set(g, 0);
  }

  const calcscore = async (hand: string): Promise<Value> =>
    (await interp.runHandler(poker!, "calcscore", [hand], { me: "flat 0", target: "" })).value;

  // face + suit are read off the name, so these are the real 52 card props
  const cases: readonly [string, number, string][] = [
    ["2h 5d 9s jc kh", 13, "nopair"],
    ["2h 2d 5s 9c kh", 202, "1pair"],
    ["2h 2d 5s 5c kh", 305, "2pair"],
    ["3h 3d 3s 9c kh", 403, "3kind"],
    ["5h 6d 7s 8c 9h", 509, "straight"],
    ["2h 5h 9h jh kh", 613, "flush"],
    ["3h 3d 3s 9c 9h", 703, "fullhouse"],
    ["3h 3d 3s 3c kh", 803, "4kind"],
    ["5h 6h 7h 8h 9h", 909, "strflush"],
    ["ah ad as ac kh", 814, "4kind"],
  ];
  for (const [hand, want, name] of cases) {
    const got = Number(await calcscore(hand));
    expect
      .soft(got, `${hand} -> ${got} (${handName(got)}); want ${want} (${name})`)
      .toBe(want);
  }
});

// --- 3. the deal itself ----------------------------------------------------

/** the 52 prop names SALGAMES.PRP carries, in indextoname()'s order */
const DECK: readonly string[] = ["h", "d", "s", "c"].flatMap((suit) =>
  ["2", "3", "4", "5", "6", "7", "8", "9", "10", "j", "q", "k", "a"].map((f) => f + suit),
);

/**
 * `makehands()` deals four hands out of one deck, and the showdown draws each
 * one by prop name (`propxy (findword (zebhand, " ", count), …)`). So a hand
 * that is short a word, or that names a card another hand also holds, is a gap
 * or a card in two places on the table — the structural half of "the cards at
 * the showdown are wrong", underneath the scoring.
 *
 * Seeded, and every seed checked, because which cards the generators reach for
 * depends on what the deck has already given out (`cardused`).
 */
test("makehands deals four whole hands out of one deck", async () => {
  const flt = `${SALGAMES}/SALGAMES.FLT`;
  if (!existsSync(flt)) {
    console.warn(`no ${flt} — skipping (needs the Dust rip)`);
    return;
  }
  const all = scripts(flt, "salgames.flt");
  const poker = all.find((s) => s.script.codes.has("makehands"))!;
  const stage = all.find((s) => s.script.codes.has("indextoname"))!;
  expect(poker && stage, "makehands() and indextoname() are in the file").toBeTruthy();

  for (let seed = 1; seed <= 40; seed++) {
    const session = newSession();
    session.seedRandom(seed);
    const interp = session.interp;
    interp.fallbackScripts = [stage];
    // initgame()'s globals: the four scores, the four hands, and the deck's
    // memory of what it has already dealt
    for (const g of ["zeb", "mez", "pete", "player"]) {
      interp.globals.set(`${g}total`, 0);
      interp.globals.set(`${g}hand`, "");
    }
    interp.globals.set("usedstring", "");
    interp.globals.set("playerhandtemp", "");

    await interp.runHandler(poker, "makehands", [], { me: "flat 0", target: "" });

    const hands = ["zeb", "mez", "pete", "player"].map(
      (who) => [who, String(interp.globals.get(`${who}hand`))] as const,
    );
    const dealt: string[] = [];
    for (const [who, hand] of hands) {
      const cards = hand.trim().split(/ +/);
      expect.soft(cards.length, `seed ${seed}: ${who} holds five cards — "${hand}"`).toBe(5);
      for (const c of cards) {
        expect.soft(DECK.includes(c), `seed ${seed}: ${who}'s "${c}" is a card in the deck`).toBe(true);
      }
      dealt.push(...cards);
    }
    expect
      .soft(new Set(dealt).size, `seed ${seed}: one deck, no card in two hands — ${JSON.stringify(hands)}`)
      .toBe(dealt.length);
  }
});

// --- 3. the money readouts are rewritten, not written over (#288) ----------

/**
 * `lowdrawcash(num, x, y)` in SALGAMES.FLT, which is the whole mechanism:
 *
 *     propvisible ("blankscore", true)     / / the patch, over this field
 *     forceupdate ()
 *     propvisible ("blankscore", false)
 *     forceupdate ()
 *     …
 *     drawstring ("$" @ num, makepoint (x + 4 * (5 -stringlength (num)), y), 0, 12)
 *
 * In DUST.EXE a `drawstring` paints into the composited screen and the pixels
 * stand until something composites over them, so that flash IS the erase. Ours
 * keeps the drawn strings and re-applies them over the props every frame, which
 * made the patch a no-op — and because the field is right-aligned by shifting x
 * by 4 px per missing digit, the new value never landed on the old one's key and
 * never replaced it. Reported as CASH and WAGER holding every value they had
 * ever shown at once: "$100" under "$10" under "$0".
 *
 * The assertion is per FIELD, not per layer: `drawcash` rewrites both, 40 px
 * apart, and a fix that wiped the text layer wholesale would pass a one-field
 * test while taking the other field's number off the table.
 */
test("blackjack's CASH and WAGER hold one value each", async () => {
  const flt = `${SALGAMES}/SALGAMES.FLT`;
  if (!existsSync(flt) || !existsSync(`${SALGAMES}/SALGAMES.PRP`)) {
    console.warn(`no ${flt} — skipping (needs the Dust rip)`);
    return;
  }
  const session = newSession();
  expect(await session.openShop("salgames.prp"), "salgames.prp opens").toBe(true);
  const all = scripts(flt, "salgames.flt");
  const util = all.find((s) => s.script.codes.has("drawcash"))!;
  expect(util, "drawcash() is in the file").toBeTruthy();
  session.interp.fallbackScripts = all;
  // blackjack's own flat, which is the arm of drawcash's switch that draws both
  // fields (flat 3 is the slot machine, and has only the one)
  session.currentFlat = "flat 2";
  expect(session.propRuntime.get("blankscore"), "the eraser prop is in the shop").toBeTruthy();

  const ctx = { me: "flat 2", target: "" };
  const drawcash = (cash: number, bet: number) =>
    session.interp.runHandler(util, "drawcash", [cash, bet], ctx);
  /** the layer as "text@x" per baseline — CASH is drawn at y 314, WAGER at 354 */
  const field = (y: number) =>
    session.textOverlay.filter((e) => e.y === y).map((e) => `${e.text}@${e.x}`);

  // a hundred dollars in hand, all of it on the table
  await drawcash(100, 100);
  expect(field(314), "CASH after the bet").toEqual(["$100@69"]);
  expect(field(354), "WAGER after the bet").toEqual(["$100@69"]);

  // ...lost, and the next round is a ten. Both values are shorter than the ones
  // they replace, so both land at a DIFFERENT x — which is what made a
  // same-position replacement miss.
  await drawcash(0, 10);
  expect(field(314), "CASH, rewritten").toEqual(["$0@77"]);
  expect(field(354), "WAGER, rewritten").toEqual(["$10@73"]);
  expect(session.textOverlay.length, "nothing else is left on the felt").toBe(2);

  // and rewriting ONE field leaves the other alone: closecards() redraws the
  // cash with no bet showing (drawcash(playercash, -1))
  await session.interp.runHandler(util, "drawcash", [25, -1], ctx);
  expect(field(314), "CASH alone, rewritten").toEqual(["$25@73"]);
  expect(field(354), "WAGER survives its neighbour's redraw").toEqual(["$-1@73"]);
});
