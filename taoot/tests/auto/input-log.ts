/**
 * What the player pressed, said in a line (taoot/src/input-log.ts,
 * [#178](https://github.com/dhobi/dreamrefactory/issues/178)).
 *
 *   npx vitest run taoot/tests/auto/input-log.ts
 *
 * The log's other half. The script log has always said what the GAME did —
 * `opensetfile(…)`, `click bag` — and nothing about what was done to it, so a
 * report saying "I pressed forward and it went wrong" could not be checked
 * against it. These lines are the cause beside the effect, in the one stream, so
 * that the order is the answer and nothing has to be correlated.
 *
 * Tested as WORDING, with no browser and no engine, because wording is what it
 * is: the module asks the page four questions and decides what to say, and every
 * decision worth making is in that sentence. The page's own half — which
 * gestures reach the recorder at all — is `main.ts`, and it is covered by the
 * fact that a key the page keeps (M, O, X) never calls it.
 *
 * The thing to be most careful about is a line that claims something happened.
 * "Nothing changed" over a press that skipped a film, or silence over a press
 * the engine threw away, is worse than no log at all: it would send a reader
 * looking for the bug somewhere else. So most of what follows is about the
 * gestures that did nothing.
 */
import { test, expect, vi } from "vitest";
import {
  InputLog,
  SLOW_MS,
  clickLabel,
  effectLine,
  hitPhrase,
  inputLabel,
  inputLine,
  stamp,
  type Cause,
  type Gate,
} from "../../src/input-log";

/* ------------------------------------------------------------------ *
 * The words
 * ------------------------------------------------------------------ */

test("a key is named by what the hand did, not by what the engine calls it (#178)", () => {
  expect(inputLabel("uparrow")).toBe("[Forward]");
  expect(inputLabel("leftarrow")).toBe("[Left]");
  expect(inputLabel("rightarrow")).toBe("[Right]");
  // the smokestack's, which is the one place the game is walked backwards
  expect(inputLabel("downarrow")).toBe("[Back]");
  expect(inputLabel(" ")).toBe("[Space]");
  // ESC reaches the engine as "." — the original's own translation
  expect(inputLabel(".")).toBe("[Esc]");
  // and a letter is named as itself rather than dropped: A/W/D are the game's
  // own rebindable movement keys (keynorth/keywest/keyeast), and the Enigma is
  // typed at, so "the game received a q" is a fact about an input
  expect(inputLabel("q")).toBe('[Key "q"]');
  expect(clickLabel(214, 180)).toBe("[Click 214,180]");
});

test("the stamp is a tenth of a second from the start of the session (#178)", () => {
  expect(stamp(0)).toBe("[+00:00.0]");
  expect(stamp(1_234)).toBe("[+00:01.2]");
  expect(stamp(74_800)).toBe("[+01:14.8]");
  // padded, so a column of them lines up in a mono pane
  expect(stamp(9_000)).toBe("[+00:09.0]");
  // an hour of session grows the field rather than rolling over — a long sitting
  // is exactly when somebody is lining the log up against a recording
  expect(stamp(3_600_000 + 74_800)).toBe("[+1:01:14.8]");
  // a clock that went backwards is not a negative time
  expect(stamp(-5)).toBe("[+00:00.0]");
});

test("a zone is named in the reader's words, not the engine's (#178)", () => {
  expect(hitPhrase({ name: "door", type: "painting" })).toBe('hotspot "door"');
  expect(hitPhrase({ name: "ok", type: "button" })).toBe('region "ok"');
  expect(hitPhrase({ name: "max", type: "actor" })).toBe('actor "max"');
  expect(hitPhrase({ name: "bag", type: "prop" })).toBe('prop "bag"');
  // A type nobody has taught it is printed as the engine spells it rather than
  // swallowed: a new kind of zone should appear in the log the day it exists.
  expect(hitPhrase({ name: "thing", type: "gizmo" })).toBe('gizmo "thing"');
  // nothing under it, and nothing to say
  expect(hitPhrase(null)).toBe("");
  expect(hitPhrase({ name: "", type: "" })).toBe("");
  // the SCENE is what the engine answers for a click on nothing in particular,
  // and it is the same information as "no hotspot" — beside a location that
  // already names the room it would be one thing said twice
  expect(hitPhrase({ name: "bedsit1", type: "scene" })).toBe("");
});

/* ------------------------------------------------------------------ *
 * The line
 * ------------------------------------------------------------------ */

