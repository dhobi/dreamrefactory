/**
 * Atlantis (world Z, disc four): from the crystal's arrival to the end.
 */
import { fail, ok, type Headless } from "../harness";
import { clickRegion, drag, findProp, goTo, propPoint, regionPoint, regions } from "../nav";

export const need = (h: Headless, name: string, want: string, what: string): void => {
  if (h.g(name) !== want) fail(`${what}: ${name} is ${h.g(name) || "unset"}, not ${want} (${h.here()})`);
};

/**
 * The city's four buildings, each marked by its own symbol at its door, are
 * visited (z003 frame 96, z004 112, z006 108, z002 104: gInBuilding "1 1 1
 * 1"), and the elevator's panel (z007, frame 744) is set to them: its four
 * symbol buttons step a picture a touch, skipping the blank 1 and wrapping at
 * 30, and it opens on 17, 6, 28 and 11 (`ElevEntButtons`, elevsolved).
 */
export async function elevatorPanel(h: Headless): Promise<void> {
  for (const [stage, frame] of [[3, 96], [4, 112], [6, 108], [2, 104]]) await goTo(h, { stage, frame });
  need(h, "gInBuilding", "1 1 1 1", "the four buildings");
  await goTo(h, { stage: 7, frame: 744 });
  const WANT = [17, 6, 28, 11];
  for (let b = 1; b <= 4; b++) {
    for (let i = 0; i < 40 && Number(h.g(`gElevEntButton${b}`)) !== WANT[b - 1]; i++) {
      const at = await propPoint(h, `Button${b}`, [0, 0, 640, 480], 60);
      h.click(at.x, at.y);
      await h.settle(`button ${b}`);
    }
  }
  const go = await propPoint(h, "Button5", [0, 0, 640, 480], 60);
  h.click(go.x, go.y);
  await h.settle("the panel");
  need(h, "elevsolved", "1", "the elevator's panel");
  ok(`the four buildings, and 17, 6, 28, 11 on the panel (${h.here()})`);
}

/** the elevator (z008, frame 120) sent to a floor: its buttons, `buttonpress (1…4)`, top down (`Button10`…`13`) */
async function ride(h: Headless, floor: 1 | 2 | 3): Promise<void> {
  await goTo(h, { stage: 8, frame: 120 });
  if (Number(h.g("elevfloor")) === floor) return;
  await h.until(() => regions(h).some((r) => r.name === `Button1${floor - 1}`), "the elevator's buttons", 3000);
  await clickRegion(h, `Button1${floor - 1}`, `floor ${floor}`);
  await h.until(() => Number(h.g("elevfloor")) === floor, `the elevator at floor ${floor}`, 6000);
  await h.settle("the elevator");
}

/**
 * The basement. The elevator down (floor 3, gBasement — and the robot's clock
 * starts, `gBaTimer`), the red crystal from its charger (z016, frame 833,
 * `getcrystal`), into the elevator's slot (`dock`, gInvCrystal 3), up again,
 * and the crystal back out of the slot (`getcrystal`, gInvCrystal 1).
 */
export async function crystal(h: Headless): Promise<void> {
  await ride(h, 3);
  await goTo(h, { stage: 16, frame: 833 });
  await clickRegion(h, "Button10", "the red crystal");
  need(h, "gInvCrystal", "1", "the red crystal");
  await goTo(h, { stage: 8, frame: 120 });
  await h.until(() => regions(h).some((r) => r.name === "dock"), "the elevator's slot", 3000);
  await drag(h, findProp(h, "invcrystal") ?? fail("no crystal in hand"), regionPoint(h, "dock"), 14, "the crystal into the slot");
  need(h, "gInvCrystal", "3", "the crystal in the slot");
  await ride(h, 1);
  const dock = await propPoint(h, "dock", [0, 0, 640, 480], 120);
  h.click(dock.x, dock.y);
  await h.settle("the crystal out of the slot");
  need(h, "gInvCrystal", "1", "the crystal back in hand");
  ok(`the red crystal from the basement, and the elevator (${h.here()})`);
}

/**
 * The stasis tube. Its 36 lights (z010, frame 419, `StasisOn n` / `StasisOf
 * n`, a touch each toggles) want the pattern the tubes along the corridor
 * show, which the script holds (`gStasisState`, gStasisSolved 1). Not engaged
 * here — engaged, it closes on nothing, and the frame's way back leads only
 * into the tube: it is the robot's trap. The red crystal goes onto the tube's
 * floor (frame 911, `DropCrystal`, gInvCrystal 4), the bait that brings the
 * robot.
 */
