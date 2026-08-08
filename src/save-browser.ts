/**
 * The in-app "Saved Games" modal — the browser stand-in for TI.EXE's native
 * Save As / Open dialogs, backed by the IndexedDB store (`save-store.ts`).
 *
 * The engine's `savegame` / `opengame` builtins block on the host hooks
 * ({@link GameSession.onSaveGame} / {@link GameSession.onLoadGame}); this module
 * satisfies them by opening one modal parameterised by mode:
 *
 *  - {@link browseForLoad} — list saves, resolve the chosen file's bytes (or null
 *    if the player closes without picking one).
 *  - {@link browseForSave} — given the snapshot bytes, offer a name and store the
 *    file; resolves when the player is done (whether they saved or not).
 *
 * Both modes share the list, so a save flow can also download/delete existing
 * saves, and either mode can import (upload) a `.ti` from disk. The markup +
 * styles live in `index.html` (`#saveModal`); this module drives them.
 */

import { readSaveFile } from "./df/savegame";
import {
  SaveEntry,
  deleteSave,
  displayName,
  getSave,
  listSaves,
  putSave,
} from "./save-store";

/** Optional host callbacks (logging into the on-screen script log). */
export interface BrowserDeps {
  log?: (line: string) => void;
}

type Mode = "load" | "save";

/** Resolver for the currently-open modal; null when closed. */
let active: ((value: unknown) => void) | null = null;

interface Els {
  modal: HTMLDivElement;
  title: HTMLSpanElement;
  list: HTMLDivElement;
  newRow: HTMLDivElement;
  nameInput: HTMLInputElement;
  confirmBtn: HTMLButtonElement;
  uploadBtn: HTMLButtonElement;
  uploadInput: HTMLInputElement;
  closeBtn: HTMLButtonElement;
}
let els: Els | null = null;

function elements(): Els {
  if (els) return els;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  els = {
    modal: get<HTMLDivElement>("saveModal"),
    title: get<HTMLSpanElement>("saveModalTitle"),
    list: get<HTMLDivElement>("saveList"),
    newRow: get<HTMLDivElement>("saveNewRow"),
    nameInput: get<HTMLInputElement>("saveNameInput"),
    confirmBtn: get<HTMLButtonElement>("saveConfirmBtn"),
    uploadBtn: get<HTMLButtonElement>("saveUploadBtn"),
    uploadInput: get<HTMLInputElement>("saveUploadInput"),
    closeBtn: get<HTMLButtonElement>("saveModalClose"),
  };
  // typing/keys inside the modal must not reach the game's global keydown
  // handler (which swallows arrows/letters as movement/toggles); Escape closes.
  els.modal.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close(undefined);
  });
  els.closeBtn.addEventListener("click", () => close(undefined));
  return els;
}

function close(value: unknown): void {
  if (els) els.modal.style.display = "none";
  const resolve = active;
  active = null;
  resolve?.(value);
}

