/**
 * The Anasazi (world A, disc two): from the canyon where the crystal leaves
 * you to the cliff city and the crystal on.
 */
import { fail, ok, type Headless } from "../harness";
import { clickRegion, drag, extent, findProp, goTo, propPoint, regionPoint, regions, useOn } from "../nav";
import { travel } from "./easter";

export const need = (h: Headless, name: string, want: string, what: string): void => {
  if (h.g(name) !== want) fail(`${what}: ${name} is ${h.g(name) || "unset"}, not ${want} (${h.here()})`);
};

/** the log (a001, frame 979) laid over the chasm (frame 118, `makebridge`) */
export async function logBridge(h: Headless): Promise<void> {
  await goTo(h, (s) => s.stage === 1 && s.frame === 979);
  const r = regions(h).find((r) => !/^(up|down|left|right)$/i.test(r.name));
  if (!r) fail(`nothing to take on ${h.here()}`);
  await clickRegion(h, r.name, "the log");
  need(h, "log", "2", "the log in hand");
  await useOn(h, "invlog", 1);
  need(h, "logbridge", "1", "the log over the chasm");
  ok(`the log over the chasm (${h.here()})`);
}

/**
 * The calendar lever (a003, frame 157): five places, left to right West,
 * East, Off, North and South (`POS1`…`POS5`, leverpos), dragged from where it
 * stands. Which way the canyon's paths and animals answer depends on it.
 */
export async function lever(h: Headless, pos: 1 | 2 | 3 | 4 | 5 | string): Promise<void> {
  const to = Number(pos);
  if (Number(h.g("leverpos")) === to) return;
  await goTo(h, { stage: 3, frame: 157 });
  const mid = (n: number): { x: number; y: number } => {
    const r = h.session.stageCtrl.flatRegion("a0001.157", `POS${n}`);
    if (!r) return fail(`the lever has no POS${n}`);
    return { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) };
  };
  // held at the new place until the lever has ground its way there: each place
  // on the way is an animation of its own (`transleft`/`transright`)
  const from = mid(Number(h.g("leverpos"))), end = mid(to);
  await h.until(() => !h.host.director.inputLocked, "a moment to take the lever", 600);
  h.mouseDown(from.x, from.y);
  await h.frame(2);
  for (let i = 1; i <= 12; i++) {
    h.moveTo(Math.round(from.x + ((end.x - from.x) * i) / 12), Math.round(from.y + ((end.y - from.y) * i) / 12));
    await h.frame(1);
  }
  await h.until(() => Number(h.g("leverpos")) === to, `the lever to reach ${to}`, 600);
  await h.frame(4);
  h.mouseUp(end.x, end.y);
  await h.settle("the lever");
  need(h, "leverpos", String(to), "the lever");
}

/** a carried thing dragged so that a point of it `tip` off its own place passes through `points` */
async function tipDrag(h: Headless, prop: string, tip: [number, number], points: [number, number][], what: string, settle = true): Promise<void> {
  const p = h.session.propRuntime.get(prop)!;
  // held on the thing itself: the middle of a thin stick's box is not on it
  const grab = findProp(h, prop) ?? fail(`no ${prop} to take hold of (${h.here()})`);
  const off = { x: grab.x - p.anchorX, y: grab.y - p.anchorY };
  const hand = ([tx, ty]: [number, number]): { x: number; y: number } => ({ x: tx + tip[0] + off.x, y: ty + tip[1] + off.y });
  await h.until(() => !h.host.director.inputLocked, `a moment to start ${what}`, 600);
  h.mouseDown(grab.x, grab.y);
  await h.frame(2);
  let at = grab;
  for (const pt of points) {
    const to = hand(pt);
    for (let i = 1; i <= 10; i++) {
      h.moveTo(Math.round(at.x + ((to.x - at.x) * i) / 10), Math.round(at.y + ((to.y - at.y) * i) / 10));
      await h.frame(1);
    }
    at = to;
    await h.frame(3);
  }
  h.mouseUp(at.x, at.y);
  if (settle) await h.settle(what);
}
const middle = (h: Headless, flat: string, region: string): [number, number] => {
  const r = h.session.stageCtrl.flatRegion(flat, region);
  if (!r) return fail(`no region ${region} on ${flat}`);
  return [Math.round((r.left + r.right) / 2), Math.round((r.top + r.bottom) / 2)];
};

