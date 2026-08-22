/**
 * The playthrough: the game plays itself, and its state trace is the assertion.
 *
 *   npm run test:playthrough
 *   TAOOT_RECORD=1 npm run test:playthrough    # re-record the golden traces
 *
 * Unlike the scenario tests in auto/regression.ts, which jump to a state and
 * probe it, a segment (segments.ts) drives the game the way a player does —
 * boot, click, turn, talk — and never calls jumpTo(). What it asserts is a
 * recorded state trace (engine/src/runtime/trace.ts): every script global, the room,
 * and who owns what, sampled at each story beat. The route is the input, the
 * trace is the expectation, and a divergence names the beat it happened at
 * rather than surfacing three missions later as a door that won't open.
 *
 * ONE session is carried from segment to segment (see `live` below): segment N
 * continues the game segment N-1 left standing, and falls back to the checkpoint
 * that segment wrote (play.ts) when it isn't — a filtered run, a fresh process, a
 * branch, or a segment after one that threw. That fallback is what keeps a failure
 * late in the story cheap to reproduce; carrying is what keeps the run a run a
 * player could have made, because a `.ti` round trip is lossy both ways.
 */
import { test, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StateTrace, formatTrace } from "@dreamfactory/engine/runtime/trace";
import { Playthrough, checkpoint, newPlaythrough, resume, saveOf } from "./play";
import { dialStops } from "./nav/dials";
import { isHarnessPaced } from "@dreamfactory/engine/runtime/masks";
import { BEDSIT_OBJECTS, MENU_GAME, refuseZeitelAgain, segment1, segment2, segment3, segment4, segment5, segment6, segment7, segment8, segment9, segment10, segment11, segment12, segment13, segment14, segment15, segment16, segment17, segment18, segment19, segment20, segment21, segment22, segment23, segment24, segment25, segment26, segment27 } from "./segments";

const HERE = dirname(fileURLToPath(import.meta.url));
const golden = (n: string) => join(HERE, "golden", `playthrough-${n}.json`);

/**
 * Globals that count how long the HARNESS dwelt, not what the game did — and
 * which this comparison therefore drops. The list and the measurements behind it
 * live in [masks.ts](../../engine/src/runtime/masks.ts), because the browser suite needs the SAME list
 * and keeping a second copy here is what let the two drift apart: `lastsail` was
 * masked here and not there, so every browser segment from 13 on failed on a frame
 * stamp this file had already identified.
 *
 * What that comparison masks and this one does not is deliberate and stated there:
 * two hosts at one instant disagree about more than one host does over time, so
 * `hrs`/`min` are dropped there and asserted here.
 *
 * {@link isCoinFlip} is NOT dropped here, and that is a property this host earned
 * back. The Gorse/Jones encounter is `random(100) < 50`, and the draw deciding it
 * used to move whenever anything moved the clock — because the crickets drew from
 * the same stream and re-armed on the clock. They have their own stream now
 * (GameSession.ambientRng), so on ONE host the coin is a function of the seed and
 * the route, which is exactly what a golden can hold. The browser comparison still
 * masks it: two hosts do not dispatch the same number of idle-driven scripts, so
 * cross-host the draw can still land elsewhere, and that is its call to make.
 */

/** a beat with the harness-paced counters dropped */
function comparable(beat: StateTrace): StateTrace {
  const globals = beat.globals as Record<string, unknown> | undefined;
  if (!globals) return beat;
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(globals)) if (!isHarnessPaced(k)) kept[k] = v;
  return { ...beat, globals: kept } as StateTrace;
}

/**
 * The segments a full run reaches by LOADING rather than carrying — and it is now
 * EMPTY, which is the property this run has been working towards.
 *
 * It held 28 for as long as the turbine-room trade existed, because that trip was a
 * leaf and the segment had to start from a savegame. The necklace sub-plot replaced
 * the trade (segments.ts `necklace`), 28 is gone, and every segment from the cold
 * boot to the credits now continues the game the one before it left standing. So
 * every golden in here speaks for a carried run, and there is no second mode left
 * for one of them to quietly be recorded in.
 *
 * Kept rather than deleted because the machinery it feeds is still right: a
 * FILTERED run (`-t "playthrough 13"`) loads, and its trace still has to stand down.
 */
const LOADS_IN_A_FULL_RUN = new Set<number>();

