/**
 * A prop state's PLAY SCRIPT — the thing that says a closing animation runs
 * backwards through the same pictures its opening runs forwards through.
 *
 * User-reported: "fusebox has wrong closing animation. When getting into A-14
 * room by powering off the cabin, the closing animation is wrong. It looks like
 * it's just the opening animation again." It was exactly that.
 *
 * FUSE.SHP's fusedoor stores six pictures for `opening` and six more for
 * `closing`, and both sets run closed -> open: the swing is drawn once and stored
 * twice, so the ONLY thing that says `closing` plays in reverse is its play
 * script. That script is a step LIST, not a permutation of the frames — steps
 * repeat, because repeating a step is how the format holds a picture for more
 * than one tick. Reading only as many entries as there are frames saw the
 * repeats, judged the table "not a permutation", and fell back to stored order.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readShpFile, PropState } from "@dreamfactory/engine/df/shp";
import { gamefilePath } from "../../tools/gamefiles";
import { degVariantFrames, playSequence } from "@dreamfactory/engine/runtime/props";

const shp = (p: string) => readShpFile(new Uint8Array(readFileSync(p)));
// resolved through the index rather than spelled out: the discs use no single
// case convention, and a literal path stops resolving as soon as a rip is
// re-cased (`Titanic2/` -> `titanic2/`)
const FUSE = gamefilePath("fuse.shp");
const BOIL = gamefilePath("boil.shp");
const HOUSE = gamefilePath("house.shp");

/** the shops are read once each; states are looked up out of these */
const files = new Map<string, ReturnType<typeof shp>>();
function state(path: string, group: string, id: string): PropState {
  if (!files.has(path)) files.set(path, shp(path));
  const g = files.get(path)!.groups.find((x) => x.name.toLowerCase() === group)!;
  const s = g.states.find((x) => x.identifier.toLowerCase() === id);
  expect(s, `${group}.${id} in ${path}`).toBeTruthy();
  return s!;
}
/**
 * The PICTURES a state plays, in order, at the given deg.
 *
 * Identified by the frame's geometry (height/width/anchor, from the transparent
 * image header) and NOT by its container: an `opening` and its `closing` store
 * SEPARATE COPIES of the same swing — fusedoor's are containers 17..22 and
 * 24..29 — so container numbers can never compare between the two, which is the
 * whole reason the direction has to come from the play script.
 */
function shown(path: string, s: PropState, deg = 0): string[] {
  const file = files.get(path)!.file;
  const sig = (loc: number) => {
    const d = file.containers[loc].data;
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    return `${v.getInt16(0, true)}x${v.getInt16(2, true)}@${v.getInt16(4, true)},${v.getInt16(6, true)}`;
  };
  const seq = playSequence(s, degVariantFrames(s, deg)) ?? s.frames.map((_, i) => i);
  // consecutive repeats collapsed: a repeat is a HOLD of one picture
  return seq.map((i) => sig(s.frames[i])).filter((v, i, a) => i === 0 || v !== a[i - 1]);
}

test("the fusebox door closes by running its opening backwards", () => {
  const opening = state(FUSE, "fusedoor", "opening");
  const closing = state(FUSE, "fusedoor", "closing");
  // the data behind the report: two states, six frames each, stored the SAME way
  expect(opening.frames.length, "opening frames").toBe(6);
  expect(closing.frames.length, "closing frames").toBe(6);
  // ten steps each — which is also the ten forceupdate()s in FUSE.SHP's open()/close()
  expect(opening.playOrder, "opening's script").toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  expect(closing.playOrder, "closing's script").toEqual([5, 4, 4, 3, 3, 2, 2, 1, 1, 0]);
  // and the claim: closing shows its pictures in the opposite order to opening
  expect(shown(FUSE, closing), "closing plays backwards").toEqual(
    [...shown(FUSE, opening)].reverse(),
  );
});

test("a step count of 1 is not a play script — 2-frame selectors still hold", () => {
  // the map/life/navarrow "dark"/"light" pairs are deg 0 = normal, deg 1 = tour.
  // They must NOT read as animations, or the band animates to the tour artwork
  // (which it once did, on the load path). Every such state stores a count of 1.
  for (const [g, id] of [["map", "dark"], ["map", "light"], ["life", "dark"], ["navarrow", "green"]]) {
    const s = state(HOUSE, g, id);
    expect(s.frames.length, `${g}.${id} is a 2-frame pair`).toBe(2);
    expect(s.playOrder, `${g}.${id} has no play script`).toBeNull();
    expect(s.animated, `${g}.${id} is a selector, not an animation`).toBe(false);
  }
});

test("a script shorter than its art is vestigial and ignored (house flames)", () => {
  // 21 frames drawn one per bearing (degrees 0,36,72,…208) and a nine-step table
  // naming only the first three — authored against art that was later redrawn.
  // Believing it would play three pictures of a fire that has twenty-one.
  const s = state(HOUSE, "flames", "untitled");
  expect(s.frames.length).toBe(21);
  expect(s.playOrder, "the short table is dropped").toBeNull();
});

test("a deg-split state's script is read as steps WITHIN the variant", () => {
  // BOIL's bag stores one six-step swing per variant: 12 frames, degrees
  // [0]*6 + [1]*6, and a six-step table. `closing`'s 6,5,4,3,2,1 means "this
  // variant, backwards" — so it must reverse for BOTH variants, not just deg 0.
  const opening = state(BOIL, "boilbag", "opening");
  const closing = state(BOIL, "boilbag", "closing");
  expect(closing.playOrder, "six steps for twelve frames").toEqual([5, 4, 3, 2, 1, 0]);
  for (const deg of [0, 1]) {
    const up = shown(BOIL, opening, deg);
    const down = shown(BOIL, closing, deg);
    expect(up.length, `deg ${deg}: six pictures`).toBe(6);
    expect(down, `deg ${deg}: the bag closes the way it opened, backwards`).toEqual(
      [...up].reverse(),
    );
    // and it stays inside its own variant — no tour frames in the normal swing
    const mine = degVariantFrames(closing, deg)!;
    const seq = playSequence(closing, mine)!;
    expect(seq.every((i) => mine.includes(i)), `deg ${deg} stays in its variant`).toBe(true);
  }
  // the two variants really are different art, so the deg-1 check meant something
  expect(shown(BOIL, closing, 0), "the variants differ").not.toEqual(shown(BOIL, closing, 1));
});