/**
 * East, with the lever on East. The squirrel seen on its two rocks (frames 622
 * and 640, squirrel 3) leaves its acorn where the honey stick can reach. The
 * stick (a012, frame 650), dipped in the hive in one drag — into it, out and
 * back (a010, frame 632, `hive`, the stick's tip 86, 63 up and left of it) —
 * comes out honeyed, and the honey takes the acorn (a011, frame 980,
 * `getacorn`), which opens the corn hole's door (frame 649, `cornhole`). The
 * match from the box (a038, frame 108, `openmatchbox`, `getmatch`), struck
 * along the rock (frame 101, 50 px in under 30 ticks, 50 px above the hand)
 * and held over the twigs while it burns (`Fire`, `matchburn` past 50),
 * lights the fire (`StartFire`, gEastRock).
 */
export async function east(h: Headless): Promise<void> {
  await lever(h, 2);
  await goTo(h, { stage: 10, frame: 622 });
  await goTo(h, { stage: 11, frame: 640 });
  need(h, "squirrel", "3", "the squirrel on its way");
  await goTo(h, { stage: 12, frame: 650 });
  await clickRegion(h, "Button12", "the stick");
  need(h, "honeystick", "2", "the stick in hand");
  await goTo(h, { stage: 10, frame: 632 });
  const hive = middle(h, "a0001.632", "hive");
  await tipDrag(h, "invhoneystick", [86, 63], [hive, [hive[0], hive[1] + 120], hive], "the stick in the hive");
  await goTo(h, { stage: 11, frame: 980 });
  await h.until(() => regions(h).some((r) => r.name === "acorn"), "the acorn", 3000);
  const acornAt = regions(h).find((r) => r.name === "acorn")!;
  await tipDrag(h, "invhoneystick", [86, 63], [[acornAt.x, acornAt.y]], "the honey to the acorn");
  need(h, "acorn", "2", "the acorn");
  await useOn(h, "invacorn", 12);
  need(h, "acorn", "3", "the acorn in the corn hole");
  await goTo(h, { stage: 38, frame: 108 });
  await clickRegion(h, "Box", "the matchbox");
  await h.until(() => regions(h).some((r) => r.name === "Match"), "the box open", 600);
  await clickRegion(h, "Match", "a match");
  need(h, "gMatchBox", "2", "a match in hand");
  await goTo(h, { stage: 38, frame: 101 });
  const fire = middle(h, "a0007.101", "Fire");
  const [x0, y0, x1, y1] = extent(h, "invmatch");
  await h.until(() => !h.host.director.inputLocked, "a moment to take the match", 600);
  h.mouseDown(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2));
  await h.frame(2);
  // a flick along the rock, 50 px above the hand: the match's loop looks at
  // the hand every other pass and wants 50 px between two looks
  const rb = h.session.stageCtrl.flatRegion("a0007.101", "Rock")!;
  const ry = Math.round((rb.top + rb.bottom) / 2) + 50;
  // and two looks at the same place are a stroke that failed, so the hand
  // swings to and fro until the match catches
  for (let i = 0; i < 12 && Number(h.g("gAnimIndex")) < 40; i++) {
    h.moveTo(i % 2 ? rb.left + 84 : rb.left + 8, ry);
    await h.frame(2);
  }
  // held over the twigs until it has burnt far enough (`matchburn`, past 50)
  h.moveTo(fire[0] - 20, fire[1]);
  await h.until(() => h.g("gAcornFire") === "1" || h.g("gMatchDropped") === "1", "the match to burn down to the twigs", 600);
  h.mouseUp(fire[0] - 20, fire[1]);
  await h.settle("the fire");
  need(h, "gEastRock", "1", "the fire lit");
  ok(`the honey, the acorn, and a fire from the rock (${h.here()})`);
}

