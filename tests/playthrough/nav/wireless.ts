/**
 * Working the wireless set — the gestures that switch it from RECEIVE to
 * TRANSMIT, which is what sending Mr. Thayer's telegram costs.
 *
 * Segment 3 used this room without ever touching a control: the message stack is
 * a prop on the main flat and reading it needs nothing switched on. Transmitting
 * is the opposite — `WIRELESS.STG` c29's `keydown` exits at once unless
 * `propowner("tapperdown") = "tx"`, and the only thing that ever sets that is
 * `setuptx()`, called from that flat's `openflat()` and ONLY when all three of
 *
 *     propowner("senderhandle") = "on"    the power
 *     propowner("tunerknob")    = "on"    tuned, which means IN BAND
 *     propowner("breakerhandle") = "tx"   send, not receive
 *
 * already hold. So the set has to be got right BEFORE the tapper flat is opened;
 * opening it first and switching afterwards leaves a morse key that does nothing
 * and says nothing about why (it `message("do nothing")`s and returns).
 *
 * ## Six flats, one apparatus
 *
 * The stage is the apparatus and each control has its own close-up. Flat 1 is the
 * whole desk with a click-region per control; each region is a `gotoflat`, and
 * every close-up has an "ok" that goes back to flat 1. The names are the game's
 * own and are NOT in panel order (WIRELESS.STG's flat table, dumped) — hence
 * {@link WIRELESS_PANELS} rather than an index, so a gesture is checked against
 * the flat it actually opened.
 *
 * ## Two of the three controls are position drags, and one is a ratchet
 *
 * The sender and the breaker are `while stilldown()` loops that read the cursor's
 * Y (resp. X) ABSOLUTELY and snap on release — one move each, like the coal lever
 * (nav/dials.ts). The tuner is not: it is the same swing-about-a-pivot ratchet as
 * the turbine dials, and every step moves the needle by two of the 14..200 it
 * runs over. The transmit band is SIX wide, so tuning it from the 200 that
 * `openshop()` parks it at is ~80 swings, and there is no way to shorten that —
 * `adjustneedle` has no acceleration.
 *
 * The needle's frequency is `propvalue`, not `propdeg`: the deg is only which of
 * ten pictures the small view draws, and `tuned()` compares the VALUE against its
 * band. That is what {@link NavDriver.propValue} exists for.
 */
import type { NavDriver } from "./navigator";

/** the whole desk — where every control is reached from, and returned to */
export const WIRELESS_MAIN = "wireless 1";

/**
 * Flat 1's click-regions and the flat each one opens.
 *
 * Read off WIRELESS.STG: region -> `gotoflat(n)` -> the n'th flat's name. The
 * numbering and the naming disagree (flat 6 is called "wireless 3"), which is
 * exactly why a route names the flat it expects to arrive in.
 */
export const WIRELESS_PANELS = {
  breaker: "wireless 2",
  sender: "wireless 4",
  tuner: "wireless 5",
  amp: "wireless 6",
  /** the operating flat: the morse key, the readout, and setuptx()/setuprx() */
  tapper: "wireless 3",
} as const;

/**
 * Where the needle has to be for `tuned()` to answer true.
 *
 * WIRELESS.SHP c33. Transmit has one band; receive has three, and which of them
 * is tuned decides which message `rx()` spells out. Both ends inclusive.
 */
export const TX_BAND = { lo: 34, hi: 40 };
export const RX_BANDS = [
  { lo: 81, hi: 87 },
  { lo: 127, hi: 133 },
  { lo: 174, hi: 180 },
];

/** the point WIRELESS.SHP's tuner mousedown measures the cursor's bearing from */
const TUNER_PIVOT = { x: 333, y: 119 };

/**
 * How far round the pivot to swing per move, in the engine's 0..255 bearings.
 *
 * `fixdeg256` quantises the bearing into SIX buckets — 256/6 ≈ 42.7 each — and
 * `limiter` moves the needle by the sign of the bucket difference, so a move
 * that stays inside one bucket is a wasted frame. 48 clears a bucket with room
 * for whole-pixel rounding while staying under the |delt| > 3 seam test, which
 * this dial applies in bucket units (a 0..5 space) and not in bearings.
 */
