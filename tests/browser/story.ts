/**
 * A {@link Story} over a real browser page — the same routes, watchable.
 *
 * Everything a segment needs comes from the {@link browserDriver}'s mirror, so
 * the sync getters a route relies on are answered without a round trip at the
 * moment of asking. The trace is produced by the page's OWN snapshotState (handed
 * out through `window.dbg`), not reimplemented here, so a browser beat and a
 * headless beat are the same function over the same state and can be compared
 * field by field.
 */
import type { Page } from "playwright";
import { Navigator } from "../playthrough/nav/navigator";
import type { Story } from "../playthrough/story";
import { browserDriver, type BrowserDriver } from "./driver";

export interface BrowserStory extends Story {
  d: BrowserDriver;
  trace: unknown[];
}

export async function browserStory(
  page: Page,
  opts: { log?(message: string): void } = {},
): Promise<BrowserStory> {
  const d = await browserDriver(page, { log: opts.log });
  const trace: unknown[] = [];

  const snapshot = (beat: string) =>
    page.evaluate(
      (b) => (window as any).dbg.snapshotState((window as any).dbg.session, (window as any).dbg.viewer, b),
      beat,
    );

  /**
   * Let the world stop before sampling it — what the headless `beat` does, and
   * what this one was missing (play.ts: "settle, then record a beat in the trace").
   *
   * A gesture can leave a script suspended well past the point the ROUTE is
   * finished with it, and a beat taken then records a world mid-sentence. Measured
   * at segment 2's steward: `pressSpace` opens the cabin door, `c73.set` c9's
   * mousedown places the steward and suspends on his conversation, and only after
   * it does the handler run its `for count = 1 to 40 forceupdate()` and then
   * `playnewtheme("deckc.trk")`. `nav.talk` returns when the talking stops, which
   * is ~2 s before that — measured `busy: true, quiescent: false, theme
   * "bedsit1.trk"` at the beat, and `deckc.trk` between 1 s and 2 s later. So the
   * browser reported `theme: browser "bedsit1.trk" vs golden "deckc.trk"` and the
   * engine had done nothing wrong; a pumped host simply runs those 40 frames in
   * less time than it takes to ask.
   *
   * The same beat is why segments 25 and 26 read `smstack.trk` against the golden's
   * `sink0.trk`: that is the mission-4 arm of the very same handler, doing
   * `playnewtheme("sink" @ phase @ ".trk")` after the same suspension.
   *
   * `conversing` short-circuits it, exactly as the driver's own settle does: a beat
   * deliberately taken mid-conversation must not wait for something only another
   * gesture can cause. Bounded, and it does not throw — a beat that cannot settle
   * is still worth recording, and the trace comparison is what should say so.
   */
  const settleForBeat = (name: string) =>
    page
      .waitForFunction(
        "(() => { const dbg = window.dbg; return dbg && dbg.viewer && (dbg.viewer.quiescent || dbg.viewer.conversing); })()",
        null,
        { timeout: 120_000 },
      )
      .catch(() => opts.log?.(`beat ${name}: never settled — sampling anyway`));

  return {
    nav: new Navigator(d),
    d,
    trace,
    num: (name) => Number(d.state().globals[name] ?? NaN),
    str: (name) => String(d.state().globals[name] ?? ""),
    owns: (prop) => d.state().props[prop.toLowerCase()]?.owner === "frank",
    deg: (prop) => Number(d.state().props[prop.toLowerCase()]?.deg ?? NaN),
    actorOwner: (name) => String(d.state().actors[name.toLowerCase()] ?? ""),
    beat: async (name) => {
      await settleForBeat(name);
      await d.sync();
      trace.push(await snapshot(name));
      opts.log?.(`beat: ${name}`);
    },
    waitFor: async (until, what) => {
      if (!(await d.waitFor(until, what))) throw new Error(`stuck waiting for ${what}`);
    },
    log: opts.log,
  };
}