/**
 * South, with the lever on South. The arrowheads lie at frame 819 (or 827),
 * put there at random as the canyon is entered (`headloc`); taken, they go
 * onto the bow's notched arrow one at a time, small, medium and large (a008,
 * frame 839, `loadhead`) — three shots. A shot is `arrowflight`, and it has no
 * chance in it but the wind (`windlevel`, which drifts a step at random):
 * drawn back d steps (the hand 20 px lower each, `propdeg ("bow")`) at x, the
 * arrow flies `vnot = (d + 1) * 5 + 20`, `hnot` the wind, `save` its head,
 * and wins if it passes through the spire's hole (`pointinprop ("hole")`)
 * once it is far enough (`loch` past 4200) and not through the mask first. So
 * the flight is flown here first, for the wind as it is while the bow is held,
 * and let go when the bow is where that flight goes through the hole
 * (wonarrow). Then the buffalo (a035, frame 104, gSouthRock).
 */
type Rect = { x: number; y: number; w: number; h: number };
/** `pointinprop` as the engine answers it: a pixel of the picture the prop shows */
type Hit = (x: number, y: number) => boolean;
function pictureOf(h: Headless, name: string): Hit {
  const p = h.session.propRuntime.get(name);
  const st = p?.state();
  if (!p || !st) return () => false;
  const f = p.shop.frame(p.currentFrame(st));
  const { x: x0, y: y0 } = p.screenCorner(f);
  return (x, y) => x >= x0 && x < x0 + f.width && y >= y0 && y < y0 + f.height && !!f.opaque[(y - y0) * f.width + (x - x0)];
}

/** `arrowflight`, flown: does it go through the hole? */
function throughHole(bowx: number, d: number, wind: number, head: number, hole: Hit, mask: Hit): boolean {
  const vnot = (d + 1) * 5 + 20, save = head + 16;
  let x = 6, locv = 470;
  while (locv < 17000) {
    x++;
    const loch = vnot * x;
    locv = 480 - Math.trunc((vnot * x) / 5) + Math.trunc((save * x * x) / 20);
    const ax = Math.trunc((wind * (x - 7)) / 10) + bowx, ay = Math.trunc((locv * 240) / loch) - 300;
    if (ay > 454) return false;
    if (loch > 4200) {
      if (hole(ax, ay)) return true;
      if (mask(ax, ay)) return false;
    }
  }
  return false;
}

export async function south(h: Headless): Promise<void> {
  await lever(h, 5);
  const heads = (): boolean => /^inv(small|med|large)head$/.test(h.g("curinvprop"));
  for (let tries = 0; !heads(); tries++) {
    if (tries > 10) fail(`the arrowheads never turned up (${h.here()})`);
    await goTo(h, { stage: 8, frame: 819 });
    if (regions(h).some((r) => r.name === "Button10")) await clickRegion(h, "Button10", "the arrowheads");
    else {
      // they are by the other rock, or not yet put anywhere: the canyon's
      // mouth deals them again (frame 705)
      await goTo(h, { stage: 6, frame: 827 });
      if (regions(h).some((r) => !/^(up|down|left|right)$/i.test(r.name))) {
        const r = regions(h).find((r) => !/^(up|down|left|right)$/i.test(r.name))!;
        await clickRegion(h, r.name, "the arrowheads");
      } else await goTo(h, { stage: 6, frame: 705 });
    }
  }
  ok(`the arrowheads (${h.here()})`);
  await goTo(h, { stage: 8, frame: 839 });
  const rt = h.session.propRuntime;
  for (let shot = 1; h.g("wonarrow") !== "1"; shot++) {
    if (!heads()) fail(`three arrows and none through the spire (${h.here()})`);
    // the arrow notched (a click on the bow), and the head put on it
    if (!rt.get("arrow")?.visible) {
      const b = await propPoint(h, "bow", [0, 0, 640, 480], 60);
      h.click(b.x, b.y);
      await h.settle("the arrow notched");
    }
    const head = h.g("curinvprop");
    await drag(h, findProp(h, head) ?? fail(`no ${head}`), { x: 320, y: 300 }, 12, `the ${head} on the arrow`);
    const arrowDeg = Number(rt.get("arrow")?.deg);
    const hole = pictureOf(h, "hole"), mask = pictureOf(h, "mask");
    // held, drawn back, and moved until the flight for this wind goes through
    const bow = await propPoint(h, "bow", [0, 0, 640, 480], 60);
    await h.until(() => !h.host.director.inputLocked, "a moment to take the bow", 600);
    h.mouseDown(bow.x, bow.y);
    await h.frame(2);
    let aimed = false;
    for (let n = 0; n < 2000 && !aimed; n++) {
      const wind = Number(h.g("windlevel"));
      let best: [number, number] | null = null;
      for (const d of [4, 5, 3, 2, 1])
        for (let x = 100; x <= 540 && !best; x++) if (throughHole(x, d, wind, arrowDeg, hole, mask)) best = [x, d];
      // …the draw a player makes: all the way down, and back up a step
      if (best) {
        h.moveTo(best[0], 375 + best[1] * 20 + 8);
        await h.frame(2);
        // released on a pass whose wind the flight was flown for
        if (Number(h.g("windlevel")) === wind && Math.abs((rt.get("bow")?.anchorX ?? 0) - best[0]) <= 0) aimed = true;
      } else await h.frame(1);
    }
    h.mouseUp(h.session.pointerX, h.session.pointerY);
    await h.settle(`shot ${shot}`);
    if (process.env.DEBUG) console.log(`shot ${shot}: ${h.g("wonarrow") === "1" ? "through" : "missed"}`);
  }
  await goTo(h, { stage: 35, frame: 104 });
  need(h, "gSouthRock", "1", "the buffalo");
  await h.settle("the buffalo");
  ok(`an arrow through the spire, and the buffalo (${h.here()})`);
}

