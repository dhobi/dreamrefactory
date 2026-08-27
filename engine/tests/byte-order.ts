/**
 * Reading a DreamFactory file the other way round.
 *
 *   npx vitest run engine/tests/byte-order.ts
 *
 * Everything this port read was little-endian until Skull Cracker: the same
 * containers, the same frame codec, the same MOV header at the same offsets,
 * every integer reversed. `engine/src/df/byte-order.ts` is the axis that added,
 * and this is what holds it in place — including the counter-example that stops
 * the axis being mistaken for a question about platforms.
 *
 * ## The half that needs no game data
 *
 * Detection is the load-bearing part — every reader downstream inherits whatever
 * it decides — and it is decidable from a 1040-byte header, so those tests build
 * their own and run anywhere. The rule they pin is the asymmetry: little-endian
 * is tried first and wins ties, so no file that read correctly before this
 * existed can be re-read as something else.
 *
 * ## The half that needs a disc — EITHER disc
 *
 * The rest reads Skull Cracker's `menu.mov` and skips when no Skull Cracker disc is
 * present, the way `dust/tests/movies.ts` does. It looks for the film in both of
 * the places the two releases keep it, and asserts the same authored facts either
 * way — because they ARE the same facts. Measured across the two discs: 356
 * containers, 175 frames, seven regions on frame 0 targeting the same seven
 * stubs, eleven bed chunks, one event sound, and a first frame whose ground
 * colour covers 17.9% of it. The files are 1.74 MB and 1.08 MB and every integer
 * in them runs the other way.
 *
 * This shape is not tidiness. The file used to hard-code the Macintosh path, and
 * within a day of being written the Mac disc was replaced by the Windows one and
 * five of these tests began passing by not running — with the warning not even
 * surfacing through the runner. That is the trap this file's own header warns
 * about, sprung on the file itself.
 *
 * ## Two assertions that need explaining
 *
 * **The palette.** Read at the wrong byte offset it does not throw and does not
 * look broken in a summary — it yields 256 entries whose channels are all near
 * zero, because it has taken the LOW byte of each 16-bit component. So the test
 * asserts the palette actually spans its range. The reserved pair is then checked
 * per disc, in the direction that disc needs.
 *
 * **The ground colour.** Which INDEX means "the black this game is drawn on" is
 * not the same on the two discs, and that is the finding rather than an
 * inconvenience: the conversion to PC swapped palette indices 0 and 255 in the
 * pixel data, because the two platforms reserve opposite ends of the system
 * palette. Measured over every film on each disc, index 255 is 27.34% of the Mac
 * one and index 0 is 27.52% of the Windows one — a mirror. So the test asks for
 * the ground index of whichever disc it has, and both render the same black.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { MAC, PC, detectByteOrder } from "@dreamfactory/engine/df/byte-order";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { FrameBuffer, decodeFrame, paletteToRGBA } from "@dreamfactory/engine/df/image";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { versionOf } from "@dreamfactory/engine/df/version";

// ---- detection, with no rip anywhere ---------------------------------------

/** the 1024-byte file header and one position slot, with a chosen byte order */
function header(fileSize: number, little: boolean, containers = 1): Uint8Array {
  const d = new Uint8Array(fileSize);
  const v = new DataView(d.buffer);
  v.setUint32(0, 0x00010000, little); // fourCC
  v.setUint32(4, fileSize, little);
  v.setInt32(20, containers, little);
  return d;
}

test("a file whose size field matches little-endian is little-endian", () => {
  expect(detectByteOrder(header(2048, true))).toBe(PC);
});

test("a file whose size field only matches big-endian is read that way", () => {
  expect(detectByteOrder(header(2048, false))).toBe(MAC);
});

test("little-endian wins a tie, so nothing that read before re-reads differently", () => {
  // 0x000a0a00 bytes is a palindrome, so both readings match the file's length —
  // and taoot's tour8.mov really is exactly this size in two editions
  expect(detectByteOrder(header(0x000a0a00, false))).toBe(PC);
});

test("a file that matches neither way is left to the reader that understands it", () => {
  const d = header(2048, true);
  new DataView(d.buffer).setUint32(4, 99, true);
  expect(detectByteOrder(d)).toBe(PC);
});

test("too short to hold a header is not a reason to guess", () => {
  expect(detectByteOrder(new Uint8Array(4))).toBe(PC);
});

// ---- the counter-example, which is why nothing assumes a platform ----------

/**
 * Titanic's Dutch release is a hybrid disc, and its Macintosh half runs on
 * LITTLE-endian data.
 *
 * This is here because the wrong lesson is so easy to draw. Skull Cracker's disc
 * is a Macintosh one and is big-endian, which invites "Mac discs are
 * big-endian" — and `INSTALL_MAC/Titanic` is a PowerPC PEF executable sitting
 * next to a `bootfile` that needs no flag at all. The byte order is a fact about
 * the title, so the reader asks the file and this test is what keeps the shortcut
 * from being reintroduced.
 */
const MAC_TITANIC = fileURLToPath(
  new URL("../../taoot/gamefiles/nl/titanic1/INSTALL_MAC/bootfile", import.meta.url),
);

test("Titanic's Macintosh build ran on little-endian data", () => {
  if (!existsSync(MAC_TITANIC)) {
    console.warn(`no ${MAC_TITANIC} — skipping (needs the Dutch Titanic rip)`);
    return;
  }
  const file = readContainerFile(new Uint8Array(readFileSync(MAC_TITANIC)));
  expect(file.order).toBe(PC);
  expect(versionOf(file.containers[0].data, file.order)).toBe(4);
});

