import { ScriptError, type Value } from "../interp";

/**
 * DreamFactory 5's argument checks, the same in every command that reads one:
 * the wrong type is error 0xe.
 */

/** an integer argument, or 0xe (`cmp word [arg], 4`) */
export const int = (cmd: string, v: Value | undefined): number => {
  if (typeof v !== "number") throw new ScriptError(0xe, `${cmd}: ${String(v)} is not an integer`);
  return v | 0;
};

/** a string argument, or 0xe (0x410560) */
export const str = (cmd: string, v: Value | undefined): string => {
  if (typeof v !== "string") throw new ScriptError(0xe, `${cmd}: ${String(v)} is not a string`);
  return v;
};

/**
 * A boolean argument as 1/0, or 0xe. A v5 boolean is 1/0 (Interpreter.bool),
 * so the exe's `cmp word [arg], 2` can only turn a string away here.
 */
export const bool = (cmd: string, v: Value | undefined): number => {
  if (typeof v === "string" || v === undefined) throw new ScriptError(0xe, `${cmd}: ${String(v)} is not a boolean`);
  return v ? 1 : 0;
};
