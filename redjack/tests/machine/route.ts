/**
 * The moves a RedJack route is written in — each one a thing the PLAYER does,
 * through the same door the page's input goes through, and each one checking
 * that it did what it says.
 *
 *   - {@link goTo} walks the room: the set main's `keydown` turns to the next
 *     exit on "left"/"right" and walks the one ahead on "up"
 *     (liznite.sett 0001), so a hop is "turn until the exit you want is ahead,
 *     then up". The path is a breadth-first search over the `.sett`'s exits.
 *   - {@link clickOn} finds where on screen the boot's `hittest` answers a name
 *     — the actor, prop or quad the player would click — and clicks there.
 *   - {@link converse} answers a conversation by clicking the plaque whose text
 *     the route names, and fails if the game offers something else.
 */
import type { MazeFilm } from "@dreamfactory/engine/df/sett";
import { fail, type Headless } from "./harness";

/** the room's nodes by the name the scripts use, and its exits as node names */
function graph(h: Headless): Map<string, string[]> {
  const maze = h.session.maze;
  if (!maze) fail("no room on screen");
  const sett = (maze as unknown as { sett: { nodes: { name: string; node: number }[] } }).sett;
  const byContainer = new Map(sett.nodes.map((n) => [n.node, n.name]));
  return new Map(
    sett.nodes.map((n) => [n.name, maze.exits(n.name).map((f: MazeFilm) => byContainer.get(f.to) ?? "")]),
  );
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** the node names from here to `to`, not counting here; fails if there is no way */
export function pathTo(h: Headless, to: string): string[] {
  const g = graph(h);
  const from = [...g.keys()].find((n) => same(n, h.node()));
  const goal = [...g.keys()].find((n) => same(n, to));
  if (!from || !goal) fail(`no node ${!from ? h.node() : to} in ${h.room()}`);
  const prev = new Map<string, string>([[from, ""]]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift()!;
    if (at === goal) break;
    for (const next of g.get(at) ?? []) {
      if (next && !prev.has(next)) {
        prev.set(next, at);
        queue.push(next);
      }
    }
  }
  if (!prev.has(goal)) fail(`${h.room()}: no way from ${from} to ${goal}`);
  const path: string[] = [];
  for (let n = goal; n !== from; n = prev.get(n)!) path.unshift(n);
  return path;
}

/** press a key and let the game answer it */
export async function press(h: Headless, key: string, what = key): Promise<void> {
  h.key(key);
  await h.settle(`${what} at ${h.node()}`);
}

/**
 * One hop to a neighbouring node, the player's way: "right" until the exit to
 * it is the one `nearexit` finds ahead, then "up". A node with more exits than
 * a turn visits in one lap has had its lap when the heading comes round again.
 */
export async function step(h: Headless, to: string): Promise<void> {
  const maze = h.session.maze!;
  const here = h.node();
  const exits = graph(h).get([...graph(h).keys()].find((n) => same(n, here))!) ?? [];
  const want = exits.findIndex((n) => same(n, to)) + 1;
  if (!want) fail(`${h.room()}/${here} has no exit to ${to} (it has ${exits.join(", ")})`);
  for (let turn = 0; maze.nearExit(here, maze.heading) !== want; turn++) {
    if (turn > exits.length + 1) fail(`${here}: turning never faced the exit to ${to}`);
    await press(h, "right", `turning towards ${to}`);
  }
  // "up" scrolls to face the exit first and walks only when it is within 30°
  for (let tries = 0; !same(h.node(), to) && !talking(h); tries++) {
    if (tries === 3) fail(`${here}: "up" at the exit to ${to} left us at ${h.node()}`);
    await press(h, "up", `walking to ${to}`);
  }
}

/** a conversation is waiting for an answer */
export const talking = (h: Headless): boolean => h.host.director.awaitingChoice;

/**
 * Walk to a node of this room by the shortest way. A node that starts a
 * conversation as you arrive (liznite's Node58, the first time) ends the walk
 * there with the question up, for the route to answer with {@link converse}.
 */
export async function goTo(h: Headless, to: string): Promise<void> {
  for (const next of pathTo(h, to)) {
    if (talking(h)) fail(`walking to ${to}: a conversation opened at ${h.node()}`);
    await step(h, next);
  }
}

/**
 * Where the boot's `hittest` answers `name` on screen now, in the middle of it,
 * or null. A coarse
 * grid first and a fine one only if that misses, so a big target is found in
 * a few hundred tests and a small one still is.
 */
export function findOnScreen(h: Headless, name: string): { x: number; y: number } | null {
  const { width, height } = h.host.director.screen;
  for (const grid of [16, 4]) {
    const hits: { x: number; y: number }[] = [];
    for (let y = grid / 2; y < height; y += grid)
      for (let x = grid / 2; x < width; x += grid)
        if (same(h.session.hitTestAt(x, y).name, name)) hits.push({ x, y });
    // the hit nearest the middle of the thing: its edge is the first pixel an
    // animating actor takes away (Lyle crouches), and {@link face} deals with
    // a thing that is in the scroll margin
    if (!hits.length) continue;
    const cx = hits.reduce((a, p) => a + p.x, 0) / hits.length;
    const cy = hits.reduce((a, p) => a + p.y, 0) / hits.length;
    const d = (p: { x: number; y: number }): number => (p.x - cx) ** 2 + (p.y - cy) ** 2;
    return hits.reduce((a, b) => (d(b) < d(a) ? b : a));
  }
  return null;
}

/**
 * Bring what `hittest` calls `name` onto the screen and out of the boot's
 * scroll margin, where a click scrolls instead of reaching it. Turning ("right")
 * finds it if it is behind; resting the pointer on the edge it is near brings it
 * in the way `idle ()` turns the view (boot tracknodescroll). Answers where it is.
 */
export async function face(h: Headless, name: string): Promise<{ x: number; y: number }> {
  let at = findOnScreen(h, name);
  for (let turn = 0; !at && turn < 8; turn++) {
    await press(h, "right", `looking for ${name}`);
    at = findOnScreen(h, name);
  }
  if (!at) fail(`${h.room()}/${h.node()}: "${name}" is nowhere on screen`);
  const margin = Number(global(h, "margin") || 0);
  const { width, height } = h.host.director.screen;
  const inMargin = (p: { x: number; y: number }): boolean =>
    p.x < margin || p.y < margin || p.x >= width - margin || p.y >= height - margin;
  if (!inMargin(at)) return at;
  for (let hover = 0; at && inMargin(at); hover++) {
    if (hover === 400) fail(`${h.node()}: resting on the edge never brought "${name}" out of the margin`);
    h.session.setPointer(at.x, at.y);
    await h.frame(1);
    at = findOnScreen(h, name);
  }
  h.session.setPointer(width / 2, height / 2);
  await h.settle(`the view to stop on ${name}`);
  return findOnScreen(h, name) ?? fail(`${h.node()}: "${name}" is gone once the view stopped`);
}

/** click on what `hittest` calls `name`, {@link face}d first */
export async function clickOn(h: Headless, name: string): Promise<void> {
  const at = await face(h, name);
  h.click(at.x, at.y);
  await h.frame(3);
}

/**
 * Play a conversation to its end: every plaque the game offers is answered
 * with the next of `answers` (the start of its text is enough), and the game
 * offering none of the answer's text is a failure that prints what it did offer.
 * Ends when the room has the screen back.
 */
export async function converse(h: Headless, answers: string[], what: string): Promise<void> {
  const dir = h.host.director;
  const left = [...answers];
  await h.until(() => h.owner() === "puppet", `${what} to open`, 2_000);
  for (;;) {
    await h.until(() => dir.awaitingChoice || h.idle(), `${what}: a choice or the end`);
    if (!dir.awaitingChoice) break;
    const want = left.shift();
    const offered = dir.choices.map((c) => c.text);
    if (want === undefined) fail(`${what}: the game asks again (${offered.join(" | ")}) and the route has no answer`);
    const i = offered.findIndex((t) => t.toLowerCase().startsWith(want.toLowerCase()));
    if (i < 0) fail(`${what}: no "${want}" among ${offered.join(" | ")}`);
    const r = dir.choiceRects[i];
    h.click(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2));
    await h.frame(3);
  }
  if (left.length) fail(`${what}: ended with ${left.length} answer(s) unused: ${left.join(" | ")}`);
  await h.settle(what);
}

/** an ai flag the way the scripts read it: `sendtoactorfx (who, getai (flag))` */
export async function ai(h: Headless, who: string, flag: string): Promise<string> {
  return String(await h.session.sendEvent("sendtoactorfx", who, "getai", [flag], "route"));
}

/** a global the way the scripts read it */
export function global(h: Headless, name: string): string {
  return String(h.session.interp.globals.get(name) ?? "");
}

/** how far `who` stands from the player, as the cast's `nearactor` measures it: `calcdist` on x and y */
export function distanceTo(h: Headless, who: string): number {
  const cam = h.session.maze?.camera();
  const a = h.session.actorRuntime.get(who);
  if (!cam || !a) fail(`no ${!cam ? "camera" : `actor ${who}`} to measure from`);
  return Math.hypot(a.worldX - cam.x, a.worldY - cam.y);
}

/**
 * Let the world run until `who` is within the room's `hotdist` — the actors that
 * pace (the bartender walks between his two stars) are only talked to when they
 * come near, and a click on one too far away is a click on the room, which walks.
 */
export async function waitNear(h: Headless, who: string, hotdist: number): Promise<void> {
  await h.until(() => distanceTo(h, who) < hotdist && h.idle(), `${who} to come within ${hotdist}`);
}
