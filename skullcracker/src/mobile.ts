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
 * Importing this also puts `mobile` on `<html>`, which is what both pages'
 * landscape rules hang on: a phone turned on its side gets the picture and
 * nothing else, and CSS alone answers every rotation after that.
 */
export function isMobileBrowser(): boolean {
  const hints = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (hints?.mobile) return true;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

export const MOBILE = isMobileBrowser();
document.documentElement.classList.toggle("mobile", MOBILE);
