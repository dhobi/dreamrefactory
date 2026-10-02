/**
 * What the screen shows, with the game drawing: the play suites run with
 * `draws: false` and follow the game's state, so nothing else here looks at
 * the picture the base and the city paint (0x40d37e, 0x407260).
 *
 *   npm test -w lunicus -- screen
 *
 * Opened from the title by File ▸ Open, as a player would:
 *
 *   - **the base**: a crew member in view is painted over the maze's picture
 *     where `drawnAt` puts her, and nowhere else changes;
 *   - **the city** (a building's fifth floor, day two): the gun in the hand is
 *     at its anchor (0x84, 0xc0) and drawn last, every other change to the
 *     view is inside a picture the frame listed, the ENTERING line is written,
 *     and the panel's buttons are their pressed or raised pictures;
 *   - **the panel's buttons and the menu in a level** (0x410671, 0x417412):
 *     a weapon button down, the save button's dialog and back to navigation,
 *     help.move from the help button and from Help ▸ Help, File ▸ Save,
 *     Settings ▸ Keys; space fires a rocket whatever the mode (0x406603);
 *   - **the mouse in navigation** (0x40d7e0, 0x407621): a click on the view's
 *     left turns left, one in its middle walks straight on down the corridor;
 *   - **the player's death** (0x413dcd): three explosions over the view, the
 *     view shaken black along its top, a click then nobody's, the title — a
 *     death, counted; File ▸ Exit in a building is the title and no death.
 */
import { test } from "vitest";
import { writeSaveV0, type SaveGameV0 } from "@dreamfactory/engine/df/savegame-v0";
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { BUTTON_LEFT, BUTTON_TOP, FORWARD, LEFT, WALK_RECTS, MESSAGE_RECT, SCREEN_W, VIEW_H, VIEW_W } from "../../src/game/data";
import { drawnAt } from "../../src/game/crew";
import { moved, type Pose } from "../../src/game/maze";
import { fail, headless, ok, pass, haveRip, type Headless } from "./harness";

const save = (o: Partial<SaveGameV0>): Uint8Array =>
  writeSaveV0({ difficulty: 2, level: 6, came: 1, elevator: 0, progress: 1, score: 0, enemies: 10000, energy: 10000, shields: 10000, bullets: 10000, grenades: 10000, rockets: 10000, ...o });

/** to the title, and File ▸ Open of this game */
function opened(h: Headless, bytes: Uint8Array): void {
  const g = h.game;
  h.until(() => g.titleUp, "the title");
  g.openGame(bytes);
}

/** the view's pixels that are not the picture under them */
function changed(px: Uint8Array, bare: Uint8Array): number[] {
  const out: number[] = [];
  for (let y = 0; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) if (px[y * SCREEN_W + x] !== bare[y * VIEW_W + x]) out.push(y * SCREEN_W + x);
  return out;
}

/** a picture's opaque pixels, drawn with its top-left at (top, left): how many of them the screen has */
function shows(px: Uint8Array, f: FrameV0, top: number, left: number): { opaque: number; match: number } {
  let opaque = 0;
  let match = 0;
  for (let r = 0; r < f.height; r++)
    for (let c = 0; c < f.width; c++) {
      const i = r * f.width + c;
      if (!f.opaque[i]) continue;
      opaque++;
      if (px[(top + r) * SCREEN_W + left + c] === f.indexed[i]) match++;
    }
  return { opaque, match };
}

/** a click that walks: answers how many cells it went, straight along the heading, and fails if it went otherwise */
function walkedFrom(from: Pose, click: () => Pose): number {
  const to = click();
  let p = from;
  for (let n = 1; n <= WALK_RECTS.length; n++) {
    p = moved(p, FORWARD);
    if (JSON.stringify(p) === JSON.stringify(to)) return n;
  }
  return fail(`a click in the middle at ${JSON.stringify(from)} went to ${JSON.stringify(to)}, not straight on`);
}

