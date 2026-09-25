/**
 * Fighting, the player's way: read what the opponent is doing off the screen
 * (the `enemy` prop's view), and answer with the pointer, which is what the
 * fight stages steer Nick's sword by.
 *
 * Each lesson's stage (`sdcombat.stag`, `sdocombat.stag`, `sscombat.stag`) is
 * its own small game and gets its own player here, each citing the script it
 * answers.
 */
import { fail, type Headless } from "./harness";

/** what the opponent shows: the `enemy` prop's view ("idle", "S left", …) */
export const enemyView = (h: Headless): string => h.session.propRuntime.get("enemy")?.stateName ?? "";

/** a fight stage is up */
export const fighting = (h: Headless, stage: string): boolean => h.session.stageName === stage;

/**
 * Where the pointer blocks each strike in the school of defense.
 *
 * sdcombat.shop `trackarm` clamps the pointer to x 240..393 and y 120..360 (a y
 * past 220 counts as 360), cuts that into 22-pixel columns and 60-pixel rows,
 * and names the guard: zones 4–7 (the top row, columns 4 to 7) block "S over",
 * 22–24 (the bottom row, left) "S left", and 26–28 (the bottom row, right)
 * "S right". Anything else is no guard at all. The middle of each:
 */
const GUARD: Record<string, { x: number; y: number }> = {
  over: { x: 350, y: 150 },
  left: { x: 262, y: 300 },
  right: { x: 372, y: 300 },
};

/**
 * The guard a view calls for: its second word, from the wind-up on — the port
 * names prop views in lower case, and each strike opens on a lead-in
 * (`s left lead`) before the swing (`s left`) that `checkforhit` times.
 */
const guardFor = (view: string): { x: number; y: number } | undefined => {
  const [kind, side] = view.toLowerCase().split(" ");
  return kind === "s" ? GUARD[side] : undefined;
};
/** out of every guard zone: the middle row */
const OPEN = { x: 320, y: 200 };

/**
 * The school of defense: Lyle strikes and Nick blocks. sdenemy1.shop
 * `checkforhit` counts a block when Nick's guard (`nickblock`) is the strike's
 * own view in the three ticks before it lands, and `calcrating` passes the
 * lesson ("a" or "e") at better than 70 blocks in a hundred. So the pointer goes
 * where the wind-up says, every frame, as a player's hand would — and back to the
 * middle between strikes.
 *
 * Ends when the stage closes: Lyle's `endfight` runs out his idle budget
 * (`Eidle` from 30 down to -10, a step every 100 frames).
 */
export async function schoolOfDefense(h: Headless): Promise<void> {
  if (!fighting(h, "sdcombat.stag")) fail(`the school of defense is not up (stage ${h.session.stageName})`);
  await h.until(
    () => {
      if (!fighting(h, "sdcombat.stag")) return true;
      const at = guardFor(enemyView(h)) ?? OPEN;
      h.session.setPointer(at.x, at.y);
      return false;
    },
    "the school of defense to end",
    60_000,
  );
}

/** the three places Nick can stand in the school of dodging, as `centerx` has them, and the key held for each */
const STANDS = [
  { cx: -100, key: "" }, // nothing held: the lean's release puts him back here (sdocombat.shop lean "-l")
  { cx: 0, key: "left" },
  { cx: -199, key: "right" },
];
/** the `centerx` a bottle thrown at x hits, ±50 about it (sdoenemy2.shop bottle `done`) */
const LANE: Record<number, number> = { 150: 0, 410: -100, 650: -199 };
/** where Lyle's `Epos` sends a bottle (sdoenemy2.shop selectstrike) */
const EPOS_X: Record<number, number> = { 1: 150, 2: 410, 3: 650 };

/**
 * The school of dodging: Lyle shuffles to one of three places and throws a
 * bottle down its lane, forty of them. A bottle breaks on Nick if his `centerx`
 * is within 50 of its lane when it lands, and the class passes on fewer than
 * seven (`endclass`). Holding an arrow leans him to that side (0 or -199);
 * letting go brings him back to -100.
 *
 * So each frame the player rules out every lane a bottle in the air is falling
 * down, and the one Lyle is moving to, and stands in what is left — the middle
 * if he can.
 */
export async function schoolOfDodging(h: Headless): Promise<void> {
  if (!fighting(h, "sdocombat.stag")) fail(`the school of dodging is not up (stage ${h.session.stageName})`);
  const dodge = dodger(h);
  await h.until(
    () => {
      if (!fighting(h, "sdocombat.stag")) return true;
      dodge.step();
      return false;
    },
    "the school of dodging to end",
    60_000,
  );
  dodge.stop();
}

/**
 * One frame of dodging, and the key held for it: every lane a bottle in the air
 * is falling down is ruled out, and the one Lyle is moving to, and Nick stands
 * in what is left — the middle if he can. The school of dodging and the second
 * half of the real fight (enemy2.shop, the same bottles and the same `centerx`)
 * both play it.
 */
