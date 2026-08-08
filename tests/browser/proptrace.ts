/**
 * Witness every write to a prop's owner, in a browser, in the SAME text the
 * headless host emits — so the two can be diffed.
 *
 *   PROPTRACE=light PROPTRACE_FILE=/tmp/br.txt npx tsx tests/browser/playthrough.ts
 *   PROPTRACE=light PROPTRACE_FILE=/tmp/hl.txt npx vitest run --config vitest.playthrough.config.ts
 *   sed -i 's| @frame=.*||' /tmp/br.txt /tmp/hl.txt && diff /tmp/hl.txt /tmp/br.txt
 *
 * The line is formatted by the ENGINE (GameSession.tracePropOwner), not here.
 * That is the whole point: this file and tests/playthrough/play.ts install the
 * same hook and neither decides what a line looks like, so a diff of their output
 * is a diff of the two hosts rather than of two probes.
 *
 * ## What this replaces, and why it had to be replaced
 *
 * tests/browser/iface.ts read `propRuntime.get("light").owner` once per animation
 * frame and recorded the transitions it saw. Over two runs of segments 1-5 it saw
 * `none -> on` and nothing else, and the conclusion drawn from that — printed in
 * its own header — was that the browser never writes `"off"` at all, so a
 * `props.light` divergence had to be something else wearing that field.
 *
 * That was wrong, and a full 27-segment run showed it: the browser does write
 * `"off"`, and once it does the value sticks for the rest of the run. Those two
 * probe runs simply were not runs where it happened. A per-frame sampler can only
 * report values that survive to a frame boundary and can only report a RUN it was
 * present for, so it cannot distinguish "never happens" from "did not happen this
 * time" — and it read as the former. A hook on the write itself cannot miss one,
 * and says which script did it.
 *
 * Not on the dispatch path, either, which the earlier attempt also got wrong: a
 * `sendEvent` wrapper doing sessionStorage + JSON.stringify hung segment 1
 * outright. `propowner` with a value is script bookkeeping — `hideinterface`
 * writes this one — so the hook costs a push per write and nothing per frame.
 */
import type { Page } from "playwright";

/**
 * Arm the probe. Call BEFORE the first goto: it is an init script, so that it
 * covers the re-navigations `loadCheckpoint` makes as well as the first boot. It
 * cannot install the hook immediately — `window.dbg` appears only when main.ts
 * has booted — so it waits for it on the frame loop and attaches once.
 */
export async function installPropTrace(page: Page, props: string[]): Promise<void> {
  await page.addInitScript(`(() => {
  const KEY = "__proptrace";
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || []; } catch (e) { return []; } };
  window.__proptrace = load();
  // persist on the way OUT only. Never per line: sessionStorage on an engine path
  // is what hung segment 1 the last time this question was asked.
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(window.__proptrace)); } catch (e) {} };
  window.addEventListener("pagehide", save);
  window.addEventListener("beforeunload", save);
  const WANT = ${JSON.stringify(props.map((p) => p.toLowerCase()))};
  const attach = () => {
    const s = window.dbg && window.dbg.session;
    if (!s) { requestAnimationFrame(attach); return; }
    for (const n of WANT) s.propTrace.add(n);
    s.onPropTrace = (line) => window.__proptrace.push(line);
  };
  attach();
})()`);
}

export async function readPropTrace(page: Page): Promise<string[]> {
  return (await page.evaluate("window.__proptrace || []").catch(() => [])) as string[];
}
