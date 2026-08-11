/**
 * The pane's rolling log (src/log-buffer.ts).
 *
 * The pane used to be its own storage — main.ts appended to a `<pre>` and the bug
 * reporter split the text back apart — so there was nothing to test and nothing
 * capping it. What matters now is that it stays bounded, that the lines a report
 * carries are the NEWEST ones, and that a full repaint is rare rather than
 * per-line.
 */
import { test, expect } from "vitest";
import { LOG_LINES_KEPT, LogBuffer } from "../../src/log-buffer";

test("the log stays bounded, and drops the oldest lines", () => {
  const buf = new LogBuffer(100, 10);
  for (let i = 0; i < 100; i++) buf.push(`line ${i}`);
  expect(buf.lines.length, "at the cap, nothing has gone yet").toBe(100);
  expect(buf.lines[0]).toBe("line 0");

  // one past the cap: a batch of the oldest goes, and the newest is still there
  const write = buf.push("line 100");
  expect(write.repaint, "the pane has to be redrawn when lines go").toBe(true);
  expect(buf.lines.length).toBe(91);
  expect(buf.lines[0], "the first ten are gone").toBe("line 10");
  expect(buf.lines[buf.lines.length - 1]).toBe("line 100");

  // and it never grows again, however long the session runs
  for (let i = 101; i < 5000; i++) buf.push(`line ${i}`);
  expect(buf.lines.length <= 100, `bounded at ${buf.lines.length}`).toBe(true);
  expect(buf.lines[buf.lines.length - 1]).toBe("line 4999");
});

test("a repaint costs once per batch, not once per line", () => {
  const buf = new LogBuffer(100, 10);
  let repaints = 0;
  for (let i = 0; i < 1000; i++) if (buf.push(`line ${i}`).repaint) repaints++;
  // 900 lines arrive past the cap, ten dropped at a time
  expect(repaints).toBe(90);
  expect(buf.dropped, "and it says how many left").toBe(900);
});

/**
 * A reader that has seen the first N lines has to be able to say where it got to
 * after some of them have gone. The browser gate's ENGINELOG counts lines it has
 * reported and would otherwise skip a whole batch the first time one is dropped.
 */
test("a follower can tell where it got to after lines roll off", () => {
  const buf = new LogBuffer(100, 10);
  const seenLines: string[] = [];
  let seen = 0;
  for (let i = 0; i < 1000; i++) {
    buf.push(`line ${i}`);
    // what the gate does on each drain: an absolute count, less what has gone
    const from = Math.max(0, seen - buf.dropped);
    seenLines.push(...buf.lines.slice(from));
    seen = buf.dropped + buf.lines.length;
  }
  expect(seenLines.length, "every line reported exactly once").toBe(1000);
  expect(seenLines[0]).toBe("line 0");
  expect(seenLines[999]).toBe("line 999");
});

test("a bug report carries the newest lines", () => {
  const buf = new LogBuffer(100, 10);
  for (let i = 0; i < 500; i++) buf.push(`line ${i}`);
  expect(buf.tail(3), "oldest first, as bug-report.ts prints them").toEqual([
    "line 497",
    "line 498",
    "line 499",
  ]);
  expect(buf.tail(8).length, "the eight a report has room for").toBe(8);
});

test("clearing leaves nothing behind for the next game", () => {
  const buf = new LogBuffer();
  buf.push("boot: reading gamefiles/");
  buf.clear();
  expect(buf.lines).toEqual([]);
  expect(buf.text()).toBe("");
  expect(buf.tail(8)).toEqual([]);
});

/**
 * The page's own cap, against the measurement it was chosen from: a carried
 * playthrough from the cold boot to the credits emits 1141 lines, so a real game
 * never reaches the cap and a report never loses a line it wanted.
 */
test("the page's cap is well clear of a whole playthrough", () => {
  const A_WHOLE_GAME = 1141;
  expect(LOG_LINES_KEPT).toBeGreaterThan(A_WHOLE_GAME * 4);
  const buf = new LogBuffer(LOG_LINES_KEPT);
  for (let i = 0; i < A_WHOLE_GAME; i++) buf.push("movie click (264,357) frame 0 -> type 6");
  expect(buf.lines.length, "nothing dropped over a whole game").toBe(A_WHOLE_GAME);
});
