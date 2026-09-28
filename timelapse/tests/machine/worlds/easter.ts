/**
 * Easter Island (world I, disc one): from the hilltop where `open.mov` leaves
 * you, to the crystal that takes you to Egypt.
 *
 * Each step names the frame it wants and lets `goTo` find the keys, then does
 * what a player does there, and checks the game's own global for it.
 */
import { fail, ok, type Headless } from "../harness";
import { clickProp, clickRegion, drag, extent, goTo, regionPoint } from "../nav";

const need = (h: Headless, name: string, want: string, what: string): void => {
  if (h.g(name) !== want) fail(`${what}: ${name} is ${h.g(name) || "unset"}, not ${want} (${h.here()})`);
};

/** the camera, and the professor's journal */
export async function camp(h: Headless): Promise<void> {
  await goTo(h, { stage: 1, frame: 349 });
  await clickRegion(h, "camera");
  need(h, "gCameraTaken", "1", "the camera");
  await goTo(h, { stage: 1, frame: 350 });
  await clickRegion(h, "journal");
  ok(`the camera and the journal (${h.here()})`);
}

/**
 * The Collins gas lantern at the cave's mouth, lit as its instructions say:
 * ten strokes of the pump, the primer up, the gas knob up, a match struck
 * along the box and held over the mantle, and the primer down.
 */
export async function lantern(h: Headless): Promise<void> {
  await goTo(h, { stage: 4, frame: 605 });
  await clickProp(h, "TableMatchBox");
  need(h, "gHasMatches", "1", "the safety matches");
  await goTo(h, { stage: 5, frame: 867 });
  await clickRegion(h, "Lantern");
  // the pump: its handle held, and pulled up past y 300 and pushed down past
  // 317 (i.shp PumpHandle), a stroke a time
  const [px0, py0, px1] = extent(h, "PumpHandle");
  const px = Math.round((px0 + px1) / 2);
  h.mouseDown(px, py0 + 12);
  await h.frame(3);
  for (let i = 0; i < 10; i++) {
    h.moveTo(px, 290);
    await h.frame(3);
    h.moveTo(px, 325);
    await h.frame(3);
  }
  h.mouseUp(px, 325);
  await h.settle("the pump");
  need(h, "gLanternPumps", "10", "ten strokes of the pump");
  await clickProp(h, "PrimeLever");
  await clickProp(h, "GasKnob");
  await clickProp(h, "GasKnob");
  need(h, "gGasKnob", "2", "the gas knob up");
  // the match comes out of the box under the hand (MatchBox mousedown), and
  // strikes when it crosses 60 px of the box inside 30 ticks (HandleMatch)
  const [bx0, by0, bx1, by1] = extent(h, "MatchBox");
  const my = Math.round((by0 + by1) / 2) + 30;
  h.mouseDown(bx0 + 4, Math.round((by0 + by1) / 2));
  await h.frame(3);
  for (let x = bx0 - 4; x <= bx1 - 8; x += 20) {
    h.moveTo(x, my);
    await h.frame(1);
  }
  // and over the mantle, before it has burnt down
  for (let i = 1; i <= 10; i++) {
    h.moveTo(Math.round(bx1 + ((300 - bx1) * i) / 10), Math.round(my + ((320 - my) * i) / 10));
    await h.frame(1);
  }
  await h.until(() => h.g("gLanternLit") === "1", "the lantern to light", 2000);
  h.mouseUp(300, 320);
  await h.settle("the lit lantern");
  await clickProp(h, "PrimeLever");
  need(h, "gPrimeLever", "0", "the primer down");
  ok(`the lantern lit (${h.here()})`);
}

/**
 * The six masks. The stone face (frame 299, through the hotspot on frame 51)
 * opens its eyes on mask 4; each click on an eye's right (left) side makes it
 * the next (previous) of six. Water poured on the face makes the lava stone
 * for a moment, and the mask can be lifted off; and each goes on the hand of
 * the statue whose symbols name it (frame 514, i.shp `HeadInSlot`): slot 1
 * takes mask 5, then 1, 6, 3, 2 and 4.
 */
