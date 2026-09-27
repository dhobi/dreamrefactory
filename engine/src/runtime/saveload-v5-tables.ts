/**
 * The scheduler's three tables in a RedJack save: loops, crickets and walks,
 * each written as RedJack.exe's own table (docs/engine/formats/savegame-v5.md,
 * "The scheduler tables") out of the port's model of it, and read back into it.
 *
 * Two clocks meet here. A loop's or a cricket's count is in PASSES, which is
 * what the port counts too. A loop made with a negative period runs on the
 * tick clock instead, and its deadline (+6) is zeroed on load, so it fires on
 * the first pass after one (0x43da7e); the port has no tick-clock loops, so
 * every loop it writes is pass-counted.
 *
 * Every pause is a nesting COUNTER in the engine and a flag in the port; a
 * paused slot is written with a count of 1 and read back as paused when its
 * count is not 0.
 */
import { pstrAt, writePstrAt } from "../df/binary";
import { TABLE } from "../df/savegame-v5";
import type { GameSession } from "./session";

const put16 = (d: Uint8Array, off: number, s: string): void => writePstrAt(d, off, s, 15);

// ---- loops (LOO*, 64 × 0x9e) ------------------------------------------------------

/** `makeloop`'s kinds as the engine numbers them (0x41bc00); there is no set kind */
const LOOP_KIND: Record<string, number> = { actor: 1, prop: 2, scene: 3, flat: 4 };
const KIND_NAME = ["", "actor", "prop", "scene", "flat"];

export function encodeLoops(session: GameSession): Uint8Array {
  const { slots, stride } = TABLE.loops;
  const out = new Uint8Array(slots * stride);
  const v = new DataView(out.buffer);
  let slot = 0;
  for (const l of session.scheduler.loops) {
    const kind = LOOP_KIND[l.kind];
    if (!kind || slot >= slots) {
      session.onLog(`savegame: a ${l.kind} loop on ${l.name} has no place in a RedJack save — left out`);
      continue;
    }
    const at = slot++ * stride;
    v.setInt16(at + 0x00, 1, true);
    v.setInt16(at + 0x02, l.paused ? 1 : 0, true);
    v.setInt16(at + 0x04, kind, true);
    v.setInt32(at + 0x06, 0, true);
    v.setInt32(at + 0x0a, Math.max(1, l.count), true);
    put16(out, at + 0x0e, l.name);
    // the handler as the statement the service sends (`"<name>", <handler>`)
    writePstrAt(out, at + 0x1e, `${l.handler}()`, 127);
  }
  return out;
}

export function decodeLoops(session: GameSession, bytes: Uint8Array): void {
  const { slots, stride } = TABLE.loops;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < slots && (i + 1) * stride <= bytes.length; i++) {
    const at = i * stride;
    if (!v.getInt16(at, true)) continue;
    const kind = KIND_NAME[v.getInt16(at + 0x04, true)] ?? "";
    if (!kind) continue;
    // a timed loop's deadline is meaningless in another process and is zeroed
    // on load, which leaves its pass count, 0: it fires on the first pass
    const passes = v.getInt32(at + 0x06, true) ? 0 : v.getInt32(at + 0x0a, true);
    const name = pstrAt(bytes, at + 0x0e);
    // as the statement the engine stores; restoreLoop takes the name out of it
    session.scheduler.restoreLoop(kind, name, pstrAt(bytes, at + 0x1e), passes);
    const l = session.scheduler.loops[session.scheduler.loops.length - 1];
    if (l && v.getInt16(at + 0x02, true)) l.paused = true;
  }
}

// ---- crickets (BAL*, 16 × 0x54) ---------------------------------------------------

export function encodeCrickets(session: GameSession): Uint8Array {
  const { slots, stride } = TABLE.crickets;
  const out = new Uint8Array(slots * stride);
  const v = new DataView(out.buffer);
  session.scheduler.crickets.slice(0, slots).forEach((c, i) => {
    const at = i * stride;
    v.setInt16(at + 0x00, 1, true);
    v.setInt16(at + 0x02, c.paused ? 1 : 0, true);
    v.setInt32(at + 0x04, c.x, true);
    v.setInt32(at + 0x08, c.y, true);
    v.setInt32(at + 0x0c, c.radius, true);
    v.setInt32(at + 0x10, c.base, true);
    v.setInt32(at + 0x14, c.jitter, true);
    v.setInt32(at + 0x18, c.count, true);
    // the volume the mixer reads is recomputed every pass; −1 is its "not yet"
    v.setInt16(at + 0x2e, -1, true);
    put16(out, at + 0x34, c.setName);
    put16(out, at + 0x44, c.name);
  });
  return out;
}

export function decodeCrickets(session: GameSession, bytes: Uint8Array): void {
  const { slots, stride } = TABLE.crickets;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < slots && (i + 1) * stride <= bytes.length; i++) {
    const at = i * stride;
    if (!v.getInt16(at, true)) continue;
    session.scheduler.restoreCricket(
      pstrAt(bytes, at + 0x44),
      pstrAt(bytes, at + 0x34),
      v.getInt32(at + 0x04, true),
      v.getInt32(at + 0x08, true),
      v.getInt32(at + 0x0c, true),
      v.getInt32(at + 0x10, true),
      v.getInt32(at + 0x14, true),
      v.getInt32(at + 0x18, true),
    );
    const c = session.scheduler.crickets[session.scheduler.crickets.length - 1];
    if (c && v.getInt16(at + 0x02, true)) c.paused = true;
  }
}