/** Trigger a browser download of a save's bytes as `<name>.ti`. */
function download(entry: SaveEntry): void {
  const blob = new Blob([entry.bytes as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = /\.ti$/i.test(entry.name) ? entry.name : `${entry.name}.ti`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Human label for a folder group. */
const FOLDER_LABELS: Record<string, string> = {
  "": "My Saves",
  "1": "Disk 1",
  "2": "Disk 2",
  ENDGAME1: "Endgame (Disk 1)",
  ENDGAME2: "Endgame (Disk 2)",
};
/** Display order for the folder groups; unknown folders sort after these. */
const FOLDER_ORDER = ["", "1", "2", "ENDGAME1", "ENDGAME2"];

function groupOrder(folder: string): number {
  const i = FOLDER_ORDER.indexOf(folder);
  return i < 0 ? FOLDER_ORDER.length : i;
}

/** Build the grouped list of saves for the given mode. */
async function renderList(mode: Mode, deps: BrowserDeps): Promise<void> {
  const e = elements();
  e.list.textContent = "";
  const saves = await listSaves();
  if (!saves.length) {
    const empty = document.createElement("div");
    empty.className = "save-empty";
    empty.textContent =
      mode === "load"
        ? "No saved games yet — save one from the control panel, or upload a .ti below."
        : "No saved games yet.";
    e.list.appendChild(empty);
    return;
  }

  const folders = [...new Set(saves.map((s) => s.folder))].sort(
    (a, b) => groupOrder(a) - groupOrder(b) || a.localeCompare(b),
  );
  for (const folder of folders) {
    const group = saves
      .filter((s) => s.folder === folder)
      // user saves newest-first; shipped saves by name (their numeric prefix).
      .sort((a, b) => (folder === "" ? b.mtime - a.mtime : a.name.localeCompare(b.name)));

    const header = document.createElement("div");
    header.className = "save-group";
    header.textContent = FOLDER_LABELS[folder] ?? folder;
    e.list.appendChild(header);

    for (const entry of group) {
      const row = document.createElement("div");
      row.className = "save-row";

      const name = document.createElement("button");
      name.className = "save-name";
      name.textContent = entry.name;
      name.title = mode === "load" ? "Load this game" : "Use this name";
      name.addEventListener("click", () => {
        if (mode === "load") {
          close(entry.bytes);
        } else {
          e.nameInput.value = entry.name;
          e.nameInput.focus();
        }
      });
      row.appendChild(name);

      const dl = document.createElement("button");
      dl.className = "save-icon";
      dl.textContent = "⬇";
      dl.title = "Download .ti";
      dl.addEventListener("click", () => download(entry));
      row.appendChild(dl);

      const del = document.createElement("button");
      del.className = "save-icon";
      del.textContent = "🗑";
      del.title = "Delete";
      del.addEventListener("click", async () => {
        if (!confirm(`Delete "${entry.name}"?`)) return;
        await deleteSave(entry.path);
        deps.log?.(`deleted save "${entry.name}"`);
        await renderList(mode, deps);
      });
      row.appendChild(del);

      e.list.appendChild(row);
    }
  }
}

/** Normalise a user-entered save name into a store path (root folder). */
function nameToPath(name: string): { path: string; clean: string } {
  // keep it filesystem-friendly and confined to the root folder.
  const clean = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\.ti$/i, "").slice(0, 60) || "save";
  return { path: `${clean}.ti`, clean };
}

/** Wire the upload input for the current render (idempotent per open). */
function wireUpload(mode: Mode, deps: BrowserDeps): void {
  const e = elements();
  e.uploadBtn.onclick = () => e.uploadInput.click();
  e.uploadInput.onchange = async () => {
    const file = e.uploadInput.files?.[0];
    e.uploadInput.value = ""; // allow re-picking the same file later
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      readSaveFile(bytes); // reject anything that isn't a .ti container
    } catch {
      deps.log?.(`upload: "${file.name}" is not a valid .ti save`);
      alert(`"${file.name}" is not a valid Titanic save file.`);
      return;
    }
    const { path, clean } = nameToPath(displayName(file.name));
    await putSave({ path, folder: "", name: clean, bytes, builtin: false, mtime: Date.now() });
    deps.log?.(`imported save "${clean}"`);
    await renderList(mode, deps);
  };
}

/** Open the modal in the given mode; resolves via {@link close}. */
function open<T>(mode: Mode, deps: BrowserDeps): Promise<T> {
  const e = elements();
  e.title.textContent = mode === "load" ? "Load Game" : "Save Game";
  e.newRow.style.display = mode === "save" ? "flex" : "none";
  e.modal.style.display = "flex";
  wireUpload(mode, deps);
  void renderList(mode, deps);
  return new Promise<T>((resolve) => {
    active = resolve as (v: unknown) => void;
  });
}

/**
 * Load flow: show the saved games and resolve the chosen file's bytes, or null
 * if the player closes the modal without picking one.
 */
export function browseForLoad(deps: BrowserDeps = {}): Promise<Uint8Array | null> {
  return open<Uint8Array | undefined>("load", deps).then((v) => v ?? null);
}

/**
 * Save flow: store `bytes` under a player-chosen name (root folder, overwriting
 * a same-named save after confirmation). Resolves when the modal closes,
 * whether or not a save was written — the caller (the CTL lever) doesn't branch
 * on it.
 */
export async function browseForSave(
  bytes: Uint8Array,
  defaultName: string,
  deps: BrowserDeps = {},
): Promise<void> {
  const e = elements();
  const done = open<void>("save", deps);
  e.nameInput.value = defaultName;
  e.confirmBtn.onclick = async () => {
    const { path, clean } = nameToPath(e.nameInput.value);
    const existing = await getSave(path);
    if (existing && !confirm(`Overwrite "${clean}"?`)) return;
    await putSave({ path, folder: "", name: clean, bytes, builtin: false, mtime: Date.now() });
    deps.log?.(`game saved as "${clean}"`);
    close(undefined);
  };
  // Enter in the name field confirms the save.
  e.nameInput.onkeydown = (ev) => {
    if (ev.key === "Enter") e.confirmBtn.click();
  };
  // focus after the modal is shown so the caret lands in the field
  setTimeout(() => {
    e.nameInput.focus();
    e.nameInput.select();
  }, 0);
  await done;
}