const STASIS = "0 1 1 0 0 1 1 0 1 0 1 0 1 0 1 0 0 1 0 0 0 1 1 1 1 1 1 0 0 0 0 0 0 0 1 1".split(" ");

export async function stasis(h: Headless): Promise<void> {
  await goTo(h, { stage: 10, frame: 419 });
  for (let i = 0; i < 36; i++) {
    if (h.g("gStasisState").split(" ")[i] === STASIS[i]) continue;
    const name = h.session.propRuntime.get(`StasisOn ${i}`)?.visible ? `StasisOn ${i}` : `StasisOf ${i}`;
    const at = await propPoint(h, name, [0, 0, 640, 480], 60);
    h.click(at.x, at.y);
    await h.settle(`light ${i}`);
  }
  need(h, "gStasisSolved", "1", "the stasis lights");
  // not engaged: it is the robot's trap, sprung from the ceiling in the fight
  await goTo(h, { stage: 10, frame: 911 });
  await drag(h, findProp(h, "invcrystal") ?? fail("no crystal in hand"), regionPoint(h, "DropCrystal"), 14, "the crystal into the tube");
  need(h, "gInvCrystal", "4", "the crystal in the tube");
  ok(`the stasis lights set, and the crystal on the tube's floor (${h.here()})`);
}

/**
 * The six wheels of red and green (z010, frame 363): each of the six yellow
 * triangles turns three wheels two steps, some each way (`TurnWheels`), and
 * the red hexagon (`Center`, `CheckRGB`) opens them on 0, 1, 2, 3, 4, 5 from
 * 4, 3, 2, 1, 0, 5 (gRGBSolved). The presses are searched.
 */
const TRIANGLES: [region: string, wheels: [number, number, number], dirs: [number, number, number]][] = [
  ["Button2", [1, 2, 3], [1, 1, -1]], ["Button3", [2, 3, 4], [-1, -1, 1]], ["Button4", [3, 4, 5], [-1, 1, 1]],
  ["Button5", [4, 5, 6], [-1, 1, -1]], ["Button1", [1, 2, 6], [1, 1, -1]], ["Button6", [1, 5, 6], [1, -1, 1]],
];

function wheelPresses(from: number[], to: number[]): string[] {
  const key = (w: number[]): string => w.join("");
  const prev = new Map<string, { k: string; press: string } | null>([[key(from), null]]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const w = queue[q];
    if (key(w) === key(to)) {
      const out: string[] = [];
      for (let p = prev.get(key(w)); p; p = prev.get(p.k)) out.unshift(p.press);
      return out;
    }
    for (const [region, wheels, dirs] of TRIANGLES) {
      const n = [...w];
      wheels.forEach((wh, i) => (n[wh - 1] = (((n[wh - 1] + 2 * dirs[i]) % 6) + 6) % 6));
      if (prev.has(key(n))) continue;
      prev.set(key(n), { k: key(w), press: region });
      queue.push(n);
    }
  }
  return fail("no presses turn the wheels home");
}

export async function wheels(h: Headless): Promise<void> {
  await goTo(h, { stage: 10, frame: 363 });
  const now = [1, 2, 3, 4, 5, 6].map((i) => Number(h.g(`gWheel${i}`)));
  for (const press of wheelPresses(now, [0, 1, 2, 3, 4, 5])) await clickRegion(h, press, `the triangle ${press}`);
  await clickRegion(h, "Center", "the red hexagon");
  await h.until(() => h.g("gRGBSolved") === "1", "the wheels to open", 600);
  await h.until(() => h.session.currentFlat.toLowerCase() === "z0001.363.1", "the wheels to close", 3000);
  await h.settle("the wheels");
  ok(`the six wheels turned home (${h.here()})`);
}

/**
 * The robot (z020, frame 196). The crystal on the tube's floor brings it
 * (`BaUp`), and it comes closer on its own clock — at the back of the room
 * (`BaAway`, state 0), halfway (`BaMid`, 1), close (`BaClose`, 2), and then
 * it is the end (`YouDead`). The gun fires a ball where the hand is
 * (`FireBall`: from the gun's own place, ten steps toward the aim before it is
 * looked at), and a ball in the chest (below y 210, 240 or 248 by where it
 * stands) drives it back a step (`BaHit`); at the back, in the tube, a ball on
 * the dark target in the ceiling (`StasisActivate`) closes the tube on it
 * (gBaSolved 1). The ball's flight is worked out here, as the arrow's was.
 */
