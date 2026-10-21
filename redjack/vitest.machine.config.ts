import { machineConfig } from "../tools/vitest-machine";

/**
 * The machine suites (`tests/machine/`); see tools/vitest-machine.ts. And the
 * contributed speedrun sheets, each played to its end (tests/speedrun/sheets.ts).
 */
export default machineConfig(import.meta.dirname, ["tests/speedrun/sheets.ts"]);