/**
 * Compare a run's trace against its recording, or record it when asked.
 * Per-beat rather than whole-file, so a failure names the beat that diverged.
 */
function assertTrace(trace: StateTrace[], file: string, n?: number): void {
  // A golden records ONE mode. `.ti` round trips are lossy in both directions —
  // they import the shipped save's leftovers (oldset "c73", deckc.trk playing in
  // the bedsit) and drop what the running game holds (handitem, the boiler and
  // turbine sim, fencelevel) — so a carried run and a loaded one disagree on
  // fifty globals while agreeing on every one that carries the story. Comparing
  // the wrong mode against it would fail on all fifty and mean nothing.
  //
  // A full run carries everything except {@link LOADS_IN_A_FULL_RUN}, so that is
  // what the goldens hold. A filtered run (`-t "playthrough 13"`) loads instead:
  // its segment's own expectations still run and still catch a route break, and
  // only the trace comparison stands down.
  const wantCarried = n === undefined || !LOADS_IN_A_FULL_RUN.has(n);
  if (carriedIn !== wantCarried && !process.env.TAOOT_RECORD) {
    console.log(`${file.split("/").pop()}: ${carriedIn ? "carried" : "loaded"} — trace not compared`);
    return;
  }
  const text = formatTrace(trace);
  if (process.env.TAOOT_RECORD || !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`recorded ${trace.length} beats -> ${file}`);
    return;
  }
  const recorded: StateTrace[] = JSON.parse(readFileSync(file, "utf8"));
  expect(trace.map((t) => t.beat), "the route hit the same beats").toEqual(recorded.map((t) => t.beat));
  for (let i = 0; i < recorded.length; i++) {
    expect(comparable(trace[i]), `beat "${recorded[i].beat}"`).toEqual(comparable(recorded[i]));
  }
}


/**
 * The game the segments are played on — ONE session carried from segment to
 * segment, rather than a savegame round trip at every boundary.
 *
 * A `.ti` holds much more than it used to — the whole actor record (owner,
 * value, placement, scale), every prop's two halves, the loop/cricket tables
 * and the playing theme all round-trip since #143 — but a load is still not
 * the run a player makes: a walk in flight is dropped (the actor stands, their
 * idle re-decides), positional sound loops beyond the theme re-arm on the next
 * movement, and the sub-minute clock starts fresh. (The original resumes the
 * walk — its payload container is understood but not trusted enough to drive;
 * see docs/engine/formats/savegame.md.) So a chain of loads is not the same run, and
 * the route is supposed to be a player.
 *
 * So a segment continues the live game when the previous test left it standing
 * exactly where this one begins. It falls back to the checkpoint otherwise, and
 * "otherwise" is not rare: a filtered run (`-t "playthrough 13"`), a fresh
 * process, and any segment after one that threw. That fallback is what keeps a
 * late failure cheap to reproduce, which is the property the checkpoints were
 * introduced for in the first place. What is no longer on that list is a segment
 * that could ONLY load — see {@link LOADS_IN_A_FULL_RUN}.
 */
let live: { p: Playthrough; at: string } | null = null;

/**
 * What a flat's "leave" region is called, commonest first.
 *
 * Not one name: scanned across every STG in the tree, 33 flats close on `ok`,
 * three on `exit` (the Enigma among them — its keyboard takes 26 of its 27
 * regions and the 27th is `exit`), two on `quit` and two on `back`. Trying `ok`
 * alone left the machine standing over c73 into the next segment.
 */
const FLAT_EXITS = ["ok", "exit", "back", "quit"];

/**
 * Whether the segment now running was CARRIED or loaded — the trace it produces
 * is not the same either way, so the golden can only speak for one of them.
 */
let carriedIn = true;

/**
 * The game segment N starts from: carried if it is already standing here.
 * `answer` is for a checkpoint whose LOAD asks a question (m4anti — see
 * segments.ts `refuseZeitelAgain`); a carried game never needs it.
 */
async function startFrom(
  name: string,
  bytes: () => Promise<Uint8Array>,
  answer?: (p: Playthrough) => Promise<void>,
): Promise<Playthrough> {
  const carry = live?.at === name ? live.p : null;
  carriedIn = carry !== null;
  live = null; // a throw below must not hand a half-played game to the next test
  return carry ?? (await resume(await bytes(), answer));
}

