/**
 * Skull Cracker's sound banks — and the one field that kept them shut.
 *
 *   npx vitest run engine/tests/skull-sound.ts
 *
 * The disc's 24 `.SND` files are DreamFactory 4 banks: the same 52-byte container
 * 0, the same Pascal name at +36, the same 26-byte chunk records, the same codec
 * the other three games' banks use. What differs is one pointer. `readBankTables`
 * read the loop table out of **container 1** — true of 615 of the 630 v4 banks
 * across four discs, and false of exactly the fifteen that are Skull Cracker's
 * music, where the header's own field at +28 names container 12, or 5, or 15. So
 * every theme read as a bank with no bars and no sounds, and the track editor
 * called them "not a bank".
 *
 * What makes the reading believable is not that it parses. It is that the sounds
 * come out in the order the EXECUTABLE plays them by. `SC.EXE` plays a one-shot
 * with `0x40ef30(bank, index, point)`, and every index read out of the chapter's
 * hit handlers lands on a name that says what it is:
 *
 * ```
 *   the hydrant's  0x44fb8d  index 4    WOODS  "0040 hydrant"
 *   the mailbox's  0x44fef4  index 5    WOODS  "0050 mailbox fa[lls]"
 *   the rat's      0x44e42a  index 12   WOODS  "0150 rat gets s[quashed]"
 *   a punk's death 0x44f1c1  index 33   WOODS  "0560 wolf death"
 *   a punk's hit   0x44f14a  35..38     WOODS  "0580 wolf punch" … "0610 wolf hit 2"
 *   the ladder's   0x42b00a  2 and 3    SKULZ  "#0070 ladder st" / "#0080 ladder st"
 * ```
 *
 * Six independent hits on a table nobody indexed by hand, including two banks and
 * a range. That is the assertion this file is really making.
 *
 * Skips loudly when no disc is present, the way `sbk.ts` does.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { readBankTables } from "@dreamfactory/engine/df/banks";
import { decodeAudioContainer } from "@dreamfactory/engine/df/audio";
import { versionOf } from "@dreamfactory/engine/df/version";

const DIRS = ["../../skullcracker/gamefiles/SKULL/DATA", "../../skullcracker/gamefiles/SKULL/Data"].map((p) =>
  fileURLToPath(new URL(p, import.meta.url)),
);
const DATA = DIRS.find((p) => existsSync(p));

const banks: string[] = DATA
  ? readdirSync(DATA)
      .filter((n) => /\.snd$/i.test(n))
      .sort()
      .map((n) => `${DATA}/${n}`)
  : [];

const skip = (): boolean => {
  if (banks.length) return false;
  console.warn(`no Skull Cracker sound banks under any of ${DIRS.join(", ")} — skipping`);
  return true;
};

const open = (path: string) => readContainerFile(new Uint8Array(readFileSync(path)));
const named = (stem: string): string | undefined => banks.find((b) => b.toUpperCase().endsWith(`/${stem}.SND`));

test("the disc holds 24 sound banks and every one of them is a version 4 bank", () => {
  if (skip()) return;
  expect(banks.length).toBe(24);
  for (const b of banks) {
    const f = open(b);
    expect(versionOf(f.containers[0].data, f.order), b).toBe(4);
    // the 52-byte header every v4 bank has, name field included
    expect(f.containers[0].data.length, b).toBe(52);
  }
});

test("each bank's header names its own tables, and fifteen of them are not container 1", () => {
  if (skip()) return;
  let elsewhere = 0;
  for (const b of banks) {
    const f = open(b);
    const t = readBankTables(f);
    // a bank has one or the other: music with bars, or sounds with names
    expect(t.loopRecords.length + t.singles.length, b).toBeGreaterThan(0);
    // and every record points at a container that is really there
    for (const c of [...t.loopRecords, ...t.singles]) {
      expect(c.containerLoc, `${b} ${c.identifier}`).toBeGreaterThan(0);
      expect(c.containerLoc, `${b} ${c.identifier}`).toBeLessThan(f.containers.length);
    }
    // the loop table's own length is exactly its header plus its records
    if (t.loopTable) {
      expect(f.containers[t.loopTable].data.length, b).toBe(270 + t.loopRecords.length * 26);
    }
    if (t.loopTable > 1) elsewhere++;
  }
  expect(elsewhere).toBe(15);
});

test("a theme is a bed of bars with a play order, and a level bank is named sounds", () => {
  if (skip()) return;
  const theme = named("THEME01");
  const woods = named("WOODS");
  expect(theme && woods).toBeTruthy();

  const t = readBankTables(open(theme!));
  expect(t.trackName).toBe("Theme 3.1");
  expect(t.loopTable).toBe(12);
  expect(t.loopRecords.length).toBe(11);
  expect(t.singles.length).toBe(0);
  // the arrangement: 62 steps over 11 bars, each step a 1-based bar
  expect(t.loopOrder.length).toBe(62);
  expect(Math.min(...t.loopOrder)).toBe(1);
  expect(Math.max(...t.loopOrder)).toBe(11);
  expect(t.loopOrder.slice(0, 6)).toEqual([1, 1, 5, 5, 5, 3]);

  const w = readBankTables(open(woods!));
  expect(w.loopRecords.length).toBe(0);
  expect(w.singles.length).toBe(53);
});

test("the indices SC.EXE plays by land on names that say what they are", () => {
  if (skip()) return;
  const woods = readBankTables(open(named("WOODS")!)).singles;
  const skulz = readBankTables(open(named("SKULZ")!)).singles;
  // one index per hit handler — see this file's own header for where each is read
  expect(woods[4].identifier).toMatch(/hydrant/i);
  expect(woods[5].identifier).toMatch(/mailbox/i);
  expect(woods[12].identifier).toMatch(/rat/i);
  expect(woods[33].identifier).toMatch(/death/i);
  for (let i = 35; i <= 38; i++) expect(woods[i].identifier, `index ${i}`).toMatch(/wolf (punch|hit)/i);
  expect(skulz[2].identifier).toMatch(/ladder/i);
  expect(skulz[3].identifier).toMatch(/ladder/i);
});

test("every chunk a bank points at decodes as audio at one of the disc's two rates", () => {
  if (skip()) return;
  let total = 0;
  let silent = 0;
  for (const b of banks) {
    const f = open(b);
    const t = readBankTables(f);
    for (const c of [...t.loopRecords, ...t.singles]) {
      const a = decodeAudioContainer(f.containers[c.containerLoc].data, f.order);
      // the disc mixes the two: the themes and most sounds are 22k, some sounds 11k
      expect([11025, 22050], `${b} ${c.identifier}`).toContain(a.sampleRate);
      expect(a.samples.length, `${b} ${c.identifier}`).toBeGreaterThan(1000);
      // real sound rather than a decode that ran off the rails — and 8 of the 530
      // chunks are digital silence, all of them quarter-second bars in THEME11's
      // bed, which is what a rest in an arrangement looks like
      let sum = 0;
      for (const s of a.samples) sum += s * s;
      const rms = Math.sqrt(sum / a.samples.length);
      if (rms > 0) expect(rms, `${b} ${c.identifier}`).toBeGreaterThan(0.001);
      expect(rms, `${b} ${c.identifier}`).toBeLessThan(0.7);
      total++;
      if (rms === 0) silent++;
    }
  }
  expect(total).toBe(530);
  expect(silent).toBe(8);
});
