/**
 * LUNICUS.EXE's menu bar — GENERATED, do not edit.
 *
 * Regenerate with `npx tsx lunicus/tools/menu.ts`: the RT_MENU resource MENUS of
 * gamefiles/LUNICUS/lunicus/lunires.dll. Each id is the command's Win32 id; the
 * disabled ones are the ones the resource greys. What each does is src/menu.ts.
 */
import type { WindowMenu } from "@dreamfactory/engine/web/window-bar";

export const MENUS: readonly WindowMenu[] = [
  {
    label: "&File",
    items: [
      { id: "201", label: "&New\tCtrl+N" },
      { id: "202", label: "&Open...\tCtrl+O" },
      { id: "203", label: "&Save...\tCtrl+S" },
      { separator: true },
      { id: "204", label: "E&xit\tCtrl+Q" },
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
      { id: "401", label: "&Beginner\tCtrl+B" },
      { id: "402", label: "&Intermediate\tCtrl+I" },
      { id: "403", label: "&Advanced\tCtrl+A" },
      { id: "404", label: "&Expert\tCtrl+E" },
      { separator: true },
      { id: "406", label: "&Keys...\tCtrl+K" },
      { id: "407", label: "&Cache Mazes...\tCtrl+M" },
    ],
  },
  {
    label: "&Sound",
    items: [
      { id: "501", label: "Sound Of&f\tCtrl+0" },
      { id: "502", label: "Sound Level &1\tCtrl+1" },
      { id: "503", label: "Sound Level &2\tCtrl+2" },
      { id: "504", label: "Sound Level &3\tCtrl+3" },
      { id: "505", label: "Sound Level &4\tCtrl+4" },
      { id: "506", label: "Sound Level &5\tCtrl+5" },
      { id: "507", label: "Sound Level &6\tCtrl+6" },
      { id: "508", label: "Sound Level &7\tCtrl+7" },
      { separator: true },
      { id: "510", label: "&Theme\tCtrl+T" },
    ],
  },
  {
    label: "&Help",
    items: [
      { id: "601", label: "About Lunicus..." },
      { id: "602", label: "Help..." },
    ],
  },
];