/**
 * Hand the played game on, and make sure its `.ti` exists.
 *
 * The write still goes through {@link checkpoint}, so it only happens when the
 * file is missing (or TAOOT_RECHECKPOINT asks) — and the browser gate, which
 * reads out/checkpoints by name, keeps getting one written from a continuous
 * run rather than from a chain of loads.
 */
async function leaveAt(name: string, p: Playthrough): Promise<void> {
  await handBack(p);
  live = { p, at: name };
  await checkpoint(name, async () => saveOf(p));
}

/**
 * Put the interface back the way a load used to find it.
 *
 * A `.ti` holds a set, a scene and a view — no flat, no parked movie — so
 * `resume()` always came back to a clear room, and a segment could finish with
 * the enigma machine open, the cufflink case up or a clip parked and never
 * notice. Carrying the game keeps all of it, and the next segment then found its
 * room covered and said so: `the "cuff 1" flat is covering ebath; close it
 * first`, `the office door did not open`. The navigator was right every time.
 *
 * So the boundary does what a player does before walking off — closes what it
 * opened. An abort is the only thing that gets out of a parked clip without
 * running its action frame (docs/engine/formats/mov.md, and segment 7 on why that
 * distinction matters at the Purser's door), and a flat closes on whichever of
 * {@link FLAT_EXITS} it happens to carry.
 */
async function handBack(p: Playthrough): Promise<void> {
  const d = p.driver;
  if (d.moviePlaying()) await d.skipMovie();
  for (let i = 0; i < 4 && d.inFlat() !== null; i++) {
    let clicked = false;
    for (const name of FLAT_EXITS) {
      if (await d.clickThing(name)) { clicked = true; break; }
    }
    if (!clicked) break;
    await d.waitFor(() => d.inFlat() === null, "the flat to close", 4000);
  }
}

test("playthrough 1: cold boot to mission 1 phase 0", async () => {
  const p = await newPlaythrough();
  await segment1(p);
  assertTrace(p.trace, golden("1"), 1);
  await leaveAt("m1p0", p);
}, 120_000);


/** the end of segment 1, as a savegame — segments 2 and 3 both start from here */
const m1p0 = () =>
  checkpoint("m1p0", async () => {
    const first = await newPlaythrough();
    await segment1(first);
    return saveOf(first);
  });

test("playthrough 2: mission 1 phase 0 -> phase 1, from the checkpoint", async () => {
  const p = await startFrom("m1p0", m1p0);
  const from = p.trace.length;
  await segment2(p);
  assertTrace(p.trace.slice(from), golden("2"), 2);
  await leaveAt("m1p1", p);
}, 300_000);

/** the end of segment 2 — segments 3 and 4 both start from here */
const m1p1 = () =>
  checkpoint("m1p1", async () => {
    const second = await resume(await m1p0());
    await segment2(second);
    return saveOf(second);
  });

test("playthrough 3: mission 1 phase 1 -> phase 2, from the checkpoint", async () => {
  const p = await startFrom("m1p1", m1p1);
  const from = p.trace.length;
  await segment3(p);
  assertTrace(p.trace.slice(from), golden("3"), 3);
  await leaveAt("m1p2", p);
}, 300_000);

/** the end of segment 3 — segments 4 and 5 both start from here */
const m1p2 = () =>
  checkpoint("m1p2", async () => {
    const third = await resume(await m1p1());
    await segment3(third);
    return saveOf(third);
  });

test("playthrough 4: mission 1 phase 2 -> phase 3, from the checkpoint", async () => {
  const p = await startFrom("m1p2", m1p2);
  const from = p.trace.length;
  await segment4(p);
  assertTrace(p.trace.slice(from), golden("4"), 4);
  await leaveAt("m1p3", p);
}, 300_000);

/** the end of segment 4 — segments 5 and 6 both start from here */
const m1p3 = () =>
  checkpoint("m1p3", async () => {
    const fourth = await resume(await m1p2());
    await segment4(fourth);
    return saveOf(fourth);
  });

test("playthrough 5: mission 1 phase 3 -> phase 4, from the checkpoint", async () => {
  const p = await startFrom("m1p3", m1p3);
  const from = p.trace.length;
  await segment5(p);
  assertTrace(p.trace.slice(from), golden("5"), 5);
  await leaveAt("m1p4", p);
}, 300_000);

/** the end of segment 5 — segments 6 and 7 both start from here */
const m1p4 = () =>
  checkpoint("m1p4", async () => {
    const fifth = await resume(await m1p3());
    await segment5(fifth);
    return saveOf(fifth);
  });

