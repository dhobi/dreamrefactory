/**
 * Dust, played — one rung of the disc's own playthrough at a time.
 *
 *   npm run test:playthrough -w dust
 *
 * The claim this suite makes is one Titanic's route cannot: **both ends were
 * written by `DF.EXE` in 1995.** A segment loads the shipped save its rung
 * starts at, plays, and is checked against the shipped save its rung ends at —
 * so a pass says the port arrived where the original engine arrived, not merely
 * where this project last recorded itself arriving
 * ([the golden thread](../../../docs/dust/thread.md)).
 *
 * One rung has only the far end, and it is the opening. `D1E_001` is the
 * earliest file CyberFlix took, so the first four thousand frames happen in
 * front of the collection and there is nothing to load: that rung starts at a
 * cold boot, and its `from` is `null`. It claims less than the others by
 * construction — half of what a rung is, is where it began — and it is the only
 * one that plays a stretch the disc cannot hand you.
 *
 * **Failed, not skipped, without the rip** — which is the opposite bargain from
 * every other Dust suite, and deliberately so. `dust/tests/*.ts` are part of the
 * gate that runs everywhere, so a machine with no disc should still get a green
 * run out of them; that is why they skip. This one is not run everywhere. It has
 * its own config, and `.github/workflows/tests.yml` starts it only when it has
 * worked out that a change can reach Dust's route — so being asked for by name
 * and answering "36 rungs passed" having played none would be the one result
 * this suite exists to make impossible.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readSetFileV1 } from "@dreamfactory/engine/df/set-v1";
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";
import { CD, SAVES, haveRip, indexDisc, newDustHost, pumped } from "./harness";
import { sceneAt } from "./nav";
import { SEGMENTS } from "./segments";

const save = (name: string) => parseSaveV1(new Uint8Array(readFileSync(`${SAVES}/${name}.RTD`)));

/** the engine reports a room without its extension and a save stores one with */
const room = (name: string): string => name.toLowerCase().replace(/\.set$/, "");

for (const seg of SEGMENTS) {
  test(`${seg.from ?? "a cold boot"} → ${seg.to}: ${seg.what}`, async () => {
    if (!haveRip()) {
      throw new Error(
        `no Dust rip at ${CD}. The playthrough plays the game against the disc's own ` +
          `saves, so it cannot run without it and will not pretend to: link a rip there, ` +
          `or set DUST_GAMEFILES in the runner's .env (docs/reference/ci.md).`,
      );
    }
    const want = save(seg.to);
    const { host, logs } = await newDustHost();
    const p = pumped(host, logs);

    // ---- the rung's own starting point, as the original left it ----------
    // …except the opening, whose starting point is the boot itself. `newDustHost`
    // has already run `coldBoot()`, so that rung is simply the one that does not
    // throw a save over the top of it.
    if (seg.from !== null) {
      expect(
        await p.session.loadGame(new Uint8Array(readFileSync(`${SAVES}/${seg.from}.RTD`))),
        `${seg.from} loads`,
      ).toBe(true);
    }
    await p.settle(seg.from ?? "the boot");

    // ---- play it ---------------------------------------------------------
    await seg.play(p);
    await p.settle("the segment");

    // ---- and check against the save the original took at the other end ---
    expect.soft(room(p.session.currentSetFile ?? ""), "the room").toBe(room(want.standpoint.setFile));
    // the standpoint, said as the scene the saved CELL is — a v1 save stores a
    // grid cell and the engine reports a name, so the set is what joins them
    // by BASENAME, because the underground rooms ship in `UNDER/` rather than
    // `DATA/` — the same index the boot's own search path amounts to
    const at = indexDisc().get(want.standpoint.setFile.toLowerCase());
    if (!at) throw new Error(`no ${want.standpoint.setFile} anywhere on the disc`);
    const set = readSetFileV1(new Uint8Array(readFileSync(at)));
    expect
      .soft(p.session.currentSceneName()?.toLowerCase(), "the standpoint")
      .toBe(sceneAt(set, want.standpoint.cellX, want.standpoint.cellZ).toLowerCase());
    expect.soft(p.session.currentViewName()?.toLowerCase(), "facing").toBe(want.standpoint.view.toLowerCase());

    // ---- the globals the rung is about -----------------------------------
    for (const name of seg.claims) {
      const got = p.session.interp.globals.get(name);
      const expected = want.numGlobals.get(name) ?? want.strGlobals.get(name);
      expect
        .soft(typeof got === "string" ? got.toLowerCase() : got, `${name}`)
        .toBe(typeof expected === "string" ? expected.toLowerCase() : expected);
    }
  }, 120_000);
}
