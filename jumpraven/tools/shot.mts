/**
 * A screenshot of the machine: `npx tsx jumpraven/tools/shot.mts <level> <ticks> <out.png> [keys…]`
 * — a new game opened at the level, run for the ticks (each key given pressed
 * once, a second apart, first), and the window saved at its own 512×384.
 */
import { writeFileSync } from "node:fs";
import { encodePNG } from "../../tools/png";
import { start } from "../tests/machine/harness";

const [level, ticks, out, ...keys] = process.argv.slice(2);
const { game, m, key } = start({ draws: true, start: { level: Number(level) } });
for (const k of keys) {
  key(k);
  for (let i = 0; i < 60; i++) game.tick();
}
for (let i = 0; i < Number(ticks); i++) game.tick();
writeFileSync(out, encodePNG(m.screen.rgba(), 512, 384));
console.log(`${out}: tick ${m.ticks}, ${m.where}`);
