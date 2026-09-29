/**
 * A game window's dialog box, drawn on the game's own frame — the menu bar's
 * (window-bar.ts) companion.
 *
 * The games' dialogs were Win32 dialog templates (`tools/rtdialog.ts` reads them
 * out of an executable): a caption and a set of buttons, edit fields and static
 * texts at positions in dialog units. This draws such a template as it was laid
 * out — every control where the template put it — centred on the frame that
 * holds the canvas, and scaled with it as the bar is (`--wbar-s`). It is modal
 * the way DialogBox was: a layer over the whole frame takes the pointer, and
 * the page should give the game no key while {@link windowDialogOpen} says so.
 *
 *   const dlg = openWindowDialog(frameEl, TEMPLATE, { onCommand: (id, dlg) => … });
 *   dlg.text(104); dlg.setText(108, "W"); dlg.close();
 *
 * A button click is `onCommand(id)`, as WM_COMMAND brought it to the dialog's
 * procedure; the dialog stays up until the procedure closes it (EndDialog). The
 * keys are the dialog manager's: Tab and Shift+Tab walk the controls, Enter is
 * the default button (BS_DEFPUSHBUTTON) and Esc is IDCANCEL (2), which a
 * procedure that never handles it lets do nothing.
 *
 * Styles in `window-bar.css`.
 */

/** one control, in the template's dialog units */
export interface WindowControl {
  id: number;
  kind: "button" | "edit" | "static" | "radio" | "check";
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** a button's BS_DEFPUSHBUTTON: Enter presses it */
  default?: boolean;
  /** a static's SS_CENTER */
  center?: boolean;
}


export interface WindowDialogTemplate {
  title: string;
  /** the client area, in dialog units */
  w: number;
  h: number;
  controls: WindowControl[];
}

export interface WindowDialog {
  readonly el: HTMLElement;
  /** an edit field's text (GetDlgItemText) */
  text(id: number): string;
  setText(id: number, text: string): void;
  /** a radio button's or check box's mark (IsDlgButtonChecked) */
  checked(id: number): boolean;
  /** CheckDlgButton: a radio button checked unchecks the dialog's others */
  check(id: number, on: boolean): void;
  /** take it down (EndDialog) */
  close(): void;
}

export interface WindowDialogOptions {
  /** a button pressed (or Enter, or Esc as IDCANCEL = 2) */
  onCommand: (id: number, dialog: WindowDialog) => void;
  /**
   * Pixels per dialog unit, before the frame's scale. A template with no font
   * of its own is in the system font, whose base units make a unit 2 pixels
   * each way (8x16 over 4x8); that is the default.
   */
  unit?: number;
}

/** Win32's IDCANCEL: what Esc sends */
export const IDCANCEL = 2;

let open = 0;
let groups = 0;

/** a dialog is up: the game should hear no key and the menu bar take none */
export function windowDialogOpen(): boolean {
  return open > 0;
}

export function openWindowDialog(frame: HTMLElement, t: WindowDialogTemplate, opts: WindowDialogOptions): WindowDialog {
  const unit = opts.unit ?? 2;
  const u = (n: number): string => `calc(var(--wbar-s, 1) * ${n * unit}px)`;

  const layer = document.createElement("div");
  layer.className = "wdlg-layer";
  const box = document.createElement("div");
  box.className = "wdlg";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.tabIndex = -1;
  const caption = document.createElement("div");
  caption.className = "wdlg-caption";
  caption.textContent = t.title;
  box.setAttribute("aria-label", t.title);
  const client = document.createElement("div");
  client.className = "wdlg-client";
  client.style.width = u(t.w);
  client.style.height = u(t.h);
  box.append(caption, client);
  layer.append(box);

  const edits = new Map<number, HTMLInputElement>();
  const marks = new Map<number, HTMLInputElement>();
  const group = `wdlg${++groups}`;
  const focusable: HTMLElement[] = [];
  let defaultId = -1;
  let closed = false;
  const handle: WindowDialog = {
    el: box,
    text: (id) => edits.get(id)?.value ?? "",
    setText: (id, text) => void (edits.has(id) && (edits.get(id)!.value = text)),
    checked: (id) => marks.get(id)?.checked ?? false,
    check: (id, on) => void (marks.has(id) && (marks.get(id)!.checked = on)),
    close,
  };
  const command = (id: number): void => {
    if (!closed) opts.onCommand(id, handle);
  };

  for (const c of t.controls) {
    let el: HTMLElement;
    if (c.kind === "button") {
      const b = document.createElement("button");
      b.type = "button";
      b.className = c.default ? "wdlg-button wdlg-default" : "wdlg-button";
      b.textContent = c.text;
      b.addEventListener("click", () => command(c.id));
      if (c.default) defaultId = c.id;
      focusable.push(b);
      el = b;
    } else if (c.kind === "edit") {
      const e = document.createElement("input");
      e.type = "text";
      e.className = "wdlg-edit";
      e.value = c.text;
      e.spellcheck = false;
      e.autocomplete = "off";
      edits.set(c.id, e);
      focusable.push(e);
      el = e;
    } else if (c.kind === "radio" || c.kind === "check") {
      // BS_AUTORADIOBUTTON, BS_AUTOCHECKBOX: the dialog's radio buttons are one group
      const label = document.createElement("label");
      label.className = "wdlg-mark";
      const box = document.createElement("input");
      box.type = c.kind === "radio" ? "radio" : "checkbox";
      if (c.kind === "radio") box.name = group;
      box.addEventListener("click", () => command(c.id));
      label.append(box, c.text);
      marks.set(c.id, box);
      focusable.push(box);
      el = label;
    } else {
      el = document.createElement("div");
      el.className = c.center ? "wdlg-static wdlg-center" : "wdlg-static";
      el.textContent = c.text;
    }
    el.dataset.id = String(c.id);
    Object.assign(el.style, { left: u(c.x), top: u(c.y), width: u(c.w), height: u(c.h) });
    client.append(el);
  }

  // the dialog manager's keys, ahead of anyone on the document
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Tab" && focusable.length) {
      const i = focusable.indexOf(document.activeElement as HTMLElement);
      const next = focusable[(i + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length];
      next.focus();
      if (next instanceof HTMLInputElement) next.select();
    } else if (e.key === "Enter") {
      // a button with the focus is the default one while it has it: its own click presses it
      if (document.activeElement instanceof HTMLButtonElement) return;
      if (defaultId >= 0) command(defaultId);
    } else if (e.key === "Escape") {
      command(IDCANCEL);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  layer.addEventListener("keydown", onKey);
  // the pointer stays in the dialog, as DialogBox's modal loop kept it
  for (const type of ["pointerdown", "mousedown", "click", "contextmenu"] as const) layer.addEventListener(type, (e) => e.target === layer && e.preventDefault());

  const before = document.activeElement as HTMLElement | null;
  frame.append(layer);
  open++;
  // WM_INITDIALOG's TRUE: the focus on the first control that takes it, an edit's text selected
  // (after the caller has filled the fields: the dialog manager does it once the procedure returns)
  queueMicrotask(() => {
    if (closed) return;
    const first = focusable[0] ?? box;
    first.focus();
    if (first instanceof HTMLInputElement) first.select();
  });

  function close(): void {
    if (closed) return;
    closed = true;
    open--;
    layer.remove();
    before?.focus?.();
  }
  return handle;
}
