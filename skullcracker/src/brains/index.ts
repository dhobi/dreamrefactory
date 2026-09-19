/**
 * The classes whose own state machine has been read, by `init` name.
 *
 * A class in here takes its frame whole and the shared reading in
 * `walk.ts`'s `stepFight` never sees it. A class NOT in here still fights —
 * it just fights through the one shared brain, which closes and swings on the
 * band table in `fights.ts` and does none of the backing off, taunting,
 * circling or committing its own machine would.
 *
 * See {@link file://./kit.ts} for what a machine is written against and why
 * `obj+0x18` is the whole of it.
 */
import type { Brain } from "./kit";
import { werea } from "./werea";

export const BRAINS: Readonly<Record<string, Brain | undefined>> = {
  initwerea: werea,
};
