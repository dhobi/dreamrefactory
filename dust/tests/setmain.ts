/**
 * Which container a v1 set calls its main script — the field, not the habit.
 *
 *   npx vitest run dust/tests/setmain.ts
 *
 * `readSetFileV1` used to take the main script from header offset `0x1c`, and
 * that offset holds a constant: it reads 1 in all 35 sets on this disc, and its
 * v4 counterpart reads 1 in every Titanic set too. DF.EXE never uses it as a
 * container index — it checks the word is non-zero and bails if it is not
 * (DFPENT.EXE `0x419962`, paired with the same test on `+0x34`, error line
 * 5402), which is a sanity check on the file. Reading it as a pointer worked
 * only because the authoring tool put the main script in container 1.
 *
 * `undertak.set` is the one set that breaks the habit. Its container 1 is the
 * ACTOR REGISTER — `actorRegister` names the same index, alone on the disc in
 * doing so, and the bytes there are the star record `under.side.side` — so its
 * main script is container 2. Reading 0x1c cost that room its whole script: no
 * main, so no `openset`, and undertak.set's openset is the only thing in the
 * corpus that ever places the undertaker. You walked into an empty room whose
 * arrows did not work either, because the same container holds its `keydown`
 * (#291).
 *
 * The real field is `0x1b78`, read as a dword, which set-open keeps in the set's
 * own state for the lazy load:
 *
 *     0x419981  mov eax, dword ptr [edi + 0x1b78]
 *     0x419987  mov dword ptr [esi + 0x24], eax
 *
 * Two claims here, and the second is the one that would have caught the bug:
 * the named container carries a script in EVERY set, and undertak.set names 2
 * while the rest name 1. The first alone passes on the old code for 34 sets.
 *
 * Skipped, not failed, without the disc (the bargain dust/tests/saves.ts makes).
 */
import { test, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSetFileV1 } from "@dreamfactory/engine/df/set-v1";
import { sniffScript } from "@dreamfactory/engine/df/script";

const DATA_DIR = fileURLToPath(new URL("../gamefiles/dustcd/DATA", import.meta.url));

/** every `.SET` in the rip's DATA directory, by name */
function sets(): string[] {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR).filter((f) => /\.set$/i.test(f)).sort();
}

test("every set's named main script container actually carries a script", () => {
  const files = sets();
  if (!files.length) {
    console.warn(`no ${DATA_DIR} — skipping (needs the Dust rip)`);
    return;
  }
  for (const f of files) {
    const set = readSetFileV1(new Uint8Array(readFileSync(join(DATA_DIR, f))));
    const c = set.file.containers[set.mainScript];
    expect.soft(c && !c.gap, `${f}: c${set.mainScript} exists`).toBeTruthy();
    // sniffScript here is the ASSERTION, not the lookup: the reader is expected
    // to have been told where the script is, and this says it was told right.
    expect.soft(c && sniffScript(c.data) !== null, `${f}: c${set.mainScript} is a script`).toBe(true);
  }
});

test("undertak.set names container 2, where its actor register displaced the script", () => {
  const files = sets();
  if (!files.length) return;
  const undertak = files.find((f) => /^undertak\.set$/i.test(f));
  expect(undertak, "the disc has undertak.set").toBeTruthy();
  const set = readSetFileV1(new Uint8Array(readFileSync(join(DATA_DIR, undertak!))));
  expect(set.mainScript, "its main script is container 2, not the usual 1").toBe(2);
  // ...and the reason, so a regression here says which of the two moved
  expect(set.actorRegister, "because container 1 is its actor register").toBe(1);
  // the handler the room dies without
  const text = sniffScript(set.file.containers[2].data);
  expect(text, "c2 parses as a script").not.toBeNull();

  // and it is the ONLY set that differs, which is what made the old reading
  // survive: every other set on the disc puts its main script in container 1
  const odd = files.filter((f) => {
    const s = readSetFileV1(new Uint8Array(readFileSync(join(DATA_DIR, f))));
    return s.mainScript !== 1;
  });
  expect(odd, "no other set breaks the container-1 habit").toEqual([undertak]);
});
