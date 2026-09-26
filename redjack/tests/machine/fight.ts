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
import { findOnScreen } from "./route";

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
export const fightLyle = (h: Headless): Promise<void> => duel(h, "combat.stag", "the fight with Lyle");

/**
 * A sword fight on a fight stage, played as {@link fightLyle} explains: guard
 * where the wind-up says, strike while the opponent is open. The alley's
 * `jcombat.stag` is the same Nick (jcombat.shop is combat.shop with a few lines
 * moved), and its opponents step back out of reach — J1.shop `retreat` sets the
 * enemy's `propdeg` to 1 — where "up" closes in again (jcombat.stag keydown →
 * `advance`). A second half of bottles (enemy2.shop) is dodged.
 */
export async function duel(h: Headless, stage: string, what: string): Promise<void> {
  if (!fighting(h, stage)) fail(`${what}: the stage is not up (stage ${h.session.stageName})`);
  const props = h.session.propRuntime;
  let next = 0;
  let held: { x: number; y: number; for: number } | null = null;
  let closing = 0;
  const letGo = (): void => {
    if (held) h.mouseUp(held.x, held.y);
    held = null;
  };
  const dodge = dodger(h);
  await h.until(
    () => {
      // the stage closes on a win, or a talk opens over it (benemy1.shop's
      // `die` asks Blackbeard's questions with Bone's stage still up)
      if (!fighting(h, stage) || h.host.director.awaitingChoice) return true;
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
      // out of reach: close in, a press at a time
      if (props.get("enemy")?.deg === 1 && props.get("enemy")?.visible) {
        letGo();
        if (closing-- <= 0) {
          h.key("up");
          closing = 10;
        }
        return false;
      }
      // the swing is under way, or the button has been down long enough: let go
      if (held && (nick.startsWith("strike") || ++held.for > 10)) letGo();
      const guard = guardFor(view);
      if (guard) {
        letGo();
        h.session.setPointer(guard.x, guard.y);
        return false;
      }
      if (held) return false;
      const open = !/^(block|hurt|fall|death|special|advance)/.test(view.toLowerCase());
      const strength = Number(props.get("nick strength")?.deg ?? 0);
      if (open && strength >= 6 && !nick.startsWith("strike")) {
        const s = STRIKES[next++ % STRIKES.length];
        h.mouseDown(s.x, s.y);
        held = { x: s.x, y: s.y, for: 0 };
      } else h.session.setPointer(OPEN.x, OPEN.y);
      return false;
    },
    `${what} to end`,
    60_000,
  );
  letGo();
  dodge.stop();
}

/**
 * The street fight at Port Royal (ptroyal.cast `bfight` → bfight.cast): Jan's
 * men drop from the roofs, run at Nick or shoot from the windows, and each dies
 * to one click on him — bfight.cast's `mousedown` for the droppers and runners
 * (enemy1), and for the sharpshooters (enemy2), whose `endanim` counts him.
 * Three waves of 9, 9 and 5 (`deadgoal`, `nextphase`), the walk to the next
 * street between them, and `endfight` after the last, which ends the day.
 *
 * So the gunner clicks any of them it sees, the one nearest first, and turns
 * the barrel of the view with the arrows toward one it does not.
 */