test("playthrough 6: mission 1 phase 4 -> mission 2, from the checkpoint", async () => {
  const p = await startFrom("m1p4", m1p4);
  const from = p.trace.length;
  await segment6(p);
  assertTrace(p.trace.slice(from), golden("6"), 6);
  await leaveAt("m2p0", p);
}, 300_000);

/** the end of segment 6 — segments 7 and 8 both start from here */
const m2p0 = () =>
  checkpoint("m2p0", async () => {
    const sixth = await resume(await m1p4());
    await segment6(sixth);
    return saveOf(sixth);
  });

test("playthrough 7: mission 2 phase 0, Thayer's telegram", async () => {
  const p = await startFrom("m2p0", m2p0);
  const from = p.trace.length;
  await segment7(p);
  assertTrace(p.trace.slice(from), golden("7"), 7);
  await leaveAt("m2gram", p);
}, 300_000);

/**
 * The end of segment 7 — at the wireless with Thayer's telegram to send.
 *
 * This checkpoint is the one that could not exist until actor owners were saved:
 * the Purser's errand lives in `actorowner("purs")`, and a `.ti` written without
 * it brought him back at "none" with the whole ladder reset. It is therefore also
 * the regression test for that fix — segment 8's first assertion is his rung.
 */
const m2gram = () =>
  checkpoint("m2gram", async () => {
    const seventh = await resume(await m2p0());
    await segment7(seventh);
    return saveOf(seventh);
  });

test("playthrough 8: mission 2 phase 0, Thayer's telegram sent", async () => {
  const p = await startFrom("m2gram", m2gram);
  const from = p.trace.length;
  await segment8(p);
  assertTrace(p.trace.slice(from), golden("8"), 8);
  await leaveAt("m2sent", p);
}, 300_000);

/** the end of segment 8 — the telegram sent, and the Purser owed a report */
const m2sent = () =>
  checkpoint("m2sent", async () => {
    const eighth = await resume(await m2gram());
    await segment8(eighth);
    return saveOf(eighth);
  });

test("playthrough 9: mission 2 phase 0, the report and the manifest", async () => {
  const p = await startFrom("m2sent", m2sent);
  const from = p.trace.length;
  await segment9(p);
  assertTrace(p.trace.slice(from), golden("9"), 9);
  await leaveAt("m2man", p);
}, 300_000);

/** the end of segment 9 — the manifest read, the Purser at "none2" */
const m2man = () =>
  checkpoint("m2man", async () => {
    const ninth = await resume(await m2sent());
    await segment9(ninth);
    return saveOf(ninth);
  });

test("playthrough 10: mission 2 phase 0, the cufflink errand and the cufflink", async () => {
  const p = await startFrom("m2man", m2man);
  const from = p.trace.length;
  await segment10(p);
  assertTrace(p.trace.slice(from), golden("10"), 10);
  await leaveAt("m2link", p);
}, 300_000);

/** the end of segment 10 — Straus's cufflink in hand, the Purser at "foundcuff" */
const m2link = () =>
  checkpoint("m2link", async () => {
    const tenth = await resume(await m2man());
    await segment10(tenth);
    return saveOf(tenth);
  });

test("playthrough 11: mission 2 phase 0, the cufflink handed over and the car keys", async () => {
  const p = await startFrom("m2link", m2link);
  const from = p.trace.length;
  await segment11(p);
  assertTrace(p.trace.slice(from), golden("11"), 11);
  await leaveAt("m2keys", p);
}, 300_000);

/** the end of segment 11 — the car keys in hand, the Purser gone for the night */
const m2keys = () =>
  checkpoint("m2keys", async () => {
    const eleventh = await resume(await m2link());
    await segment11(eleventh);
    return saveOf(eleventh);
  });

test("playthrough 12: mission 2 phase 0 -> phase 1, the hold and the painting", async () => {
  const p = await startFrom("m2keys", m2keys);
  const from = p.trace.length;
  await segment12(p);
  assertTrace(p.trace.slice(from), golden("12"), 12);
  await leaveAt("m2p1", p);
}, 300_000);

/** the end of segment 12 — the painting in the bag, mission 2 phase 1 */
const m2p1 = () =>
  checkpoint("m2p1", async () => {
    const twelfth = await resume(await m2keys());
    await segment12(twelfth);
    return saveOf(twelfth);
  });

