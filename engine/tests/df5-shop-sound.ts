/**
 * A DreamFactory 5 view's sound: the VIEW's u32 at 0x0c names a SOUN container
 * (PropState.sound), and that SOUN is the IMA ADPCM chunk RedJack's sounds use.
 *
 *   npx vitest run engine/tests/df5-shop-sound.ts
 *
 * Measured from Disney's Villains Revenge (`Title/v105/v105a.shop`, issue #477),
 * which this repository does not carry — so the shop here is built from nothing.
 * The last test reads `redjack/gamefiles` and skips loudly without it: RedJack's
 * shops have no sounds, and must still read none.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import { ContainerBuilder, i16, i32, pstr } from "@dreamfactory/engine/df/build";
import { decodeAudioContainer } from "@dreamfactory/engine/df/audio";
import { readShpFile } from "@dreamfactory/engine/df/shp";

/** the 24-byte v5 prefix: `00 00 05 00` and the fourCC written backwards */
function v5(kind: string, size: number): Uint8Array {
  const d = new Uint8Array(size);
  d[2] = 5;
  for (let i = 0; i < 4; i++) d[7 - i] = kind.charCodeAt(i);
  return d;
}

/**
 * A SOUN as Villains Revenge stores one: codec 2 with the word at 0x18 set (IMA
 * ADPCM), the rate at 0x1c, the 16-bit size at 0x24, the block count at 0x28 and
 * `count + 1` block offsets from 0x2c. One block: predictor 1000, step index 0,
 * then `nibbleBytes` bytes of code 4 — each nibble a step up.
 */
function soun(rate: number, nibbleBytes: number): Uint8Array {
  const table = 0x2c + 2 * 4;
  const d = v5("SOUN", table + 3 + nibbleBytes);
  const samples = 1 + 2 * nibbleBytes;
  i16(d, 0x18, 1);
  i16(d, 0x1a, 2);
  i32(d, 0x1c, rate);
  i32(d, 0x24, samples * 2);
  i32(d, 0x28, 1);
  i32(d, 0x2c, table);
  i32(d, 0x30, d.length);
  i16(d, table, 1000);
  d.fill(0x44, table + 3);
  return d;
}

/** a VIEW with one picture and its sound field at 0x0c */
function view(picture: number, sound: number): Uint8Array {
  const d = v5("VIEW", 0x236 + 44);
  i32(d, 0x0c, sound);
  i16(d, 0x2e, 1); // one step, frame 1
  i16(d, 0x230, 1);
  i32(d, 0x232, 1);
  i32(d, 0x236, picture);
  return d;
}

/** SHOP, PROP, then the views — the first followed by its SOUN, as in v105a.shop */
function shop(): Uint8Array {
  const b = new ContainerBuilder();
  const head = b.reserve(0x3c + 16);
  const prop = b.reserve(94 + 3 * 32);
  const sprite = b.add(v5("SPRI", 0x40));
  const views: number[] = [];
  views.push(b.add(view(sprite, b.count + 1)));
  b.add(soun(22050, 50));
  views.push(b.add(view(sprite, 0)));
  // a 0x0c that names a container which is not a SOUN is not a sound
  views.push(b.add(view(sprite, sprite)));

  head.data.set(v5("SHOP", 8));
  pstr(head.data, 0x28, "knobs");
  i32(head.data, 0x38, 1);
  i32(head.data, 0x3c, prop.loc);
  prop.data.set(v5("PROP", 8));
  pstr(prop.data, 42, "KnobBodies");
  i32(prop.data, 90, views.length);
  ["sounding", "silent", "notsound"].forEach((name, e) => {
    i32(prop.data, 94 + e * 32, views[e]);
    pstr(prop.data, 94 + e * 32 + 16, name);
  });
  return b.bytes();
}

test("a v5 view's 0x0c names its SOUN, and that SOUN decodes as IMA ADPCM", () => {
  const s = readShpFile(shop());
  const [sounding, silent, notSound] = s.groups[0].states;
  expect(sounding.identifier).toBe("sounding");
  expect(sounding.sound).toBe(sounding.location + 1);
  expect(silent.sound).toBeUndefined();
  expect(notSound.sound).toBeUndefined();

  const audio = decodeAudioContainer(s.file.containers[sounding.sound!].data);
  expect(audio.sampleRate).toBe(22050);
  expect(audio.samples.length).toBe(101);
  expect(audio.samples[0]).toBe(1000 / 32768);
  // index 0's step is 7: code 4 adds step + step/8, 7
  expect(audio.samples[1]).toBe(1007 / 32768);
  expect(audio.samples[100]).toBeGreaterThan(audio.samples[1]);
});

// ---- the rip ---------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../redjack/gamefiles", import.meta.url));
const shops: string[] = [];
const walk = (dir: string): void => {
  for (const n of readdirSync(dir)) {
    const p = `${dir}/${n}`;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.shop$/i.test(n)) shops.push(p);
  }
};
if (existsSync(ROOT)) walk(ROOT);

const missing = shops.length === 0;
if (missing) console.warn(`no RedJack shops under ${ROOT} — skipping`);

test.skipIf(missing)("RedJack's shops name no view sound", () => {
  for (const path of shops) {
    const s = readShpFile(new Uint8Array(readFileSync(path)));
    for (const g of s.groups) for (const st of g.states) expect(st.sound, `${path} ${g.name}/${st.identifier}`).toBeUndefined();
  }
});