function dodger(h: Headless): { step(): void; stop(): void } {
  const props = h.session.propRuntime;
  let held = "";
  const hold = (key: string): void => {
    if (key === held) return;
    if (held) h.keyUp(held);
    if (key) h.key(key);
    held = key;
  };
  return {
    step() {
      const danger = new Set<number>();
      for (const n of [1, 2, 3, 11, 12, 13]) {
        const b = props.get(`bottle${n}`);
        if (b?.visible && b.stateName === "animated") danger.add(LANE[Math.round(b.anchorX)]);
      }
      const epos = Number(h.session.interp.globals.get("epos") ?? 0);
      if (EPOS_X[epos] !== undefined) danger.add(LANE[EPOS_X[epos]]);
      const stand = STANDS.find((s) => ![...danger].some((lane) => Math.abs(s.cx - lane) < 50)) ?? STANDS[0];
      hold(stand.key);
    },
    stop: () => hold(""),
  };
}

/** where a click makes each strike (sscombat.shop think: above `topline` 200 is overhead, else by side of 320) */
const STRIKES = [
  { view: "strike overhead", x: 320, y: 150 },
  { view: "strike", x: 260, y: 300 },
  { view: "strike lm", x: 380, y: 300 },
];

/**
 * The school of striking: Lyle stands and takes it, and the class passes if he
 * is down inside 375 frames (ssenemy1.shop calcrating; "e" inside 220). A click
 * strikes when Nick has the strength for it (`think`), the kind of strike by
 * where the click lands; Lyle blocks at random, the more often for a strike
 * repeated (`checkforblock`: `samestrike ()` adds four in ten), and a blow only
 * counts while he is neither blocking nor hurt (`checkforEhit`). Its weight
 * grows with Nick's strength (`Edamage`).
 *
 * So the player strikes only when Nick is idle, strong, and Lyle open, and goes
 * round the three strikes in turn.
 */
export async function schoolOfStriking(h: Headless): Promise<void> {
  if (!fighting(h, "sscombat.stag")) fail(`the school of striking is not up (stage ${h.session.stageName})`);
  const props = h.session.propRuntime;
  let next = 0;
  let pending: (() => boolean) | null = null;
  // A hand's pace, not the machine's: a click is a running script, and while one
  // runs the scheduler holds every loop back — `think`, which turns the click
  // into a strike, among them. Clicking every pass starved it, and Nick never
  // swung. So one click, then wait for the swing to show, or ten passes.
  let wait = 0;
  await h.until(
    () => {
      if (!fighting(h, "sscombat.stag")) return true;
      if (pending && !pending()) return false;
      pending = null;
      const nick = props.get("nick")?.stateName ?? "";
      if (nick.startsWith("strike")) wait = 0;
      if (wait > 0) {
        wait--;
        return false;
      }
      const open = !/^(block|hurt|fall|death)/.test(enemyView(h).toLowerCase());
      const strength = Number(props.get("nick strength")?.deg ?? 0);
      if (open && strength >= 6 && !nick.startsWith("strike")) {
        const s = STRIKES[next++ % STRIKES.length];
        pending = h.click(s.x, s.y);
        wait = 10;
      }
      return false;
    },
    "the school of striking to end",
    60_000,
  );
}

/**
 * The real fight on the dock (Fight1.pupp realfight → `combat.stag`, Lyle as
 * `enemy1.shop`): both halves at once. combat.shop's `trackarm` guards by the
 * same zones as the school of defense and its `think` strikes by the same lines
 * as the school of striking, so the player guards while Lyle winds up and
 * strikes, in turn and at a hand's pace, while he is open. Won when Lyle's life
 * runs out (enemy1.shop `death`, fightstat "n"); lost when Nick's does ("l").
 */
export async function fightLyle(h: Headless): Promise<void> {
  if (!fighting(h, "combat.stag")) fail(`the fight is not up (stage ${h.session.stageName})`);
  const props = h.session.propRuntime;
  let next = 0;
  let held: { x: number; y: number; for: number } | null = null;
  const letGo = (): void => {
    if (held) h.mouseUp(held.x, held.y);
    held = null;
  };
  const dodge = dodger(h);
  await h.until(
    () => {
      if (!fighting(h, "combat.stag")) return true;
      const view = enemyView(h);
      const nick = props.get("nick")?.stateName ?? "";
      // the second half: beaten with the sword, Lyle backs off and throws
      // (combat.shop opens enemy2.shop), and Nick dodges as in the school
      if (props.get("enemy")?.shop.name === "enemy2.shop") {
        letGo();
        dodge.step();
        return false;
      }
      dodge.stop();
      // the swing is under way, or the button has been down long enough: let go
      if (held && (nick.startsWith("strike") || ++held.for > 10)) letGo();
      const guard = guardFor(view);
      if (guard) {
        letGo();
        h.session.setPointer(guard.x, guard.y);
        return false;
      }
      if (held) return false;
      const open = !/^(block|hurt|fall|death)/.test(view.toLowerCase());
      const strength = Number(props.get("nick strength")?.deg ?? 0);
      if (open && strength >= 6 && !nick.startsWith("strike")) {
        const s = STRIKES[next++ % STRIKES.length];
        h.mouseDown(s.x, s.y);
        held = { x: s.x, y: s.y, for: 0 };
      } else h.session.setPointer(OPEN.x, OPEN.y);
      return false;
    },
    "the fight with Lyle to end",
    60_000,
  );
  letGo();
  dodge.stop();
}
