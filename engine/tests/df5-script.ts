/**
 * What DreamFactory 5 changed in a script, and what it changed in container 0.
 *
 *   npx vitest run engine/tests/df5-script.ts
 *
 * RedJack (1998) is the only v5 game, and its scripts are v4's bytecode with two
 * additions: ids v4 never had (`DF5_OPCODES`, read out of `RedJack.exe`) and a
 * segment kind for a commented-out line. The segments are built by hand here —
 * no game data — in exactly the shape the BOOTFILE's `boot()` uses: a
 * `permanent` declaration, and an `if isdebugging()` / `endif` commented out
 * around a live `clearmenus()`.
 */
import { test, expect } from "vitest";
import { DF5_OPCODES, OPCODES } from "@dreamfactory/engine/df/opcodes";
import { decodeScript } from "@dreamfactory/engine/df/script";
import { versionOf } from "@dreamfactory/engine/df/version";
import { parseScript } from "@dreamfactory/engine/runtime/parser";

/** a script container: segments, a zero terminator, then the string pool */
function build(segs: ([number, number] | [3 | 5 | 7, string])[]): Uint8Array {
  const poolAt = (segs.length + 1) * 8;
  const pool: number[] = [];
  const out = new Uint8Array(poolAt + 512);
  const v = new DataView(out.buffer);
  segs.forEach(([cmd, info], i) => {
    const pos = i * 8;
    v.setUint16(pos, cmd, true);
    if (typeof info === "string") {
      const at = poolAt + pool.length;
      pool.push(info.length, ...[...info].map((c) => c.charCodeAt(0)));
      v.setUint32(pos + 2, at - pos, true);
    } else v.setUint32(pos + 2, info, true);
  });
  out.set(pool, poolAt);
  return out;
}

const CODE = 4001, ENDCODE = 4004, LP = 4018, RP = 4019, BREAK = 6;
const PERMANENT = 4030, CLEARMENUS = 12114;

test("the v5 ids only ever fill gaps in the v4 table", () => {
  for (const id of DF5_OPCODES.keys()) expect(OPCODES.has(id), `id ${id}`).toBe(false);
});

test("a v5 script decodes: new ids by name, commented lines dropped", () => {
  const data = build([
    [CODE, 0], [5, "boot"], [LP, 0], [RP, 0], [BREAK, 1],
    [PERMANENT, 0], [5, "numgames"], [BREAK, 1],
    [7, "\tif isdebugging()"],
    [CLEARMENUS, 0], [LP, 0], [RP, 0], [BREAK, 1],
    [7, "\tendif "],
    [ENDCODE, 0],
  ]);
  const tokens = decodeScript(data);
  const ops = tokens.filter((t) => t.kind === "op").map((t) => (t as { name: string }).name);
  expect(ops).toContain("permanent");
  expect(ops).toContain("clearmenus");
  // the two comments left nothing behind, so the `if` they would have opened
  // is not waiting for an `endif`
  expect(ops).not.toContain("if");
  const script = parseScript(tokens);
  expect([...script.codes.keys()]).toEqual(["boot"]);
});

test("container 0 of a v5 file says 5, and a v4 one still says 4", () => {
  // `00 00 05 00 "TOOB"` — the u16 tag, then the file's own fourCC
  expect(versionOf(new Uint8Array([0, 0, 5, 0, 0x54, 0x4f, 0x4f, 0x42]))).toBe(5);
  expect(versionOf(new Uint8Array([0, 0, 4, 0, 0, 0, 0, 0]))).toBe(4);
  expect(versionOf(new Uint8Array([0, 0, 1, 0, 0, 0, 0, 0]))).toBe(1);
});

test("a v5 switch's `default` arm is the arm no case matched, not a command", () => {
  // gang.cast's seagull, `fly`: a gull on any star but the four named ones
  // takes the default, and without it asked for the star "seagull"
  const SWITCH = 4009, ENDSWITCH = 4010, CASE = 4011, DEFAULT = 4032, RETURN = 4024;
  const data = build([
    [CODE, 0], [5, "pick"], [LP, 0], [RP, 0], [BREAK, 1],
    [SWITCH, 0], [3, "seagull5"], [BREAK, 1],
    [CASE, 0], [3, "seagull1"], [BREAK, 1],
    [RETURN, 0], [3, "2,3,4,5,"], [BREAK, 1],
    [DEFAULT, 0], [BREAK, 1],
    [RETURN, 0], [3, "1,2,3,4,"], [BREAK, 1],
    [ENDSWITCH, 0], [BREAK, 1],
    [ENDCODE, 0],
  ]);
  const body = parseScript(decodeScript(data)).codes.get("pick")!.body;
  expect(body).toEqual([
    {
      t: "switch",
      subject: { t: "str", v: "seagull5" },
      cases: [{ match: { t: "str", v: "seagull1" }, body: [{ t: "return", value: { t: "str", v: "2,3,4,5," } }] }],
      default_: [{ t: "return", value: { t: "str", v: "1,2,3,4," } }],
    },
  ]);
});
