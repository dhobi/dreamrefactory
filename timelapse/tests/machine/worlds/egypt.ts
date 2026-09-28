/**
 * Egypt (world E, disc one): from the crystal's arrival on the river bank to
 * the gene pod and the crystal home.
 */
import { fail, ok, type Headless } from "../harness";
import { clickProp, clickRegion, drag, extent, goTo, propPoint, regionPoint } from "../nav";
import { travel } from "./easter";

export const need = (h: Headless, name: string, want: string, what: string): void => {
  if (h.g(name) !== want) fail(`${what}: ${name} is ${h.g(name) || "unset"}, not ${want} (${h.here()})`);
};

/**
 * The water that opens the dock. The hanging basket (frame 111) dips once a
 * pull (e.shp `e27.111b`, taken below y 280) and pours into the cistern
 * (`waterlevel`); with the pulley over the well swung across (`welltopswitch`
 * 0, `e27.154b`), the lever beneath it (`e27.154a`) empties the cistern into
 * the well's bucket (`bucketlevel`). Four and two fill it to six, one more
 * would spill it; the pulley swung back, the full bucket's weight lets the
 * dock's lever (`e27.170g`) open the gate.
 */
export async function water(h: Headless): Promise<void> {
  const dip = async (times: number): Promise<void> => {
    await goTo(h, { stage: 25, frame: 111 });
    for (let i = 0; i < times; i++) {
      const was = Number(h.g("waterlevel"));
      await h.until(() => h.g("animphasenext") === "swinging", "the basket swinging", 3000);
      const at = await propPoint(h, "e27.111b", [0, 290, 640, 480]);
      h.click(at.x, at.y);
      await h.until(() => Number(h.g("waterlevel")) === was + 1, "the basket to fill the cistern", 3000);
    }
  };
  const drain = async (): Promise<void> => {
    await goTo(h, { stage: 25, frame: 154 });
    if (h.g("welltopswitch") === "1") await pulley();
    const was = Number(h.g("bucketlevel")) + Number(h.g("waterlevel"));
    h.click(508, 372);
    await h.settle("the cistern's lever");
    need(h, "bucketlevel", String(was), "the cistern emptied into the bucket");
  };
  const pulley = async (): Promise<void> => {
    const across = h.g("welltopswitch") === "1";
    // its handle is the top bar while it shows picture 0 and the upright on
    // any other (e.shp `e27.154b`), which after the bucket moved is not 11
    await h.until(() => h.g("animphase") === "steady", "the bucket to come to rest", 2000);
    const bar = Number(await h.eval('return (propdeg ("e27.154b"))')) === 0;
    const at = !bar
      ? await propPoint(h, "e27.154b", [255, 48, 273, 131], 30)
      : await propPoint(h, "e27.154b", [287, 30, 361, 48], 30);
    h.click(at.x, at.y);
    await h.settle("the pulley");
    need(h, "welltopswitch", across ? "0" : "1", "the pulley swung");
  };
  await dip(4);
  await drain();
  await dip(2);
  await drain();
  await pulley();
  await goTo(h, { stage: 26, frame: 170 });
  const [, , x1, y1] = extent(h, "e27.170g");
  const from = { x: Math.min(x1 - 4, 600), y: Math.min(y1, 340) };
  await drag(h, from, { x: from.x - 140, y: from.y }, 14, "the dock's lever");
  need(h, "gateopen", "1", "the dock gate");
  ok(`four baskets and two, the bucket full, and the dock open (${h.here()})`);
}

/**
 * Across the river on the barge, the spear from the far bank (`e1.102`), and
 * the crocodile at the dock temple (frame 104 of stage 34). The spear follows
 * the hand; a jab lands when the hand is on the yellow of the neck, x 478…490,
 * y 419…431, while the beast has turned its head (its picture 1…5, e.shp
 * `e1.102s`), and three of them see it off (`crochit`, crockilled).
 */
