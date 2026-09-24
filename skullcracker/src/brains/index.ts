/**
 * The classes whose own state machine has been read, by `init` name.
 *
 * A class in here takes its frame whole and the shared reading in `walk.ts`'s
 * `stepFight` never sees it. Each module is one class's think function out of
 * `SC.EXE`, a jump table over `obj+0x18` — see {@link file://./kit.ts} for why
 * that word is the whole of a state machine, and {@link file://./werea.ts} for
 * the worked example the rest were written against.
 *
 * Three of them are deliberately empty. `initcoke`, `inithydrant` and
 * `initmailbox` have no tracker, no band list and no code in the state they
 * spend a level in: the furniture really does just stand there, and the file
 * says so with the addresses to prove it rather than leaving a gap.
 */
import type { Brain, Gate, Reaction } from "./kit";
import { arm, armGate, armReacts } from "./arm";
import { bat, batReacts } from "./bat";
import { batboy, batboyDown, gangReacts } from "./batboy";
import { coke, cokeGate } from "./coke";
import { cop, copReacts } from "./cop";
import { dog, dogReacts } from "./dog";
import { eyeball, eyeballReacts } from "./eyeball";
import { ghengis, ghengisReacts } from "./ghengis";
import { hardcore, hardcoreReacts } from "./hardcore";
import { hydrant } from "./hydrant";
import { igor } from "./igor";
import { knifeboy, knifeboyDown } from "./knifeboy";
import { knotboy, knotboyDown } from "./knotboy";
import { kragg, kraggGate, kraggReacts } from "./kragg";
import { mailbox } from "./mailbox";
import { maskboy, maskboyReacts } from "./maskboy";
import { ox, oxReacts } from "./ox";
import { puke, pukeCorpse } from "./puke";
import { rat, ratReacts } from "./rat";
import { skel, skelReacts } from "./skel";
import { slurp, slurpReacts } from "./slurp";
import { tube, tubeCorpse } from "./tube";
import { vpriest, vpriestReacts } from "./vpriest";
import { wbooly, wboolyGate, wboolyReacts } from "./wbooly";
import { werea, wereaReacts } from "./werea";
import { wereb, werebReacts } from "./wereb";
import { werec, werecReacts } from "./werec";
import { wered, weredGate, weredReacts } from "./wered";
import { wraith, wraithGate, wraithReacts } from "./wraith";
import { zomb } from "./zomb";

export const BRAINS: Readonly<Record<string, Brain | undefined>> = {
  initarm: arm,
  initbat: bat,
  initbatboy: batboy,
  initcoke: coke,
  initcop: cop,
  initdog: dog,
  initeyeball: eyeball,
  initghengis: ghengis,
  inithardcore: hardcore,
  inithydrant: hydrant,
  initigor: igor,
  initknifeboy: knifeboy,
  initknotboy: knotboy,
  initkragg: kragg,
  initmailbox: mailbox,
  initmaskboy: maskboy,
  initox: ox,
  initpuke: puke,
  initrat: rat,
  initskel: skel,
  initslurp: slurp,
  inittube: tube,
  initvpriest: vpriest,
  initwbooly: wbooly,
  initwerea: werea,
  initwereb: wereb,
  initwerec: werec,
  initwered: wered,
  initwraith: wraith,
  initzomb: zomb,
};

/**
 * The classes that do something while the page is playing their reaction —
 * see {@link Reaction}. Everything else reacts by animation alone.
 */
export const REACTIONS: Readonly<Record<string, Reaction>> = {
  initarm: armReacts,
  initdog: dogReacts,
  initrat: ratReacts,
  initbat: batReacts,
  initbatboy: gangReacts(batboyDown),
  initcop: copReacts,
  initeyeball: eyeballReacts,
  initghengis: ghengisReacts,
  initknifeboy: gangReacts(knifeboyDown),
  initknotboy: gangReacts(knotboyDown),
  initmaskboy: maskboyReacts,
  inithardcore: hardcoreReacts,
  initkragg: kraggReacts,
  initox: oxReacts,
  initpuke: pukeCorpse,
  initskel: skelReacts,
  initslurp: slurpReacts,
  inittube: tubeCorpse,
  initvpriest: vpriestReacts,
  initwerea: wereaReacts,
  initwereb: werebReacts,
  initwerec: werecReacts,
  initwered: weredReacts,
  initwraith: wraithReacts,
  initwbooly: wboolyReacts,
};

/**
 * The classes whose hit handler asks the class's own STATE before it reads the
 * blow — see {@link kraggGate}, the one that does. `null` is a blow that lands
 * as nothing at all.
 */
export const GATES: Readonly<Record<string, Gate>> = {
  initkragg: kraggGate,
  initwbooly: wboolyGate,
  initwered: weredGate,
  initcoke: cokeGate,
  initwraith: wraithGate,
  initarm: armGate,
};
