/**
 * The wireless set's controls (`src/speedrun/nav/wireless.ts`) when the set does
 * not do what they ask: each step's refusal, and `switchToTransmit` stopping at
 * the first one with that step's own reason.
 *
 *   npx vitest run taoot/tests/auto/speedrun-wireless.ts
 *
 * `speedrun-controls.ts` works the set through the `wireless` verb and a model
 * that always answers; this drives the module's functions directly against a
 * set that can be told to misbehave one way at a time — a region missing, a
 * click that leaves the wrong flat up, a handle that settles on the wrong
 * notch, a needle that never comes into band — because a sheet stopping on any
 * of these has only the reason to go on.
 */
import { expect, test } from "vitest";
import {
  RX_BANDS,
  TX_BAND,
  WIRELESS_MAIN,
  WIRELESS_PANELS,
  closePanel,
  openPanel,
  setBreaker,
  setSender,
  switchToTransmit,
  tuneTo,
  type WirelessDriver,
} from "../../src/speedrun/nav/wireless";

type Pt = { x: number; y: number };

/**
 * A wireless set that works unless told otherwise: a click on a control's
 * region opens its close-up, `ok` comes back to the desk, a handle dragged to a
 * point settles on whatever `settle` says that point means.
 */
function set(opts: {
  flat?: string | null;
  /** things with no region or prop to aim at */
  missing?: string[];
  /** where a click on a name leaves the flat, when not where it should */
  leadsTo?: Record<string, string | null>;
  /** a handle's owner after it is dragged to a point */
  settle?: Record<string, (to: Pt) => string>;
  /** the tuner needle after a drag to a point */
  needle?: (to: Pt, was: number) => number;
  owners?: Record<string, string>;
  start?: number;
} = {}) {
  let flat = opts.flat === undefined ? WIRELESS_MAIN : opts.flat;
  const owners: Record<string, string> = { tapperdown: "tx", tunerknob: "on", ...opts.owners };
  let needle = opts.start ?? 0;
  const clicks: string[] = [];
  const back = Object.fromEntries(Object.entries(WIRELESS_PANELS).map(([k, v]) => [k, v]));
  const d: WirelessDriver = {
    inFlat: () => flat,
    clickThing: async (name) => {
      if (opts.missing?.includes(name)) return false;
      clicks.push(name);
      if (opts.leadsTo && name in opts.leadsTo) flat = opts.leadsTo[name];
      else flat = name === "ok" ? WIRELESS_MAIN : (back[name] ?? flat);
      return true;
    },
    dragProp: async (name, next) => {
      if (opts.missing?.includes(name)) return false;
      const from = { x: 200, y: 200 };
      for (let to = next(from); to; to = next(from)) {
        const s = opts.settle?.[name];
        if (s) owners[name] = s(to);
        if (name === "tunerknob" && opts.needle) needle = opts.needle(to, needle);
      }
      return true;
    },
    propOwner: (name) => owners[name] ?? "",
    propValue: (name) => (name === "tunerneedle" ? needle : Number.NaN),
  };
  return { d, clicks, flat: () => flat };
}

/** where the breaker handle lands, by how far along it was dragged */
const breakerAt = (to: Pt): string => {
  if (to.x < 80) return "tx";
  return to.x < 180 ? "off" : "rx";
};
/** and the sender, by how high */
const senderAt = (to: Pt): string => (to.y < 100 ? "on" : "off");

test("a close-up is opened only from the desk, and only when its region is there and leads to it", async () => {
  expect(await openPanel(set({ flat: WIRELESS_PANELS.amp }).d, "breaker")).toEqual({
    ok: false,
    reason: `the breaker is reached from ${WIRELESS_MAIN}, not ${WIRELESS_PANELS.amp}`,
  });
  expect(await openPanel(set({ missing: ["breaker"] }).d, "breaker")).toEqual({
    ok: false,
    reason: `no breaker region on ${WIRELESS_MAIN}`,
  });
  expect(await openPanel(set({ leadsTo: { tuner: WIRELESS_MAIN } }).d, "tuner")).toEqual({
    ok: false,
    reason: `clicking tuner left us on ${WIRELESS_MAIN}, not ${WIRELESS_PANELS.tuner}`,
  });
  const fine = set();
  expect(await openPanel(fine.d, "sender")).toEqual({ ok: true });
  expect(fine.flat()).toBe(WIRELESS_PANELS.sender);
});