export async function shootout(h: Headless, done: () => boolean): Promise<number> {
  const actors = h.session.actorRuntime;
  const foe = /^(dropper|runner|sharpshooter) \d+$/;
  let shots = 0;
  let cool = 0;
  let search = 0;
  let target: (typeof actors.actors extends Map<string, infer A> ? A : never) | undefined;
  await h.until(
    () => {
      if (done()) return true;
      const m = h.session.maze;
      const cam = m?.camera();
      const eye = m?.spriteCamera(640, 480);
      if (!m || !cam || !eye || h.session.stageName !== "none" || m.view !== "node") return false;
      if (cool-- > 0) return false;
      const live = [...actors.actors.values()]
        .filter((a) => foe.test(a.name) && a.visible && a.owner !== "dead")
        .sort((a, b) => Math.hypot(a.worldX - cam.x, a.worldY - cam.y) - Math.hypot(b.worldX - cam.x, b.worldY - cam.y));
      for (const a of live) {
        const p = eye.project(a.worldX, a.worldY, a.worldZ);
        if (!p || p.x < -40 || p.x >= 680) continue;
        // over the sprite, from its feet up, until the room answers with him
        for (let dy = 0; dy <= 240; dy += 10) {
          for (const dx of [0, -12, 12, -24, 24]) {
            const x = Math.round(p.x + dx);
            const y = Math.round(p.y - dy);
            if (x < 0 || x >= 640 || y < 0 || y >= 480) continue;
            if (h.session.hitTestAt(x, y).name.toLowerCase() === a.name) {
              h.click(x, y);
              shots++;
              cool = 2;
              return false;
            }
          }
        }
      }
      // the projection missed him: look for him, now and then, over the screen
      for (const a of (search++ % 10 === 0 ? live : [])) {
        const at = findOnScreen(h, a.name, "actor", [16]);
        if (at) {
          h.click(at.x, at.y);
          shots++;
          cool = 2;
          return false;
        }
      }
      // nobody in sight: look toward one, and stay with him until he is down.
      // The fight sets the boot's `margin` to 310 (bfight.cast opencast), so
      // anywhere but the middle of the screen scrolls the view that way
      // (ptroyal.sett region/tracknodescroll): the pointer leads the eye
      if (!target || !live.includes(target)) target = live[0];
      const a = target;
      if (a) {
        const want = Math.atan2(a.worldY - cam.y, a.worldX - cam.x);
        const off = ((want - cam.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        const p = eye.project(a.worldX, a.worldY, a.worldZ);
        const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
        const x = !p || Math.abs(off) > 0.8 ? (off > 0 ? 4 : 636) : clamp(p.x, 4, 636);
        const y = p ? clamp(p.y, 4, 476) : 240;
        h.session.setPointer(Math.round(x), Math.round(y));
      }
      return false;
    },
    "the street fight to end",
    60_000,
  );
  return shots;
}

/**
 * The torturer's whip, the first half of the fight in Cartagena's torture
 * chamber (tcombat.stag, tenemy1.shop). The whip cracks from one side at the
 * strike's tenth tick (`checkforhit`, `hitframe` 10), and misses only a Nick
 * leaned all the way to the other: `centerx` 0 for a lash from the left, -199
 * for one from the right. The arrows lean him (tcombat.shop "loop 4" `lean`,
 * `strafe`: 60 a pass from the middle, -100) and letting go brings him back
 * (`antilean`). Two lashes dodged, the stage steps him a node closer
 * (`advance`); at the fourth node the torturer's dropped sword lies in reach
 * (tenemy1.shop fsword, `znode = 4`), and taking it up opens the second half
 * (tcombat.shop `nextenemy`, tenemy2.shop) — a sword fight, for
 * {@link cauldronFight}.
 */
export async function whipFight(h: Headless): Promise<void> {
  if (!fighting(h, "tcombat.stag")) fail(`the whip: the stage is not up (stage ${h.session.stageName})`);
  let held = "";
  let looks = 0;
  const lean = (side: string): void => {
    if (side === held) return;
    if (held && !side) h.keyUp(held);
    if (side) h.key(side);
    held = side;
  };
  await h.until(
    () => {
      if (!fighting(h, "tcombat.stag")) return true;
      if (h.session.propRuntime.get("enemy")?.shop.name === "tenemy2.shop") return true;
      const [kind, side] = enemyView(h).toLowerCase().split(" ");
      // a lash from the left is dodged leaning left, and the other way round
      lean(kind === "s" && (side === "left" || side === "right") ? side : "");
      // a look for the sword every tenth pass: a search of the whole screen is dear
      if (!held && Number(h.session.interp.globals.get("znode")) === 4 && ++looks % 10 === 1) {
        const sword = findOnScreen(h, "fsword", "prop", [16]);
        if (sword) h.click(sword.x, sword.y);
      }
      return false;
    },
    "the torturer's whip",
    20_000,
  );
  lean("");
  if (!fighting(h, "tcombat.stag")) fail(`the whip: the fight ended before the sword was taken up (wonfight ${h.session.interp.globals.get("wonfight")})`);
}

/**
 * The torturer's second half (tenemy2.shop), which no sword stroke wins:
 * tcombat.shop `Edamage` stops on its first line, `exitcode`, so a hit only
 * makes him stagger (`hurt`, `fall back`). He is beaten by the cauldron beside
 * him. Clicked while Nick stands at the sixth or seventh node (tenemy2.shop
 * couldron, `znode = 6 | znode = 7`), it tips its coals at his feet
 * (`coals.move`) and he dances; a stroke that lands while he dances wins
 * (`checkforEhit` → "safe win" `win`, `twin.move`, `wonfight`).
 *
 * Every stroke steps Nick a node closer (tcombat.shop `think` → `advance`, up
 * to `maxZnodes` 8), and "down" steps him back (`retreat`, no nearer than 5).
 * So he guards where the wind-up says, as in {@link duel}, strikes his way in
 * to the sixth node or backs off to the seventh, clicks the cauldron, and
 * strikes while the torturer dances.
 */
export async function cauldronFight(h: Headless): Promise<void> {
  if (!fighting(h, "tcombat.stag")) fail(`the cauldron: the stage is not up (stage ${h.session.stageName})`);
  const g = (name: string): number => Number(h.session.interp.globals.get(name) ?? 0);
  let held = 0;
  let wait = 0;
  await h.until(
    () => {
      if (!fighting(h, "tcombat.stag")) return true;
      const view = enemyView(h).toLowerCase();
      if (held && --held === 0) h.mouseUp(320, 300);
      if (held) return false;
      const guard = guardFor(view);
      if (guard) {
        h.session.setPointer(guard.x, guard.y);
        return false;
      }
      h.session.setPointer(OPEN.x, OPEN.y);
      if (wait > 0) {
        wait--;
        return false;
      }
      // he dances on the coals: strike (the bottom row, clear of every guard)
      if (view === "dance") {
        h.mouseDown(260, 300);
        held = 4;
        return false;
      }
      if (g("imbeingused") !== 0 || view !== "idle") return false;
      const node = g("znode");
      if (node > 7) {
        h.key("down");
        h.keyUp("down");
        wait = 10;
        return false;
      }
      if (node >= 6) {
        const cauldron = findOnScreen(h, "couldron", "prop", [16]);
        if (cauldron) h.click(cauldron.x, cauldron.y);
        wait = 10;
      } else {
        // "up" is refused while he is aggressive (tcombat.stag keydown), and a
        // stroke steps Nick in (tcombat.shop `think` → `advance`)
        h.mouseDown(260, 300);
        held = 4;
      }
      return false;
    },
    "the fight in the torture chamber to end",
    30_000,
  );
  if (held) h.mouseUp(320, 300);
}
