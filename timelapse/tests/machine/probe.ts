/**
 * A probe for writing a route: the game booted headless, any of the route's
 * steps played, then a few moves by hand, each reporting where it landed and
 * what can be touched there. Not a suite (it never says `pass`), so
 * `vitest.machine.config.ts` leaves it out: it has no `test(`.
 *
 *   npx tsx tests/machine/probe.ts "<steps>::<moves>" "<steps after>"     (from timelapse/)
 *
 * Steps are the route's own exports, by name and comma-separated, with
 * arguments after a space (`camp,lantern`, `travel Button10 E`, `lever 4`).
 * `enter <W>` starts in world W by the BOOTFILE's own `enterworld`, as its
 * `boot ()` does with `offcd` off — a world's route can be explored without
 * playing the ones before it, though its state is then a fresh game's.
 *
 * Moves, separated by `|`:
 *
 *   g:<stage>,<frame>   walk there (`goTo`)           w:<keys>   keys, `R F2 L`
 *   c:<region>          click a region                p:<prop>   click a prop
 *   k:<key>             a key                         f:<n>      n passes
 *   e:<script>          one line of the game's language, its value printed
 *
 * SRC=1 prints the scripts of each flat landed on and of its regions.
 */
import { headless, ok, type Headless } from "./harness";
import { clickProp, clickRegion, flatSource, goTo, propsOnScreen, regions, walk } from "./nav";
import * as easter from "./worlds/easter";
import * as egypt from "./worlds/egypt";
import * as maya from "./worlds/maya";
import * as anasazi from "./worlds/anasazi";
import * as atlantis from "./worlds/atlantis";

type Step = (h: Headless, ...args: string[]) => Promise<void>;
const steps: Record<string, Step> = {
  ...(easter as unknown as Record<string, Step>),
  ...(egypt as unknown as Record<string, Step>),
  ...(maya as unknown as Record<string, Step>),
  ...(anasazi as unknown as Record<string, Step>),
  ...(atlantis as unknown as Record<string, Step>),
  enter: async (h, w) => {
    void h.session.sendEvent("sendtoboot", "", "enterworld", [w], "probe");
    await h.until(() => h.where().world === w && h.idle(), `world ${w}`, 100_000);
    await h.settle(`world ${w}`);
  },
};
const run = async (list: string): Promise<void> => {
  for (const s of list.split(",").filter(Boolean)) {
    const [name, ...args] = s.split(" ");
    if (!steps[name]) throw new Error(`no step "${name}"`);
    await steps[name](h, ...args);
  }
};

const h = await headless();
await h.settle("the hilltop", 60_000);
const [before, moves = ""] = (process.argv[2] ?? "").split("::");
await run(before);
for (const m of moves.split("|").filter(Boolean)) {
  const [kind, arg = ""] = [m.slice(0, m.indexOf(":")), m.slice(m.indexOf(":") + 1)];
  if (kind === "w") await walk(h, arg);
  else if (kind === "c") await clickRegion(h, arg);
  else if (kind === "p") await clickProp(h, arg);
  else if (kind === "f") await h.frame(Number(arg));
  else if (kind === "k") (h.key(arg), await h.settle(arg));
  else if (kind === "e") console.log("  =", await h.eval(arg));
  else if (kind === "g") {
    const [stage, frame] = arg.split(",").map(Number);
    await goTo(h, { stage, frame });
  }
  const named = regions(h).map((r) => r.name).filter((n) => !/^(up|down|left|right)$/i.test(n));
  ok(`${m}: ${h.here()} regions [${named.join(", ")}] props [${propsOnScreen(h).join(", ")}]`);
  if (process.env.SRC) {
    const src = flatSource(h);
    console.log(src.flat);
    for (const [n, t] of Object.entries(src.regions)) if (!/^(up|down|left|right)$/i.test(n)) console.log(`--- region ${n}\n${t}`);
  }
}
await run(process.argv[3] ?? "");
const errors = h.logs.filter((l) => /error/i.test(l));
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
process.exit(0);