function ballAt(mx: number, my: number): [number, number] {
  const gun = Math.max(0, Math.min(6, Math.trunc(((mx - 220) * 7) / 201)));
  const cx = Math.max(220, Math.min(420, mx)), cy = Math.max(144, Math.min(300, my));
  const dx = Math.trunc((cx - 320) / 16), dy = -Math.trunc((330 - cy) / 10);
  // `RunFire` moves it while its picture is below 10 and looks on the 9th:
  // ten steps
  return [320 + (gun - 3) * 14 + 10 * dx, 328 + 10 * dy];
}

export async function robot(h: Headless): Promise<void> {
  // turned from the wheels to face the tube (frame 200), the game carries
  // you on to it itself (`ForwardtoBa`)
  await goTo(h, (s) => s.stage === 20 || (s.stage === 10 && s.frame === 200));
  await h.until(() => h.where().stage === 20 && h.g("gBaSolved") === "2", "the robot to come for the crystal", 20_000);
  const rt = h.session.propRuntime;
  const pixel = (name: string): ((x: number, y: number) => boolean) => {
    const p = rt.get(name);
    const st = p?.state();
    if (!p?.visible || !st) return () => false;
    const f = p.shop.frame(p.currentFrame(st));
    const { x: x0, y: y0 } = p.screenCorner(f);
    return (x, y) => x >= x0 && x < x0 + f.width && y >= y0 && y < y0 + f.height && !!f.opaque[(y - y0) * f.width + (x - x0)];
  };
  const trap = h.session.stageCtrl.flatRegion("Z0001.196", "StasisActivate") ?? fail("no target in the ceiling");
  for (let shots = 0; h.g("gBaSolved") !== "1"; shots++) {
    if (shots > 40) fail(`forty shots and the robot is not in the tube (state ${h.g("baState")})`);
    if (h.g("gGameEnding") === "9") fail("the robot got you");
    // at rest in one of its three places, and no ball in the air
    await h.until(() => ["0", "1", "2"].includes(h.g("baState")) && !rt.get("EnergyBall")?.visible && !h.host.director.inputLocked, "the robot to stand", 3000);
    const state = Number(h.g("baState"));
    const ba = pixel(["BaAway", "BaMid", "BaClose"][state]);
    const chest = [210, 240, 248][state];
    let aim: [number, number] | null = null;
    for (let my = 144; my <= 300 && !aim; my += 2)
      for (let mx = 220; mx <= 420 && !aim; mx += 2) {
        const [bx, by] = ballAt(mx, my);
        const inTrap = bx >= trap.left && bx <= trap.right && by >= trap.top && by <= trap.bottom;
        if (state === 0 ? inTrap && !ba(bx, by) : ba(bx, by) && by >= chest + 4) aim = [mx, my];
      }
    if (!aim) fail(`no shot at the robot in state ${state}`);
    h.session.setPointer(aim[0], aim[1]);
    await h.frame(2);
    h.mouseDown(aim[0], aim[1]);
    await h.frame(3);
    h.mouseUp(aim[0], aim[1]);
    await h.wait(() => rt.get("EnergyBall")?.visible === true, 60);
    await h.until(() => !rt.get("EnergyBall")?.visible, "the ball to land", 120);
    if (process.env.DEBUG) console.log(`shot ${shots + 1} at state ${state}: now ${h.g("baState")} ${h.g("gBaSolved")}`);
  }
  // the tube closes on it (`BaDone`, its first picture) with the input locked
  await h.until(() => h.session.currentFlat.toLowerCase() === "z0001.196.1" && h.g("lockevents") !== "1", "the tube to close", 6000);
  await h.settle("the robot in the tube", 60_000);
  ok(`the robot driven into the tube and trapped (${h.here()})`);
}