/**
 * West, with the lever on West. The rock of hand prints (a017, frame 252)
 * shows nineteen glyphs (`newglyph0`…`18`) that a touch turns on or off, and
 * keeps them as a number (`calcbitmap`, glyph n worth 2^(22 - n)); it wants
 * 3722528 (`isfinished`) — glyphs 1, 2, 3, 7, 8, 11, 12, 14 and 17, the nine
 * the flashlight shows in the cave — and the coyote comes (gHandPrint). The
 * door beside it then opens (frame 253, `tryopendoor`), and past it the
 * dripping water (a034, frame 116, gWestRock).
 */
const HAND_GLYPHS = [1, 2, 3, 7, 8, 11, 12, 14, 17];

export async function west(h: Headless): Promise<void> {
  await lever(h, 1);
  await goTo(h, { stage: 17, frame: 252 });
  const rt = h.session.propRuntime;
  for (let g = 0; g <= 18 && h.g("gHandPrint") !== "1"; g++) {
    const p = rt.get(`newglyph${g}`);
    if (!p) fail(`no glyph ${g} on the rock (${h.here()})`);
    if (p.visible === HAND_GLYPHS.includes(g)) continue;
    // a glyph that is off is not drawn, so it is touched where it would be
    const r = p.screenRect()!;
    h.click(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2));
    await h.settle(`glyph ${g}`);
  }
  await h.until(() => h.g("gHandPrint") === "1", "the coyote", 3000);
  await h.settle("the coyote");
  await goTo(h, { stage: 17, frame: 253 });
  await clickRegion(h, "Button10", "the door");
  need(h, "handdooropen", "1", "the door by the hand prints");
  await goTo(h, { stage: 34, frame: 116 });
  need(h, "gWestRock", "1", "the dripping water");
  ok(`the nine hand glyphs, the coyote, and the water (${h.here()})`);
}

/**
 * North, with the lever on North. Five of the canyon's feathers show only with
 * the lever there — turkey (a018, frame 515), owl (a004, 502), crow (a018,
 * 519), quail (a005, 611) and woodpecker (a018, 509) — and the stand of bird
 * heads (a018, frame 933) wants them in its top row in that order, slots 1 to
 * 5 (`checksolved`: headf1…5 = 1…5; `slotpoint` gives each slot's place). Its
 * button then grows the corn (headsolved), and the way north opens to the
 * wind in the leaves (a037, frame 103, gNorthRock).
 */
const FEATHERS: [stage: number, frame: number, prop: string][] = [
  [18, 515, "invturkeyfeathe"], [4, 502, "invowlfeather"], [18, 519, "invcrowfeather"],
  [5, 611, "invquailfeather"], [18, 509, "invwoodfeather"],
];
const SLOT = [[228, 386], [267, 380], [318, 378], [370, 380], [418, 386]];

