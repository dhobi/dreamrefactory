/**
 * Write the scaler cases out for record.py: the same seeded cases
 * engine/tests/sprite-scaler.ts replays.
 *
 *   npx tsx tools/native-sprite/cases.mts <seed> <count> > cases.json
 */
import { scalerCases } from "../../engine/tests/helpers/sprite-scaler-cases";

const [seed, count] = process.argv.slice(2).map(Number);
const b64 = (u: Uint8Array | null) => (u ? Buffer.from(u).toString("base64") : null);
process.stdout.write(
  JSON.stringify(
    scalerCases(seed, count).map((c) => ({ ...c, sprite: b64(c.sprite), mask: b64(c.mask) })),
  ),
);