const ARC = 48;

/** the radius to swing at: wide for bearing accuracy, and on the canvas at 333,119 */
const RADIUS = 100;

/**
 * A ceiling on the swings, generous enough to cross the whole dial.
 *
 * The needle runs 14..200 in steps of two, so the longest honest tune is 93
 * moves. Anything past that is not a slow dial, it is a dial that is not
 * listening — most likely because the swing is going the wrong way round and the
 * needle is sitting on a clamp.
 */
const MAX_SWINGS = 120;

const BEARING = (2 * Math.PI) / 256;

export interface WirelessResult {
  ok: boolean;
  reason?: string;
}

const bad = (reason: string): WirelessResult => ({ ok: false, reason });

/**
 * Open a control's close-up from the main flat.
 *
 * Answers on the flat that is actually up afterwards, not on the click landing:
 * clicking a region while a script still holds the flat is accepted by the hit test
 * and dropped by the stage. That was the same trap `hunt()` used to fall into
 * (fixed — it judges a click by what moved now). This stays as it
 * is, and not because it is a workaround: what this function promises is a
 * PARTICULAR panel, which is a stronger claim than "something happened".
 */
export async function openPanel(
  d: NavDriver,
  region: keyof typeof WIRELESS_PANELS,
): Promise<WirelessResult> {
  const want = WIRELESS_PANELS[region];
  if (d.inFlat() !== WIRELESS_MAIN) return bad(`the ${region} is reached from ${WIRELESS_MAIN}, not ${d.inFlat()}`);
  if (!(await d.clickThing(region))) return bad(`no ${region} region on ${WIRELESS_MAIN}`);
  if (d.inFlat() !== want) return bad(`clicking ${region} left us on ${d.inFlat()}, not ${want}`);
  return { ok: true };
}

/** Click a close-up's OK plaque, which returns to the desk. */
export async function closePanel(d: NavDriver): Promise<WirelessResult> {
  const from = d.inFlat();
  if (!(await d.clickThing("ok"))) return bad(`no ok on ${from}`);
  if (d.inFlat() !== WIRELESS_MAIN) return bad(`ok on ${from} left us on ${d.inFlat()}, not ${WIRELESS_MAIN}`);
  return { ok: true };
}

/**
 * Throw the breaker to transmit, receive or off.
 *
 * WIRELESS.SHP c85: the held loop bands the cursor's X into five degs and the
 * release snaps the two in-between ones outwards, so only three settle — 0 "tx",
 * 2 "off", 4 "rx". The X asked for is the middle of each band, and the Y is left
 * where the handle was grabbed because the loop never looks at it.
 */
export async function setBreaker(d: NavDriver, want: "tx" | "off" | "rx"): Promise<WirelessResult> {
  const x = want === "tx" ? 40 : want === "off" ? 125 : 240;
  let moved = false;
  const held = await d.dragProp("breakerhandle", (from) => (moved ? null : ((moved = true), { x, y: from.y })));
  if (!held) return bad("no breakerhandle to take hold of");
  const got = d.propOwner("breakerhandle");
  if (got !== want) return bad(`the breaker went to "${got}" at x=${x}, not "${want}"`);
  return { ok: true };
}

/**
 * Power the set up (or down).
 *
 * WIRELESS.SHP c74, the same shape as the breaker but on the cursor's Y, and
 * `senderon()` is more than a flag: it lights four lamps a frame apart and starts
 * the room's theme, which is why the gesture is worth a settle of its own.
 */
export async function setSender(d: NavDriver, want: "on" | "off"): Promise<WirelessResult> {
  const y = want === "on" ? 40 : 300;
  let moved = false;
  const held = await d.dragProp("senderhandle", (from) => (moved ? null : ((moved = true), { x: from.x, y })));
  if (!held) return bad("no senderhandle to take hold of");
  const got = d.propOwner("senderhandle");
  if (got !== want) return bad(`the sender went to "${got}" at y=${y}, not "${want}"`);
  return { ok: true };
}

