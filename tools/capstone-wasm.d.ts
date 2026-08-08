// capstone-wasm ships type declarations but its package.json "exports" omits a
// "types" condition, so TS can't resolve them under bundler resolution. Declare
// the small surface the RE tooling uses here.
declare module "capstone-wasm" {
  export interface Insn {
    id: number;
    address: number | bigint;
    size: number;
    bytes: Uint8Array;
    mnemonic: string;
    opStr: string;
  }
  export class Capstone {
    constructor(arch: number, mode: number);
    setOption(opt: number, value: number): number;
    disasm(data: number[] | Uint8Array, options?: { address?: number | bigint; count?: number }): Insn[];
    close(): void;
  }
  export const Const: Record<string, number>;
  export function loadCapstone(args?: Record<string, unknown>): Promise<void>;
}