const cause = (over: Partial<Cause> = {}): Cause => ({
  at: 74_800,
  what: "[Forward]",
  hit: null,
  gate: "ready",
  where: "deckbd2.set — Scene35 / View102",
  ...over,
});

test("a gesture that moved the game says where it went (#178)", () => {
  const line = inputLine(cause(), "wireless.set — Scene10 / View14");
  expect(line).toContain("[+01:14.8]");
  expect(line).toContain("[Forward]");
  expect(line).toContain("→ wireless.set — Scene10 / View14");
});

test("a gesture that hit something names it, moved or not (#178)", () => {
  // #178's own example: Space opens the door and the view does not change
  const door = cause({ what: "[Space]", hit: { name: "door", type: "painting" } });
  const line = inputLine(door, door.where);
  expect(line).toContain("[+01:14.8] [Space]");
  expect(line).toContain('hotspot "door" → deckbd2.set — Scene35 / View102');
});

test("the tails line up, whatever the gesture was called (#178)", () => {
  // A mono pane and a column of these: the label field is padded so the arrows
  // and the "nothing changed"s are readable as a column rather than as prose.
  // Asserted as an alignment rather than as a character count, so the field can
  // be widened without rewriting the expectations above.
  const at = (l: string): number => l.indexOf("→");
  const forward = inputLine(cause({ what: "[Forward]" }), "elsewhere");
  const esc = inputLine(cause({ what: "[Esc]" }), "elsewhere");
  expect(at(esc)).toBe(at(forward));
  // ...and a label too long for the field pushes its own tail out rather than
  // being cut: a click's coordinates are the thing that makes it identifiable
  const click = inputLine(cause({ what: "[Click 214,180]" }), "elsewhere");
  expect(click).toContain("[Click 214,180]");
  expect(at(click)).toBeGreaterThanOrEqual(at(forward));
});

test("a gesture that did nothing SAYS nothing happened (#178)", () => {
  // The most important line in the file. Silence here reads as "the log is
  // broken", and a location repeated with an arrow reads as "it worked".
  const line = inputLine(cause({ what: "[Esc]" }), cause().where);
  expect(line).toContain("[Esc]");
  expect(line).toContain("— nothing changed");
  expect(line).not.toContain("→");
});

test("a press the engine threw away is not reported as a press that worked (#178)", () => {
  // The fade gap: `movingCamera` files a press and `inputLocked` without it
  // discards one, and the difference is the whole of why a gesture can vanish.
  const dropped = inputLine(cause({ gate: "locked" }), cause().where);
  expect(dropped).toContain("DROPPED");
  expect(dropped).not.toContain("nothing changed");
  const queued = inputLine(cause({ gate: "queued" }), "deckbd2.set — Scene35 / View106");
  expect(queued).toContain("queued behind a camera move");
  expect(queued).toContain("→ deckbd2.set — Scene35 / View106");
  // no room to accept it at all — a film, a menu, the boot — is not a fault
  // worth a word: the location says where it went, and "no room open" is
  // already the answer to why nothing happened
  const noRoom = inputLine(cause({ gate: "none" }), cause().where);
  expect(noRoom).toContain("— nothing changed");
  expect(noRoom).not.toMatch(/DROPPED|queued/);
});

test("a gesture still being worked on says so, and where it started (#178)", () => {
  const line = inputLine(cause({ what: "[Click 214,180]" }), null);
  expect(line).toContain("[Click 214,180]");
  expect(line).toContain("deckbd2.set — Scene35 / View102…");
  // ...and the second line is what it turned out to do
  expect(effectLine(80_000, cause().where, "wireless.set — Scene10 / View14")).toBe(
    "[+01:20.0]                 → wireless.set — Scene10 / View14",
  );
  expect(effectLine(80_000, cause().where, cause().where)).toContain("— nothing changed");
});

/* ------------------------------------------------------------------ *
 * The recorder
 * ------------------------------------------------------------------ */

/** a page whose clock, location and gate this test moves by hand */
function fakePage(where = "bedsit1 — Scene3 / View20") {
  const said: string[] = [];
  let now = 0;
  let gate: Gate = "ready";
  const timers: { at: number; fn: () => void }[] = [];
  const log = new InputLog({
    now: () => now,
    say: (l) => said.push(l),
    where: () => where,
    gate: () => gate,
    after: (ms, fn) => {
      const t = { at: now + ms, fn };
      timers.push(t);
      return () => void timers.splice(timers.indexOf(t), 1);
    },
  });
  return {
    log,
    said,
    at: (ms: number) => {
      now = ms;
      for (const t of [...timers]) if (t.at <= now) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    },
    go: (to: string) => void (where = to),
    lock: (g: Gate) => void (gate = g),
    pending: () => timers.length,
  };
}

