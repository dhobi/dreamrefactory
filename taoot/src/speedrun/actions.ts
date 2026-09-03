/**
 * Titanic's own verbs — the ones that know a room, a prop or a character.
 *
 * The rest of the vocabulary is the engine's ({@link CORE_ACTIONS}): the arrows,
 * the clicks, the holds, the films, the conversations and the run's bookkeeping
 * are the same gestures on any DreamFactory disc, and they moved so that a
 * second port would get a sheet language rather than a copy of one. What stayed
 * is what could not: the coal lever's twenty-one stops, the wireless, the map's
 * jumps, the false smokestack's ladders, the inventory band, and the two verbs
 * that name this game's own structure (`intro`, `mission`).
 *
 * ## The two altitudes
 *
 * Almost everything here is LITERAL: `dial(slider, 7)` turns one control to one
 * setting. A literal sheet costs nothing at runtime — no planning, no hunting,
 * no round trips beyond the gesture itself — and it is deterministic, which is
 * what makes a time comparable to the last time.
 *
 * The exception is `travel`, and it exists to be temporary. It runs the real
 * {@link Navigator} — the same pathfinder the playthrough suite uses — and then
 * PRINTS THE GESTURES IT MADE as sheet lines you can paste back in. That is the
 * bootstrap loop: write `travel(turb)`, run it, take the eight literal lines it
 * emits, replace the `travel` with them, and shave from there. The planner aims
 * for reachable, not shortest, so a `travel` left in a finished sheet is time
 * being given away — the report flags every one for that reason.
 *
 * ## Nothing here reaches past the player
 *
 * The run is human-legal (`docs/…`, and the header of driver.ts). Every verb
 * bottoms out in a Playwright mouse or key event at the canvas. Where a verb
 * needs to know something — where `cards` is, which plaque is bevel 3 — it asks
 * the engine the same question the browser suite asks, through the same
 * `engine/src/web/speedrun/aim.ts` sweep, and never moves the game by writing to it.
 */
import type { VerbSpec } from "@dreamfactory/engine/web/speedrun/sheet";
import { CORE_ACTIONS } from "@dreamfactory/engine/web/speedrun/actions-core";
import { QUIET } from "@dreamfactory/engine/web/speedrun/driver";
import {
  IDLE,
  STANDING,
  aimAtSettled,
  arrow,
  clickThing,
  composeActions,
  condition,
  key,
  loadPoint,
  predicate,
  resolveIn,
  verbsOf,
  type Action,
  type ActionContext,
  type ActionTable,
} from "@dreamfactory/engine/web/speedrun/action";
import { jumpTo, pageButton, jumpableSets } from "./nav/mapjumps";

/* ------------------------------------------------------------------ *
 * The planner escape hatch
 * ------------------------------------------------------------------ */

/** what `travel`/`hunt`/`stand` need, when a host can provide it */
export type PlannerFn = (
  c: ActionContext,
  method: "travel" | "hunt" | "stand",
  target: string,
) => Promise<void>;

let plannerImpl: PlannerFn | null = null;

/**
 * Install the pathfinder. Only the Playwright runner can.
 *
 * `travel`, `hunt` and `stand` run the real {@link Navigator}, which needs the
 * Node-side browser driver — and that parses `.SET` files off disk to plan with.
 * A page has no disk, so these three verbs simply do not exist there, and saying
 * so plainly is better than shipping a half-planner that explores differently.
 *
 * Which is not the loss it sounds like: all three are ESCAPE HATCHES that print
 * the literal gestures they used precisely so a sheet can stop needing them. A
 * sheet that still contains one is a sheet that has not been finished, and the
 * page is where you finish it.
 */
export function setPlanner(fn: PlannerFn | null): void {
  plannerImpl = fn;
}