test("playthrough 13: mission 2 phase 1, the squash court and the first bout", async () => {
  const p = await startFrom("m2p1", m2p1);
  const from = p.trace.length;
  await segment13(p);
  assertTrace(p.trace.slice(from), golden("13"), 13);
  await leaveAt("m2fence", p);
}, 600_000);

/** the end of segment 13 — one bout won, the ring still Haderlitz's */
const m2fence = () =>
  checkpoint("m2fence", async () => {
    const thirteenth = await resume(await m2p1());
    await segment13(thirteenth);
    return saveOf(thirteenth);
  });

test("playthrough 14: mission 2 phase 1 -> phase 2, Willy's ring", async () => {
  const p = await startFrom("m2fence", m2fence);
  const from = p.trace.length;
  await segment14(p);
  assertTrace(p.trace.slice(from), golden("14"), 14);
  await leaveAt("m2p2", p);
}, 300_000);

/** the end of segment 14 — the ring in hand, mission 2 phase 2 */
const m2p2 = () =>
  checkpoint("m2p2", async () => {
    const fourteenth = await resume(await m2fence());
    await segment14(fourteenth);
    return saveOf(fourteenth);
  });

test("playthrough 15: mission 2 phase 2 -> phase 3, the ring identified", async () => {
  const p = await startFrom("m2p2", m2p2);
  const from = p.trace.length;
  await segment15(p);
  assertTrace(p.trace.slice(from), golden("15"), 15);
  await leaveAt("m2p3", p);
}, 300_000);

/** the end of segment 15 — the ring identified, mission 2 phase 3 */
const m2p3 = () =>
  checkpoint("m2p3", async () => {
    const fifteenth = await resume(await m2p2());
    await segment15(fifteenth);
    return saveOf(fifteenth);
  });

test("playthrough 16: mission 2 phase 3 -> mission 3, Penny's debrief", async () => {
  const p = await startFrom("m2p3", m2p3);
  const from = p.trace.length;
  await segment16(p);
  assertTrace(p.trace.slice(from), golden("16"), 16);
  await leaveAt("m3p0", p);
}, 300_000);

/** the end of segment 16 — mission 3, phase 0, Penny's pen in the bag */
const m3p0 = () =>
  checkpoint("m3p0", async () => {
    const sixteenth = await resume(await m2p3());
    await segment16(sixteenth);
    return saveOf(sixteenth);
  });

test("playthrough 17: mission 3 phase 0, Willy's body and the Rubaiyat clue", async () => {
  const p = await startFrom("m3p0", m3p0);
  const from = p.trace.length;
  await segment17(p);
  assertTrace(p.trace.slice(from), golden("17"), 17);
  await leaveAt("m3clue", p);
}, 300_000);

/** the end of segment 17 — the Rubaiyat clue in the bag */
const m3clue = () =>
  checkpoint("m3clue", async () => {
    const seventeenth = await resume(await m3p0());
    await segment17(seventeenth);
    return saveOf(seventeenth);
  });

test("playthrough 18: mission 3 phase 0, the Hacker's phrase", async () => {
  const p = await startFrom("m3clue", m3clue);
  const from = p.trace.length;
  await segment18(p);
  assertTrace(p.trace.slice(from), golden("18"), 18);
  await leaveAt("m3phrase", p);
}, 300_000);

/** the end of segment 18 — the Hacker's phrase in the bag */
const m3phrase = () =>
  checkpoint("m3phrase", async () => {
    const eighteenth = await resume(await m3clue());
    await segment18(eighteenth);
    return saveOf(eighteenth);
  });

test("playthrough 19: mission 3 phase 0, the Old Reds", async () => {
  const p = await startFrom("m3phrase", m3phrase);
  const from = p.trace.length;
  await segment19(p);
  assertTrace(p.trace.slice(from), golden("19"), 19);
  await leaveAt("m3cigs", p);
}, 300_000);

/** the end of segment 19 — the cigarettes in the bag */
const m3cigs = () =>
  checkpoint("m3cigs", async () => {
    const nineteenth = await resume(await m3phrase());
    await segment19(nineteenth);
    return saveOf(nineteenth);
  });

test("playthrough 20: mission 3 phase 0 -> phase 1, the Old Reds delivered", async () => {
  const p = await startFrom("m3cigs", m3cigs);
  const from = p.trace.length;
  await segment20(p);
  assertTrace(p.trace.slice(from), golden("20"), 20);
  await leaveAt("m3p1", p);
}, 300_000);

