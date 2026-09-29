/**
 * The day's reckoning, on the way back from the flying: the damage done
 * (RAVEN.EXE 0x408a68) and the debrief's accuracy (0x401000).
 *
 * ## The damage (0x408c00)
 *
 * `damage` (DAYn\DAMAGE): the four enemies, each with its kills at its bounty,
 * `N X $P = $T`, in ink 0x19, and CONTINUE. The bounties are the screen's own
 * (0x408c70); whatever they add up to, the flying has already paid.
 *
 * ## The accuracy (0x401000, 0x4012a9)
 *
 * The day's accuracy is every hit over every shot, the player's and the
 * copilot's together, as a percentage. At 60 or better the briefing is
 * `bata.pupp` and there is a LEVEL BONUS of 1000, paid as the screen closes
 * (0x401276); under it, `batb.pupp` and NO LEVEL BONUS!. `accuracy`
 * (SHARED\ACCURACY) shows each of the five weapons' percentages (not the
 * defensive's), the player's on the JUMP RAVEN row and the copilot's on the
 * COPILOT row, each row's average, the total, and the money: the total now,
 * the bonus and the new total.
 */
import { decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { trackPress } from "@dreamfactory/engine/v0/film";
import type { Co, Machine } from "./machine";
import type { Records, Tally } from "./records";
import { anchored, inRect } from "./screens";

const INK = 0x19;
/** a level bonus for 60% (0x4010b5, 0x401276) */
export const BONUS_ACCURACY = 60;
export const LEVEL_BONUS = 1000;

/** each count's bounty and where it is written (0x408c70) */
const BOUNTIES: { kill: keyof Tally["kills"]; price: number; x: number; y: number }[] = [
  { kill: "bike", price: 15, x: 0x46, y: 0xa1 },
  { kill: "copter", price: 25, x: 0x12e, y: 0xa1 },
  { kill: "tank", price: 55, x: 0x46, y: 0x13e },
  { kill: "jeep", price: 35, x: 0x12e, y: 0x13e },
];

const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
/** 0x401614: a percentage, 0 when nothing was fired */
const percent = (hits: number, shots: number): number => (shots > 0 ? Math.trunc((hits * 100) / shots) : 0);

/** 0x401007: the day's accuracy, every hit of both over every shot */
export function accuracy(t: Tally): number {
  return percent(sum(t.hits) + sum(t.copilotHits), sum(t.shots) + sum(t.copilotShots));
}

/** a screen of two or three pictures and a CONTINUE (picture 1) that closes it */
function* screenUntilContinue(m: Machine, pictures: FrameV0[], draw: () => void, palette: Uint8ClampedArray): Co {
  draw();
  yield* m.fadeIn(palette);
  const cont = anchored(pictures[1]);
  for (;;) {
    const e = m.take();
    if (e?.kind === "down" && inRect(cont, e.x, e.y) && (yield* trackPress(m, cont))) return;
    yield;
  }
}

/** 0x408a8d … 0x408be3: the damage screen */
export function* damage(m: Machine, r: Records, file: Uint8Array, palette: Uint8ClampedArray): Co {
  const p = readContainerFile(file).containers.map((c) => decodeFrameV0(c.data));
  const draw = (): void => {
    if (!m.draws) return;
    m.screen.spriteAt(p[0], 0, 0);
    m.screen.sprite(p[1], 0, 0);
    if (!m.font) return;
    for (const b of BOUNTIES) {
      const n = r.tally.kills[b.kill];
      m.screen.text(m.font, b.x, b.y, `${n} X $${b.price} = $${n * b.price}`, INK);
    }
  };
  yield* screenUntilContinue(m, p, draw, palette);
}

/** 0x401118 … 0x401276: the accuracy screen, and the bonus paid as it closes */
export function* accuracyScreen(m: Machine, r: Records, file: Uint8Array, palette: Uint8ClampedArray): Co {
  const p = readContainerFile(file).containers.map((c) => decodeFrameV0(c.data));
  const t = r.tally;
  const acc = accuracy(t);
  const draw = (): void => {
    if (!m.draws) return;
    const s = m.screen;
    s.spriteAt(p[0], 0, 0);
    s.sprite(p[1], 0, 0);
    const font = m.font;
    if (!font) return;
    const at = (x: number, y: number, v: number): void => void s.text(font, x, y, String(v), INK);
    for (let k = 0; k < 5; k++) {
      at(0x12c + 0x2a * k, 0x64, percent(t.hits[k], t.shots[k]));
      at(0x12c + 0x2a * k, 0xdc, percent(t.copilotHits[k], t.copilotShots[k]));
    }
    at(0x86, 0x64, percent(sum(t.hits), sum(t.shots)));
    at(0x86, 0xdc, percent(sum(t.copilotHits), sum(t.copilotShots)));
    at(0xaa, 0x109, acc);
    const bonus = acc >= BONUS_ACCURACY ? LEVEL_BONUS : 0;
    at(0x1c2, 0x109, r.score);
    at(0x1c2, 0x140, bonus);
    at(0x1c2, 0x15e, r.score + bonus);
    if (bonus) s.sprite(p[2], 0, 0);
  };
  yield* screenUntilContinue(m, p, draw, palette);
  if (acc >= BONUS_ACCURACY) r.score += LEVEL_BONUS;
}