export async function north(h: Headless): Promise<void> {
  await lever(h, 4);
  for (const [slot, [stage, frame, prop]] of FEATHERS.entries()) {
    await goTo(h, { stage, frame });
    const take = regions(h).find((r) => !/^(up|down|left|right)$/i.test(r.name));
    if (!take) fail(`no feather to take on ${h.here()}`);
    await clickRegion(h, take.name, prop);
    need(h, "curinvprop", prop, `the feather at ${stage}:${frame}`);
    await goTo(h, { stage: 18, frame: 933 });
    await drag(h, findProp(h, prop) ?? fail(`no ${prop}`), { x: SLOT[slot][0], y: SLOT[slot][1] - 20 }, 14, `${prop} to slot ${slot + 1}`);
    await h.frame(20);
    need(h, `headf${slot + 1}`, String(slot + 1), `the feather in slot ${slot + 1}`);
  }
  await clickRegion(h, "Button11", "the stand's button");
  need(h, "headsolved", "1", "the feathers on the stand");
  await h.settle("the corn");
  await goTo(h, { stage: 37, frame: 103 });
  need(h, "gNorthRock", "1", "the wind in the leaves");
  ok(`five feathers on the stand, and the wind (${h.here()})`);
}

/**
 * The four tablets (a007, frame 834), with the lever back on Off: each takes
 * the last two of its glyphs touched (`glyph0`…`44`, eleven or twelve a
 * tablet), and they want the animal and the sound of each way — 0 and 7, 12
 * and 18, 26 and 32, 39 and 44 (`isfinished`) — with all four rocks heard.
 * Their button opens the way (`buttonpushed`, pizzadoor) to the gene pod
 * (a036, frame 112, `getpod`, haspodA). A glyph is found by its box
 * (`pointinprop`), first match in number order, so each is touched at a point
 * of its box that no lower glyph's box covers.
 */
export async function tablets(h: Headless): Promise<void> {
  await lever(h, 3);
  await goTo(h, { stage: 7, frame: 834 });
  const rt = h.session.propRuntime;
  // a glyph is found by its picture (`pointinglyph` → `pointinprop`), first in
  // number order, so each is touched on a pixel of it no lower glyph covers
  const test = async (n: number, x: number, y: number): Promise<boolean> =>
    Number(await h.eval(`propvisible ("glyph${n}", true)\n\treturn (pointinprop ("glyph${n}", makepoint (${x}, ${y})))`)) === 1;
  for (const g of [0, 7, 12, 18, 26, 32, 39, 44]) {
    const r = rt.get(`glyph${g}`)!.screenRect()!;
    let at: [number, number] | null = null;
    const was = [...Array(45).keys()].map((n) => rt.get(`glyph${n}`)!.visible);
    for (let y = Math.max(0, r.y) + 2; y < Math.min(480, r.y + r.h) && !at; y += 4)
      for (let x = Math.max(0, r.x) + 2; x < Math.min(640, r.x + r.w) && !at; x += 4) {
        if (!(await test(g, x, y))) continue;
        let covered = false;
        for (let l = 0; l < g && !covered; l++) covered = await test(l, x, y);
        if (!covered) at = [x, y];
      }
    was.forEach((v, n) => (rt.get(`glyph${n}`)!.visible = v));
    if (!at) fail(`glyph ${g} is under the glyphs before it everywhere`);
    h.click(at[0], at[1]);
    await h.settle(`glyph ${g}`);
  }
  await clickRegion(h, "Button10", "the tablets' button");
  need(h, "pizzadoor", "1", "the tablets' door");
  await h.settle("the door");
  await goTo(h, { stage: 36, frame: 112 });
  await clickRegion(h, "Button10", "the gene pod");
  await h.until(() => h.g("haspodA") === "1", "the Anasazi gene pod", 20_000);
  await h.settle("the pod's film", 60_000);
  ok(`the tablets read, and the Anasazi gene pod (${h.here()})`);
}

/**
 * The corn (a019, frame 313). The long arrow (frame 937, `getarrow`) is a
 * spear here: it follows the hand, and a touch stabs whatever cactus piece is
 * 10 and 20 px up and left of it (`mousedownx`). Five of the hundred and
 * forty-seven pieces hold water — the middle cactus's 21st, the short one's
 * 11th and 12th, and the tall one's 70th and 20th (`cactusmed` deg 20,
 * `cactussmall` 10 and 11, `cactuslarge` 69 and 19) — and each leak grows the
 * corn (`takeleak`); five, and it is a ladder to the cliff city (cornsolved).
 */
