/**
 * Whether this is a MOBILE BROWSER — a phone or a tablet, not merely a machine
 * with fingers.
 *
 * Fingers alone are not enough: a laptop with a touchscreen, or a Windows
 * desktop whose driver advertises touch points, reports `maxTouchPoints > 0`
 * and has a keyboard right there.
 *
 * `userAgentData.mobile` where the browser has it (Chromium), and the user agent
 * string where it has not. iPadOS is the one that lies: since 13 it asks for
 * the desktop site as `Macintosh`, and the touch points are what give it away —
 * no Mac has any.
 *
 * Importing this also puts `mobile` on `<html>`, for a page's own rules that
 * differ on a phone. A phone turned on its side is not one of them any more: it
 * goes into fullscreen, by the button's own route (`landscape` in
 * {@link file://./fullscreen.ts}), so every game takes it and the picture options
 * that key off `.fs` (stretch, TH mode) come with it.
 *
 * Lifted out of Skull Cracker, the first page to need it, when the other four
 * took the landscape rule too.
 */
export function isMobileBrowser(): boolean {
  const hints = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (hints?.mobile) return true;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

// guarded, because the engine's node tests import fullscreen.ts, and this with it
export const MOBILE = typeof navigator !== "undefined" && isMobileBrowser();
if (typeof document !== "undefined") document.documentElement.classList.toggle("mobile", MOBILE);