test("the log off costs the game nothing, and the engine no hit test (#178)", async () => {
  const page = fakePage();
  const dispatch = vi.fn(async () => {});
  const hit = vi.fn(() => ({ name: "door", type: "painting" }));
  page.log.note("[Space]", dispatch, hit);
  await Promise.resolve();
  // the gesture still happens — the log is a readout and never a gate on play
  expect(dispatch).toHaveBeenCalledTimes(1);
  // ...but nothing was measured for it: `hitTestAt` walks the sprites, the
  // view's hotspots and the stage's regions, and a click is not the moment to
  // do that for a line nobody will read
  expect(hit).not.toHaveBeenCalled();
  expect(page.said).toEqual([]);
});

test("a quick gesture is ONE line, complete (#178)", async () => {
  const page = fakePage();
  page.log.on = true;
  let land = (): void => {};
  page.log.note("[Left]", () => new Promise<void>((r) => (land = r)));
  page.go("bedsit1 — Scene3 / View21");
  page.at(20); // answered well inside SLOW_MS
  land();
  await Promise.resolve();
  await Promise.resolve();
  expect(page.said).toHaveLength(1);
  expect(page.said[0]).toContain("[Left]");
  expect(page.said[0]).toContain("→ bedsit1 — Scene3 / View21");
  // and the "still working" timer was called off rather than left to fire
  expect(page.pending()).toBe(0);
});

test("a slow gesture says its cause in the right place, then its effect (#178)", async () => {
  // The reason this is not one line: a press at a two-minute film would have
  // its line land after the film's own, i.e. after everything the reader is
  // trying to explain.
  const page = fakePage();
  page.log.on = true;
  let land = (): void => {};
  page.log.note("[Esc]", () => new Promise<void>((r) => (land = r)));
  page.at(SLOW_MS);
  expect(page.said).toHaveLength(1);
  expect(page.said[0]).toContain("bedsit1 — Scene3 / View20…");

  page.go("bedsit1 — Scene3 / View20 · flat \"inven 1\"");
  page.at(9_000);
  land();
  await Promise.resolve();
  await Promise.resolve();
  expect(page.said).toHaveLength(2);
  expect(page.said[1]).toContain("[+00:09.0]");
  expect(page.said[1]).toContain('→ bedsit1 — Scene3 / View20 · flat "inven 1"');
});

test("a dispatch that threw still gets its line (#178)", async () => {
  // A script error is exactly when the reader needs to know which gesture ran
  // it — and `session.track` reports the error itself, on its own line.
  const page = fakePage();
  page.log.on = true;
  page.log.note("[Space]", () => Promise.reject(new Error("script error")));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(page.said).toHaveLength(1);
  expect(page.said[0]).toContain("[Space]");
});

test("the gate is read when the gesture arrives, not when it lands (#178)", async () => {
  const page = fakePage();
  page.log.on = true;
  page.lock("locked");
  let land = (): void => {};
  page.log.note("[Forward]", () => new Promise<void>((r) => (land = r)));
  // by the time it lands the fade is over and the engine would accept a press —
  // which says nothing about the one that was thrown away
  page.lock("ready");
  page.at(10);
  land();
  await Promise.resolve();
  await Promise.resolve();
  expect(page.said[0]).toContain("DROPPED");
});

test("an answer known at once is not dressed as a location change (#178)", () => {
  // The Nightdive intro (#171): `intro.key` returns whether the film took the
  // press and nothing about the page changes either way, so "nothing changed"
  // would be a lie about a press that had just skipped a film.
  const page = fakePage("the Nightdive intro");
  page.log.on = true;
  page.log.noteAnswered("[Esc]", "the Nightdive intro", "skipped the film");
  expect(page.said[0]).toContain("[+00:00.0] [Esc]");
  expect(page.said[0]).toContain("skipped the film · the Nightdive intro");
  expect(page.said[0]).not.toContain("nothing changed");
  page.log.on = false;
  page.log.noteAnswered("[Esc]", "the Nightdive intro", "skipped the film");
  expect(page.said).toHaveLength(1);
});