const SLOT_OF_HEAD: Record<number, number> = { 5: 1, 1: 2, 6: 3, 3: 4, 2: 5, 4: 6 };
/** the middle of each slot's band on frame 514 (`HeadInSlot`'s thresholds) */
const SLOT_X = [0, 80, 170, 262, 357, 459, 570];

export async function masks(h: Headless): Promise<void> {
  for (const head of [4, 5, 6, 3, 2, 1]) {
    // the first time through the hotspot on frame 51; once the face has
    // melted (gMelted), the tables lead to it from frame 509
    if (h.g("gMelted") === "1") await goTo(h, { stage: 7, frame: 299 });
    else {
      await goTo(h, { stage: 7, frame: 51 });
      await clickRegion(h, "up", "the stone face");
    }
    // the eyes open on mask 4, and the face waits with its lava melted
    await h.until(() => h.g("headSolid") === "0" && h.g("gEyePosition") !== "0", "the eyes to open", 4000);
    while (Number(h.g("gCurrHead")) !== head) {
      const right = Number(h.g("gCurrHead")) < head;
      h.click(right ? 370 : 310, 75);
      await h.settle("the eyes to turn");
      await h.until(() => [1, 6, 11, 16, 21, 26].includes(Number(h.g("gEyePosition"))), "the eyes at rest", 2000);
    }
    await clickRegion(h, "pour", "water on the face");
    if (h.g("headSolid") !== "1") fail(`the poured face is not stone (${h.here()})`);
    await clickProp(h, "MeltedHeads", `mask ${head}`);
    if (h.g("curinvprop") !== "Heads") fail(`mask ${head} is not in hand: ${h.g("curinvprop") || "nothing"}`);
    await goTo(h, { stage: 7, frame: 514 });
    const slot = SLOT_OF_HEAD[head];
    const [x0, y0, x1, y1] = extent(h, "Heads");
    const grab = { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
    // where the HAND lets go picks the slot (the mask's place less the grip)
    await drag(h, grab, { x: SLOT_X[slot], y: 300 }, 12, `mask ${head} to slot ${slot}`);
    if (h.g("gHeadsplaced").split(",")[slot - 1] !== "1") fail(`mask ${head} did not stay in slot ${slot}: ${h.g("gHeadsplaced")}`);
  }
  if (h.g("gHeadsSolved") !== "1") fail(`six masks placed and the puzzle not solved: ${h.g("gHeadsplaced")}`);
  ok(`the six masks on the statues' hands (${h.g("gHeadsplaced")})`);
}

/**
 * The time gate. The glowing eyes on frame 520 open the particle door
 * (`OpenDoor`, gPortalOpen), and beyond it stands the professor's console
 * (frame 101 of stage 8). Its first button is Egypt (`buttonpress (1)`,
 * `T018.Mov`); the transport happens when the hand rests on the crystal ball
 * as that film ends (`dotransport`, x 230…440, y 50…260), and `enterworld ("E")`
 * plays `E025.Mov` into Egypt.
 */
export async function gate(h: Headless): Promise<void> {
  await goTo(h, { stage: 7, frame: 520 });
  await clickRegion(h, "Open", "the glowing eyes");
  need(h, "gPortalOpen", "1", "the particle door");
  await goTo(h, { stage: 8, frame: 101 });
  ok(`through the particle door to the professor's console (${h.here()})`);
}

/** Easter Island from the hilltop to Egypt: what every later world starts from */
export async function playEaster(h: Headless): Promise<void> {
  await camp(h);
  await lantern(h);
  await masks(h);
  await gate(h);
  await travel(h, "Button10", "E");
}

/** from the console, a button and a touch of the crystal: into another world */
export async function travel(h: Headless, button: string, world: string): Promise<void> {
  const b = regionPoint(h, button);
  h.click(b.x, b.y);
  // the button's film waits on the crystal ball: a touch on it ends the film
  // with the hand still there, which is what `dotransport` asks
  await h.until(() => h.owner() === "movie", "the gate's film", 2000);
  await h.frame(30);
  h.click(335, 155);
  await h.frame(2);
  h.session.setPointer(335, 155);
  await h.until(() => h.where().world === world && h.idle(), `the world ${world}`, 60_000);
  await h.settle(`arriving in ${world}`);
  ok(`${button}, the crystal, and world ${world} (${h.here()})`);
}
