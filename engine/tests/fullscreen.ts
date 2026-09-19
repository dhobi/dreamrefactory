/**
 * The Fullscreen button, and the browser it was broken on.
 *
 *   npx vitest run engine/tests/fullscreen.ts
 *
 * Four pages carried the same twelve lines and all four were dead on an iPhone,
 * which is the browser nobody here can run: `Element.requestFullscreen` does not
 * exist on it, so `stage.requestFullscreen()` threw on the CALL and the
 * `.catch()` chained to it never ran — no log line, no fallback, and an uncaught
 * TypeError in a console no player opens. That failure is invisible to a type
 * checker (the DOM lib says the method is there) and invisible to a desktop, so
 * the only thing that can hold the fix in place is a test that takes the method
 * away.
 *
 * Which linkedom does for free: it implements no fullscreen at all, so the DOM
 * these tests run against IS the iPhone's for this purpose. The other three
 * cases — a browser that grants it, one that refuses, and the way back out — are
 * stubbed onto the same document.
 */
import { test, expect, vi } from "vitest";
import { parseHTML } from "linkedom";
import { EXIT_LABEL, installFullscreen } from "@dreamfactory/engine/web/fullscreen";

/**
 * A page shaped like the four real ones: a stage with the picture in it, and the
 * button under it rather than inside it — which is the whole reason the module
 * has to hang an exit of its own inside the stage.
 */
function page(): { doc: Document; stage: HTMLElement; btn: HTMLElement } {
  const { document, Event } = parseHTML(
    `<html><body>
       <div id="stage"><canvas id="screen"></canvas></div>
       <div id="under"><button id="fsBtn">⛶ Fullscreen</button></div>
     </body></html>`,
  );
  // the module reads these off the globals, the way a page does
  (globalThis as Record<string, unknown>).document = document;
  (globalThis as Record<string, unknown>).Event = Event;
  return {
    doc: document as unknown as Document,
    stage: document.getElementById("stage") as unknown as HTMLElement,
    btn: document.getElementById("fsBtn") as unknown as HTMLElement,
  };
}

/** what the UA does on the real route, which is all this module watches for */
function grantFullscreen(doc: Document, el: HTMLElement | null): void {
  Object.defineProperty(doc, "fullscreenElement", { value: el, configurable: true });
  doc.dispatchEvent(new (globalThis as unknown as { Event: typeof Event }).Event("fullscreenchange"));
}

test("an iPhone has no element fullscreen, so the page fills itself", () => {
  const { doc, stage, btn } = page();
  // the premise: this is the browser the four copies were broken on
  expect((stage as unknown as { requestFullscreen?: unknown }).requestFullscreen).toBeUndefined();

  installFullscreen(btn, stage);
  expect(stage.classList.contains("fs")).toBe(false);

  btn.click();
  expect(stage.classList.contains("fs")).toBe(true);
  expect(doc.body.classList.contains("fs-faux")).toBe(true);
  expect(btn.textContent).toBe(EXIT_LABEL);
});

test("the way out is inside the stage, because the button is under it", () => {
  const { doc, stage, btn } = page();
  installFullscreen(btn, stage);

  // hung on the stage at install time, so the overlay can never cover it
  const chip = stage.querySelector(".fsexit") as HTMLElement;
  expect(chip).not.toBeNull();
  expect(chip.getAttribute("aria-label")).toBe(EXIT_LABEL);

  btn.click();
  chip.click();
  expect(stage.classList.contains("fs")).toBe(false);
  expect(doc.body.classList.contains("fs-faux")).toBe(false);
  expect(btn.textContent).toBe("⛶ Fullscreen");
});

test("a translated label is given back, not overwritten with English", () => {
  const { stage, btn } = page();
  btn.textContent = "⛶ 全画面";
  installFullscreen(btn, stage);

  btn.click();
  btn.click();
  expect(btn.textContent).toBe("⛶ 全画面");
});

test("a browser that grants it does the filling, and the page holds no state", async () => {
  const { doc, stage, btn } = page();
  const request = vi.fn(() => {
    grantFullscreen(doc, stage);
    return Promise.resolve();
  });
  (stage as unknown as { requestFullscreen: unknown }).requestFullscreen = request;
  Object.defineProperty(doc, "fullscreenEnabled", { value: true, configurable: true });

  installFullscreen(btn, stage);
  btn.click();
  await Promise.resolve();

  expect(request).toHaveBeenCalledOnce();
  // the SAME class letterboxes on both routes — that is the point of the class
  expect(stage.classList.contains("fs")).toBe(true);
  // ...and none of the faux state, because the document underneath is not shown
  expect(doc.body.classList.contains("fs-faux")).toBe(false);

  // the UA's own exit — Escape, or its control — comes back through the event
  grantFullscreen(doc, null);
  expect(stage.classList.contains("fs")).toBe(false);
  expect(btn.textContent).toBe("⛶ Fullscreen");
});

test("a refusal falls back to filling the page rather than dead-ending", async () => {
  const { doc, stage, btn } = page();
  (stage as unknown as { requestFullscreen: unknown }).requestFullscreen = () =>
    Promise.reject(new Error("permissions check failed"));
  Object.defineProperty(doc, "fullscreenEnabled", { value: true, configurable: true });
  const report = vi.fn();

  installFullscreen(btn, stage, { report });
  btn.click();
  await Promise.resolve();
  await Promise.resolve();

  expect(report).toHaveBeenCalledOnce();
  expect(report.mock.calls[0][0]).toContain("permissions check failed");
  expect(doc.body.classList.contains("fs-faux")).toBe(true);
  expect(stage.classList.contains("fs")).toBe(true);
});

test("an iframe that was not granted the feature is not asked twice", () => {
  const { doc, stage, btn } = page();
  const request = vi.fn(() => Promise.resolve());
  (stage as unknown as { requestFullscreen: unknown }).requestFullscreen = request;
  // what a browser says when the document may not have it at all
  Object.defineProperty(doc, "fullscreenEnabled", { value: false, configurable: true });

  installFullscreen(btn, stage);
  btn.click();

  expect(request).not.toHaveBeenCalled();
  expect(doc.body.classList.contains("fs-faux")).toBe(true);
});
