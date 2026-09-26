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
import { TURN, type MazeFilm } from "@dreamfactory/engine/df/sett";
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
  // the set's keydown walks only when the exit `nearexit` finds is within 30° —
  // with few exits the nearest can still be well off to the side
  const off = (): number => {
    const d = Math.abs(((maze.exitField(here, want, 1) - maze.heading) % TURN + TURN) % TURN);
    return Math.min(d, TURN - d);
  };
  for (let turn = 0; maze.nearExit(here, maze.heading) !== want || off() >= TURN / 12; turn++) {
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

/** what `hittest` says a thing is: "prop", "actor", "quad", "button"… */
export type HitType = string;
const hitIs = (hit: { name: string; type: string }, name: string, type?: HitType): boolean =>
  same(hit.name, name) && (!type || hit.type === type);

/**
 * Where the boot's `hittest` answers `name` on screen now — of `type` when two
 * things share the name (rjcave's trunk is the quad "chest", and the inventory's
 * chest is a prop of the same name, over the bottom left of every room), in the middle of it,
 * or null. A coarse
 * grid first and a fine one only if that misses, so a big target is found in
 * a few hundred tests and a small one still is.
 */
export function findOnScreen(
  h: Headless,
  name: string,
  type?: HitType,
  grids: number[] = [16, 8],
): { x: number; y: number } | null {
  const { width, height } = h.host.director.screen;
  for (const grid of grids) {
    const hits: { x: number; y: number }[] = [];
    for (let y = grid / 2; y < height; y += grid)
      for (let x = grid / 2; x < width; x += grid)
        if (hitIs(h.session.hitTestAt(x, y), name, type)) hits.push({ x, y });
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
export async function face(h: Headless, name: string, type?: HitType): Promise<{ x: number; y: number }> {
  let at = findOnScreen(h, name, type);
  const margin = Number(global(h, "margin") || 0);
  const { width, height } = h.host.director.screen;
  for (let turn = 0; !at && turn < 8; turn++) {
    await press(h, "right", `looking for ${name}`);
    at = findOnScreen(h, name, type);
  }
  // a node with one exit does not turn on "right": pan the view round instead,
  // the pointer resting on the right edge (boot region/tracknodescroll) — and
  // look down, and up, the same way: the jail's keys lie on the floor below
  const rest = [
    { x: width - 4, y: height / 2, n: 40 },
    { x: width / 2, y: height - 4, n: 30 },
    { x: width - 4, y: height / 2, n: 40 },
    { x: width / 2, y: 4, n: 60 },
    { x: width - 4, y: height / 2, n: 40 },
  ];
  const panned = !at;
  for (const r of rest) {
    for (let pan = 0; !at && pan < r.n; pan++) {
      h.session.setPointer(r.x, r.y);
      await h.frame(4);
      // the coarse grid alone while the view moves; the fine one once it is found
      at = findOnScreen(h, name, type, [16]) && findOnScreen(h, name, type);
    }
  }
  if (!at) fail(`${h.room()}/${h.node()}: "${name}" is nowhere on screen`);
  const inMargin = (p: { x: number; y: number }): boolean =>
    p.x < margin || p.y < margin || p.x >= width - margin || p.y >= height - margin;
  // a pan leaves the pointer on the edge and the view still turning, and a click
  // while the view turns scrolls instead (boot scrollmargin → isnodescrolling):
  // a thing found clear of the margin is clicked once the hand is back in the
  // middle and the view has stopped (the skull's gem quad, found panning)
  if (panned && !inMargin(at)) {
    h.session.setPointer(width / 2, height / 2);
    await h.settle(`the view to stop on ${name}`);
    at = findOnScreen(h, name, type) ?? fail(`${h.node()}: "${name}" is gone once the view stopped`);
  }
  // `scrollmargin` answers false while the room is hidden, as it is behind a stage;
  // and the boot asks it only of a quad, and of a prop or an actor at a distance
  // of 0 or more (boot mousedown: `propdist (thename) >= 0 & scrollmargin`) — the
  // jail's keys, nearer than that, take a click anywhere
  const hit = h.session.hitTestAt(at.x, at.y);
  const near =
    (hit.type === "prop" && Number(h.session.propRuntime.get(hit.name)?.dist ?? 0) < 0) ||
    (hit.type === "actor" && Number(h.session.actorRuntime.get(hit.name)?.dist ?? 0) < 0);
  if (!inMargin(at) || near || !h.session.setVisible || h.session.maze?.view !== "node") return at;
  for (let hover = 0; at && inMargin(at); hover++) {
    if (hover === 100) fail(`${h.node()}: resting on the edge never brought "${name}" out of the margin (at ${at.x},${at.y}, the middle answers ${h.session.hitTestAt(width / 2, height / 2).name})`);
    h.session.setPointer(at.x, at.y);
    await h.frame(4);
    at = findOnScreen(h, name, type);
  }
  h.session.setPointer(width / 2, height / 2);
  await h.settle(`the view to stop on ${name}`);
  return findOnScreen(h, name, type) ?? fail(`${h.node()}: "${name}" is gone once the view stopped`);
}

/** click on what `hittest` calls `name`, {@link face}d first */
export async function clickOn(h: Headless, name: string, type?: HitType): Promise<void> {
  const at = await face(h, name, type);
  h.click(at.x, at.y);
  await h.frame(3);
}

/**
 * Play a conversation to its end: every plaque the game offers is answered
 * with the next of `answers` (the start of its text is enough), and the game
 * offering none of the answer's text is a failure that prints what it did offer.
 * A frame of a film that waits for a click (a letter shown in the middle of a
 * talk) is clicked through. Ends when the room has the screen back — or, with
 * `thenAsks`, at the first question after the last answer.
 */
export async function converse(
  h: Headless,
  answers: string[],
  what: string,
  opts: { thenAsks?: boolean } = {},
): Promise<void> {
  const dir = h.host.director;
  const left = [...answers];
  let answered = "";
  let stale = 0;
  // a talk opened with `openpuppetfile` and `sendtopuppet` rather than
  // `runpuppet` (Erzulie's, from her set's openset) asks without the puppet
  // owning the screen
  await h.until(() => h.owner() === "puppet" || dir.awaitingChoice, `${what} to open`, 2_000);
  for (;;) {
    await h.until(() => dir.awaitingChoice || h.idle() || filmWaits(h), `${what}: a choice or the end`);
    if (filmWaits(h)) {
      await clickFilm(h);
      continue;
    }
    if (!dir.awaitingChoice) break;
    const offered = dir.choices.map((c) => c.text);
    // the plaques just answered, up again: a talk that looks for a click a tick
    // long before it clears them (marquez2.pupp `puppetevent (0)`) is not asking
    if (offered.join("|") === answered) {
      await h.frame(4);
      if (dir.awaitingChoice && dir.choices.map((c) => c.text).join("|") === answered && ++stale < 5) continue;
      if (!dir.awaitingChoice) continue;
    }
    stale = 0;
    const want = left.shift();
    // the talk hands on to the next thing that asks (Justice's last word on the
    // ship is the day's last; the next day opens on a question of its own)
    if (want === undefined && opts.thenAsks) return;
    if (want === undefined) fail(`${what}: the game asks again (${offered.join(" | ")}) and the route has no answer`);
    const i = offered.findIndex((t) => t.toLowerCase().startsWith(want.toLowerCase()));
    if (i < 0) fail(`${what}: no "${want}" among ${offered.join(" | ")}`);
    const r = dir.choiceRects[i];
    h.click(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2));
    answered = offered.join("|");
    await h.frame(3);
  }
  if (left.length) fail(`${what}: ended with ${left.length} answer(s) unused: ${left.join(" | ")}`);
  await h.settle(what);
}

/** a film on screen is standing on a frame that waits for a click (anne1.pupp letter: letter.move's "Letter 1") */
export const filmWaits = (h: Headless): boolean => h.host.director.movies.waitingRegions.length > 0;

/** click the first of the regions a waiting film frame offers, in its middle, and let the film go on */
export async function clickFilm(h: Headless): Promise<void> {
  const r = h.host.director.movies.waitingRegions[0];
  const x = Math.round((r.x0 + r.x1) / 2);
  const y = Math.round((r.y0 + r.y1) / 2);
  h.click(x, y);
  await h.until(() => !filmWaits(h) || h.host.director.movies.waitingRegions[0] !== r, `the film to take the click at ${x},${y}`, 2_000);
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
 * Walk up to `who`: to the node of this room nearest where they stand. The
 * cast's `nearactor` only answers a click from within the room's `hotdist`, so a
 * player crosses the room first (Justice at his desk is out of reach from the
 * cabin door, capts.sett Node10).
 */
export async function walkUpTo(h: Headless, who: string): Promise<void> {
  const a = h.session.actorRuntime.get(who) ?? fail(`no actor ${who} in ${h.room()}`);
  const nodes = (h.session.maze as unknown as { sett: { nodes: { name: string; x: number; y: number }[] } }).sett.nodes;
  const d = (n: { x: number; y: number }): number => Math.hypot(n.x - a.worldX, n.y - a.worldY);
  const nearest = nodes.reduce((m, n) => (d(n) < d(m) ? n : m));
  if (!same(nearest.name, h.node())) await goTo(h, nearest.name);
}

/**
 * Let the world run until `who` is within the room's `hotdist` — the actors that
 * pace (the bartender walks between his two stars) are only talked to when they
 * come near, and a click on one too far away is a click on the room, which walks.
 */
export async function waitNear(h: Headless, who: string, hotdist: number): Promise<void> {
  await h.until(() => distanceTo(h, who) < hotdist && h.idle(), `${who} to come within ${hotdist}`);
}

/**
 * Use one thing on another the way the inventory wants it: press on `what`,
 * carry it with the button held — inven.shop `stdmove` follows the pointer in a
 * `while stilldown ()` loop — and let go over `onto`, which is where the item's
 * own test looks (`pointinbutton`, `pointinprop`, `pointinactor`).
 */
export async function drag(h: Headless, what: string, onto: string, ontoType?: HitType): Promise<void> {
  // the thing carried is always a prop; the target may share its name (horn3's
  // quad "horn" is where the inventory's "horn" goes)
  const to = findOnScreen(h, onto, ontoType) ?? fail(`${h.node()}: nothing called "${onto}" to drop ${what} on`);
  const from = findOnScreen(h, what, "prop") ?? fail(`${h.node()}: "${what}" is not on screen to pick up`);
  h.mouseDown(from.x, from.y);
  await h.frame(3);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    h.session.setPointer(Math.round(from.x + ((to.x - from.x) * i) / steps), Math.round(from.y + ((to.y - from.y) * i) / steps));
    await h.frame(1);
  }
  h.mouseUp(to.x, to.y);
  await h.frame(3);
  await h.until(() => h.running().length === 0, `dropping ${what} on ${onto}`, 3_000);
}

/**
 * Carry `what` to `where` with the button held and scrape it to and fro there,
 * then let go — how the jail's cup, plate and spoon are rattled along the bars
 * (jail.shop `stdmove`: every move of more than the bars' spacing across the
 * window or the cell door rings, and letting go calls whoever is there).
 */
export async function rattle(h: Headless, what: string, where: { x: number; y: number }, strokes = 6): Promise<void> {
  const from = findOnScreen(h, what) ?? fail(`${h.node()}: "${what}" is not on screen to pick up`);
  h.mouseDown(from.x, from.y);
  await h.frame(3);
  const path: { x: number; y: number }[] = [];
  for (let i = 1; i <= 8; i++) path.push({ x: from.x + ((where.x - from.x) * i) / 8, y: from.y + ((where.y - from.y) * i) / 8 });
  for (let i = 0; i < strokes; i++) path.push({ x: where.x + (i % 2 ? 30 : -30), y: where.y });
  for (const p of path) {
    h.session.setPointer(Math.round(p.x), Math.round(p.y));
    await h.frame(1);
  }
  h.mouseUp(where.x, where.y);
  await h.frame(3);
}

/** carry `what` with the button held along a straight line to (x, y), and let go there */
export async function carry(h: Headless, what: string, to: { x: number; y: number }, type?: HitType): Promise<void> {
  const from = findOnScreen(h, what, type) ?? fail(`${h.node()}: "${what}" is not on screen to pick up`);
  h.mouseDown(from.x, from.y);
  await h.frame(3);
  for (let i = 1; i <= 10; i++) {
    h.session.setPointer(Math.round(from.x + ((to.x - from.x) * i) / 10), Math.round(from.y + ((to.y - from.y) * i) / 10));
    await h.frame(1);
  }
  h.mouseUp(to.x, to.y);
  await h.frame(3);
}

/**
 * Walk a room's old-style SCENES (fixed views, as v4's rooms were — the hub's
 * flame corridor is twelve of them) back to its nodes: in each scene turn
 * ("right") until the view faces a road that leads somewhere `wanted`, then
 * "up" along it. Answers the scenes passed through.
 */
export async function walkScenes(
  h: Headless,
  wanted: (road: { to: number; toScene: number }, scene: string) => boolean,
  max = 30,
): Promise<string[]> {
  const passed: string[] = [];
  for (let hop = 0; h.session.maze?.scene; hop++) {
    if (hop === max) fail(`the scenes never led out (${passed.join(" > ")})`);
    const m = h.session.maze;
    const sc = m.scene!;
    passed.push(sc.name);
    const goal = sc.views.find((v) => v.road && wanted(v.road, sc.name));
    if (!goal) fail(`${sc.name} has no road the walk wants`);
    for (let turn = 0; m.sceneView !== goal.name; turn++) {
      if (turn > sc.views.length + 1) fail(`${sc.name}: turning never faced ${goal.name}`);
      await press(h, "right", `turning to ${goal.name}`);
    }
    await press(h, "up", `walking out of ${sc.name}`);
  }
  return passed;
}

/**
 * Open the inventory the way the player finds it after day one: the chest in
 * the bottom left fades out unless the pointer is on its corner (boot `chest`,
 * `mouseonchest`: x 15–149, y 366–475), so the hand goes there, the chest fades
 * in, and it is clicked.
 */
export async function openInventory(h: Headless): Promise<void> {
  const chest = h.session.propRuntime.get("chest") ?? fail("no inventory chest");
  h.session.setPointer(80, 420);
  await h.until(() => chest.visible && Number(chest.ink) >= 7, "the chest to fade in", 200);
  const at = findOnScreen(h, "chest", "prop") ?? fail("the chest is not on screen");
  h.click(at.x, at.y);
  await h.until(() => h.running().length === 0, "the inventory to open", 400);
  await h.frame(5);
}

/** close the inventory: a click on the open chest (common.shop chest: `propdeg` 12 is open) */
export async function closeInventory(h: Headless): Promise<void> {
  const chest = h.session.propRuntime.get("chest") ?? fail("no inventory chest");
  if (Number(chest.deg) !== 12) return;
  const at = findOnScreen(h, "chest", "prop") ?? fail("the open chest is not on screen");
  h.click(at.x, at.y);
  await h.until(() => Number(chest.deg) === 0 && h.running().length === 0, "the inventory to close", 400);
  h.session.setPointer(320, 240);
}

/**
 * Face a heading (whole degrees) by turning, a press at a time, and go "up" —
 * the doors that are no exit of the node but a scripted jump the set's `keydown`
 * makes when you face them (the hub's lava, the beach's way to the links)
 */
export async function upFacing(h: Headless, deg: number): Promise<void> {
  const m = h.session.maze ?? fail("no room");
  const at = (): number => Math.round((m.heading * 360) / TURN);
  for (let i = 0; Math.abs(((at() - deg + 540) % 360) - 180) > 20; i++) {
    if (i === 16) fail(`${h.node()}: turning never faced ${deg} degrees`);
    await press(h, "right", `turning to ${deg} degrees`);
  }
  await press(h, "up", `going on at ${deg} degrees`);
}