const inside = (i: number, [t, l, b, r]: readonly number[]): boolean => {
  const y = Math.floor(i / SCREEN_W);
  const x = i % SCREEN_W;
  return y >= t && y < b && x >= l && x < r;
};

test.skipIf(!haveRip())("screen", async () => {
  /* ---- the base: a figure over the maze ---------------------------------- */
  {
    const h = headless({ draws: true });
    const g = h.game;
    opened(h, save({ level: 2 }));
    h.settle("day one's lower floor, opened");
    const b = g.base!;
    const sasha = b.crew.find((c) => c.name === "sasha")!;
    h.walkTo({ x: sasha.home.cellX, y: sasha.home.cellY, dir: 0 });
    h.frame(6);
    const d = drawnAt(sasha, b.cam, b.maze.has);
    if (!d) fail(`sasha is not in view from ${JSON.stringify(h.pose())}`);
    const bare = b.maze.draw(b.maze.restFrame(b.pose), true)!;
    const diff = changed(g.m.screen.pixels, bare);
    const box = [Math.max(d.rect[0], d.clip[0]), Math.max(d.rect[1], d.clip[1]), Math.min(d.rect[2], d.clip[2]), Math.min(d.rect[3], d.clip[3])];
    const others = b.figures().filter((f) => f.frame !== d.frame);
    const stray = diff.filter((i) => !inside(i, box) && !others.some((o) => inside(i, o.rect)));
    if (stray.length) fail(`${stray.length} pixels of the view changed outside the figures, the first at ${stray[0] % SCREEN_W},${Math.floor(stray[0] / SCREEN_W)}`);
    const hers = diff.filter((i) => inside(i, box)).length;
    const area = (box[2] - box[0]) * (box[3] - box[1]);
    if (hers < area / 10) fail(`only ${hers} of sasha's ${area} pixels are painted`);
    ok(`the base: sasha painted in [${box.join(",")}] (${hers} of ${area} pixels), the rest of the view the maze's own`);

    // the mouse in navigation (0x40d7e0): a click on the view's left turns left, facing a thing (classified) or
    // down a corridor (outside the widest walk rect); one in the middle down a corridor walks on along it
    for (let turns = 0; turns < 2; turns++) {
      const from = h.pose();
      h.click(20, 132);
      h.settle("a click on the base's view, left");
      if (JSON.stringify(h.pose()) !== JSON.stringify(moved(from, LEFT))) fail(`a click on the left at ${JSON.stringify(from)} (byte ${b.maze.byte(from)}) went to ${JSON.stringify(h.pose())}`);
    }
    if (b.maze.byte(h.pose())) fail(`the base's turns did not end facing down a corridor: byte ${b.maze.byte(h.pose())}`);
    const steps = walkedFrom(h.pose(), () => (h.click(192, 132), h.settle("a click on the base's view, middle"), h.pose()));
    ok(`the base by the mouse: two turns left, then ${steps} cells straight on`);
  }

  /* ---- the city: the view, the hand, the panel ---------------------------- */
  const asked: string[][] = [];
  const h = headless({ draws: true, keysDialog: (fields, _d, done) => (asked.push(fields), done(null)) });
  const g = h.game;
  const m = g.m;
  // read through functions: the machine changes these under TypeScript's narrowing
  const mode = (): number => g.hud.mode;
  const saved = (): number => h.saves.length;
  const deaths = (): number => g.deaths;
  opened(h, save({ level: 8, came: 5, progress: 0, score: 1234 }));
  h.until(() => g.phase === "city" && !!g.city?.world, "the opened building");
  const c = g.city!;
  const w = c.world;
  h.settle("the building's first view");
  // a fresh frame: its list of pictures, then the screen as it painted them
  const frameNow = (): void => {
    const was = w.draws;
    h.until(() => w.draws !== was, "a frame", 20);
  };
  frameNow();
  const px = m.screen.pixels;
  const hand = w.draws.at(-1)!;
  if (hand.y !== 0x84 || hand.x !== 0xc0 || hand.depth !== 0 || !c.weapons.hand.includes(hand.frame))
    fail(`the last picture is not the hand at 0x84,0xc0: ${hand.y},${hand.x} depth ${hand.depth}`);
  const shown = shows(px, hand.frame, hand.y - hand.frame.anchorY, hand.x - hand.frame.anchorX);
  // clipped to the view: the hand's rows below it are the panel's
  const inView = (() => {
    let n = 0;
    for (let r = 0; r < hand.frame.height; r++) for (let k = 0; k < hand.frame.width; k++) if (hand.frame.opaque[r * hand.frame.width + k] && hand.y - hand.frame.anchorY + r < VIEW_H) n++;
    return n;
  })();
  if (shown.match < inView) fail(`the hand: ${shown.match} of its ${inView} pixels in the view are on the screen`);
  const bare = w.maze.draw(w.maze.restFrame(w.pose), true)!;
  const boxes = w.draws.map((d) => {
    const top = d.y - d.frame.anchorY;
    const left = d.mirror ? d.x - (d.frame.width - d.frame.anchorX) : d.x - d.frame.anchorX;
    return [top, left, top + d.frame.height, left + d.frame.width];
  });
  const stray = changed(px, bare).filter((i) => !boxes.some((bx) => inside(i, bx)));
  if (stray.length) fail(`${stray.length} pixels of the view changed outside the frame's ${w.draws.length} pictures`);
  ok(`the city: the hand at its anchor, drawn last (${shown.match} pixels); the rest of the view the maze's own and ${w.draws.length - 1} other pictures`);

  // the ENTERING line on the panel: the message the opened building said, in more than one ink
  const said = m.screen.pixels;
  const inks = new Set<number>();
  for (let y = MESSAGE_RECT[0]; y < MESSAGE_RECT[2]; y++) for (let x = MESSAGE_RECT[1]; x < MESSAGE_RECT[3]; x++) inks.add(said[y * SCREEN_W + x]);
  if (g.hud.message < 0 || inks.size < 2) fail(`the message line: message ${g.hud.message}, ${inks.size} inks`);

  // the buttons: navigation down, the weapons up
  const button = (i: number): number => {
    const f = c.panel.frames[c.panel.button(i)];
    return shows(m.screen.pixels, f, BUTTON_TOP, BUTTON_LEFT[i]).match / shows(m.screen.pixels, f, BUTTON_TOP, BUTTON_LEFT[i]).opaque;
  };
  if (c.panel.button(2) !== 3 || button(2) !== 1 || button(3) !== 1) fail(`the panel's buttons are not as the HUD has them (nav ${button(2)}, bullets ${button(3)})`);
  ok(`the panel: the message line written, the navigation button down, the weapons up`);

  /* ---- the panel's buttons, the keys and the menu in a level ------------- */
  const at = (i: number): [number, number] => [BUTTON_LEFT[i] + 32, BUTTON_TOP + 20];
  h.click(...at(3));
  h.settle("the bullets button");
  frameNow();
  if (g.hud.mode !== 3 || c.panel.button(3) !== 4 || button(3) !== 1 || c.panel.button(2) !== 10 || button(2) !== 1)
    fail(`the bullets button: mode ${g.hud.mode}, its picture ${c.panel.button(3)}`);
  ok("the bullets button: down, navigation up");

  const rockets = g.hud.rockets;
  h.key(" ");
  h.settle("a rocket");
  if (g.hud.rockets >= rockets || g.hud.mode !== 3) fail(`space: rockets ${rockets} → ${g.hud.rockets}, mode ${g.hud.mode}`);
  ok(`space: a rocket (${rockets} → ${g.hud.rockets}), still on bullets`);

  h.click(...at(1));
  h.settle("the save button");
  if (saved() !== 1 || mode() !== 2) fail(`the save button: ${h.saves.length} saves, mode ${g.hud.mode}`);
  const saw = (film: string): number => h.logs.filter((l) => l.startsWith("▶ ") && l.includes(film)).length;
  h.click(...at(0));
  h.settle("help.move from the help button");
  if (saw("help.mov") !== 1 || mode() !== 2) fail(`the help button: help.move ${saw("help.mov")} times, mode ${g.hud.mode}`);
  ok("the save button: the dialog, then navigation; the help button: help.move");

  h.input.menu(203);
  h.settle("File ▸ Save");
  h.input.menu(602);
  h.settle("Help ▸ Help");
  h.input.menu(406);
  h.settle("Settings ▸ Keys");
  if (saved() !== 2 || saw("help.mov") !== 2 || asked.length !== 1 || asked[0].join("") !== "WADHJKL")
    fail(`the menu in the building: ${h.saves.length} saves, help.move ${saw("help.mov")} times, Keys asked ${asked.length}`);
  ok("the menu in the building: File ▸ Save, Help ▸ Help, Settings ▸ Keys");

  if (w.maze.byte(w.pose)) fail(`the building does not open facing down a corridor: byte ${w.maze.byte(w.pose)}`);
  const cells = walkedFrom({ ...w.pose }, () => (h.click(192, 132), h.settle("a click on the view's middle"), { ...w.pose }));
  ok(`a click on the view's middle in navigation: ${cells} cells straight on`);

  const from = { ...w.pose };
  h.click(20, 132);
  h.settle("a click on the view's left");
  const want = moved(from, LEFT);
  if (JSON.stringify(w.pose) !== JSON.stringify(want)) fail(`a click on the left in navigation: ${JSON.stringify(from)} → ${JSON.stringify(w.pose)}`);
  ok(`a click on the view's left: turned to ${w.pose.dir}`);

  /* ---- File ▸ Exit in a building (0x41745e): the title there and then, and no death */
  h.input.menu(204);
  h.until(() => g.titleUp, "the title after File ▸ Exit", 20_000);
  if (g.deaths !== 0 || g.progress.came !== 0 || h.logs.includes("the player died: back to the title"))
    fail(`File ▸ Exit in the building: ${g.deaths} deaths, floor ${g.progress.came}`);
  ok("File ▸ Exit in the building: the title, not a death");

  /* ---- the player's death, in the building opened again ------------------ */
  g.openGame(save({ level: 8, came: 5, progress: 0 }));
  h.until(() => g.phase === "city" && !!g.city?.world && g.city !== c, "the building opened again");
  h.settle("the building's first view, again");
  const w2 = g.city!.world;
  const still = { ...w2.pose };
  g.hud.energy = 0;
  const blasts = new Set<string>();
  let shaken = 0;
  let clicked = false;
  for (let i = 0; i < 3000 && g.phase === "city"; i++) {
    const was = w2.draws;
    if (!g.tick()) fail(`the machine ended: ${g.stopped}`);
    if (w2.draws !== was) {
      for (const d of w2.draws) if (w2.pyro.includes(d.frame)) blasts.add(`${d.y},${d.x}${d.mirror ? " mirrored" : ""}`);
      let black = true;
      for (let y = 0; y < 16 && black; y++) for (let x = 0; x < VIEW_W; x++) if (m.screen.pixels[y * SCREEN_W + x] !== 0xff) (black = false);
      if (black) shaken++;
      // a dead player's click is nobody's
      if (!clicked) (clicked = true), h.input.click(20, 132);
    }
  }
  if (g.phase !== "title" || deaths() !== 1 || !h.logs.includes("the player died: back to the title"))
    fail(`after dying: ${g.phase}, ${g.deaths} deaths`);
  if ([...blasts].sort().join(" / ") !== "200,192 mirrored / 225,272 / 250,112") fail(`the explosions: ${[...blasts].join(" / ")}`);
  if (!shaken) fail("the view was never shaken black along its top");
  if (JSON.stringify(w2.pose) !== JSON.stringify(still)) fail("a click while dying moved the player");
  ok(`the player's death: three explosions at ${[...blasts].join(", ")}, the view shaken ${shaken} frames, the title — a death`);

  pass("screen");
});