/**
 * Swing the tuner until the needle is inside `band`, and leave it there.
 *
 * The direction is not a guess: a RISING bearing raises the bucket, `limiter`
 * takes the sign, and `adjustneedle` adds two — so swinging the way `atan2`
 * counts sends the needle UP the dial. Every move re-reads the needle, so a
 * dropped frame costs a swing and not the setting.
 *
 * Ending the drag in band is the point, not a nicety. The held loop calls
 * `tuned()` at the foot of every iteration and answers it with `tuneron()` or
 * `tuneroff()`, so the LAST iteration decides whether `propowner("tunerknob")`
 * is "on" when the button comes up — and that owner is one of the three things
 * `openflat()` tests. A drag released one swing past the band leaves a dial
 * pointing at the right number and a set that will not transmit.
 */
export async function tuneTo(d: NavDriver, band: { lo: number; hi: number }): Promise<WirelessResult> {
  const needle = (): number => d.propValue("tunerneedle");
  const inBand = (): boolean => needle() >= band.lo && needle() <= band.hi;
  let bearing = 0;
  let swings = 0;
  const trail: number[] = [];
  const held = await d.dragProp("tunerknob", (from) => {
    if (swings === 0) {
      // the grab point sets the arc's phase; moving straight out to the radius
      // changes no bearing, so it costs no swing
      bearing = Math.atan2(from.y - TUNER_PIVOT.y, from.x - TUNER_PIVOT.x) / BEARING;
    }
    const now = needle();
    if (trail.length < 4) trail.push(now);
    if (inBand() || ++swings > MAX_SWINGS) return null;
    bearing += now < band.lo ? ARC : -ARC;
    return {
      x: Math.round(TUNER_PIVOT.x + RADIUS * Math.cos(bearing * BEARING)),
      y: Math.round(TUNER_PIVOT.y + RADIUS * Math.sin(bearing * BEARING)),
    };
  });
  if (!held) return bad("no tunerknob to take hold of");
  if (!inBand()) {
    return bad(
      `the needle would not come to ${band.lo}..${band.hi} in ${MAX_SWINGS} swings ` +
        `(started ${trail.join(" -> ")}, ended ${needle()})`,
    );
  }
  // the owner, not just the number: this is what openflat() will read
  if (d.propOwner("tunerknob") !== "on") {
    return bad(`the needle is at ${needle()} but the knob is "${d.propOwner("tunerknob")}", not "on"`);
  }
  return { ok: true };
}

/**
 * The whole errand: switch the set to transmit and open the operating flat.
 *
 * Order matters, and not for tidiness. `tuned()` answers false for ANY needle
 * position unless the breaker and the sender are already set — it branches on
 * them before it looks at the band — so tuning first tunes to nothing. Power and
 * mode, then the needle, then the tapper.
 */
export async function switchToTransmit(d: NavDriver): Promise<WirelessResult> {
  for (const step of [
    { region: "breaker", set: () => setBreaker(d, "tx") },
    { region: "sender", set: () => setSender(d, "on") },
    { region: "tuner", set: () => tuneTo(d, TX_BAND) },
  ] as const) {
    const open = await openPanel(d, step.region);
    if (!open.ok) return open;
    const done = await step.set();
    if (!done.ok) return done;
    const back = await closePanel(d);
    if (!back.ok) return back;
  }
  const tapper = await openPanel(d, "tapper");
  if (!tapper.ok) return tapper;
  // openflat() ran on the way in, and this is the only thing it leaves behind
  // that says which way round the set is
  if (d.propOwner("tapperdown") !== "tx") {
    return bad(`the tapper flat opened in "${d.propOwner("tapperdown")}", not "tx" — setuptx() did not run`);
  }
  return { ok: true };
}