test("a close-up is closed by its ok, which has to be there and has to lead back to the desk", async () => {
  expect(await closePanel(set({ flat: WIRELESS_PANELS.sender, missing: ["ok"] }).d)).toEqual({
    ok: false,
    reason: `no ok on ${WIRELESS_PANELS.sender}`,
  });
  expect(await closePanel(set({ flat: WIRELESS_PANELS.sender, leadsTo: { ok: WIRELESS_PANELS.amp } }).d)).toEqual({
    ok: false,
    reason: `ok on ${WIRELESS_PANELS.sender} left us on ${WIRELESS_PANELS.amp}, not ${WIRELESS_MAIN}`,
  });
});

test("the breaker is dragged once to its notch and read back", async () => {
  expect(await setBreaker(set({ settle: { breakerhandle: breakerAt } }).d, "rx")).toEqual({ ok: true });
  expect(await setBreaker(set({ missing: ["breakerhandle"] }).d, "tx")).toEqual({
    ok: false,
    reason: "no breakerhandle to take hold of",
  });
  // a handle that sticks at off whatever it is dragged to
  expect(await setBreaker(set({ settle: { breakerhandle: () => "off" } }).d, "tx")).toEqual({
    ok: false,
    reason: `the breaker went to "off" at x=40, not "tx"`,
  });
});

test("the sender is dragged up for on and down for off", async () => {
  expect(await setSender(set({ settle: { senderhandle: senderAt } }).d, "off")).toEqual({ ok: true });
  expect(await setSender(set({ settle: { senderhandle: senderAt } }).d, "on")).toEqual({ ok: true });
  expect(await setSender(set({ missing: ["senderhandle"] }).d, "on")).toEqual({
    ok: false,
    reason: "no senderhandle to take hold of",
  });
  expect(await setSender(set({ settle: { senderhandle: () => "on" } }).d, "off")).toEqual({
    ok: false,
    reason: `the sender went to "on" at y=300, not "off"`,
  });
});

test("the tuner swings down to a band below the needle, and refuses a knob that is not on", async () => {
  // a needle that falls ten a swing: from 201 it is above the band, so the arc
  // has to keep running the falling way until it is in
  const high = set({ start: 201, needle: (_to, was) => was - 10 });
  expect(await tuneTo(high.d, RX_BANDS[0])).toEqual({ ok: true });
  expect(high.d.propValue("tunerneedle")).toBe(81);
  // and below it, the rising way
  const low = set({ start: 5, needle: (_to, was) => was + 10 });
  expect(await tuneTo(low.d, TX_BAND)).toEqual({ ok: true });
  expect(low.d.propValue("tunerneedle")).toBe(35);
  // a needle that never moves is given up on, with where it started and ended
  expect(await tuneTo(set({ start: 0, needle: (_to, was) => was }).d, TX_BAND)).toEqual({
    ok: false,
    reason: "the needle would not come to 34..40 in 120 swings (started 0 -> 0 -> 0 -> 0, ended 0)",
  });

  expect(await tuneTo(set({ missing: ["tunerknob"] }).d, TX_BAND)).toEqual({
    ok: false,
    reason: "no tunerknob to take hold of",
  });
  expect(await tuneTo(set({ start: 36, owners: { tunerknob: "off" } }).d, TX_BAND)).toEqual({
    ok: false,
    reason: `the needle is at 36 but the knob is "off", not "on"`,
  });
});

test("switching to transmit stops at the first step that fails, with that step's reason", async () => {
  const works = { settle: { breakerhandle: breakerAt, senderhandle: senderAt }, start: 36 };
  expect(await switchToTransmit(set(works).d)).toEqual({ ok: true });

  // the breaker's region missing: nothing is dragged
  expect((await switchToTransmit(set({ ...works, missing: ["breaker"] }).d)).reason).toBe(
    `no breaker region on ${WIRELESS_MAIN}`,
  );
  // the sender will not go on
  expect((await switchToTransmit(set({ ...works, settle: { ...works.settle, senderhandle: () => "off" } }).d)).reason).toBe(
    `the sender went to "off" at y=40, not "on"`,
  );
  // the breaker's ok leaves the amp panel up
  expect((await switchToTransmit(set({ ...works, leadsTo: { ok: WIRELESS_PANELS.amp } }).d)).reason).toBe(
    `ok on ${WIRELESS_PANELS.breaker} left us on ${WIRELESS_PANELS.amp}, not ${WIRELESS_MAIN}`,
  );
  // the morse key's flat will not open
  expect((await switchToTransmit(set({ ...works, missing: ["tapper"] }).d)).reason).toBe(
    `no tapper region on ${WIRELESS_MAIN}`,
  );
  // and opens the wrong way round
  expect((await switchToTransmit(set({ ...works, owners: { tapperdown: "rx" } }).d)).reason).toBe(
    `the tapper flat opened in "rx", not "tx" — setuptx() did not run`,
  );
});
