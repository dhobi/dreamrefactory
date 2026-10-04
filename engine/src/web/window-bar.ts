/**
 * A game window's menu bar, drawn on the game's own frame.
 *
 * The games ran in a window with a Win32 menu bar across its top (LUNICUS.EXE's
 * File, Edit, Settings, Sound, Help; TI.EXE's developer menu). This is that bar:
 * it goes INSIDE the element that holds the canvas, above the picture and exactly
 * as wide, so it scales with the canvas, and in fullscreen it lies over the top
 * edge and slides in when the pointer (or a finger) reaches it, as a fullscreen
 * Windows program's did.
 *
 *   const bar = attachWindowBar(frameEl, MENUS, { onSelect: (id) => … });
 *   bar.check("402", CAPTURE); bar.enable("203", false); bar.hide();
 *
 * The menus are data, in the resource's own spelling: a label keeps its `&`
 * mnemonic mark and its `\tCtrl+X` hint (`tools/rtmenu.ts` reads them out of an
 * executable), and the bar underlines the one and right-aligns the other. With
 * `accelerators` the Ctrl+X hints are live keys too, with the bar hidden as
 * well — except those a browser keeps for itself (Ctrl+N, Ctrl+T and Ctrl+W
 * never reach a page).
 *
 * Keys: Alt (alone) or F10 puts the bar in menu mode, Alt+letter opens that menu,
 * the arrows walk it, Enter picks, Esc backs out — the Windows rules. While a menu
 * is open the bar takes every key, so a game listening on the document hears none
 * (the listener is on `window` in the capture phase, ahead of the document's).
 *
 * Styles in `window-bar.css` beside this: the classic grey Windows look, sized
 * against the frame's width (a 512-pixel window's 8-point bar, scaled).
 */

/** one command on a menu */
export interface WindowMenuItem {
  /** what `onSelect` is called with */
  id: string;
  /** the label as a Win32 resource spells it: `&Open...\tCtrl+O` */
  label: string;
  disabled?: boolean;
  checked?: boolean;
  separator?: false;
}
export type WindowMenuEntry = WindowMenuItem | { separator: true };
/** one title on the bar, and what drops down from it */
export interface WindowMenu {
  label: string;
  items: WindowMenuEntry[];
}

export interface WindowBarOptions {
  onSelect: (id: string) => void;
  /** the Ctrl+X hints are keys too */
  accelerators?: boolean;
  /** start hidden (`show()` later) */
  hidden?: boolean;
  /**
   * Whether the bar may take keys now — false while a modal dialog is up, say.
   * (A key typed into a text field is never the bar's.)
   */
  keys?: () => boolean;
}

export interface WindowBar {
  readonly el: HTMLElement;
  show(): void;
  hide(): void;
  readonly visible: boolean;
  /** a menu is open (or the bar is in menu mode): the game should hear no keys */
  readonly active: boolean;
  check(id: string, on: boolean): void;
  enable(id: string, on: boolean): void;
  /** close whatever is open */
  close(): void;
  destroy(): void;
}

/** `&Open...\tCtrl+O` → its text, its mnemonic letter and its hint */
export function parseMenuLabel(label: string): { text: string; key: string | null; hint: string } {
  const [head, hint = ""] = label.split("\t");
  let text = "";
  let key: string | null = null;
  for (let i = 0; i < head.length; i++) {
    if (head[i] === "&" && i + 1 < head.length) {
      i++;
      if (head[i] !== "&" && key === null) key = head[i].toLowerCase();
    }
    text += head[i];
  }
  return { text, key, hint: hint.trim() };
}

/** `Ctrl+O` → the key and the modifier it needs, or null for a hint that is not one */
export function parseAccelerator(hint: string): { key: string; shift: boolean } | null {
  const m = /^Ctrl\+(Shift\+)?(.+)$/i.exec(hint);
  if (!m) return null;
  return { key: m[2].length === 1 ? m[2].toLowerCase() : m[2], shift: !!m[1] };
}

