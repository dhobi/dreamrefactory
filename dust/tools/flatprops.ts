/**
 * What is on a flat, and — the part that matters — WHERE.
 *
 *   npx tsx dust/tools/flatprops.ts hotplate.flt
 *   npx tsx dust/tools/flatprops.ts new.flt --scripts
 *
 * A **flat** is a full-screen 2D layer — the control panel, the inventory, the
 * fight, the breakfast table — and while one is up the arrow keys do nothing:
 * everything is a click. That makes writing a route across one a problem,
 * because the script says
 *
 *     code mousedown (arg)
 *         gotoflat (4)
 *
 * and never says where on the screen that is. Blind clicking has failed twice on
 * this route: thirty clicks through `getcards.mov` took the walk-away branch
 * every time, and forty spread over the breakfast table never found the picture
 * that ends the meal.
 *
 * It need not be guesswork. A flat carries a **click-logic container** of
 * regions, each one a rectangle, a name and the container index of the script it
 * runs ({@link StgRegion}) — so the answer to "where do I click to leave" is in
 * the file, and this prints it.
 *
 * Locating structures through the real readers rather than by guessing is the
 * rule this repository keeps relearning; it applies to pixels as much as to
 * bytes.
 *
 * Needs the rip and nothing else: no page, no boot, no clock.
 */
import { existsSync, readFileSync } from "node:fs";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";
import { sniffScript, scriptToText } from "@dreamfactory/engine/df/script";
import { indexDisc } from "../tests/playthrough/harness";

const want = process.argv.find((a) => !a.startsWith("-") && /\.(flt|stg)$/i.test(a));
const withScripts = process.argv.includes("--scripts");
if (!want) {
  console.error("usage: npx tsx dust/tools/flatprops.ts <file.flt> [--scripts]");
  process.exit(1);
}

const path = indexDisc().get(want.toLowerCase());
if (!path || !existsSync(path)) {
  console.error(`no ${want} on the disc — this needs the Dust rip`);
  process.exit(1);
}

const stg = readStgFile(new Uint8Array(readFileSync(path)));
console.log(`${want} — DreamFactory ${stg.version}, ${stg.flats.length} flat(s)\n`);

/** the source of a container, when it holds a script */
const source = (index: number): string[] => {
  const data = stg.file.containers[index]?.data;
  if (!data) return [];
  const tokens = sniffScript(data);
  if (!tokens) return [];
  try {
    return scriptToText(tokens).split("\n");
  } catch {
    return [];
  }
};

/** the calls a container's script makes, as a one-line summary */
const summary = (index: number): string => {
  const lines = source(index)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("code ") && l !== "endcode" && !l.startsWith("global "));
  if (!lines.length) return "";
  const interesting = lines.filter((l) => /^(gotoflat|closestagefile|openstagefile|sendto|addinven|playmovie|gotointerior)/.test(l));
  return (interesting.length ? interesting : lines).slice(0, 3).join(" · ");
};

for (const flat of stg.flats) {
  console.log(
    `${flat.name}  ${flat.width}x${flat.height}  script=c${flat.locationScript}` +
      `  frame=c${flat.locationFrame}  clicks=c${flat.locationClickLogic}`,
  );
  const own = summary(flat.locationScript);
  if (own) console.log(`    the flat itself: ${own}`);
  // the regions live in the flat's own click-logic container, and are read at
  // the version the file was written by — a v1 `.FLT` lays them out differently
  const clicks = stg.file.containers[flat.locationClickLogic]?.data;
  const regions = clicks ? readStgRegions(clicks, stg.version) : [];
  if (!regions.length) console.log("    (no click regions)");
  for (const r of regions) {
    const box = `${r.left},${r.top}-${r.right},${r.bottom}`;
    const mid = `click (${Math.round((r.left + r.right) / 2)},${Math.round((r.top + r.bottom) / 2)})`;
    console.log(`    ${(r.name || "(unnamed)").padEnd(14)} ${box.padEnd(20)} ${mid.padEnd(20)} c${r.script}  ${summary(r.script)}`);
  }
  if (withScripts) {
    for (const line of source(flat.locationScript)) console.log(`      | ${line}`);
  }
  console.log();
}