/**
 * The end. The gene pod receptacle (z014, frame 600, `Device`) opens (gPods
 * 3); the interface panel's gene pods (space, then `gene pod`: P.Stg flat 4,
 * `genepods`) go into it (gPods 4), and a second touch takes it up
 * (`PickupGenetic`). On the transmission panel (frame 402) its podium opens
 * (`Activate`) and the receptacle goes into it (`GeneticDrop` on its eleventh
 * and twelfth pictures): Atlantis will launch in two minutes (`SetLaunchTimer`,
 * gEscPodActive). The way to stay on Earth is the elevator's blinking symbol
 * (z008, `Button13`, `buttonpress (4)`): the outpost goes without you
 * (`EndTimer (4)`, OUT41 and OUT42), and a passing ship finds you.
 */
export async function finale(h: Headless): Promise<void> {
  await goTo(h, { stage: 14, frame: 600 });
  await clickRegion(h, "Device", "the receptacle");
  await h.until(() => h.g("gPods") === "3", "the receptacle open", 3000);
  await h.settle("the receptacle");
  h.key(" ");
  await h.until(() => h.session.stageName.toLowerCase().startsWith("p."), "the interface panel", 600);
  await h.settle("the panel");
  await clickRegion(h, "gene pod", "the gene pods");
  // the three pods are `genepods` instances by the world they came from
  const pods = await propPoint(h, "egypt", [0, 0, 640, 480], 120);
  h.click(pods.x, pods.y);
  await h.until(() => h.g("gPods") === "4", "the pods into the receptacle", 3000);
  await h.until(() => h.where().stage === 14 && h.idle(), "back from the panel", 3000);
  await clickRegion(h, "Device", "the receptacle up");
  await h.until(() => h.g("curinvprop") === "InvGenetic", "the receptacle in hand", 600);
  await h.settle("the receptacle in hand");
  ok(`the three gene pods in the receptacle (${h.here()})`);
  await goTo(h, { stage: 14, frame: 402 });
  await clickRegion(h, "Activate", "the transmission panel");
  await h.until(() => regions(h).some((r) => r.name === "GeneticDrop"), "the podium open", 3000);
  await drag(h, findProp(h, "InvGenetic") ?? fail("no receptacle in hand"), regionPoint(h, "GeneticDrop"), 14, "the receptacle to the podium", false);
  await h.until(() => h.g("gEscPodActive") === "1", "the launch", 3000);
  await h.settle("the launch", 60_000);
  ok(`the receptacle on the podium, and two minutes to launch (${h.here()})`);
  await goTo(h, { stage: 8, frame: 120 });
  // the blinking symbol is a prop over the button (`Escape`, `DoEscInd`), and
  // it answers only while it is lit
  const esc = await propPoint(h, "Escape", [0, 0, 640, 480], 600);
  h.click(esc.x, esc.y);
  // OUT41 and OUT42 — whose end card waits for a click on it — then the game's
  // last question, and its quit
  type Region = { x0: number; y0: number; x1: number; y1: number };
  const waiting = (): Region | null => {
    const m = (h.host.director as unknown as { movies: { active: { meta: { regions: Region[] }[]; pos: number } | null } }).movies.active;
    return m?.meta[m.pos]?.regions[0] ?? null;
  };
  for (let n = 0; n < 120_000 && !h.quit(); n++) {
    const r = waiting();
    if (r) {
      h.click(Math.round((r.x0 + r.x1) / 2), Math.round((r.y0 + r.y1) / 2));
      await h.frame(20);
    } else await h.frame(1);
  }
  if (!h.quit()) {
    const m = (h.host.director as unknown as { movies: { active: Record<string, unknown> | null } }).movies.active;
    fail(`the game never ended (${h.owner()} at ${h.here()}; film ${m?.fileName} segment ${m?.segIdx} frame ${m?.pos} interval ${m?.interval}, ${JSON.stringify((m?.meta as { regions: unknown[]; type: number; name: string }[] | undefined)?.[m?.pos as number])?.slice(0, 200)})`);
  }
  const films = [...new Set(h.logs.flatMap((l) => /^movie: (out\w+\.mov)/i.exec(l)?.[1] ?? []))];
  if (films.join() !== "out41.mov,out42.mov") fail(`the ending plays ${films.join(", ") || "no film"}; EndTimer (4) plays OUT41 and OUT42`);
  ok(`the escape: Atlantis leaves without you (${films.join(", ")}), "${h.questions.at(-1)}" — no, and the game quits`);
}

/** Atlantis from the crystal to the end */
export async function playAtlantis(h: Headless): Promise<void> {
  await elevatorPanel(h);
  await crystal(h);
  await stasis(h);
  await wheels(h);
  await robot(h);
  await finale(h);
}