async function planner(c: ActionContext, method: "travel" | "hunt" | "stand", target: string): Promise<void> {
  if (!plannerImpl) {
    throw new Error(
      `\`${method}\` needs the pathfinder, which only the Playwright runner has. ` +
        `Run this sheet with \`npm run speedrun -w taoot\` to get the literal gestures it would use, ` +
        `then paste those in and the line will work here too.`,
    );
  }
  return plannerImpl(c, method, target);
}
/** the verbs Titanic adds to the engine's — see the header */
export const TITANIC_ACTIONS: ActionTable = {

  closeup: {
    args: [1, 1],
    wait: "none",
    opts: ["ok", "by"],
    sig: "closeUp(memory, by: esc)",
    help: "click a scoring object and close its film — by: ok walks the plaque, by: esc aborts it",
    run: async (c) => {
      const id = c.step.args[0];
      const okAt = (c.step.opts.ok ?? "460,352").split(",").map(Number);
      const before = await c.d.evaluate<number>(
        `Number(window.dbg.session.interp.globals.get("bombpoints") ?? 0)`,
      );
      // Deliberately NOT skipMovie, and this is the whole scoring rule rather
      // than caution: bedcards.mov pays +3 on each of its two action frames —
      // six of the eleven points that arm the bomb — and BEDSIT1 reads
      // actionframe(1) only AFTER spotmovie returns. An ESC before those frames
      // is simply a lower score, and eleven points is exactly what there is, so
      // one lost point is a raid that never comes and a run that waits forever.
      await clickThing(c, id, "taken");

      // by: esc — abort the film instead of walking it off the end.
      //
      // Worth the option because the SCORE does not depend on the film at all:
      // BEDSIT1 0001 adds the points inside the `case` of its mousedown, before
      // `spotmovie` is ever called, so the picture afterwards is just a picture.
      // Measured on `memory`: 2.9 s and ~58 engine frames to press the OK plaque,
      // 0.3 s and 6 frames to ESC it.
      //
      // NOT the default, and `cards` is why: its +3/+3 are paid for PASSING
      // THROUGH the frames named in the movie's header, which an abort skips. Any
      // object whose film you have to watch has to keep by: ok.
      //
      // The wait is the whole technique. A close-up is fetched over HTTP, so for
      // a moment after the click there is no film yet and an ESC sent then lands
      // on nothing — see the `playing` condition.
      if ((c.step.opts.by ?? "ok") === "esc") {
        await c.d.hold(predicate("playing"), `${id}'s close-up to start`, c.budget);
        const n = await c.d.hammer("Escape", {
          until: predicate("nomovie"),
          arm: predicate("playing"),
          gap: c.gap,
          budget: c.budget,
          what: `${id}'s close-up to be let go`,
        });
        const after = await c.d.evaluate<number>(
          `Number(window.dbg.session.interp.globals.get("bombpoints") ?? 0)`,
        );
        if (after === before) throw new Error(`${id} scored nothing — the raid needs all eleven points`);
        c.say(`${after} points, ${n} ESC`);
        return;
      }

      for (let ok = 0; ok < 12; ok++) {
        await c.d.hold(
          `(() => { const d = window.dbg; return d.viewer.awaitingInput || !d.session.scriptBusy; })()`,
          `${id}'s close-up`,
          c.budget,
        );
        // press OK only if OK is THERE — if a region of the parked film actually
        // covers that point. Otherwise 460,352 is a point in the ROOM, and a
        // stray click there once landed on `cards`, setting xxcards with no
        // close-up to score from: one point short at 10 of 11, no raid, no run.
        const onOK = await c.d.evaluate<boolean>(`(() => {
          const rs = window.dbg.viewer.movieRegions || [];
          return rs.some((r) => ${okAt[0]} >= r.x0 && ${okAt[0]} <= r.x1 && ${okAt[1]} >= r.y0 && ${okAt[1]} <= r.y1);
        })()`);
        if (!onOK) break;
        await c.d.clickAt(okAt[0], okAt[1], "taken", c.budget);
      }
      const after = await c.d.evaluate<number>(
        `Number(window.dbg.session.interp.globals.get("bombpoints") ?? 0)`,
      );
      // a click that leaves bombpoints where it was is a click that did not land
      if (after === before) throw new Error(`${id} scored nothing — the raid needs all eleven points`);
      c.say(`${after} points`);
    },
  },
  accost: {
    args: [1, 1],
    wait: "none",
    opts: ["turns", "patience"],
    sig: "accost(penny)",
    help: "click someone until they actually start talking, turning if they are not in reach",
    run: async (c) => {
      // The browser-capable half of `hunt`. The pathfinder is Node-only because
      // it plans over `.SET` files read off disk, but the two things this needs —
      // the engine's own hit test (`aim`) and a turn — both exist in a page, so a
      // route does not have to give up the workbench to accost someone.
      //
      // It exists because a single `click` is genuinely not enough, and the
      // reason is worth stating: clicking a character starts a WALK to them and
      // the puppet only opens once they have been reached, so a click can be
      // taken, be aimed correctly, and still produce no conversation — the run
      // then waits ninety seconds for a line nobody is going to speak. Measured
      // on Penny in the gym, from the very standpoint the planner clicks her
      // from. Turning and trying again is what a player does.
      const who = c.step.args[0];
      const turns = Number(c.step.opts.turns ?? 8);
      const patience = Number(c.step.opts.patience ?? 8000);
      // Somebody talking to you already IS the accost, and checking costs one
      // round trip per turn.
      //
      // Half this game's characters open the conversation themselves. Morrow
      // heads you off on the boat deck the moment you arrive, and a run that
      // walks up and accosts him is a run standing inside an open puppet: the
      // engine is busy for as long as the conversation lasts, so the hit test
      // finds nothing clickable, and the turn this verb makes to look again
      // waits on an engine that will not be idle until the thing it is waiting
      // to cause has finished. Measured: 2m08s on one `accost(morrow)`, all of
      // it a single ArrowRight's hold, and the readout said "talking to
      // morrow1.pup" the whole time.
      //
      // WHO it is is reported rather than checked. The puppet's name is the
      // file's ("morrow1.pup") and the sheet's is the hotspot's, and inventing a
      // match between the two would turn a working line into a broken one for
      // every character whose two names differ. If the wrong person opened the
      // conversation, the bevel numbers on the next line will not be there and
      // `say` will say so — with this note directly above it in the report.
      const opened = `(() => {
        const v = window.dbg.viewer;
        return v && v.conversing ? String(v.conversingWith || "someone") : "";
      })()`;
      for (let turn = 0; turn <= turns; turn++) {
        const already = await c.d.evaluate<string>(opened);
        if (already) {
          c.say(turn ? `${turn} turns, then ${already} spoke first` : `already talking to ${already}`);
          return;
        }
        // Wait for the engine to be able to TAKE the click before making it: one
        // sent while the camera is still animating is filed rather than
        // dispatched, and a filed click is one `flushevents()` away from never
        // having happened (see IDLE).
        //
        // ONE press per standpoint, and that is measured rather than assumed.
        // Clicking Vlad in the boiler room takes 5.2 s to produce a conversation,
        // which reads exactly like a lost click — but pressing three times took
        // 10.7 s and still opened at the same moment. The delay is his: the click
        // lands, he stops shovelling and crosses the room, and the puppet opens
        // when he arrives. `patience` is what covers that walk, not a retry.
        await c.d.tryHold(IDLE, Math.min(patience, 8000));
        // ...and let them stand still, or the aim is a pixel they have already
        // turned away from — see STANDING (#338)
        const at = await aimAtSettled(c, who);
        if (at) {
          // wait: none, deliberately. A click that OPENS a conversation is not
          // consumed in the ordinary way: the puppet suspends holding the
          // engine, and the press can sit in `GameSession.events` for as long
          // as the conversation lasts. Waiting for the queue to drain therefore
          // waits for the very thing the click just caused to finish — measured
          // in the page as "stuck waiting for click 242,106 to settle" while the
          // readout said, in the same breath, "talking to penny1.pup".
          //
          // The conversation opening IS the acknowledgement, so wait for that.
          await c.d.clickAt(at.x, at.y, "none", c.budget);
          if (await c.d.tryHold(predicate("talking"), patience)) {
            c.say(turn ? `${turn} turns` : "first look");
            return;
          }
        }
        if (turn === turns) break;
        await arrow("ArrowRight")({ ...c, wait: "none" });
      }
      throw new Error(`turned the whole ring and ${who} never started talking`);
    },
  },
  climbstack: {
    args: [0, 0],
    wait: "none",
    sig: "climbStack()",
    help: "climb the false smokestack, solving whichever maze was drawn",
    run: async (c) => {
      // The one place the sheet cannot be literal, because the course is drawn
      // rather than authored: ENGINE.SET's keydown at View120 does
      // `mazenumber = random(4)`, and one of the sixteen (maze, entry) pairs is a
      // DEAD END — maze 4 into scene39 has both its neighbouring gaps shut on the
      // first floor, so a run that walked in there could only go back down.
      //
      // So the maze is read and solved. `planStack` breadth-firsts over
      // (level, position) using SMSTACK2's own `setupblocks()` table, and
      // `pickEntry` tries all four of smstack1's ways up and takes one that
      // solves — which is the choice smstack1 exists to offer.
      const { pickEntry } = await import("./nav/smokestack");
      const maze = await c.d.evaluate<number>(
        `Number(window.dbg.session.interp.globals.get("mazenumber") ?? 0)`,
      );
      const chosen = pickEntry(maze);
      if (!chosen) throw new Error(`maze ${maze} has no way up from any of the four entries`);
      c.say(`maze ${maze}, in at ${chosen.entry.scene}, ${chosen.plan.length} moves`);

      const sceneNow = `String(window.dbg.viewer.scene.sceneName || "").toLowerCase()`;
      const setNow = `String(window.dbg.session.currentSetFile || "").toLowerCase().replace(/\\.set$/, "")`;

      // in at the entry smstack1 offers
      await ACTIONS.face.run({ ...c, step: { ...c.step, args: [chosen.entry.stand], opts: {} } });
      await c.d.key("ArrowUp", "none", c.budget);
      await c.d.hold(`(${setNow}) === "smstack2"`, "the first floor of the stack", c.budget);

      for (const m of chosen.plan) {
        await ACTIONS.face.run({ ...c, step: { ...c.step, args: [m.view], opts: {} } });
        await c.d.key("ArrowUp", "none", c.budget);
        const arrived =
          m.to === "smstack3"
            ? `(${setNow}) === "smstack3"`
            : `(${setNow}) === "smstack2" && (${sceneNow}) === ${JSON.stringify(m.to)} ` +
              `&& Number(window.dbg.session.interp.globals.get("stacklevel")) === ${m.level}`;
        await c.d.hold(arrived, `${m.kind} to ${m.to} (level ${m.level})`, c.budget);
      }
      // The top is a CHANGESET, and the set name flips before the viewer that
      // serves it exists (see the note in `stand`). Returning on the name alone
      // hands the next line the departing room to read, so the climb is not over
      // until the arriving one is quiet.
      await c.d.settle("quiet", "the top of the stack to arrive", c.budget);
      const ended = await c.d.evaluate<string>(
        `String(window.dbg.session.currentSetFile || "") + " " + String(window.dbg.viewer.scene.sceneName || "")`,
      );
      c.say(`up in ${ended}`);
    },
  },

  // -- inventory ------------------------------------------------------------
  take: {
    args: [1, 1],
    wait: "quiet",
    sig: "take(ring)",
    help: "bag → item → OK, the three clicks that put something in your hand",
    run: async (c) => {
      const item = c.step.args[0].toLowerCase();
      const held = () => c.d.evaluate<string>(`String(window.dbg.session.interp.globals.get("handitem") ?? "")`);
      if ((await held()).toLowerCase() === item) return;
      // The band is a two-state thing and that costs a click: house.shp's bag
      // mousedown answers a `darkclosed` bag with activateinterface() and nothing
      // else, so the first click often only turns the lights on. A closed inventory
      // is an EXPECTED answer to it, not a fault — hence the retry.
      for (let i = 0; i < 3; i++) {
        if (await c.d.evaluate<boolean>(`!window.dbg.session.viewShowing && !!window.dbg.session.stageScript`)) break;
        await clickThing(c, "bag", "taken");
        await c.d.tryHold(`!window.dbg.session.viewShowing && !!window.dbg.session.stageScript`, 4000);
      }
      await c.d.settle("quiet", "the inventory", c.budget);
      await clickThing(c, item, "taken");
      if ((await held()).toLowerCase() !== item) {
        throw new Error(`clicked ${item} but "${await held()}" is in hand`);
      }
      await clickThing(c, "ok", "quiet");
    },
  },
  use: {
    args: [2, 3],
    wait: "quiet",
    sig: "use(package, on, vlad)",
    help: "drag the hand item onto something — use light on watch",
    run: async (c) => {
      const [item, ...rest] = c.step.args;
      const target = rest.filter((w) => w.toLowerCase() !== "on")[0];
      if (!target) throw new Error(`use needs something to use it ON`);
      const held = await c.d.evaluate<string>(`String(window.dbg.session.interp.globals.get("handitem") ?? "")`);
      if (held.toLowerCase() !== item.toLowerCase()) {
        await ACTIONS.take.run({ ...c, step: { ...c.step, args: [item] } });
      }
      const from = await c.d.aim("thing", item);
      const to = await c.d.aim("thing", target);
      if (!from) throw new Error(`the ${item} is not on screen to drag`);
      if (!to) throw new Error(`no ${target} to put the ${item} on from here`);
      await c.d.drag(from, to);
      await c.d.settle(c.wait, `${item} on ${target}`, c.budget);
    },
  },

  // -- dials ----------------------------------------------------------------
  dial: {
    args: [2, 2],
    wait: "quiet",
    sig: "dial(valve1, 10)",
    help: "set a named dial or lever to a number — dial boiler 6, dial coal 3",
    run: async (c) => {
      const [name, value] = c.step.args;
      const want = Number(value);
      if (!Number.isFinite(want)) throw new Error(`dial needs a number, got "${value}"`);
      const { TURBINE_DIALS, PATTY_DIALS, COAL_LEVER, turnDial, setLever } = await import("./nav/dials");
      const key = name.toLowerCase();
      // the coal lever slides and the rest turn, which is two different swings —
      // dials.ts keeps them apart and so must the lookup
      // the coal lever SLIDES and the rest turn, which is two different swings —
      // dials.ts keeps them apart and so must the lookup. It answers to both its
      // prop name (`slider`, which is what the goldens and TURBINE.SHP call it)
      // and to `coal`, which is the global it drives and what a route calls it.
      const isLever = key === "coal" || key === COAL_LEVER.prop;
      const control = TURBINE_DIALS[key] ?? PATTY_DIALS[key] ?? (isLever ? COAL_LEVER : undefined);
      if (!control) {
        const known = [...Object.keys(TURBINE_DIALS), ...Object.keys(PATTY_DIALS), "coal"];
        throw new Error(`no dial called "${name}" (there is ${known.join(", ")})`);
      }
      // dials.ts is written against a NavDriver, and the four members it actually
      // touches are the four below — so it gets those over the speedrun driver
      // rather than a second copy of the swing arithmetic. That arithmetic is the
      // part worth not duplicating: it knows the arc radius, the stop spacing and
      // which way round a dial reads, and a speedrun that got any of it wrong
      // would take an extra lap of the dial and call it a route problem.
      const adapter = {
        propDeg: (p: string) => degCache[p.toLowerCase()] ?? NaN,
        flow: () => flowCache,
        dragProp: async (p: string, next: (start: { x: number; y: number }) => { x: number; y: number } | null) => {
          const at = await c.d.aim("thing", p);
          if (!at) return false;
          // A cache REFILLED BETWEEN FRAMES, which is the whole trick. dials.ts
          // steers by reading the deg back after every move, and it asks for that
          // reading synchronously — it was written against the headless driver,
          // where a prop is a field on the live session and there is nothing to
          // wait for. Out here it is a round trip into the page, so the read has
          // to be done just BEFORE the question is asked rather than in answer to
          // it. Refilling here, right after the driver has waited out the frame
          // that consumed the last move, is that moment: `next` then reads a deg
          // the engine has actually settled on.
          //
          // Filling it only once before the press is what the first version did,
          // and it steers a dial by a photograph: the number never changes, so
          // the swing never turns round and never stops. valve3 asked for 7 wound
          // 2->19, 19->0, 0->19 across its three grabs and was called stuck.
          await c.d.dragProp(at, async () => (await refresh(), next(at)), c.budget);
          await refresh();
          return true;
        },
        log: (m: string) => c.say(m),
      };
      let degCache: Record<string, number> = {};
      let flowCache: Record<string, string | number> = {};
      const refresh = async () => {
        const s = await c.d.evaluate<{ degs: Record<string, number>; flow: Record<string, string | number> }>(`(() => {
          const s = window.dbg.session, degs = {};
          for (const shop of s.propRuntime.shops.keys())
            for (const g of s.propRuntime.shops.get(shop).shp.groups) {
              const p = s.propRuntime.get(g.name);
              if (p) degs[g.name.toLowerCase()] = Number(p.deg) || 0;
            }
          return { degs, flow: Object.fromEntries(s.interp.globals) };
        })()`);
        degCache = s.degs;
        flowCache = s.flow;
      };
      await refresh();
      const result = isLever
        ? await setLever(adapter as never, COAL_LEVER, want)
        : await turnDial(adapter as never, control as never, want);
      if (!result.ok) throw new Error(result.reason ?? `${name} would not reach ${want}`);
      c.say(`${name} = ${want}`);
      await c.d.settle(c.wait, `the ${name} dial`, c.budget);
    },
  },

  /**
   * Switch the wireless apparatus to transmit, and open the morse key.
   *
   * One verb rather than a run of lines, because the set cannot be worked by
   * lines. Sending Mr. Thayer's telegram costs four gestures in a fixed order and
   * the last of them is a loop:
   *
   *   - the BREAKER and the SENDER are one-move drags — `while stilldown()` loops
   *     that read the cursor's X (resp. Y) absolutely and snap on release, like
   *     the coal lever. Those two a `drag(from, to)` verb could just about say.
   *   - the TUNER cannot be said at all. It is the same swing-about-a-pivot
   *     ratchet as the turbine dials, two of the needle's 14..200 per step, and
   *     `openshop()` parks it at 200 while the transmit band is 34..40 — so it is
   *     roughly eighty swings, each aimed from the needle read back after the
   *     last one, and the drag has to be RELEASED in band because the held loop
   *     answers `tuned()` on its final iteration and that is what sets
   *     `propowner("tunerknob")`.
   *
   * And the order is not tidiness: `tuned()` branches on the breaker and the
   * sender before it looks at the band, so tuning first tunes to nothing, and the
   * tapper flat's `openflat()` only runs `setuptx()` if all three owners already
   * hold when it opens. Open the morse key first and it is a key that does
   * nothing and says nothing about why.
   *
   * All of that is nav/wireless.ts, which the playthrough suite drives too — so
   * this verb is an adapter and not a second copy, exactly as `dial` is over
   * nav/dials.ts. The cache underneath it is the same trick and for the same
   * reason: the module was written against the headless driver, where a prop is a
   * field on the live session, and out here every reading is a round trip. It is
   * refilled immediately before `next` is asked, which is the moment the driver
   * has just waited out the frame that consumed the last move.
   *
   * Every form starts at the desk (`wireless 1`). `wireless(tx)` ends on the
   * morse key, so the errand reads:
   *
   *     click(wireless); wireless(tx); key(e); click(ok); click(ok)
   *
   * and the per-control forms — `wireless(breaker, tx)`, `wireless(sender, on)`,
   * `wireless(tuner, tx)` — each open their close-up, work the one control and
   * come back to the desk, so the same errand spelled out is:
   *
   *     click(wireless)
   *     wireless(breaker, tx); wireless(sender, on); wireless(tuner, tx)
   *     click(tapper); key(e); click(ok); click(ok)
   */
  wireless: {
    args: [1, 2],
    wait: "quiet",
    sig: "wireless(tx)",
    help:
      "work the wireless set from the apparatus desk — wireless(tx) does the lot, or one " +
      "control at a time: wireless(breaker, tx|rx|off), wireless(sender, on|off), " +
      "wireless(tuner, tx|rx1|rx2|rx3)",
    run: async (c) => {
      const what = c.step.args[0].toLowerCase();
      const value = (c.step.args[1] ?? "").toLowerCase();
      const w = await import("./nav/wireless");
      const { switchToTransmit, setBreaker, setSender, tuneTo, openPanel, closePanel } = w;
      const { WIRELESS_MAIN, TX_BAND, RX_BANDS } = w;
      const at = await c.d.evaluate<string | null>(
        `(() => { const s = window.dbg.session; return !s.viewShowing && s.currentFlat ? String(s.currentFlat) : null; })()`,
      );
      if (at !== WIRELESS_MAIN) {
        throw new Error(
          `the wireless set is worked from the "${WIRELESS_MAIN}" flat and we are ` +
            `${at ? `in "${at}"` : "in the room"} — click(wireless) opens it`,
        );
      }
      let props: Record<string, { owner: string; value: number }> = {};
      let flat: string | null = null;
      const refresh = async (): Promise<void> => {
        const got = await c.d.evaluate<{
          props: Record<string, { owner: string; value: number }>;
          flat: string | null;
        }>(`(() => {
          const s = window.dbg.session, props = {};
          for (const shop of s.propRuntime.shops.keys())
            for (const g of s.propRuntime.shops.get(shop).shp.groups) {
              const p = s.propRuntime.get(g.name);
              if (p) props[g.name.toLowerCase()] = { owner: String(p.owner ?? ""), value: Number(p.value) };
            }
          return { props, flat: !s.viewShowing && s.currentFlat ? String(s.currentFlat) : null };
        })()`);
        props = got.props;
        flat = got.flat;
      };
      const adapter = {
        inFlat: () => flat,
        propOwner: (n: string) => props[n.toLowerCase()]?.owner ?? "",
        propValue: (n: string) => props[n.toLowerCase()]?.value ?? NaN,
        clickThing: async (n: string) => {
          const spot = await c.d.aim("thing", n);
          if (!spot) return false;
          // quiet, because every one of these clicks is a flat change with a fade
          // in it, and the module asks `inFlat()` the instant this returns
          await c.d.clickAt(spot.x, spot.y, "quiet", c.budget);
          await refresh();
          return true;
        },
        dragProp: async (n: string, next: (from: { x: number; y: number }) => { x: number; y: number } | null) => {
          const spot = await c.d.aim("thing", n);
          if (!spot) return false;
          await c.d.dragProp(spot, async () => (await refresh(), next(spot)), c.budget);
          await refresh();
          return true;
        },
      };
      await refresh();

      // The whole errand, which is what a route wants: three controls in the one
      // order that works, then the morse key.
      if (what === "tx") {
        if (value) throw new Error(`wireless(tx) takes no second argument — did you mean wireless(${value}, …)?`);
        const result = await switchToTransmit(adapter);
        if (!result.ok) throw new Error(result.reason ?? "the set would not switch to transmit");
        c.say(`needle ${adapter.propValue("tunerneedle")}, tapper ${adapter.propOwner("tapperdown")}`);
        await c.d.settle(c.wait, "the morse key flat", c.budget);
        return;
      }

      /**
       * One control, opened and put back.
       *
       * The three setters in nav/wireless.ts work the control and nothing else —
       * `switchToTransmit` is what wraps each in its panel. So each of these does
       * the same wrapping, which is what makes them sheet lines: every one starts
       * and ends at the desk, and a sheet can put them in any order it likes and
       * see where the set gets to.
       *
       * Which is the point of having them at all. `wireless(tx)` is the errand
       * and cannot show its working: when the needle will not come to band there
       * is no way to try the tuner twice, or to power the set and stop, or to
       * throw the breaker to rx and read the message stack. These are that.
       */
      const control =
        what === "breaker"
          ? {
              region: "breaker" as const,
              run: () => {
                if (!["tx", "rx", "off"].includes(value)) {
                  throw new Error(`the breaker settles on tx, rx or off — not "${value}"`);
                }
                return setBreaker(adapter, value as "tx" | "rx" | "off");
              },
            }
          : what === "sender"
            ? {
                region: "sender" as const,
                run: () => {
                  if (!["on", "off"].includes(value)) throw new Error(`the sender is on or off — not "${value}"`);
                  return setSender(adapter, value as "on" | "off");
                },
              }
            : what === "tuner"
              ? {
                  region: "tuner" as const,
                  run: () => {
                    // The transmit band, or one of the three receive bands. Which
                    // receive band is tuned decides which message `rx()` spells
                    // out, so they are numbered rather than lumped together.
                    const band =
                      value === "tx"
                        ? TX_BAND
                        : /^rx[123]$/.test(value)
                          ? RX_BANDS[Number(value[2]) - 1]
                          : null;
                    if (!band) {
                      throw new Error(
                        `the tuner takes a band: tx (${TX_BAND.lo}..${TX_BAND.hi}) or ` +
                          RX_BANDS.map((b, i) => `rx${i + 1} (${b.lo}..${b.hi})`).join(", ") +
                          ` — not "${value}"`,
                      );
                    }
                    return tuneTo(adapter, band);
                  },
                }
              : null;
      if (!control) {
        throw new Error(
          `wireless does tx (the lot), or one of breaker, sender, tuner — not "${what}". ` +
            `The amp panel is reachable with click(amp) and drives nothing.`,
        );
      }

      const open = await openPanel(adapter, control.region);
      if (!open.ok) throw new Error(open.reason ?? `the ${control.region} close-up would not open`);
      const set = await control.run();
      if (!set.ok) throw new Error(set.reason ?? `the ${control.region} would not go to "${value}"`);
      const back = await closePanel(adapter);
      if (!back.ok) throw new Error(back.reason ?? `the ${control.region} close-up would not close`);
      c.say(
        what === "tuner"
          ? `needle ${adapter.propValue("tunerneedle")}, knob ${adapter.propOwner("tunerknob")}`
          : `${what} ${adapter.propOwner(`${what}handle`)}`,
      );
      await c.d.settle(c.wait, `the ${control.region}`, c.budget);
    },
  },

  // -- travel ---------------------------------------------------------------
  mapjump: {
    args: [1, 1],
    wait: "none",
    opts: ["deck"],
    sig: "mapJump(gstair1, deck: bd)",
    // The reachable sets are read off MAP.STG's own red areas rather than typed
    // out here, so this list cannot go stale against the table that decides
    // whether a jump actually works.
    help:
      "the deck plan, as literal clicks: open, turn to the page, press the stairwell. Reaches " +
      [...jumpableSets()].sort().join(", "),
    run: async (c) => {
      const goal = c.step.args[0].toLowerCase();
      const deck = c.step.opts.deck ?? (await c.d.evaluate<string>(
        `String(window.dbg.session.interp.globals.get("savedeck") ?? "")`,
      ));
      const red = jumpTo(goal, deck);
      if (!red) {
        throw new Error(
          `no red area for ${goal} on any deck plan — the map reaches ${[...jumpableSets()].sort().join(", ")}`,
        );
      }
      // `deck:` is a PREFERENCE, not a constraint: `jumpTo` falls back to the
      // lowest page that has the set at all, so a deck the plan does not carry
      // lands somewhere else without failing. Silent, and it need not be — the
      // set a route wanted is reached either way, but which stairwell it came
      // out of decides the walk after it.
      if (deck && red.deck !== deck.toLowerCase()) {
        c.say(`no ${goal} on deck ${deck} — took deck ${red.deck} instead`);
      }
      const page = () =>
        c.d.evaluate<number | null>(
          `(() => { const m = /^map (\\d+)$/i.exec(String(window.dbg.session.currentFlat || "")); return m ? Number(m[1]) : null; })()`,
        );
      // TWO clicks, doing DIFFERENT things — so they must not be waited on the
      // same way. house.shp c609's mousedown switches on the map's own view:
      // "dark" runs activateinterface(), which lights the band and returns with
      // nothing to animate and nothing to load, and only "light" runs open().
      //
      // So waiting for the map PAGE after the first click waits for something
      // that click was never going to produce, and it always ran out: measured
      // here at a flat 4 s of the 5.3 s a map jump cost, and measured at 4.8 s
      // in the browser gate before nav/navigator.ts fixed the same bug. Wait for
      // "the band is lit OR the map is up" and it ends the moment either click
      // lands.
      const lit = `String((window.dbg.session.propRuntime.get("map") || {}).stateName || "") === "light"`;

      // WAIT FOR THE WORLD TO BE ABLE TO TAKE THE CLICK, before sending one.
      //
      // The same gate `key()` puts in front of a press (see SpeedrunDriver.key),
      // and missing here for the same reason it was missing there: the click is
      // sent, it is swallowed, and the only evidence is the four seconds spent
      // afterwards waiting for a map that was never going to open. Then the loop
      // below clicks again, it works, and the line costs 4 s more than it looks
      // like it should — reported as "it takes way too long until the map is
      // clicked; it's clickable, I don't know what we are waiting for".
      //
      // What makes a route hit it is a `changeset` in the line before. A
      // conversation whose last bevel changes the set — SASHA1.PUP's `want` 102,
      // handing over Vlad's package — ends when the puppet closes, which is
      // BEFORE the room it asked for has loaded and faded in. A click into that
      // gap reaches an engine that is not taking any.
      //
      // Bounded, and it does not fail if it runs out: a state that never goes
      // quiet leaves the loop below exactly as it was, retry and all.
      await c.d.tryHold(QUIET, Math.min(c.budget, 10_000));

      for (let i = 0; i < 3 && (await page()) === null; i++) {
        // `!wasLight` rather than `wasDark`, which is the same test for the two
        // states the map is normally in and a better one for every other: the
        // map only opens from `light`, so from ANY other state the first click
        // is the one that lights the band and "the band lit" is the outcome to
        // wait for. Asking `wasDark` gave a map caught in some third state — mid
        // animation, or not yet built — no early exit at all, and it spent the
        // whole 4 s. Waiting for the page alone is right when it was ALREADY
        // light, and only then, because that click opens it and a second one
        // would shut it again.
        const wasLight = await c.d.evaluate<boolean>(lit);
        await clickThing(c, "map", "taken");
        const answered = await c.d.tryHold(
          `/^map \\d+$/i.test(String(window.dbg.session.currentFlat || ""))${wasLight ? "" : ` || (${lit})`}`,
          4000,
        );
        // A click that did nothing costs the whole backstop, and until now it did
        // so in silence — the line simply took four seconds longer than it looks
        // like it should, with nothing in the report to point at. Say so, with
        // what the map was doing at the time, so the next one of these arrives
        // already diagnosed instead of as "it feels slow sometimes".
        if (!answered) {
          const now = await c.d.evaluate<string>(
            `String((window.dbg.session.propRuntime.get("map") || {}).stateName || "(no map prop)")`,
          );
          c.say(`click ${i + 1} on the map did nothing in 4 s — map state "${now}", retrying`);
        }
      }
      const on = await page();
      if (on === null) throw new Error(`the map would not open here (mapdisabled, or no bag/watch yet)`);
      if (on !== red.page) {
        const button = pageButton(red.page);
        if (!button) throw new Error(`no page button for deck plan ${red.page}`);
        await clickThing(c, button.region, "taken");
      }
      await clickThing(c, red.region, "none");
      // exitmap() runs the close animation and transfromflat() before the engine
      // consumes jumpset, so arriving takes a moment longer than the click.
      //
      // `quiet` and not merely "the right set, no flat": the arrival is still
      // FADING when those two become true, and a movement key pressed into a
      // fade is silently discarded (viewer.ts on `pressNav`). Handing over early
      // does not save the wait, it moves it — measured, the first `left()` after
      // a jump cost 2.0 s in three presses, two of them dropped, while every
      // later move in the same room cost 0.2 s. Waiting for the room to settle
      // here pays the fade once instead of guessing at it twice.
      await c.d.hold(
        `(${predicate(`set == ${goal}`)}) && (${predicate("noflat")}) && (${predicate("quiet")})`,
        `the jump to ${goal}`,
        c.budget,
      );
      c.say(`deck ${red.deck}`);
    },
  },
  travel: {
    args: [1, 1],
    wait: "none",
    sig: "travel(gym)",
    help: "PLANNER ESCAPE HATCH — pathfind to a set and print the literal lines it used",
    run: async (c) => planner(c, "travel", c.step.args[0].toLowerCase()),
  },
  hunt: {
    args: [1, 1],
    wait: "none",
    sig: "hunt(bag)",
    help: "PLANNER ESCAPE HATCH — turn/walk around a room until a thing is clickable",
    run: async (c) => planner(c, "hunt", c.step.args[0].toLowerCase()),
  },
  /**
   * Get to a named view, TURNING AND WALKING, without a pathfinder.
   *
   * `face` turns and only turns, so it can reach a view in the scene you are
   * standing in and no other. That is most rooms and it is not the top of the
   * smokestack: SMSTACK3.SET is four scenes of four views joined by four roads,
   *
   *     Scene42/View46 <-> Scene37/View47      Scene37/View48 <-> Scene38/View51
   *     Scene38/View52 <-> Scene39/View58      Scene39/View57 <-> Scene42/View45
   *
   * and the notebook is only takeable from Scene39/View55. Which of the four you
   * come up into depends on which ladder the maze route ended on, so a sheet
   * cannot write the turns down — `face(view55)` turned the whole ring and never
   * found it, because view55 was two rooms away.
   *
   * THE ROOM IS ALREADY PARSED, which is the whole trick. `travel` and `hunt`
   * need the pathfinder because a route between SETS is planned over `.SET` files
   * read off disk, and a page has no disk. But the set you are STANDING IN is in
   * memory — `viewer.set.scenes` and `viewer.set.transitions` — so a walk inside
   * one room needs nothing a page does not already have. Hence this plans here
   * and works in both hosts, and only falls through to the planner when the
   * target is somewhere else entirely.
   *
   * The plan is over SCENES, not views, and the gestures are `face` then `up`:
   * face already turns by real presses and confirms by the view NAME, so nothing
   * here has to know which way a turn ring runs — a fact that lives in the
   * scene's frame registers and would be one more thing to get wrong.
   */
  stand: {
    args: [1, 1],
    wait: "none",
    opts: ["set"],
    sig: "stand(view55, set: smstack3)",
    help: "get to a named view — turning, and walking between the scenes of this room if need be",
    run: async (c) => {
      const want = c.step.args[0].toLowerCase();
      /**
       * READ THE ROOM ONLY WHEN THERE IS ONE.
       *
       * `session.currentSetFile` is assigned BEFORE the new `SetViewer` is built
       * (host.ts: the name, then an `await ensureBooted()`, then the viewer), so
       * a changeset has a window in which the session names the arriving room and
       * `window.dbg.viewer` is still the departing one. A plan made in that window
       * is made from the old room's scenes and roads, and it is not obviously
       * wrong — it is a correct route through a room nobody is in.
       *
       * That is what it looked like: `planning in smstack3 (from scene65)`,
       * smstack3's name against smstack2's geometry, routed through a `view70`
       * that only exists downstairs. The room, sampled a moment later when the
       * step failed, was `smstack3 Scene39/View58` — one right turn from the
       * target and no roads at all.
       *
       * A settle closes the window, because a changeset is not quiet while it is
       * happening. This is exactly what `settle()`'s own help means by "needed
       * before anything that reads the world".
       */
      await c.d.settle("quiet", `the room before planning to ${want}`, c.budget);
      const room = await c.d.evaluate<{
        set: string;
        here: string;
        scenes: { name: string; views: { name: string; id: number }[] }[];
        roads: [number, number][];
      } | null>(`(() => {
        const v = window.dbg.viewer, s = window.dbg.session;
        if (!v || !v.set) return null;
        return {
          set: String(s.currentSetFile || "").toLowerCase().replace(/\.set$/, ""),
          here: String(v.scene.sceneName || "").toLowerCase(),
          scenes: v.set.scenes.map((sc) => ({
            name: String(sc.sceneName || "").toLowerCase(),
            views: sc.views.map((w) => ({ name: String(w.viewName || "").toLowerCase(), id: w.viewID })),
          })),
          roads: v.set.transitions.map((t) => [t.viewIDstart, t.viewIDend]),
        };
      })()`);
      /**
       * A VIEW NAME IS NOT UNIQUE ACROSS SETS, and this room is the reason to
       * say so out loud.
       *
       * The false smokestack has `scene39/view55` in BOTH `smstack2` (the nine
       * floors you climb) and `smstack3` (the top, where the notebook is). So
       * `stand(view55)` reached for one room and planned a correct route through
       * the other — through `view70`, a standpoint that exists only in smstack2 —
       * and reported turning a ring that was never going to contain it.
       *
       * `set:` is the guard. It costs a word and it turns "the walk went
       * somewhere strange" into "you are not where you think you are", which is
       * the fact that actually needed reporting: something before this line did
       * not finish.
       */
      const mustBe = (c.step.opts.set ?? "").toLowerCase();
      if (room && mustBe && room.set !== mustBe) {
        throw new Error(
          `stand(${want}) expects to be in ${mustBe} and this is ${room.set}` +
            (room.scenes.some((sc) => sc.views.some((w) => w.name === want))
              ? ` — which has a ${want} of its own, so the walk would have gone somewhere plausible and wrong`
              : ""),
        );
      }
      // No set in memory means no room to plan in — the planner's problem, if
      // this host has one.
      if (!room || !room.scenes.some((s) => s.views.some((w) => w.name === want))) {
        return planner(c, "stand", want);
      }

      // where every global view id lives, so a road can say which scene it joins
      const at = new Map<number, { scene: string; view: string }>();
      for (const sc of room.scenes) for (const w of sc.views) at.set(w.id, { scene: sc.name, view: w.name });
      const goal = room.scenes.find((s) => s.views.some((w) => w.name === want))!.name;

      // Breadth-first over scenes: each road is one `face(leave); up()`, and the
      // shortest chain of them is the fewest gestures, because every road costs
      // the same one walk however far apart the scenes are drawn.
      const steps: { face: string }[] = [];
      if (room.here !== goal) {
        const prev = new Map<string, { from: string; leave: string }>();
        const seen = new Set([room.here]);
        const queue = [room.here];
        while (queue.length) {
          const now = queue.shift()!;
          if (now === goal) break;
          for (const [a, b] of room.roads) {
            for (const [from, to] of [[a, b], [b, a]] as [number, number][]) {
              const side = at.get(from), other = at.get(to);
              if (!side || !other || side.scene !== now || seen.has(other.scene)) continue;
              seen.add(other.scene);
              prev.set(other.scene, { from: now, leave: side.view });
              queue.push(other.scene);
            }
          }
        }
        if (!prev.has(goal)) {
          throw new Error(
            `no way through this room from ${room.here} to ${goal} (where ${want} is) — ` +
              `its scenes are ${room.scenes.map((s) => s.name).join(", ")}`,
          );
        }
        for (let sc = goal; sc !== room.here; sc = prev.get(sc)!.from) steps.unshift({ face: prev.get(sc)!.leave });
      }

      // The room in every failure, because the plan is only ever as right as the
      // room it was made in — and which room that is has now been the answer
      // twice.
      const where = `${room.set} (from ${room.here})`;
      try {
        for (const step of steps) {
          await ACTIONS.face.run({ ...c, step: { ...c.step, args: [step.face] }, wait: "none" });
          await arrow("ArrowUp")({ ...c, wait: "none" });
        }
        await ACTIONS.face.run({ ...c, step: { ...c.step, args: [want] }, wait: "none" });
      } catch (e) {
        throw new Error(
          `${(e as Error).message}\n    planning in ${where} via ` +
            `${[...steps.map((s2) => s2.face), want].join(" -> ")}`,
        );
      }
      c.say(`${where}${steps.length ? `, ${steps.length} road(s): ` : ": "}${[...steps.map((s2) => s2.face), want].join(" -> ")}`);
      await c.d.settle(c.wait, `the walk to ${want}`, c.budget);
    },
  },
  intro: {
    args: [0, 0],
    wait: "none",
    sig: "intro()",
    help: "press past the Nightdive film and answer YES (English edition only)",
    run: async (c) => {
      const showed = await c.d.tryHold(`!!window.dbg && (!!window.dbg.intro || !!window.dbg.viewer)`, 20_000);
      if (!showed || !(await c.d.evaluate<boolean>(`!!window.dbg.intro`))) return;
      await c.d.rawKey("Escape");
      const asked = await c.d.tryHold(`!!window.dbg.intro && window.dbg.intro.regions().length > 0`, 30_000);
      if (!asked) {
        if (await c.d.evaluate<boolean>(`!window.dbg.intro`)) return; // pre-#171 film
        throw new Error("the nightdive intro never reached its question");
      }
      // YES rather than NO: "wants" navigates the page to gog.com, which is not
      // somewhere a run comes back from
      const at = await c.d.evaluate<{ x: number; y: number } | null>(`(() => {
        const r = window.dbg.intro.regions().find((b) => b.target === "yes");
        return r ? { x: Math.round((r.x0 + r.x1) / 2), y: Math.round((r.y0 + r.y1) / 2) } : null;
      })()`);
      if (!at) throw new Error('the ownership question has no "yes" button');
      await c.d.clickAt(at.x, at.y, "none");
      await c.d.hold(`!window.dbg.intro`, "the intro to let go", 30_000);
    },
  },
  mission: {
    args: [1, 1],
    once: true,
    wait: "quiet",
    opts: ["phase"],
    sig: "mission(1, phase: 2)",
    help: "jump to a mission and phase — mission(1, phase: 2) loads the point named m1p2",
    run: async (c) => {
      const n = Number(c.step.args[0]);
      const phase = Number(c.step.opts.phase ?? 0);
      if (!Number.isFinite(n) || !Number.isFinite(phase)) {
        throw new Error(`mission takes numbers — mission(1, phase: 2)`);
      }
      await loadPoint(c, `m${n}p${phase}`);
    },
  },
};