export async function corn(h: Headless): Promise<void> {
  await goTo(h, { stage: 19, frame: 937 });
  if (h.g("arrow") !== "2") await clickRegion(h, "Button10", "the long arrow");
  need(h, "arrow", "2", "the long arrow");
  await goTo(h, { stage: 19, frame: 313 });
  // the spear taken up (a touch on it: `followcursor`), then carried to each
  // piece and stabbed, the touch landing on the spear that is at the hand
  const spear = findProp(h, "invarrow") ?? fail("no spear in hand");
  h.click(spear.x, spear.y);
  await h.settle("the spear taken up");
  for (const piece of ["cactusmed21", "cactussmall11", "cactussmall12", "cactuslarge70", "cactuslarge20"]) {
    const at = await propPoint(h, piece, [0, 0, 640, 480], 120);
    const hand = { x: at.x + 10, y: at.y + 20 };
    h.session.setPointer(hand.x, hand.y);
    await h.until(() => h.session.hitTestAt(hand.x, hand.y).name === "invarrow", "the spear at the hand", 120);
    const before = Number(h.g("cornlevel"));
    h.click(hand.x, hand.y);
    await h.settle(`the spear into ${piece}`);
    if (Number(h.g("cornlevel")) <= before) fail(`${piece} did not leak (corn ${h.g("cornlevel")}, ${h.here()})`);
  }
  await h.until(() => h.g("cornsolved") === "1", "the corn to grow", 3000);
  ok(`five cacti pierced, and the corn grown (${h.here()})`);
}

/**
 * The cliff city's rattlesnake (a022, frame 328). The rattle (frame 330,
 * `getrattle`) is shaken at it: four quick moves of more than 50 px between
 * two looks — left, right, left, left (`phaser` 1…4, a pause between each so
 * the next counts as a new one) — and the snake turns into a ladder
 * (`goodrattle`, rattlersolved).
 */
export async function rattlesnake(h: Headless): Promise<void> {
  await goTo(h, { stage: 22, frame: 330 });
  await clickRegion(h, "Button11", "the rattle");
  need(h, "rattle", "2", "the rattle");
  await goTo(h, { stage: 22, frame: 328 });
  const grab = findProp(h, "invrattle") ?? fail("no rattle in hand");
  await h.until(() => !h.host.director.inputLocked, "a moment to take the rattle", 600);
  h.mouseDown(grab.x, grab.y);
  await h.frame(3);
  // brought over slowly: a move of more than 50 px between two looks is a shake
  let x = 320;
  for (let i = 1; i <= 24; i++) {
    h.moveTo(Math.round(grab.x + ((x - grab.x) * i) / 24), Math.round(grab.y + ((300 - grab.y) * i) / 24));
    await h.frame(1);
  }
  await h.frame(6);
  for (const dx of [-80, 80, -80, -80]) {
    x += dx;
    h.moveTo(x, 300);
    await h.frame(3);
    await h.frame(6); // held still: the next move is a new shake
  }
  h.mouseUp(x, 300);
  await h.until(() => h.g("rattlersolved") === "1", "the snake to go", 3000);
  await h.settle("the ladder");
  ok(`left, right, left, left: the snake is a ladder (${h.here()})`);
}

/**
 * The loom (a024, frame 345): three rows, in the red yarn, the small red and
 * the small striped (`yarn`, `yarn2`, `yarn3`: degrees 0, 1, 2, `done`). For
 * each, the ball goes into the basket (`basketarea`) — and the shuttle with the
 * first — then a touch on the ball and one on the shuttle thread it, the white
 * threads take it (`weaveit`), and the bar beats it down (`loommove`).
 */
export async function loom(h: Headless): Promise<void> {
  await goTo(h, { stage: 24, frame: 345 });
  const basket = regionPoint(h, "basketarea");
  for (const [row, ball] of ["yarn", "yarn2", "yarn3"].entries()) {
    await drag(h, await propPoint(h, ball, [0, 0, 640, 480], 60), basket, 14, `${ball} to the basket`);
    if (row === 0) await drag(h, await propPoint(h, "shuttle", [0, 0, 640, 480], 60), basket, 14, "the shuttle to the basket");
    const tap = async (name: string): Promise<void> => {
      const at = await propPoint(h, name, [0, 0, 640, 480], 60);
      h.click(at.x, at.y);
      await h.settle(name);
    };
    await tap("dragyarn");
    await tap("shuttle");
    await clickRegion(h, "weaveit", "the white threads");
    await tap("loommove");
    await h.until(() => Number(h.g("loomup")) === row + 1, `row ${row + 1}`, 600);
    await h.settle(`row ${row + 1}`);
  }
  await h.until(() => h.g("gLoomSolved") === "1", "the blanket", 3000);
  ok(`the blanket woven, and the corn plant glowing (${h.here()})`);
}