export async function crocodile(h: Headless): Promise<void> {
  await goTo(h, { stage: 34, frame: 102 });
  const spear = await propPoint(h, "e1.102", [0, 0, 640, 480], 60);
  h.click(spear.x, spear.y);
  await h.settle("the spear");
  need(h, "hasspear", "1", "the spear");
  await goTo(h, { stage: 34, frame: 104 });
  // the head turned, and nothing running: a click made while the beast's
  // `animtick` runs waits in the queue, and lands a moment too late
  const turned = async (): Promise<boolean> => {
    if (h.g("animphase") !== "seq" || h.host.director.inputLocked) return false;
    const d = Number(await h.eval('return (propdeg ("e1.104"))'));
    return d >= 1 && d <= 5;
  };
  for (let jabs = 0; Number(h.g("crocdamage")) < 3; jabs++) {
    if (jabs > 12) fail(`twelve jabs and the crocodile still stands (${h.g("crocdamage")} hits, ${h.here()})`);
    h.session.setPointer(484, 425);
    for (let i = 0; !(await turned()); i++) {
      if (i > 20_000) fail(`the crocodile never turned its head (${h.here()})`);
      await h.frame(1);
    }
    const hits = Number(h.g("crocdamage"));
    h.click(484, 425);
    await h.frame(8);
    if (process.env.DEBUG) console.log(`jab ${jabs + 1}: ${Number(h.g("crocdamage")) > hits ? "hit" : "miss"}`);
    await h.until(() => h.g("animphase") !== "seq" || h.g("crockilled") === "1", "the crocodile to recover", 400);
  }
  await h.until(() => h.g("crockilled") === "1", "the crocodile gone", 3000);
  await h.settle("the crocodile gone");
  ok(`the spear, three jabs, and the crocodile gone (${h.here()})`);
}

/**
 * The eight crystals at the feet of the gods' statues. Each close-up (frames
 * 21…28, two of them on stage 13) shows three rows — the god's animal 1…8, its
 * number 9…21 and its symbol 22…32 — and a click on a row steps it on
 * (`e10.26`'s flats, y 100…200, 200…300, 300…400). What the pool asks for is
 * written in its own script (e014 `HotTub`), whatever the obelisks outside
 * showed: crystal 1 at "8 19 29", and on.
 */
const CRYSTALS: [stage: number, frame: number, want: string][] = [
  [14, 21, "8 19 29"], [14, 22, "7 13 22"], [14, 23, "3 9 23"], [13, 24, "5 18 27"],
  [13, 25, "4 15 26"], [14, 26, "2 20 28"], [14, 27, "6 10 25"], [14, 28, "1 16 24"],
];

export async function crystals(h: Headless): Promise<void> {
  for (const [n, [stage, frame, want]] of CRYSTALS.entries()) {
    await goTo(h, { stage, frame });
    const rows = ["e10.25a", "e10.25b", "e10.25c"];
    for (const [r, prop] of rows.entries()) {
      const target = Number(want.split(" ")[r]);
      for (let i = 0; i < 16; i++) {
        if (Number(await h.eval(`return (propdeg ("${prop}"))`)) === target) break;
        h.click(335, 150 + r * 100);
        await h.settle(`crystal ${n + 1}, row ${r + 1}`);
      }
    }
    // the crystal's global is written as the close-up is left
    await goTo(h, (s) => s.stage !== stage || s.frame !== frame);
    need(h, `crystal${n + 1}`, want, `crystal ${n + 1}`);
  }
  ok(`the eight crystals set as the pool asks (${h.here()})`);
}

/**
 * The red gem the pool gives up (`e16.1b`, hascrystal 1). Dragged onto the
 * cobra on the causeway (stage 15, frame 2) it sends the snake off
 * (`snakeleave`, snakekilled); let go within 80 px of (330, 315) over the
 * pool at the causeway's end (stage 18, frame 12) it falls in (`gemdrop`,
 * hascrystal 2).
 */
