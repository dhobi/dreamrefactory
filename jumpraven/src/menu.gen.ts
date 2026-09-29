/**
 * RAVEN.EXE's menu bar — GENERATED, do not edit.
 *
 * Regenerate with `npx tsx jumpraven/tools/menu.ts`: the RT_MENU resource MENUS of
 * gamefiles/RAVEN/RAVEN/RAVENRES.DLL. Each id is the command's Win32 id; the
 * disabled ones are the ones the resource greys. What each does is src/menu.ts.
 */
import type { WindowMenu } from "@dreamfactory/engine/web/window-bar";

export const MENUS: readonly WindowMenu[] = [
  {
    label: "&File",
    items: [
      { id: "201", label: "&New" },
      { id: "202", label: "&Open..." },
      { id: "203", label: "&Save..." },
      { separator: true },
      { id: "204", label: "E&xit" },
    ],
  },
  {
    label: "&Edit",
    items: [
      { id: "301", label: "&Undo", disabled: true },
      { separator: true },
      { id: "303", label: "Cu&t", disabled: true },
      { id: "304", label: "&Copy", disabled: true },
      { id: "305", label: "&Paste", disabled: true },
    ],
  },
  {
    label: "Se&ttings",
    items: [
      { id: "401", label: "&Training" },
      { id: "402", label: "&Intermediate" },
      { id: "403", label: "&Advanced" },
      { id: "404", label: "&Expert" },
      { separator: true },
      { id: "406", label: "&Keys..." },
      { id: "407", label: "&Cache Mazes..." },
    ],
  },
  {
    label: "Sound",
    items: [
      { id: "501", label: "Sound Of&f" },
      { id: "502", label: "Sound Level &1" },
      { id: "503", label: "Sound Level &2" },
      { id: "504", label: "Sound Level &3" },
      { id: "505", label: "Sound Level &4" },
      { id: "506", label: "Sound Level &5" },
      { id: "507", label: "Sound Level &6" },
      { id: "508", label: "Sound Level &7" },
    ],
  },
  {
    label: "&Help",
    items: [
      { id: "601", label: "Abount Raven..." },
      { id: "602", label: "Help..." },
      { id: "603", label: "Memory..." },
    ],
  },
];