// ---- the real thing, when the rip is here ----------------------------------

/**
 * Where each release keeps the menu film.
 *
 * The Macintosh disc's `Install Folder/` copy and not its `Movies/` one — those
 * two differ, and the installed one (356 containers, 175 frames) is what shipped;
 * the Windows disc carries only that same revision, in `MOVIES/`. Ordered so the
 * first hit wins, which matters not at all while only one disc is ever present.
 */
const MENU_PATHS = [
  "../../skullcracker/gamefiles/SKULL/Install Folder/Local/menu.mov",
  "../../skullcracker/gamefiles/SKULL/MOVIES/MENU.MOV",
].map((p) => fileURLToPath(new URL(p, import.meta.url)));

const MENU = MENU_PATHS.find((p) => existsSync(p));

const skip = (): boolean => {
  if (MENU) return false;
  console.warn(`no Skull Cracker disc at any of ${MENU_PATHS.join(", ")} — skipping`);
  return true;
};

const menu = (): Uint8Array => new Uint8Array(readFileSync(MENU!));

/** the index this disc draws its black ground in — see the header */
const groundIndex = (order: string): number => (order === "be" ? 255 : 0);

test("Skull Cracker's menu is a DreamFactory 4 container file, either way round", () => {
  if (skip()) return;
  const file = readContainerFile(menu());
  // whichever disc this is, the ANSWER has to be one of the two and the file has
  // to be the same film underneath it
  expect([PC, MAC]).toContain(file.order);
  expect(file.containers.length).toBe(356);
  // the version tag is the one field that MOVES between the two orders, so it is
  // asked for through versionOf rather than read at a fixed offset. This is the
  // assertion that would fail if that anomaly were a misreading: on the Mac disc
  // it is a u16 at +0x00, on the Windows one an i32 at +0x02, and both say 4.
  expect(versionOf(file.containers[0].data, file.order)).toBe(4);
});

test("its frames, names and click regions read out", () => {
  if (skip()) return;
  const mov = readMovFile(menu());
  expect(mov.frames.length).toBe(175);
  expect(mov.frames[0].name).toBe("frame 1");
  // the six buttons down the menu, plus the demo panel — all type 2 (go to the
  // named frame), and every one of those names is a frame that exists
  const regions = mov.frames[0].regions;
  expect(regions.length).toBe(7);
  const names = new Set(mov.frames.map((f) => f.name.toLowerCase()));
  for (const r of regions) {
    expect(r.type).toBe(2);
    expect(names.has(r.target.toLowerCase())).toBe(true);
  }
  // and the stubs those buttons land on END the film, which is how a menu with
  // no script answers: Prefs is the one that chains onwards by itself
  const stub = (name: string) => mov.frames.find((f) => f.name === name)!;
  expect(stub("frame 2").type).toBe(1);
  expect(stub("frame 5").type).toBe(3);
  expect(stub("frame 5").event).toBe("prefs.mov");
});

test("its bed and its click sound are found, which needs the 32-bit counts", () => {
  if (skip()) return;
  const mov = readMovFile(menu());
  // read as i16 these are the empty half of a big-endian field and both come out
  // zero — a menu that plays in silence and clicks without a click
  expect(mov.audioChunks.length).toBe(11);
  expect([...mov.sounds.keys()]).toEqual(["sound 1"]);
});

test("its palette spans a real range and reserves this disc's own two ends", () => {
  if (skip()) return;
  const mov = readMovFile(menu());
  const pal = paletteToRGBA(mov.paletteRaw, 256, mov.file.order);
  // read at the wrong byte the whole table is near-black; read right it is a
  // full ramp
  let bright = 0;
  for (let i = 0; i < 256; i++) if (pal[i * 4] > 200) bright++;
  expect(bright).toBeGreaterThan(20);
  // Both discs STORE white at 0 and black at 255 — that is the Macintosh
  // system palette, and DreamFactory was authored on one. What differs is
  // whether the PC's correction is applied on top.
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  const at = (i: number) => [pal[i * 4], pal[i * 4 + 1], pal[i * 4 + 2]];
  if (mov.file.order === MAC) {
    expect(at(0)).toEqual(white);
    expect(at(255)).toEqual(black);
  } else {
    // palettised Windows reserves black at 0 and white at 255, so they swap
    expect(at(0)).toEqual(black);
    expect(at(255)).toEqual(white);
  }
});

test("its first frame decodes to the whole screen, and is 17.9% ground", () => {
  if (skip()) return;
  const mov = readMovFile(menu());
  const fb = new FrameBuffer();
  const d = decodeFrame(mov.file.containers[mov.frames[0].locationFrame].data, fb, mov.file.order);
  expect([d.width, d.height]).toEqual([512, 384]);
  // 35136 of this frame's 196608 pixels are the ground the game is drawn on —
  // index 255 on the Mac disc, index 0 on the Windows one, the same black either
  // way. Both discs, same count: the two decodes of this frame were compared
  // pixel for pixel and differ nowhere.
  const ground = groundIndex(mov.file.order);
  let n = 0;
  for (let i = 0; i < d.width * d.height; i++) if (fb.pixels[i] === ground) n++;
  expect(n).toBe(35136);
});
