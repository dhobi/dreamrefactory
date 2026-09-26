/**
 * The lava caves under RedJack's skull (lava.sett, lava.shop), crossed the way
 * the pillars allow.
 *
 * As the scripts have it:
 *
 *   - **the pillars.** Every node has one but seven (lava.shop `needpillar`:
 *     Node10, Scene12, 13, 29, 35, 37 and 40 are rock). A node's `openscene`
 *     kills Nick on a pillar that is down (`nickdies`, flamedeath.move); one
 *     that is up takes him and starts to sink (`sinking`), so he must not stay.
 *   - **which are up**: all at first but 11, 14, 17, 18 and 24 (the pillar's
 *     `setmeup`); the first step on Scene29 raises 17, 18 and 24 and drops 20
 *     and 22, and the first on Scene40 raises 22 (lava.sett openscene).
 *   - **the way out**: Scene23 sets every pillar solid (`solidifypillars`), and
 *     "up" there facing 241° jumps to the hub (`endlava ("hub")`).
 *
 * So the route is found on those rules, and walked a hop at a time.
 */
import { fail, type Headless } from "./harness";
import { face, step } from "./route";

const ROCK = new Set(["node10", "scene12", "scene13", "scene29", "scene35", "scene37", "scene40"]);
const DOWN_AT_FIRST = new Set(["scene11", "scene14", "scene17", "scene18", "scene24"]);

function standing(node: string, saw29: boolean, saw40: boolean): boolean {
  const n = node.toLowerCase();
  if (ROCK.has(n)) return true;
  if (saw29 && (n === "scene20" || n === "scene22") && !(n === "scene22" && saw40)) return false;
  if (saw29 && (n === "scene17" || n === "scene18" || n === "scene24")) return true;
  if (saw40 && n === "scene22") return true;
  return !DOWN_AT_FIRST.has(n);
}

/** the hops from Node10 to Scene23 that never land on a pillar that is down */
export function lavaPath(h: Headless): string[] {
  const maze = h.session.maze ?? fail("no room");
  const sett = (maze as unknown as { sett: { nodes: { name: string; node: number }[] } }).sett;
  const byContainer = new Map(sett.nodes.map((n) => [n.node, n.name]));
  const exits = (n: string): string[] => maze.exits(n).map((f) => byContainer.get(f.to) ?? "");
  type S = { at: string; s29: boolean; s40: boolean };
  const key = (s: S): string => `${s.at.toLowerCase()},${s.s29},${s.s40}`;
  const start: S = { at: maze.sceneName, s29: false, s40: false };
  const prev = new Map<string, { from: string; s: S } | null>([[key(start), null]]);
  const states = new Map<string, S>([[key(start), start]]);
  const queue = [start];
  while (queue.length) {
    const s = queue.shift()!;
    if (s.at.toLowerCase() === "scene23") {
      const path: string[] = [];
      for (let k = key(s); prev.get(k); k = prev.get(k)!.from) path.unshift(states.get(k)!.at);
      return path;
    }
    for (const to of exits(s.at)) {
      if (!to || !standing(to, s.s29, s.s40)) continue;
      const t: S = { at: to, s29: s.s29 || to.toLowerCase() === "scene29", s40: s.s40 || to.toLowerCase() === "scene40" };
      const k = key(t);
      if (prev.has(k)) continue;
      prev.set(k, { from: key(s), s: t });
      states.set(k, t);
      queue.push(t);
    }
  }
  fail("the lava has no way across in the model");
}

/** walk the lava to Scene23 and jump to the hub */
export async function crossTheLava(h: Headless): Promise<string[]> {
  const path = lavaPath(h);
  for (const to of path) await step(h, to);
  return path;
}

/**
 * The flame corridor off the hub (hub.sett Scene36 on, flame.shop): "up" walks
 * a step (`currentscene ("strait")`) and then asks whether a flame is burning
 * where Nick stands — `checkforhit`, the flame and its twin at step `node`,
 * visible with their count between 4 and 20. The flames fire on a drum
 * pattern, every 32 frames (`run`), and burn for 16 (`blowloop`). So Nick steps
 * only while both flames of the next step are out and the next beat is further
 * off than a step takes to walk.
 */