/**
 * The drums (a025, frame 362): the stick (frame 363, `getdrumstick`) strikes
 * the drum under a point 45 and 25 px up and left of it (`bangdrum`), and the
 * drums want the tune the wind chime plays — drums 1, 4, 2, 0 and 3
 * (`theseq`) — and then the stick is gone (drumsolved).
 */
export async function drums(h: Headless): Promise<void> {
  await goTo(h, { stage: 25, frame: 363 });
  await clickRegion(h, "Button10", "the drum stick");
  need(h, "drumstick", "2", "the drum stick");
  await goTo(h, { stage: 25, frame: 362 });
  for (const n of [1, 4, 2, 0, 3]) {
    const drum = middle(h, "a0001.362", `Drum${n}`);
    await tipDrag(h, "invdrumstick", [45, 25], [drum], `drum ${n}`);
  }
  need(h, "drumsolved", "1", "the drums' tune");
  ok(`1, 4, 2, 0, 3 on the drums (${h.here()})`);
}

/**
 * The glowing stick and the rag. The stick (a027, frame 370, `getglowstick`)
 * lights the alcoves as it passes (the x-ray plugin), and held with a point of
 * it 20 and 50 px up and left in the fourth (`snake2`) it finds the rag there
 * (gGlowStickUsed), which a touch then takes (`getrag`) — before the frame is
 * left, which puts the dark back. Dipped in the stone pot of water (frame
 * 373, a point 25 px left of it in `bowl`, gDunkRag) and drawn over the wall
 * (`Wipe`) it cleans off another symbol (`DoWipeAnim`, gRagSolved).
 */
export async function rag(h: Headless): Promise<void> {
  await goTo(h, { stage: 27, frame: 370 });
  await clickRegion(h, "Button15", "the glowing stick");
  need(h, "glowstick", "2", "the glowing stick");
  await goTo(h, { stage: 27, frame: 371 });
  await tipDrag(h, "invglowstick", [20, 50], [middle(h, "a0001.371", "snake2")], "the stick into the fourth alcove");
  need(h, "gGlowStickUsed", "1", "the fourth alcove lit");
  const alcove = middle(h, "a0001.371", "snake2");
  h.click(alcove[0], alcove[1]);
  await h.settle("the rag");
  need(h, "rag", "2", "the rag");
  await goTo(h, { stage: 27, frame: 373 });
  await tipDrag(h, "invrag", [25, 0], [middle(h, "a0001.373", "bowl")], "the rag into the pot");
  await h.until(() => h.g("gDunkRag") === "1", "the rag wet", 3000);
  await h.settle("the rag wet");
  const [wx, wy] = middle(h, "a0001.373", "Wipe");
  const grab = findProp(h, "invrag") ?? fail("no rag in hand");
  await drag(h, grab, { x: wx, y: wy }, 14, "the rag over the wall");
  await h.until(() => h.g("gRagSolved") === "1", "the wall cleaned", 3000);
  await h.settle("the wall");
  ok(`the rag from the fourth alcove, wet, and the wall cleaned (${h.here()})`);
}

/**
 * Into the kiva. In the sand pit (a021, frame 932) the wind blows the leaves
 * in, and three are missing from the spiral: the third, second and first
 * leaves go to its three empty places (`spot1`…`3`, `solveentry`,
 * kivaentry), and the brown leaf is left on the wall behind (a020, frame 931,
 * `getkivaleaf`), which fits the hole beside the kiva (a025, frame 364,
 * `OpenKiva`).
 *
 * Inside (a039), the circle of arrows opens on seven pictures touched on its
 * three other walls — the buffalo and bee east, the shaman, sun and reindeer
 * west, the bird and corn south — which the walls keep as numbers
 * (`putdownwall`: picture n of a wall of s worth 2^(s - n + 1); east 4104,
 * west 100352, south 288, `opentransdoor`). A picture is touched where it
 * would be, since one not yet touched is not drawn.
 */