/** as an options object: Node's EventTarget will not remove a listener added with a bare `true` */
const CAPTURE = { capture: true } as const;

const isItem = (e: WindowMenuEntry): e is WindowMenuItem => !e.separator;

/** the label's text with its mnemonic letter underlined */
function labelNodes(label: string): Node[] {
  const [head] = label.split("\t");
  const out: Node[] = [];
  let run = "";
  let marked = false;
  for (let i = 0; i < head.length; i++) {
    if (head[i] === "&" && i + 1 < head.length) {
      i++;
      if (head[i] !== "&" && !marked) {
        if (run) out.push(document.createTextNode(run));
        run = "";
        const u = document.createElement("u");
        u.textContent = head[i];
        out.push(u);
        marked = true;
        continue;
      }
    }
    run += head[i];
  }
  if (run) out.push(document.createTextNode(run));
  return out;
}

export function attachWindowBar(frame: HTMLElement, menus: readonly WindowMenu[], opts: WindowBarOptions): WindowBar {
  const bar = document.createElement("div");
  bar.className = "wbar";
  bar.setAttribute("role", "menubar");
  frame.classList.add("wbar-frame");
  frame.prepend(bar);

  const items = new Map<string, { entry: WindowMenuItem; el: HTMLElement }>();
  const titles: HTMLElement[] = [];
  const drops: HTMLElement[] = [];
  const mnemonics: (string | null)[] = [];
  /** the open menu, -1 for none; `hot` the title lit in menu mode with none open */
  let open = -1;
  let hot = -1;
  let focusItem = -1;

  menus.forEach((menu, m) => {
    const wrap = document.createElement("div");
    wrap.className = "wbar-menu";
    // divs, not buttons: a page's own button styles (hover, press) are not the window's
    const title = document.createElement("div");
    title.className = "wbar-title";
    title.setAttribute("role", "menuitem");
    title.setAttribute("aria-haspopup", "true");
    title.setAttribute("aria-expanded", "false");
    title.tabIndex = -1;
    title.append(...labelNodes(menu.label));
    mnemonics.push(parseMenuLabel(menu.label).key);
    const drop = document.createElement("div");
    drop.className = "wbar-drop";
    drop.setAttribute("role", "menu");
    drop.hidden = true;
    for (const entry of menu.items) {
      if (!isItem(entry)) {
        const hr = document.createElement("div");
        hr.className = "wbar-sep";
        hr.setAttribute("role", "separator");
        drop.append(hr);
        continue;
      }
      const it = document.createElement("div");
      it.className = "wbar-item";
      it.setAttribute("role", "menuitemcheckbox");
      it.tabIndex = -1;
      it.dataset.id = entry.id;
      const mark = document.createElement("span");
      mark.className = "wbar-check";
      const text = document.createElement("span");
      text.className = "wbar-text";
      text.append(...labelNodes(entry.label));
      const hint = document.createElement("span");
      hint.className = "wbar-hint";
      hint.textContent = parseMenuLabel(entry.label).hint;
      it.append(mark, text, hint);
      it.addEventListener("click", (e) => {
        e.stopPropagation();
        pick(entry.id);
      });
      it.addEventListener("pointerenter", () => {
        focusItem = [...drop.querySelectorAll(".wbar-item")].indexOf(it);
        paintFocus();
      });
      drop.append(it);
      items.set(entry.id, { entry: { ...entry }, el: it });
      paintItem(entry.id);
    }
    title.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (open === m) close();
      else openMenu(m, -1);
    });
    title.addEventListener("pointerenter", () => {
      if (open >= 0 && open !== m) openMenu(m, -1);
    });
    wrap.append(title, drop);
    bar.append(wrap);
    titles.push(title);
    drops.push(drop);
  });

  function paintItem(id: string): void {
    const it = items.get(id);
    if (!it) return;
    it.el.classList.toggle("disabled", !!it.entry.disabled);
    it.el.setAttribute("aria-disabled", String(!!it.entry.disabled));
    it.el.setAttribute("aria-checked", String(!!it.entry.checked));
    (it.el.firstChild as HTMLElement).textContent = it.entry.checked ? "✓" : "";
  }

  const itemsOf = (m: number): HTMLElement[] => [...drops[m].querySelectorAll<HTMLElement>(".wbar-item")];

  function paintFocus(): void {
    titles.forEach((t, i) => t.classList.toggle("hot", i === open || (open < 0 && i === hot)));
    if (open < 0) return;
    itemsOf(open).forEach((el, i) => el.classList.toggle("hot", i === focusItem));
  }

  function openMenu(m: number, first: number): void {
    if (open >= 0) {
      drops[open].hidden = true;
      titles[open].setAttribute("aria-expanded", "false");
    }
    open = m;
    hot = m;
    drops[m].hidden = false;
    titles[m].setAttribute("aria-expanded", "true");
    const list = itemsOf(m);
    focusItem = first === 0 ? list.findIndex((el) => !el.classList.contains("disabled")) : first;
    bar.classList.add("active");
    paintFocus();
  }

  function close(): void {
    if (open >= 0) {
      drops[open].hidden = true;
      titles[open].setAttribute("aria-expanded", "false");
    }
    open = -1;
    hot = -1;
    focusItem = -1;
    bar.classList.remove("active");
    paintFocus();
  }

  function pick(id: string): void {
    const it = items.get(id);
    if (!it || it.entry.disabled) return;
    close();
    opts.onSelect(id);
  }

  /** walk the open menu's items by `d`, over the disabled ones */
  function step(d: number): void {
    const list = itemsOf(open);
    if (!list.length) return;
    let from = focusItem;
    if (from < 0) from = d > 0 ? -1 : 0;
    for (let n = 1; n <= list.length; n++) {
      const i = (((from + d * n) % list.length) + list.length) % list.length;
      if (!list[i].classList.contains("disabled")) {
        focusItem = i;
        break;
      }
    }
    paintFocus();
  }

  const accels = new Map<string, string>();
  if (opts.accelerators) {
    for (const [id, { entry }] of items) {
      const a = parseAccelerator(parseMenuLabel(entry.label).hint);
      if (a) accels.set(`${a.shift ? "S+" : ""}${a.key}`, id);
    }
  }

  /** Alt pressed and released with nothing between: menu mode, as Windows does it */
  let altAlone = false;
  const typing = (e: KeyboardEvent): boolean => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable === true);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (typing(e) || (opts.keys && !opts.keys())) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // the accelerators are the window's, menu bar or none: the EXE's
    // TranslateAccelerator runs whether the bar is attached or not
    if (!visible) {
      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const id = accels.get(`${e.shiftKey ? "S+" : ""}${k}`);
        if (id !== undefined) {
          e.preventDefault();
          e.stopImmediatePropagation();
          pick(id);
        }
      }
      return;
    }
    if (e.key === "Alt") {
      altAlone = true;
      return;
    }
    altAlone = false;
    const inMenu = open >= 0 || hot >= 0;
    if (!inMenu && e.altKey && !e.ctrlKey) {
      const m = mnemonics.indexOf(k);
      if (m >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openMenu(m, 0);
      }
      return;
    }
    if (!inMenu && e.key === "F10") {
      e.preventDefault();
      e.stopImmediatePropagation();
      hot = 0;
      bar.classList.add("active");
      paintFocus();
      return;
    }
    if (!inMenu) {
      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const id = accels.get(`${e.shiftKey ? "S+" : ""}${k}`);
        if (id !== undefined) {
          e.preventDefault();
          e.stopImmediatePropagation();
          pick(id);
        }
      }
      return;
    }
    // menu mode: every key is the bar's
    e.preventDefault();
    e.stopImmediatePropagation();
    const at = open >= 0 ? open : hot;
    if (e.key === "Escape") {
      if (open >= 0) {
        drops[open].hidden = true;
        titles[open].setAttribute("aria-expanded", "false");
        open = -1;
        paintFocus();
      } else close();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const m = (at + (e.key === "ArrowLeft" ? -1 : 1) + menus.length) % menus.length;
      if (open >= 0) openMenu(m, 0);
      else {
        hot = m;
        paintFocus();
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (open < 0) openMenu(at, 0);
      else step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" || e.key === " ") {
      if (open < 0) openMenu(at, 0);
      else {
        const el = itemsOf(open)[focusItem];
        if (el) pick(el.dataset.id!);
      }
    } else if (open >= 0) {
      const el = itemsOf(open).find((el) => {
        const it = items.get(el.dataset.id!)!;
        return parseMenuLabel(it.entry.label).key === k;
      });
      if (el) pick(el.dataset.id!);
    } else {
      const m = mnemonics.indexOf(k);
      if (m >= 0) openMenu(m, 0);
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (!visible || e.key !== "Alt" || !altAlone) return;
    altAlone = false;
    e.preventDefault();
    if (open >= 0 || hot >= 0) close();
    else {
      hot = 0;
      bar.classList.add("active");
      paintFocus();
    }
  };
  const onOutside = (e: PointerEvent): void => {
    if ((open >= 0 || hot >= 0) && !bar.contains(e.target as Node)) close();
  };
  const onBlur = (): void => close();
  addEventListener("keydown", onKeyDown, CAPTURE);
  addEventListener("keyup", onKeyUp, CAPTURE);
  addEventListener("pointerdown", onOutside, CAPTURE);
  addEventListener("blur", onBlur);

  // Fullscreen: the bar lies over the picture's top edge and shows while the
  // pointer is near it (a finger's touch at the top does the same).
  const REVEAL = 0.05;
  const onMove = (e: PointerEvent): void => {
    if (!frame.closest(".fs")) return bar.classList.remove("reveal");
    const r = frame.getBoundingClientRect();
    const near = e.clientY - r.top < Math.max(bar.offsetHeight, r.height * REVEAL);
    bar.classList.toggle("reveal", near || bar.classList.contains("active"));
  };
  addEventListener("pointermove", onMove, CAPTURE);
  addEventListener("pointerdown", onMove, CAPTURE);

  // the frame's width over the 512-pixel window the bar was drawn for, kept in
  // `--wbar-s` for window-bar.css; held between 1 and 2 so it stays readable on a
  // phone and does not tower over a big screen
  const scale = new ResizeObserver(() => {
    const s = Math.min(2, Math.max(1, frame.clientWidth / 512));
    frame.style.setProperty("--wbar-s", s.toFixed(3));
  });
  scale.observe(frame);

  let visible = !opts.hidden;
  bar.hidden = !visible;
  frame.classList.toggle("wbar-on", visible);

  return {
    el: bar,
    show() {
      visible = true;
      bar.hidden = false;
      frame.classList.add("wbar-on");
    },
    hide() {
      close();
      visible = false;
      bar.hidden = true;
      frame.classList.remove("wbar-on");
    },
    get visible() {
      return visible;
    },
    get active() {
      return open >= 0 || hot >= 0;
    },
    check(id, on) {
      const it = items.get(id);
      if (!it) return;
      it.entry.checked = on;
      paintItem(id);
    },
    enable(id, on) {
      const it = items.get(id);
      if (!it) return;
      it.entry.disabled = !on;
      paintItem(id);
    },
    close,
    destroy() {
      close();
      scale.disconnect();
      removeEventListener("keydown", onKeyDown, CAPTURE);
      removeEventListener("keyup", onKeyUp, CAPTURE);
      removeEventListener("pointerdown", onOutside, CAPTURE);
      removeEventListener("pointermove", onMove, CAPTURE);
      removeEventListener("pointerdown", onMove, CAPTURE);
      removeEventListener("blur", onBlur);
      bar.remove();
      frame.classList.remove("wbar-frame", "wbar-on");
    },
  };
}