/**
 * Titanic's whole vocabulary: the engine's verbs, with this game's over the top.
 *
 * Exported because everything that reads a sheet reads it through this — the
 * parser needs the grammar ({@link VERBS}), the run loop needs the
 * implementation, and the workbench's legend needs both. One table so that a
 * sheet cannot mean one thing to the CLI runner and another in the page.
 */
export const ACTIONS: ActionTable = composeActions(CORE_ACTIONS, TITANIC_ACTIONS);

/** the grammar half of {@link ACTIONS}, for the parser */
export const VERBS: Record<string, VerbSpec> = verbsOf(ACTIONS);

/** a verb by name, case-insensitively — see `resolveIn` */
export const resolve = (verb: string): Action | undefined => resolveIn(ACTIONS, verb);

/** may a Pause abort this verb mid-flight, or must it finish first? */
export const interruptible = (verb: string): boolean => !!resolve(verb)?.interruptible;

/**
 * The condition vocabulary and the universal options, passed through.
 *
 * They are the engine's — every one of them is a fact about a DreamFactory
 * session rather than about this ship — but the workbench's legend wants the
 * whole language in one import, and "what may appear on a line of a Titanic
 * sheet" is a question this module is the right one to answer.
 */
export { CONDITIONS, UNIVERSAL_HELP } from "@dreamfactory/engine/web/speedrun/action";