export async function runTheFlames(h: Headless, done: () => boolean): Promise<number> {
  const props = h.session.propRuntime;
  const g = (n: string): number => Number(h.session.interp.globals.get(n) ?? 0);
  let lastBeat = g("drumbeat");
  let sinceBeat = 0;
  let walk = 12;
  let walking = -1;
  let steps = 0;
  const out = (name: string): boolean => {
    const p = props.get(name);
    return !p || !p.visible || Number(p.value) <= 3;
  };
  await h.until(
    () => {
      if (done()) return true;
      if (g("drumbeat") !== lastBeat) {
        lastBeat = g("drumbeat");
        sinceBeat = 0;
      } else sinceBeat++;
      const m = h.session.maze;
      // how long a step takes, measured on the steps taken
      if (walking >= 0) {
        if (m?.walk || h.running().length) walking++;
        else {
          walk = Math.max(walk, walking);
          walking = -1;
        }
      }
      if (!m || m.walk || h.running().length || m.view !== "view1") return false;
      const node = g("node");
      if (!out(`flame ${node}`) || !out(`fflame ${node}`)) return false;
      if (sinceBeat + walk + 2 >= 32) return false;
      h.key("up");
      steps++;
      walking = 0;
      return false;
    },
    "the flame corridor",
    20_000,
  );
  return steps;
}

/**
 * The swinging chain between Node195 and Node196 (rjbeach.shop chain): a click
 * swings Nick across, and kills him unless the chain is near the start of its
 * swing — `tick () - propvalue ("chain")` more than 48 and less than 224 is a
 * fall (`die`). The swing restarts at each end of its animation (`endanim` →
 * `swing`, which stamps the tick), so the click waits for a fresh swing.
 */
export async function swingTheChain(h: Headless, to: string): Promise<void> {
  const tick = (): number => Math.floor((h.session.clock.now * 3) / 50);
  const chain = h.session.propRuntime.get("chain") ?? fail("no chain in the hub");
  const at = await face(h, "chain");
  await h.until(() => {
    const d = tick() - Number(chain.value);
    return d >= 0 && d <= 30;
  }, "a fresh swing of the chain", 2_000);
  h.click(at.x, at.y);
  await h.until(() => h.node().toLowerCase() === to.toLowerCase() && h.idle(), `the chain to ${to}`, 3_000);
}

/**
 * The skeleton by the scepter (scombat2.stag) cannot be beaten with the sword —
 * it blocks every stroke — but the vine over it can bring it down: the stage's
 * one button, "Vine", lies past the right edge of a flat wider than the screen
 * (x 677-841), in reach only while Nick leans right and the stage slides left
 * (`stageorigin`). A click there lands on the vine prop, which hands it to the
 * button beneath (sCombat.shop fvine), and the button wins (`swin1.move`) — in
 * the band below the strikes (`think` strikes above y 384).
 */
export async function pullTheVine(h: Headless): Promise<void> {
  const props = h.session.propRuntime;
  h.key("right");
  await h.frame(20);
  const vine = props.get("fvine") ?? fail("no vine on the skeleton's stage");
  const on: { x: number; y: number }[] = [];
  for (let y = 386; y < 480; y += 4) for (let x = 2; x < 640; x += 4) if (h.session.hitTestAt(x, y).name === "fvine") on.push({ x, y });
  vine.visible = false;
  const over = on.filter((p) => h.session.hitTestAt(p.x, p.y).type === "button");
  vine.visible = true;
  const at = over[Math.floor(over.length / 2)] ?? fail("the vine is over no button, leaning");
  h.click(at.x, at.y);
  await h.until(() => h.session.stageName !== "scombat2.stag" && h.running().length === 0, "the vine to bring the skeleton down", 3_000);
  h.keyUp("right");
}
