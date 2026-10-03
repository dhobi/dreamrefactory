/**
 * A page of this site stood up in node for a test: its real HTML parsed by
 * linkedom, and the few browser globals a page module reaches for at import
 * stood in for — `window` as an EventTarget, a storage that can be emptied,
 * `requestAnimationFrame` run by hand.
 *
 * Not a suite (it is outside `tests/auto/`); the page suites there import it.
 * Each call is a fresh page, and `vi.unstubAllGlobals()` takes it down.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { parseHTML } from "linkedom";

export interface TestPage {
  document: Document;
  /** linkedom's own window, for its Event class */
  dom: ReturnType<typeof parseHTML>;
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  /** an event on the window (`keydown`, `resize` …), with its fields */
  fire: (type: string, props?: Record<string, unknown>) => Event;
  /** an event on an element of the page */
  on: (target: Element, type: string, props?: Record<string, unknown>) => Event;
  click: (id: string) => void;
  /** run the frames the page has asked for */
  frame: () => void;
  storage: Map<string, string>;
}

/** `html` is relative to taoot/ — "captions/index.html" */
export function openDom(html: string, opts: { storage?: Record<string, string>; search?: string } = {}): TestPage {
  const dom = parseHTML(readFileSync(join(import.meta.dirname, "..", html), "utf8"));
  const { document } = dom;
  const win = new EventTarget();
  const frames: FrameRequestCallback[] = [];
  const storage = new Map(Object.entries(opts.storage ?? {}));
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
  vi.stubGlobal("removeEventListener", win.removeEventListener.bind(win));
  vi.stubGlobal("dispatchEvent", win.dispatchEvent.bind(win));
  vi.stubGlobal("location", { search: opts.search ?? "", href: `http://localhost/${opts.search ?? ""}`, pathname: "/" });
  vi.stubGlobal("navigator", { maxTouchPoints: 0, language: "en", languages: ["en"] });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("MutationObserver", dom.MutationObserver ?? class { observe() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  });
  const assign = <E extends object>(e: E, props: Record<string, unknown>): E => {
    for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
    return e;
  };
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as unknown as T;
  return {
    document: document as unknown as Document,
    dom,
    el,
    fire: (type, props = {}) => {
      const e = assign(new Event(type, { cancelable: true }), { key: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...props });
      win.dispatchEvent(e);
      return e;
    },
    on: (target, type, props = {}) => {
      const e = assign(new dom.Event(type, { bubbles: true, cancelable: true }), { key: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...props });
      target.dispatchEvent(e);
      return e as unknown as Event;
    },
    click: (id) => void el(id).dispatchEvent(new dom.Event("click", { bubbles: true })),
    frame: () => frames.splice(0).forEach((cb) => cb(0)),
    storage,
  };
}