export async function gem(h: Headless): Promise<void> {
  if (h.where().stage !== 14 || h.where().region !== 16) {
    await goTo(h, { stage: 14, frame: 9 });
    await clickRegion(h, "HotTub", "the pool");
  }
  if (h.where().region !== 16) fail(`the pool does not open: the crystals are wrong (${h.here()})`);
  const g = await propPoint(h, "e16.1b", [0, 0, 640, 480], 60);
  h.click(g.x, g.y);
  await h.settle("the red gem");
  need(h, "hascrystal", "1", "the red gem");
  const hand = (): { x: number; y: number } => {
    const [x0, y0, x1, y1] = extent(h, "e16.1");
    return { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
  };
  await goTo(h, { stage: 15, frame: 2 });
  // the snake sways: the gem is let go on its body, low, where every one of
  // its pictures covers, and again if it swayed off
  for (let tries = 0; h.g("snakekilled") !== "1"; tries++) {
    if (tries > 8) fail(`the gem never found the cobra (${h.here()})`);
    const [x0, y0, x1, y1] = extent(h, "e10.2");
    await drag(h, hand(), { x: Math.round((x0 + x1) / 2), y: Math.round(y0 + (y1 - y0) * 0.7) }, 12, "the gem to the cobra");
    // gone (its film, then snakekilled), or still swaying
    await h.until(() => h.g("snakekilled") === "1" || h.g("animphase") === "seq", "the cobra's answer", 3000);
  }
  await h.until(() => h.g("snakekilled") === "1", "the cobra to go", 3000);
  await h.settle("the cobra gone");
  await goTo(h, { stage: 18, frame: 12 });
  await drag(h, hand(), { x: 330, y: 315 }, 12, "the gem into the pool", false);
  await h.until(() => h.g("hascrystal") === "2", "the gem in the pool", 3000);
  await h.settle("the gem's film");
  ok(`the red gem, the cobra gone, and the gem in the pool (${h.here()})`);
}

/** the button beside the pool, which with the gem below opens the stairs (e.shp `e22.5b`, stairsopen) */
export async function stairs(h: Headless): Promise<void> {
  await goTo(h, { stage: 17, frame: 5 });
  const b = await propPoint(h, "e22.5b", [0, 0, 640, 480], 60);
  h.click(b.x, b.y);
  await h.settle("the stairs' button");
  if (h.g("stairsopen") === "0") fail(`the button beside the pool opens nothing (${h.here()})`);
  ok(`the stairs open (${h.here()})`);
}

/**
 * The game of snakes and jewels (e024.stg, its own shop and track): the die
 * (`Dice`) rolls one to four for red and then for blue, and red must land on
 * the gold pillar at 37 exactly (`movemany`, wonsnakes). The roll is the
 * game's own seeded `random`, so it is the same game every run. Won, the eye
 * on the wall comes away (`eye`, the Wadjet `e24.118`) and goes on the
 * cabinet door (frame 124, x 280…410, y 200…300, eyeondoor).
 */
export async function snakes(h: Headless): Promise<void> {
  await goTo(h, { stage: 24, frame: 118 });
  let rolls = 0;
  while (h.g("wonsnakes") !== "1") {
    if (++rolls > 1000) fail(`a thousand rolls and red has not won (${h.here()})`);
    const d = await propPoint(h, "Dice", [0, 0, 640, 480], 120);
    h.click(d.x, d.y);
    await h.settle(`roll ${rolls}`);
  }
  const eye = await propPoint(h, "eye", [0, 0, 640, 480], 120);
  h.click(eye.x, eye.y);
  await h.settle("the eye");
  need(h, "haseye", "1", "the eye from the wall");
  ok(`red home in ${rolls} rolls, and the eye (${h.here()})`);
  await goTo(h, (s) => s.frame === 124);
  const [x0, y0, x1, y1] = extent(h, "e24.118");
  await drag(h, { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) }, { x: 345, y: 250 }, 12, "the eye to the door");
  need(h, "eyeondoor", "1", "the eye on the cabinet door");
  ok(`the eye on the cabinet door (${h.here()})`);
}

