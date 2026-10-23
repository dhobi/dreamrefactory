/**
 * A stand-in `BrainCtx` for the class suites (`tests/brains*.ts`): its dice are
 * a queue the test fills, and every call a brain makes on it is written down
 * in order, so a test asserts what a think DID — which script went on, which
 * sound was said, what was thrown — rather than how it is written.
 *
 * Not a suite itself (it lives outside `tests/*.ts`).
 */
import type { BrainCtx, Enemy, Track } from "../../src/brains/kit";
import type { FoeAnim } from "../../src/brains/foe";

export type Player = BrainCtx["player"];

export interface Stand {
  k: BrainCtx;
  heard: string[];
}

/** a context whose dice are a queue, and which writes down what it is asked */
export function ctx(
  track: Partial<Track> | (() => Partial<Track>),
  rolls: number[] = [],
  player: Partial<Player> = {},
  over: Partial<BrainCtx> = {},
): Stand {
  const heard: string[] = [];
  const fixed = typeof track === "function" ? track : () => track;
  const k: BrainCtx = {
    player: {
      x: 0, y: 0, top: 0, anchor: 0, vy: 0, swinging: false, down: false, facing: -1, climbing: false,
      crouching: false, character: 0, jolted: false, helpless: false, free: true, ...player,
    },
    ladderNear: () => undefined,
    track: () => ({ forward: 200, dy: 0, band: 0, side: 1, ...fixed() }),
    anchorY: (e: Enemy) => e.y,
    anchorX: (e: Enemy) => e.x,
    burn: (_e: Enemy, how: { late?: boolean; forever?: boolean }) =>
      heard.push(`burn${how.late ? " late" : ""}${how.forever ? " forever" : ""}`),
    spray: (_e: Enemy, n: number) => heard.push(`spray ${n}`),
    shake: (n: number) => heard.push(`shake ${n}`),
    flash: (c: number) => heard.push(`flash ${c}`),
    atBound: () => false,
    atRear: () => false,
    crowded: () => false,
    roll: (n: number) => {
      const r = rolls.shift();
      if (r === undefined) throw new Error(`an unplanned roll of ${n}`);
      if (r < 1 || r > n) throw new Error(`a roll of ${n} cannot come up ${r}`);
      heard.push(`roll ${n}=${r}`);
      return r;
    },
    count: () => 0,
    nearest: () => null,
    slayAll: (kind: string) => heard.push(`slay ${kind}`),
    remove: (_e: Enemy, award: number) => heard.push(`remove ${award}`),
    scaled: (n: number) => n,
    root: (n: number) => Math.floor(Math.sqrt(n)),
    say: (_e: Enemy, id: number, way?: string) => heard.push(["say", `0x${id.toString(16)}`, way].filter(Boolean).join(" ")),
    sprinkler: () => null,
    spill: (at: { x: number; y: number }, n: number) => heard.push(`spill ${n} at ${at.x},${at.y}`),
    pin: (at: { x: number; y: number }, v?: { vx?: number; vy?: number; facing?: number; fell?: number }) =>
      heard.push([`pin ${at.x},${at.y}`, v && JSON.stringify(v)].filter(Boolean).join(" ")),
    hide: (h: boolean) => heard.push(`hide ${h}`),
    drain: (n: number) => heard.push(`drain ${n}`),
    bleed: (n: number) => heard.push(`bleed ${n}`),
    pose: (m: number) => heard.push(`pose ${m}`),
    someIn: () => false,
    raise: () => heard.push("raise"),
    cast: () => heard.push("cast"),
    hatch: (_e: Enemy, kind: string, at: { x: number; y: number; facing: number }) =>
      heard.push(`hatch ${kind} at ${at.x},${at.y} facing ${at.facing}`),
    roller: (_e: Enemy, at: { x: number; y: number; vx: number }) => heard.push(`roller ${at.x},${at.y} vx ${at.vx}`),
    gravity: 10,
    ...over,
  } as BrainCtx;
  return { k, heard };
}

/** a creature of a class in a given script, facing east, its rect round the player */
export function inState(kind: string, anim: FoeAnim, over: Partial<Enemy> = {}): Enemy {
  return {
    kind, x: 0, y: 0, facing: 1, left: -500, right: 500, top: -500, bottom: 500, clock: 0,
    state: "gait", anim, linger: 0, dents: 0, vx: 0, vy: 0, hp: 100, max: 100, script: anim.kind, tag: anim.tag,
    beat: 0, fighting: true, ...over,
  } as Enemy;
}

/** the script and tag a creature is on */
export const on = (e: Enemy): [number | undefined, number | undefined] => [e.script, e.tag];
/** ...and the ones an animation would put it on */
export const is = (a: FoeAnim): [number | undefined, number | undefined] => [a.kind, a.tag];
