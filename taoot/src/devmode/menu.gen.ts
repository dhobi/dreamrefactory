/**
 * TI.EXE's developer menu bar — GENERATED, do not edit.
 *
 * Regenerate with `npx tsx taoot/tools/devmenu.ts`, which reads the RT_MENU
 * resource out of the executable and explains the format. What it is FOR is in
 * `taoot/src/devmode/menu.ts` beside this.
 *
 * Read from resource 3498 of gamefiles/en/titanic1/install/bin/ti.exe.
 */

/** one command on a menu, or a rule between two of them */
export type DevMenuEntry =
  | { separator: true }
  | {
      /** the label as TI.EXE stores it — `&` accelerator marks and `\tCtrl+X` hint */
      label: string;
      /** the Win32 command id the resource gives it */
      id: number;
      /** the name BOOTFILE's `menuselect` switches on */
      select: string;
      separator?: false;
    };

/** one title on the bar, and what drops down from it */
export interface DevMenu {
  label: string;
  items: DevMenuEntry[];
}

export const DEV_MENU: readonly DevMenu[] = [
  {
    label: "&File",
    items: [
      { label: "&Quit\tCtrl+Q", id: 100, select: "quit" },
    ],
  },
  {
    label: "&Options",
    items: [
      { label: "&Message\tCtrl+M", id: 200, select: "message" },
      { label: "&Report\tCtrl+R", id: 201, select: "report" },
      { label: "&Close Puppet\tCtrl+N", id: 202, select: "close puppet" },
      { label: "&Debug On/Off\tCtrl+D", id: 203, select: "debug on/off" },
    ],
  },
  {
    label: "Soun&d",
    items: [
      { label: "Volume &0\tCtrl+0", id: 300, select: "volume 0" },
      { label: "Volume &1\tCtrl+1", id: 301, select: "volume 1" },
      { label: "Volume &2\tCtrl+2", id: 302, select: "volume 2" },
      { label: "Volume &3\tCtrl+3", id: 303, select: "volume 3" },
      { label: "Volume &4\tCtrl+4", id: 304, select: "volume 4" },
      { label: "Volume &5\tCtrl+5", id: 305, select: "volume 5" },
      { label: "Volume &6\tCtrl+6", id: 306, select: "volume 6" },
      { label: "Volume &7\tCtrl+7", id: 307, select: "volume 7" },
      { label: "Volume &8\tCtrl+8", id: 308, select: "volume 8" },
      { label: "Volume &9\tCtrl+9", id: 309, select: "volume 9" },
    ],
  },
  {
    label: "&Scripts",
    items: [
      { label: "&Flat script\tCtrl+F", id: 400, select: "flat script" },
      { label: "S&cene script\tCtrl+C", id: 401, select: "scene script" },
      { label: "Se&t script\tCtrl+T", id: 402, select: "set script" },
      { label: "Sta&ge script\tCtrl+G", id: 403, select: "stage script" },
      { label: "&Boot script\tCtrl+B", id: 404, select: "boot script" },
      { label: "&Post script\tCtrl+P", id: 405, select: "post script" },
      { label: "Ser&ver script\tCtrl+V", id: 406, select: "server script" },
      { label: "P&ainting scripts\tCtrl+A", id: 407, select: "painting scripts" },
      { label: "Butt&on scripts\tCtrl+O", id: 408, select: "button scripts" },
    ],
  },
];
