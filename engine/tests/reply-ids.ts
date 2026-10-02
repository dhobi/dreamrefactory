/**
 * A conversation's answers can show the ids a speedrun sheet answers them by
 * (#377; engine/src/web/puppet-view.ts).
 *
 *   npx vitest run engine/tests/reply-ids.ts
 *
 * `say([103,102,101])` picks answers by the script's ids, which the game never
 * shows: finding them meant reading the puppet's script. With `replyIds.shown`,
 * each answer row ends in its id, `[101]`, in a grey that is no colour of the
 * game's, so it reads as the workbench's note and not as the game's text. Off,
 * the rows are exactly what the game draws. The close-up is a stub with two
 * answers and a canvas context that records what is written on it.
 */
import { afterEach, expect, test } from "vitest";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { PuppetView, replyIds } from "@dreamfactory/engine/web/puppet-view";

afterEach(() => {
  replyIds.shown = false;
});

/** a session holding a close-up that offers two answers */
function talking(): GameSession {
  const session = new GameSession(() => null, new NullAudioSink());
  (session.puppetCtrl as unknown as { puppet: unknown }).puppet = {
    visible: true,
    name: "jones",
    stanceIdx: 0,
    subtitle: "",
    bevels: [
      { text: "Who are you?", id: 101 },
      { text: "Goodbye.", id: 103 },
    ],
    chosen: null,
    press: null,
    pup: { paletteRaw: new Uint8Array(256 * 3), stances: [], bandLocation: 0, file: { containers: [] } },
  };
  return session;
}

/** every string written, with where and in what */
function draw(view: PuppetView): { text: string; x: number; y: number; fill: string }[] {
  const written: { text: string; x: number; y: number; fill: string }[] = [];
  const ctx = {
    fillStyle: "#000" as string,
    strokeStyle: "#000",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalCompositeOperation: "source-over",
    save() {},
    restore() {},
    fillRect() {},
    strokeRect() {},
    measureText: (s: string) => ({ width: s.length * 6 }),
    fillText(text: string, x: number, y: number) {
      written.push({ text, x, y, fill: String(this.fillStyle) });
    },
  };
  view.drawOverlay(ctx as unknown as CanvasRenderingContext2D);
  return written;
}

test("in play, the answers are only the game's text", () => {
  const written = draw(new PuppetView(talking()));
  expect(written.map((w) => w.text)).toEqual(["Who are you?", "Goodbye."]);
});

test("switched on, each answer ends in its id, bracketed, in a grey of its own", () => {
  replyIds.shown = true;
  const written = draw(new PuppetView(talking()));
  expect(written.map((w) => w.text)).toEqual(["Who are you?", "Goodbye.", " [101]", " [103]"]);
  const [who, bye, id1, id3] = written;
  // straight after the text on the same row, not over it
  expect(id1.y).toBe(who.y);
  expect(id1.x).toBe(who.x + "Who are you?".length * 6);
  expect(id3.y).toBe(bye.y);
  expect(id3.x).toBe(bye.x + "Goodbye.".length * 6);
  // and not in the answers' ink
  expect(id1.fill).not.toBe(who.fill);
  expect(id1.fill).toBe("#9a9a9a");
});