/** the end of segment 20 — mission 3 phase 1, and Vlad waiting in the engine room */
const m3p1 = () =>
  checkpoint("m3p1", async () => {
    const twentieth = await resume(await m3cigs());
    await segment20(twentieth);
    return saveOf(twentieth);
  });

test("playthrough 21: mission 3 phase 1, the engine room unlocked", async () => {
  const p = await startFrom("m3p1", m3p1);
  const from = p.trace.length;
  await segment21(p);
  assertTrace(p.trace.slice(from), golden("21"), 21);
  await leaveAt("m3thanks", p);
}, 300_000);

/** the end of segment 21 — the engineer thanked twice, so the engine room opens */
const m3thanks = () =>
  checkpoint("m3thanks", async () => {
    const twentyfirst = await resume(await m3p1());
    await segment21(twentyfirst);
    return saveOf(twentyfirst);
  });

test("playthrough 22: mission 3 phase 1 -> phase 2, the fight with Vlad", async () => {
  const p = await startFrom("m3thanks", m3thanks);
  const from = p.trace.length;
  await segment22(p);
  assertTrace(p.trace.slice(from), golden("22"), 22);
  await leaveAt("m3p2", p);
}, 600_000);

/** the end of segment 22 — Vlad on the floor, mission 3 phase 2 */
const m3p2 = () =>
  checkpoint("m3p2", async () => {
    const twentysecond = await resume(await m3thanks());
    await segment22(twentysecond);
    return saveOf(twentysecond);
  });

test("playthrough 23: mission 3 phase 2, up the false smokestack", async () => {
  const p = await startFrom("m3p2", m3p2);
  const from = p.trace.length;
  await segment23(p);
  assertTrace(p.trace.slice(from), golden("23"), 23);
  await leaveAt("m3top", p);
}, 600_000);

/** the end of segment 23 — the top of the false stack, the notebook still on it */
const m3top = () =>
  checkpoint("m3top", async () => {
    const twentythird = await resume(await m3p2());
    await segment23(twentythird);
    return saveOf(twentythird);
  });

test("playthrough 24: mission 3 phase 3 -> mission 4, the notebook to Zeitel", async () => {
  const p = await startFrom("m3top", m3top);
  const from = p.trace.length;
  await segment24(p);
  assertTrace(p.trace.slice(from), golden("24"), 24);
  await leaveAt("m4p0", p);
}, 600_000);

/** the end of segment 24 — mission 4 phase 0, back in Frank's cabin */
const m4p0 = () =>
  checkpoint("m4p0", async () => {
    const twentyfourth = await resume(await m3top());
    await segment24(twentyfourth);
    return saveOf(twentyfourth);
  });

test("playthrough 25: mission 4 phase 0, Penny at the cabin door", async () => {
  const p = await startFrom("m4p0", m4p0);
  const from = p.trace.length;
  await segment25(p);
  assertTrace(p.trace.slice(from), golden("25"), 25);
  await leaveAt("m4penny", p);
}, 600_000);

/** the end of segment 25 — Penny has been in, the sinking soundtrack running */
const m4penny = () =>
  checkpoint("m4penny", async () => {
    const twentyfifth = await resume(await m4p0());
    await segment25(twentyfifth);
    return saveOf(twentyfifth);
  });

test("playthrough 26: mission 4 phase 0, the shawl and Zeitel refused", async () => {
  const p = await startFrom("m4penny", m4penny);
  const from = p.trace.length;
  await segment26(p);
  assertTrace(p.trace.slice(from), golden("26"), 26);
  await leaveAt("m4anti", p);
}, 600_000);

/** the end of segment 26 — Zeitel refused, the painting still ours */
const m4anti = () =>
  checkpoint("m4anti", async () => {
    const twentysixth = await resume(await m4penny());
    await segment26(twentysixth);
    return saveOf(twentysixth);
  });