// ---- walks (WAL*, 16 × 0x80) and their routes (DRIV) ------------------------------

/** the walk modes (savegame-v5.md): a turn, a straight walk, a point, a route */
const MODE = { turn: 0, star: 1, xyz: 2, path: 3 } as const;

/** a route as a DRIV container: the length at 0x18, the count at 0x20, points from 0x34 */
function driv(points: { x: number; y: number; z: number; cum: number }[]): Uint8Array {
  const d = new Uint8Array(0x34 + points.length * 16);
  const v = new DataView(d.buffer);
  v.setUint32(0, 0x00050000, true);
  v.setUint32(4, 0x44524956, true); // 'DRIV'
  v.setInt32(0x18, Math.round(points[points.length - 1]?.cum ?? 0), true);
  v.setInt32(0x20, points.length, true);
  points.forEach((p, i) => {
    const at = 0x34 + i * 16;
    v.setInt32(at, p.x, true);
    v.setInt32(at + 4, p.y, true);
    v.setInt32(at + 8, p.z, true);
    v.setInt32(at + 12, Math.round(i ? p.cum - points[i - 1].cum : 0), true);
  });
  return d;
}

function undriv(d: Uint8Array): { x: number; y: number; z: number; cum: number }[] {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: { x: number; y: number; z: number; cum: number }[] = [];
  let cum = 0;
  for (let i = 0, n = v.getInt32(0x20, true); i < n && 0x34 + (i + 1) * 16 <= d.length; i++) {
    const at = 0x34 + i * 16;
    cum += i ? v.getInt32(at + 12, true) : 0;
    out.push({ x: v.getInt32(at, true), y: v.getInt32(at + 4, true), z: v.getInt32(at + 8, true), cum });
  }
  return out;
}

export function encodeWalks(
  session: GameSession,
  _handle: (file: string) => number,
): { table: Uint8Array; routes: Uint8Array[] } {
  const { slots, stride } = TABLE.walks;
  const out = new Uint8Array(slots * stride);
  const v = new DataView(out.buffer);
  const routes: Uint8Array[] = [];
  let slot = 0;
  for (const [key, w] of session.scheduler.walks) {
    if (slot >= slots) break;
    const a = session.actorRuntime.get(key);
    if (!a) continue;
    const at = slot++ * stride;
    const mode = w.turnOnly ? MODE.turn : w.path ? MODE.path : w.arriveStar === "custom" ? MODE.xyz : MODE.star;
    v.setInt16(at + 0x00, 1, true);
    v.setInt16(at + 0x02, w.paused ? 1 : 0, true);
    v.setInt16(at + 0x04, mode, true);
    v.setInt32(at + 0x08, w.turnTo ?? -1, true);
    v.setInt32(at + 0x0c, a.deg, true);
    v.setInt32(at + 0x18, w.sx, true);
    v.setInt32(at + 0x1c, w.sy, true);
    v.setInt32(at + 0x20, w.sz, true);
    // a route slot's handle is non-zero, which is what tells the loader a DRIV follows
    v.setUint32(at + 0x24, w.path ? routes.length + 1 : 0, true);
    v.setInt32(at + 0x28, Math.round(w.progress), true);
    // the engine keeps start − target, the port target − start
    v.setInt32(at + 0x2c, -w.dx, true);
    v.setInt32(at + 0x30, -w.dy, true);
    v.setInt32(at + 0x34, -w.dz, true);
    v.setInt32(at + 0x38, Math.max(1, Math.round(w.dist)), true);
    put16(out, at + 0x40, a.name);
    put16(out, at + 0x50, w.arriveStar ?? "");
    if (w.path) routes.push(driv(w.path));
  }
  return { table: out, routes };
}

export function decodeWalks(
  session: GameSession,
  table: Uint8Array,
  routes: Uint8Array[],
  _file: (handle: number) => string,
): void {
  const { slots, stride } = TABLE.walks;
  const v = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let route = 0;
  for (let i = 0; i < slots && (i + 1) * stride <= table.length; i++) {
    const at = i * stride;
    if (!v.getInt16(at, true)) continue;
    const mode = v.getInt16(at + 0x04, true);
    const name = pstrAt(table, at + 0x40);
    const path = v.getUint32(at + 0x24, true) && routes[route] ? undriv(routes[route++]) : undefined;
    const turnTo = v.getInt32(at + 0x08, true);
    const ok = session.scheduler.restoreWalk(name, {
      turnOnly: mode === MODE.turn,
      paused: v.getInt16(at + 0x02, true) !== 0,
      turnTo: turnTo >= 0 ? turnTo : undefined,
      sx: v.getInt32(at + 0x18, true),
      sy: v.getInt32(at + 0x1c, true),
      sz: v.getInt32(at + 0x20, true),
      dx: -v.getInt32(at + 0x2c, true),
      dy: -v.getInt32(at + 0x30, true),
      dz: -v.getInt32(at + 0x34, true),
      dist: v.getInt32(at + 0x38, true),
      progress: v.getInt32(at + 0x28, true),
      arriveStar: pstrAt(table, at + 0x50) || undefined,
      path: path && path.length >= 2 ? path : undefined,
    });
    if (!ok) session.onLog(`opengame: ${name} was saved walking and is not in the reopened casts — left standing`);
  }
}
