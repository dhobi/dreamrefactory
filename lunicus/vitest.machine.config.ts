import { machineConfig } from "../tools/vitest-machine";

/** The machine suites (`tests/machine/`); see tools/vitest-machine.ts. */
export default machineConfig(import.meta.dirname);