/** behind the eye's door, past the scroll of 3, 10, 9 and 4: the gene pod (`e24.126a`, gEgyptPod) */
export async function pod(h: Headless): Promise<void> {
  await goTo(h, { stage: 23, frame: 126 });
  const p = await propPoint(h, "e24.126a", [0, 0, 640, 480], 120);
  h.click(p.x, p.y);
  await h.until(() => h.g("gEgyptPod") === "1", "the gene pod", 20_000);
  await h.settle("the gene pod's film");
  need(h, "haspodE", "1", "Egypt's gene pod");
  ok(`Egypt's gene pod (${h.here()})`);
}

/**
 * The pyramid door. The pillar by the dock has three buttons, and only the top
 * one (`e1.183a` above y 189, pillarbutton 0) lets the door open; its four
 * wheels (`e32.168a`…`d`, the last turning only with the pod in hand) turn by
 * dragging up or down a step each 15 px, and open on 32, 11, 14, 25 — the
 * scroll's 3, 10, 9 and 4, in the tablet's numbers — or on 33, 12, 15, 26
 * (e.shp `eb216801`). The button between them then lets you in.
 */
export async function pyramid(h: Headless): Promise<void> {
  await goTo(h, { stage: 7, frame: 183 });
  const b = await propPoint(h, "e1.183a", [0, 0, 640, 188], 60);
  h.click(b.x, b.y);
  await h.settle("the pillar's top button");
  need(h, "pillarbutton", "0", "the pillar's top button");
  await goTo(h, { stage: 30, frame: 168 });
  const want: Record<string, number> = { a: 32, b: 11, c: 14, d: 25 };
  for (const w of ["a", "b", "c", "d"]) {
    const prop = `e32.168${w}`;
    for (let tries = 0; tries < 4; tries++) {
      const now = Number(await h.eval(`return (propdeg ("${prop}"))`));
      const steps = (((want[w] - now) % 37) + 37) % 37;
      if (!steps) break;
      // up raises the wheel's number: curdeg = firstdeg - dy / 15
      const up = steps <= 18;
      const n = up ? steps : 37 - steps;
      const [x0, y0, x1, y1] = extent(h, prop);
      const x = Math.round((x0 + x1) / 2);
      const from = up ? Math.min(470, y1 - 4) : Math.max(10, y0 + 4);
      await drag(h, { x, y: from }, { x, y: from + (up ? -1 : 1) * (n * 15 + 7) }, Math.max(12, n), `wheel ${w}`);
    }
    const got = Number(await h.eval(`return (propdeg ("${prop}"))`));
    if (got !== want[w]) fail(`wheel ${w} shows ${got}, not ${want[w]}`);
  }
  const btn = await propPoint(h, "eb216801a", [0, 0, 640, 480], 60);
  h.click(btn.x, btn.y);
  await h.until(() => h.g("pyrdoorsolved") === "1", "the door's combination", 600);
  await h.settle("the pyramid door");
  ok(`32, 11, 14, 25, and into the pyramid (${h.here()})`);
}

/**
 * Past the sarcophagus the professor's second console (e033, frame 101): Egypt
 * done, its first button only zaps now (`buttonpress (1)` with haspodE), and
 * the fourth, the lizard, is the Maya's (`enterworld ("M")`).
 */
export async function toMaya(h: Headless): Promise<void> {
  await goTo(h, { stage: 33, frame: 101 });
  ok(`past the sarcophagus to the console (${h.here()})`);
  await travel(h, "Button13", "M");
}

/** Egypt from the river bank to the Maya */
export async function playEgypt(h: Headless): Promise<void> {
  await water(h);
  await crocodile(h);
  await crystals(h);
  await gem(h);
  await stairs(h);
  await snakes(h);
  await pod(h);
  await pyramid(h);
  await toMaya(h);
}
