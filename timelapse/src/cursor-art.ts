/**
 * The mouse cursors this game's engine build carries — GENERATED, do not edit.
 *
 *   npx tsx tools/dumpcursors.ts TLAPSE1/install/bin/tl.exe --out <this file> --const TL_CURSORS
 *
 * 15 `CURS.*` resources out of `tl.exe`, minus 2 that are duplicates under an old numeric name (curs131, curs2002).
 * What they are, how `cursor("touch")` reaches one and why a table is per BUILD
 * rather than per engine is in that tool's header; how a browser is given one is
 * in engine/src/web/cursors.ts.
 */
import type { CursorArt } from "@dreamfactory/engine/web/cursors";

/** by the name a script passes `cursor(...)`, folded — Win32 resource lookup
 *  folds case and the discs rely on it */
export const TL_CURSORS: Record<string, CursorArt> = {
  arrow: { hx: 2, hy: 4, fallback: "default",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAABgAAAAcAAAAHgAAAB8AAAAfgAAAH8AAAB/gAAAf8AAAH/gAAB/8AAAf/gAAH8AAAB3AAAAY4AAAEOAAAABwAAAAcAAAADgAAAA4AAAAHAAAABwAAAAAAAAAAAAAAAAAAAAAAAD/////////////////////3////8/////H////w////8H////A////wH///8A////AH///wA///8AH///AA///wAH//8AA///AAH//wB///8IP///GD///zwf//98H////g////4P////B////wf///+P//////////////////w==" },
  fist: { hx: 16, hy: 16, fallback: "grabbing",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2wAAAP9AAAB/wAAAf8AAAf/AAAH/wAAB/4AAAP+AAAB/AAAAPwAAAD8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD////////////////////////////////////////////////////////////yT///4AP//+AB///wAf//4AH//8AB///AAf//wAP//+AD///wB///+Af///gH/////////////////////////////////////////////////w==" },
  godown: { hx: 15, hy: 15, fallback: "pointer",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAYAAAAPAAAADwAAAB+AAAAfgAABf+gAAL/QAABfoAAAL0AAABaAAAAJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD////////////////////////////////////////////+f////D////w////4H///+B////AP///wD///AAD//wAA//+AAf//wAP//+AH///wD///+B////w////+f////////////////////////////////////////////w==" },
  goleft: { hx: 13, hy: 13, fallback: "pointer",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAABgAAAA4AAAAf+AAAP/4AAH/+AAA//wAAH/8AAA4/AAAGHwAAAh8AAAAfAAAAHwAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///////////////////////////////////////P////j////w////4Af//8AB//+AAP//AAD//4AAf//AAH//4AB///DAf//4wH///MB////Af///wH///8B/////////////////////////////////////////////////w==" },
  goleftback: { hx: 15, hy: 15, fallback: "pointer",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAAAAf4AAAOHAAADAwAAAwMAAAMDAAADAwAAAwMAAAMDAAADAwAAAwMAAA/DAAADgAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///////////////////////////////////////wP///4B///8AP//+AB///h4f//4eH//+Hh///h4f//4eH//+Hh///h4f//ACH//4Bh///A4f//4f////P//////////////////////////////////////////////////w==" },
  goright: { hx: 18, hy: 14, fallback: "pointer",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAGAAAABwAAAf+AAAf/wAAH/+AAD//AAA//gAAPxwAAD4YAAA+EAAAPgAAAD4AAAA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////////////////////////////////////z////8f////D///4Af//4AD//8AAf//AAD//gAB//4AA//+AAf//gMP//4DH//+Az///gP///4D///+A/////////////////////////////////////////////w==" },
  gorightback: { hx: 15, hy: 15, fallback: "pointer",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAB/gAAA4cAAAMDAAADAwAAAwMAAAMDAAADAwAAAwMAAAMDAAADAwAAAw/AAAAHgAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///////////////////////////////////////A////gH///wA///4AH//+Hh///h4f//4eH//+Hh///h4f//4eH//+Hh///hAD//4YB//+HA////4f////P/////////////////////////////////////////////////w==" },
  gostrait: { hx: 15, hy: 16, fallback: "pointer",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAA4AAAAfAAAAP4AAAH/AAAD/4AAAHwAAAB8AAAAfAAAAHwAAAB8AAAAfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////////////////////////////////////////////////v////x////4P///8B///+AP///AB///gAP//wAB///wH///8B////Af///wH///8B////Af/////////////////////////////////////////////////w==" },
  goup: { hx: 15, hy: 16, fallback: "pointer",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAAADwAAAB+AAAA/wAAAf+AAAP/wAAAPAAAB73gAAB+AAAAfgAAAH4AAAD/AAAAAAAAAf+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD////////////////////////////////////////////+f////D////gf///wD///4Af//8AD//+AAf//AAD//wAA//8AAP//8A////AP///gB///wAP//8AD///AA////////////////////////////////////////////w==" },
  hand: { hx: 15, hy: 14, fallback: "grab",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAzYAAAM2AAABtkAAAbbAAAD+wAAM/8AAD/+AAAf/gAAD/4AAA/8AAAH/AAAA/gAAAH4AAAB+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD////////////////////////////////////////////8////yB///4AP//+AC///wAH//8AB//8gAf/+AAH//gAD//8AA///gAP//4AH///AB///4A////AP///wD////////////////////////////////////////////w==" },
  hyperlink: { hx: 15, hy: 15, fallback: "pointer",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AAAGBgAACAEAABAAgAAQ8IAAIQhAACIEQAAiBEAAIgRAACIEQAAhCEAAEPCAABAAgAAIAQAABgYAAAH4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///////////////////////////////////////gf///gB///wAP//4PB//+EIf//CBD//xGI//8TyP//E8j//xGI//8IEP//hCH//4PB///AA///4Af///gf/////////////////////////////////////////////////w==" },
  none: { hx: 0, hy: 0, fallback: "none",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////w==" },
  sight: { hx: 16, hy: 15, fallback: "crosshair",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAAADwAAAAYAAAAGAAAABgAAAIYQAAH/+AAB//gAAIYQAAAGAAAABgAAAAYAAAAPAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD////////////////////////////////////////////+f////D////gf///4H////D///8wz//+AAf//AAD//wAA//+AAf//zDP///w////4H///+B////w////+f////////////////////////////////////////////w==" },
  touch: { hx: 14, hy: 9, fallback: "pointer",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAADAAAAAwAAAAMAAAADAAAAAwAAAGNQAAAzVAAAG/QAABv8AAAP/AAAB/gAAAf4AAAD+AAAA/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD////////////////////////////////////////////8////+H////h////4f///+H////h///+ID///AAP//4AB///AAf//wAH//+AB///wA///8AP///gD///4A////////////////////////////////////////////w==" },
  watch: { hx: 16, hy: 16, fallback: "wait",
    bits: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAH/wAAAAAAAAP+AAAD/gAAA/YAAAKqAAADVgAAAawAAADYAAAAcAAAACAAAAAgAAAAIAAAAHAAAAD4AAAB3AAAA/4AAAPeAAADrgAAA1YAAAKqAAAAAAAAB/8AAAAAAAAAAAAAAAAAAAAAAD/////////////////gAD//4AA//+AAP//wAH//8AB///AAf//wAH//8AB///AAf//4AP///AH///4D////B////wf///8H///+A////AH///gA///wAH//8AB///AAf//wAH//8AB///AAf//gAD//4AA//+AAP///////////w==" },
};