const WALLS: [frame: number, group: string, pictures: number[]][] = [
  [105, "glyphs105", [1, 10]], [106, "glyphs106", [0, 1, 5]], [107, "glyphs107", [7, 10]],
];

export async function kiva(h: Headless): Promise<void> {
  await goTo(h, { stage: 21, frame: 932 });
  const rt = h.session.propRuntime;
  await h.until(() => !!rt.get("leaf2")?.visible && !h.host.director.inputLocked, "the leaves to settle", 3000);
  for (const [leaf, spot] of [["leaf2", "spot1"], ["leaf1", "spot2"], ["leaf0", "spot3"]] as const) {
    await propPoint(h, leaf, [0, 0, 640, 480], 120);
    await tipDrag(h, leaf, [0, 0], [middle(h, "a0001.932", spot)], `${leaf} to ${spot}`);
  }
  await h.until(() => h.g("kivaentry") === "1", "the spiral whole", 3000);
  await h.settle("the leaves blown away", 60_000);
  await goTo(h, { stage: 20, frame: 931 });
  await clickRegion(h, "Button10", "the brown leaf");
  need(h, "gKivaLeaf", "1", "the brown leaf");
  await goTo(h, { stage: 25, frame: 364 });
  await tipDrag(h, "invkivaleaf", [0, 0], [middle(h, "a0001.364", "leafhole")], "the leaf into its hole");
  await h.until(() => h.g("gKivaOpen") === "1", "the kiva open", 3000);
  await h.settle("the kiva door");
  for (const [frame, group, pictures] of WALLS) {
    await goTo(h, { stage: 39, frame });
    for (const n of pictures) {
      const p = rt.get(`${group}${n}`);
      if (!p) fail(`no picture ${group}${n} on ${h.here()}`);
      if (p.visible) continue;
      // the first hidden picture in number order under the touch is the one
      // that shows, so a pixel of this one that none before it covers — and
      // on the wall itself, not in the edge regions that turn you
      const hit = pictureOf(h, `${group}${n}`);
      const before = [...Array(n).keys()].filter((l) => !rt.get(`${group}${l}`)?.visible).map((l) => pictureOf(h, `${group}${l}`));
      const r = p.screenRect()!;
      let at: [number, number] | null = null;
      for (let y = Math.max(0, r.y); y < Math.min(480, r.y + r.h) && !at; y += 3)
        for (let x = Math.max(0, r.x); x < Math.min(640, r.x + r.w) && !at; x += 3)
          if (hit(x, y) && !before.some((b) => b(x, y)) && h.session.hitTestAt(x, y).type === "flat") at = [x, y];
      if (!at) fail(`picture ${group}${n} has no pixel to touch`);
      h.click(at[0], at[1]);
      await h.settle(`picture ${n}`);
      if (!rt.get(`${group}${n}`)?.visible) fail(`picture ${group}${n} did not show`);
    }
  }
  await goTo(h, { stage: 39, frame: 104 });
  await clickRegion(h, "Button11", "the circle");
  await h.until(() => h.g("finalkiva") === "1", "the circle to open", 600);
  await h.settle("the kiva's way", 60_000);
  ok(`the leaves, the brown leaf, the kiva's seven pictures, and the circle open (${h.here()})`);
}

/**
 * Past the kiva to the professor's last console (a042, frame 101). With the
 * three gene pods, its third button — the dolphin — is Atlantis
 * (`dotransport (3)`, `enterworld ("Z")`).
 */
export async function toAtlantis(h: Headless): Promise<void> {
  await goTo(h, { stage: 42, frame: 101 });
  ok(`through the kiva to the console (${h.here()})`);
  await travel(h, "Button12", "Z");
}

/** the Anasazi from the canyon to Atlantis */
export async function playAnasazi(h: Headless): Promise<void> {
  await logBridge(h);
  await east(h);
  await south(h);
  await west(h);
  await north(h);
  await tablets(h);
  await corn(h);
  await rattlesnake(h);
  await loom(h);
  await drums(h);
  await rag(h);
  await kiva(h);
  await toAtlantis(h);
}