/**
 * The last segment — and there used to be two more.
 *
 * One went six decks down to the turbine room to trade Clariss's shawl
 * for the real necklace, because `worldwar1()` wants that necklace out of Vlad's
 * hands and the route had no other way to get it. The necklace SUB-PLOT is that
 * other way: it runs in mission 1 phase 4 (segments.ts `necklace`), costs none of
 * mission 4's 63-minute clock, and leaves `propowner("realneck")` = "frank" from
 * the first hour.
 *
 * So the trade became redundant, and dropping it was worth more than the gestures it
 * saved: it was the ONLY segment in this file that LOADED rather than carrying,
 * because the turbine-room trip was a leaf. With it gone the whole run is one
 * carried game from the cold boot to the credits, which is what makes every golden
 * in here speak for a game a player could actually have played — a `.ti` round trip
 * is lossy both ways, so a loaded segment's trace is only ever an oracle for
 * loading.
 *
 * The other carried Georgia's antidote to A deck and then played blackjack for the
 * boat pass, and it went for a reason worth keeping: BOTH of those errands existed
 * only to undo segment 26 handing the painting to Zeitel. Refusing his deal keeps
 * the painting, which is the flag the pass was for — so the antidote, the table, and
 * the trade back all went with it, and with them the one part of the run whose
 * outcome was a property of the RNG stream rather than of the play
 * (docs/reference/route.md). Lady
 * Georgia dies of the poison; the closing narration does not score her, and segment
 * 26 says so where it makes the choice.
 *
 * Each retirement handed its number back, so the segments run 1..27 with no gap.
 */
test("playthrough 27: mission 4, the boat deck and the end of the game", async () => {
  const p = await startFrom("m4anti", m4anti, refuseZeitelAgain);
  const from = p.trace.length;
  await segment27(p);
  assertTrace(p.trace.slice(from), golden("27"), 27);
}, 900_000);

/** the trace is only an oracle if the same seed gives the same run */
test("playthrough 1 is reproducible: the same seed traces identically", async () => {
  const run = async (): Promise<string> => {
    const p = await newPlaythrough();
    let booted = false;
    const boot = p.session.track(p.host.coldBoot().then(() => (booted = true)));
    await p.pump(() => p.host.viewer?.awaitingInput ?? false, "the boot menu");
    await p.v().click(MENU_GAME.x, MENU_GAME.y);
    await p.pump(() => booted && !p.session.fade.queue.length, "the London flat", 80_000);
    await boot;
    await p.beat("boot");
    // the draws the rest of the route makes, so the seed itself is compared too
    return JSON.stringify([p.trace, [p.session.rng(), p.session.rng()]]);
  };
  expect(await run(), "two boots on one seed agree").toBe(await run());
}, 120_000);

/** documents what the route depends on: which objects are worth what */
test("the bedsit scoring leaves exactly one route to the bomb", () => {
  const points: Record<string, number> = {
    memory: 4, obit: 2, paper: 1, cabinet: 1, cards: 1, poster: 1, mantle: 1,
  };
  const all = Object.values(points).reduce((a, b) => a + b, 0);
  expect(all, "all seven objects").toBe(11);
  const best6 = Object.values(points).sort((a, b) => b - a).slice(0, 6).reduce((a, b) => a + b, 0);
  expect(best6, "the best six fall exactly one short of the > 10 gate").toBe(10);
});

/**
 * Documents the other thing segment 4's route depends on: which degs a turbine
 * pump can actually be asked for.
 *
 * A dial that moves 3 at a time keeps its residue class until it clamps, so from
 * an arbitrary start only two of the three classes are reachable — via the end
 * stop each hangs off. The route's two pump settings (15 and 7) are one from each,
 * and asserting that here is what stops a future re-tune quietly picking a deg the
 * dial cannot land on and blaming the gesture.
 */
test("a turbine pump can be asked for two of the three residue classes", () => {
  const reachable = (want: number): boolean =>
    // from every possible starting deg, not just a lucky one
    Array.from({ length: 20 }, (_, now) => dialStops(3, want, now)).every((s) => s.length > 0);
  expect(reachable(15), "pump1's setting, on the chain up from the 0 stop").toBe(true);
  expect(reachable(7), "pump2's setting, on the chain down from the 19 stop").toBe(true);
  const nowhere = [2, 5, 8, 11, 14, 17].filter((d) => !reachable(d));
  expect(nowhere, "these six are only reachable from their own chain").toEqual([2, 5, 8, 11, 14, 17]);
  // and from a start on that chain, they are — which is what makes a retry work
  expect(dialStops(3, 8, 2), "8 from 2 is a straight run").toEqual([8]);
  // a valve steps by 1 and needs no stop at all
  expect(dialStops(-1, 8, 19), "a valve just counts there").toEqual([8]);
});
