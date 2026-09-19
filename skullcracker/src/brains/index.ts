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
import type { Brain } from "./kit";
import { arm } from "./arm";
import { bat } from "./bat";
import { batboy } from "./batboy";
import { coke } from "./coke";
import { cop } from "./cop";
import { dog } from "./dog";
import { eyeball } from "./eyeball";
import { ghengis } from "./ghengis";
import { hardcore } from "./hardcore";
import { hydrant } from "./hydrant";
import { igor } from "./igor";
import { knifeboy } from "./knifeboy";
import { knotboy } from "./knotboy";
import { kragg } from "./kragg";
import { mailbox } from "./mailbox";
import { maskboy } from "./maskboy";
import { ox } from "./ox";
import { puke } from "./puke";
import { rat } from "./rat";
import { skel } from "./skel";
import { slurp } from "./slurp";
import { tube } from "./tube";
import { vpriest } from "./vpriest";
import { wbooly } from "./wbooly";
import { werea } from "./werea";
import { wereb } from "./wereb";
import { werec } from "./werec";
import { wered } from "./wered";
import { wraith } from "./wraith";
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
