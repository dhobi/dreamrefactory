/**
 * The verbs that name no game — what any DreamFactory disc can be driven with.
 *
 * Split out of Titanic's table so that a second port gets a working sheet
 * language on the day it gets a workbench, rather than a copy of one. What is
 * here is the gesture layer and the conditions over it: the four arrows and
 * Space, clicks at a name or a pixel, a held press, ESC through a film, a
 * conversation answered by bevel, the waits, and the run's own bookkeeping
 * (`save`, `load`, `watchFor`, `split`, `note`).
 *
 * What is NOT here is anything that knows a room, a prop or a character:
 * Titanic's coal lever, its wireless, its map jumps and its inventory band are
 * `taoot/src/speedrun/actions.ts`, and Dust's will be its own file beside it.
 * The test for a verb is in {@link action.ts}.
 *
 * A game composes the two ({@link composeActions}) and nothing here reaches for
 * the result — the run's own vocabulary arrives on
 * {@link ActionContext.verbs}, which is what lets `watchFor` parse a line
 * against the table the run is actually using.
 */
import { parseSheet } from "./sheet";
import { SHOWING } from "./driver";
import {
  IDLE,
  WATCHES,
  arrow,
  clickThing,
  condition,
  converse,
  dismissMovie,
  key,
  loadPoint,
  otherwiseOf,
  path,
  predicate,
  thenOf,
  type ActionTable,
} from "./action";

export const CORE_ACTIONS: ActionTable = {
  // -- raw input ------------------------------------------------------------
  left: {
    args: [0, 0], wait: "none", opts: ["confirm"],
    sig: "left()",
    help: "turn left (ArrowLeft), confirmed by the view changing",
    run: arrow("ArrowLeft"),
  },
  right: {
    args: [0, 0], wait: "none", opts: ["confirm"],
    sig: "right()",
    help: "turn right (ArrowRight), confirmed by the view changing",
    run: arrow("ArrowRight"),
  },
  up: {
    args: [0, 0], wait: "none", opts: ["confirm"],
    sig: "up()",
    help: "walk forward (ArrowUp), confirmed by the standpoint changing",
    run: arrow("ArrowUp"),
  },
  space: {
    args: [0, 0], wait: "ready", opts: ["confirm"],
    sig: "space()",
    help: "open the door you are facing (Space) — add wait(set == x) to confirm it",
    run: key(" "),
  },
  /**
   * A door, which is always the same three gestures — so it is one verb.
   *
   * Space opens what you are facing, ArrowUp walks through it, and the room
   * beyond has to have ARRIVED before the next line reads the world. Every door
   * in a sheet was those three lines, and writing them out invited two mistakes
   * that this spelling cannot make.
   *
   * The waits are the reason it is worth wrapping rather than aliasing, because
   * they are not the same for all three:
   *
   *   - the space waits `ready`, the fade gate. A door opening is exactly the
   *     ramp in which the NEXT key press is silently discarded (the note on
   *     `pressNav`), so walking without that gate is how an ArrowUp goes missing.
   *   - the walk waits for nothing, because {@link arrow} already confirms it by
   *     the standpoint changing and presses again if it did not. A settle here
   *     would be paid twice over, once in the middle and once at the end.
   *   - the settle at the end is `wait:`, so `door(wait: ready)` is available to a
   *     leg that is going straight on to another gesture and does not need the
   *     room to be finished.
   *
   * `confirm: no` passes through to the walk, for the rare door you expect to
   * stand still in.
   */
  door: {
    args: [0, 0],
    wait: "quiet",
    opts: ["confirm"],
    sig: "door()",
    help: "open the door you are facing and walk through it — space(), up(), settle()",
    run: async (c) => {
      await key(" ")({ ...c, wait: "ready" });
      await arrow("ArrowUp")({ ...c, wait: "none" });
      await c.d.settle(c.wait, "the room through the door", c.budget);
    },
  },
  /**
   * The fourth arrow, and the one that is a navigation key almost nowhere.
   *
   * ArrowDown goes to the script chain like any other key and hardly anything
   * reads it — `SMSTACK2`/`SMSTACK3` views 43, 50, 54 and 56 are the exceptions,
   * the false smokestack's ladder platforms whose scene `keydown` is the only way
   * down a level (engine/src/web/keys.ts, and #100 for the soft-lock that got it
   * bound at all). So this is confirmed like the other three and will say so
   * anywhere it does nothing, which is most places and is the right answer there.
   */
  down: {
    args: [0, 0], wait: "none", opts: ["confirm"],
    sig: "down()",
    help: "climb down a level (ArrowDown) — the smokestack ladders, and nowhere else",
    run: arrow("ArrowDown"),
  },
  /**
   * A path, written short (#250).
   *
   * Twenty-one lines of `up()` and `right()` is what a corridor looks like in a
   * sheet, four times over for the one from the F deck stairs to the turbine
   * room, and none of those lines is tuned or ever will be — they are the way
   * there. So a path may be one line, in the five letters a path is made of.
   *
   * It is EXPANDED rather than executed: `move(u,r,o)` is parsed into `up()`,
   * `right()`, `door()` and the run never sees a `move` at all (see `expand` in
   * sheet.ts). Which is why nothing else in the harness had to learn about it —
   * every move keeps its own row in the report and its own FRAMES, a Pause lands
   * between two of them, and a failure names `up()` rather than the whole line.
   *
   * The commas are grouping and nothing more: `move(u,r,u)` and `move(uru)` are
   * the same path, and a long one reads better in runs — `move(o, ururururur,
   * o)` is the corridor above with its doors at either end. Options ride on every
   * move in the line, because the line is the moves: `move(u,r, confirm: no)` is
   * `up(confirm: no); right(confirm: no)`, and `x2` repeats the whole path rather
   * than each step of it.
   */
  move: {
    args: [1, Infinity],
    // no `wait` of its own: every move on the line takes the one its own verb
    // takes, which is what makes a path the lines it stands for
    opts: ["confirm"],
    sig: "move(u,r,u,l,u,o)",
    help: "a path in one line — l(eft) r(ight) u(p) d(own) o(pen a door), e.g. move(o,ururur,o)",
    expand: path,
    run: async () => {
      // unreachable: the parser turns every `move` into the moves it names, and
      // a `move` that reached the runner would be a Step nobody expanded
      throw new Error("a move is expanded when the sheet is parsed and cannot be run");
    },
  },
  esc: {
    args: [0, 0],
    wait: "none",
    sig: "esc()",
    help: "a single Escape keypress (skipMovie is the repeating version)",
    run: key("Escape"),
  },
  key: {
    args: [1, 1],
    wait: "ready",
    sig: "key(e)",
    help: "press any key by Playwright name (M, O, X, Escape)",
    run: async (c) => c.d.key(c.step.args[0], c.wait, c.budget),
  },

  // -- clicking -------------------------------------------------------------
  click: {
    args: [1, 1],
    wait: "taken",
    sig: "click(cards)",
    help: "click a named thing — hotspot, character, prop or flat region",
    run: async (c) => clickThing(c, c.step.args[0]),
  },
  clickspot: {
    args: [1, 1],
    wait: "taken",
    sig: "clickSpot(door)",
    help: "click a view HOTSPOT by name, never a prop that happens to share it",
    run: async (c) => {
      const at = await c.d.aim("hotspot", c.step.args[0]);
      if (!at) throw new Error(`no hotspot "${c.step.args[0]}" in this view`);
      await c.d.clickAt(at.x, at.y, c.wait, c.budget);
    },
  },
  clickat: {
    args: [2, 2],
    wait: "taken",
    sig: "clickAt(169, 311)",
    help: "click a raw canvas pixel, 512x384 — for movie buttons with no name",
    run: async (c) => {
      const [x, y] = c.step.args.map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`clickAt needs two numbers`);
      await c.d.clickAt(x, y, c.wait, c.budget);
    },
  },

  /**
   * A press that is HELD — for the scripts that wait for a button by polling for
   * one instead of being handed one.
   *
   * `while not button()` is the shape, and INVEN1.STG's `dobook()` is the case
   * that named this verb. Putting the Rubaiyat down in a coal bunker goes: click
   * the inventory's OK, which runs `transfromflat()` and only THEN parks in
   *
   *     while not button ()
   *         propxy ("boilrubaiyat", pointx (mouse ()), pointy (mouse ()))
   *     endwhile
   *     if pointinprop ("boilbag", mouse ()) …    <- the drop, decided by WHERE
   *
   * — and `transfromflat`'s two fade ramps block the script for their ten ticks
   * each first. A click is milliseconds; by the time anything asks, the button
   * has been up for a third of a second and the loop parks for good. A player
   * never meets this because a player holds the button while they aim.
   *
   * `until` says what the press is being held FOR, and the default is `quiet` —
   * the engine going idle — because that is true of every one of these without
   * having to know the puzzle. It also covers the fade: the engine is busy for
   * the whole of `transfromflat`, so the hold outlasts it and is still down when
   * `dobook` finally asks.
   *
   * Naming a condition instead is worth it when you know one, but pick one that
   * can actually arrive. `until: !owns.rubaiyat` looks exactly right and hangs
   * whenever the drop lands back in the bag — `pointinprop("boilbag", mouse())`
   * hides the book again without changing its owner, so the condition is waiting
   * for something the gesture it describes has already decided against.
   *
   *     holdAt(150, 250)                    # until the game has finished reacting
   *     holdAt(150, 250, until: !polling)    # until the loop that wanted it lets go
   */
  holdat: {
    args: [2, 2],
    wait: "quiet",
    opts: ["until"],
    sig: "holdAt(150, 250)",
    help:
      "press a pixel and HOLD the button until a condition holds (default quiet) — for " +
      "the scripts that poll `button()`, like putting the Rubaiyat down",
    run: async (c) => {
      const [x, y] = c.step.args.map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`holdAt needs two numbers`);
      const goal = c.step.opts.until;
      const polling = predicate("polling");
      const idle = `!(${polling})`;
      /**
       * The default is a handshake in three parts, and each part is a bug that
       * happened.
       *
       * 1. WAIT FOR THE LAST GESTURE'S LOOP TO END. `polling` is true of any
       *    input loop, including the one the PREVIOUS click was still running:
       *    a click holds the button for three frames, `trackbut` spins
       *    `while stilldown()` for those frames, and the poll stays warm for
       *    four engine steps after. Arming on that pressed while the OK's own
       *    handler was mid-flight.
       * 2. WAIT FOR A NEW ONE TO START. That is the fade — `transfromflat` and
       *    its two ramps — after which `dobook` finally asks. Press before it
       *    and the press lands on the panel that has not gone away yet, takes
       *    hold of the item drawn under the cursor, and starts a
       *    `while stilldown()` loop that cannot end while the button is down:
       *    measured, the whole 120 s budget with `flat "inven 1"` still up.
       * 3. HOLD UNTIL IT LETS GO. Which is the press being taken.
       */
      let r;
      if (goal) {
        r = await c.d.holdAt(x, y, { until: condition(goal) }, c.budget);
      } else {
        await c.d.tryHold(idle, Math.min(c.budget, 5_000));
        r = await c.d.holdAt(x, y, { arm: polling, until: idle }, c.budget);
      }
      // A hold that gave up is a FAILURE, and saying so is most of what this verb
      // is for. It used to read as a success, so a condition that could never
      // arrive spent the whole budget looking like a working gesture and then
      // broke the next line instead — which is exactly how `!owns.rubaiyat` hides
      // a drop that landed back in the bag.
      if (!r.armed) {
        throw new Error(
          `nothing was waiting for a press at ${x},${y} — no script polled ` +
            `button() while it was held, so the hold did nothing. Is the gesture ` +
            `before this one the one that parks?`,
        );
      }
      if (!r.held) {
        throw new Error(
          `held the button at ${x},${y} for ${c.budget} ms and ` +
            `${goal ?? "the poll loop letting go"} never came true` +
            (goal ? ` — is it something this gesture can actually cause?` : ""),
        );
      }
      await c.d.settle(c.wait, `the hold at ${x},${y}`, c.budget);
    },
  },

  /**
   * Take hold of a NAMED prop and keep holding it until something is true.
   *
   * {@link holdat}'s twin, aimed by the engine's own hit test rather than by
   * pixels — which is the whole difference, because the things worth holding are
   * dials and a dial is wherever its shop drew it.
   *
   * WHY A ROUTE WANTS THIS. Some of this game's scripts are simulations that only
   * run while you are touching them, and the turbine plant is the one that named
   * this verb. Every one of TURBINE.SHP's five dials is
   *
   *     while stilldown ()
   *         propdeg (me, limiter (orig, newd))
   *         valve1 = sendtostagefx (degtonum (propdeg (me)))
   *         sendtostage (changedone ())          <- one iterateone() per FRAME
   *         forceupdate ()
   *     endwhile
   *
   * and `changedone` is the plant's entire clock: one `iterateone()`, a redraw,
   * and `makeloop("flat", …, "changedone", 10)` to come back in ten engine steps.
   * So the plant advances twice a second when nobody is touching it and once per
   * frame when somebody is. Holding a valve is therefore the game's own
   * fast-forward — the difference between watching the gauge climb and having
   * climbed it — and it is the plant's own script doing it, so a run that uses it
   * is still a run a person could have done.
   *
   * A HOLD IS NOT A DRAG. `limiter` hands back the deg untouched when the cursor
   * has not moved (`delt = 0`), and the cursor does not move here, so the dial
   * stays on the number the `dial()` before it set while the loop body goes on
   * republishing that number to the plant. Nothing is re-aimed and nothing is
   * disturbed; only time passes, and faster.
   *
   * `until` is REQUIRED, where {@link holdat}'s is optional. That verb's default —
   * hold until the poll loop lets go — describes a press that something was
   * ALREADY waiting for. Here the press is what starts the loop, so "the loop let
   * go" cannot become true while we are still holding it, and defaulting to it
   * would spend the whole budget every time and then call it a failure.
   *
   *     hold(valve1, until: global.electlag > 73)   # spin the plant up to the gate
   */
  hold: {
    args: [1, 1],
    wait: "quiet",
    opts: ["until"],
    sig: "hold(valve1, until: global.electlag > 73)",
    help:
      "grab a named prop and HOLD the button until a condition holds — for the " +
      "scripts that only advance while you are touching them, like the turbine's dials",
    run: async (c) => {
      const name = c.step.args[0];
      const goal = c.step.opts.until;
      if (!goal) {
        throw new Error(
          `hold(${name}) needs an until: — a hold with no condition has nothing to ` +
            `wait for, since the press is what starts the loop it is waiting on`,
        );
      }
      const at = await c.d.aim("thing", name);
      if (!at) throw new Error(`no "${name}" on screen to take hold of`);
      const r = await c.d.holdAt(at.x, at.y, { until: condition(goal) }, c.budget);
      if (!r.held) {
        throw new Error(
          `held ${name} for ${c.budget} ms and ${goal} never came true — is it ` +
            `something holding ${name} can actually bring about?`,
        );
      }
      await c.d.settle(c.wait, `the hold on ${name}`, c.budget);
    },
  },

  // -- movies ---------------------------------------------------------------
  skipmovie: {
    args: [0, 0],
    wait: "none",
    opts: ["until"],
    interruptible: true,
    sig: "skipMovie(until: quiet)",
    help: "hammer ESC through every playing cutscene, never one that is asking something",
    run: async (c) => {
      // the rule, one line: skip a movie that is PLAYING AND NOT WAITING. A movie
      // parked on its regions is the engine asking a question and its answer is
      // story — the boot menu's GAME/TOUR, a wireless telegram, a London close-up's
      // OK plaque. `arm` is that test; `until` is where the sheet wants to get to.
      const until = c.step.opts.until
        ? `(${condition(c.step.opts.until)})`
        : `!(${SHOWING})`;
      const n = await c.d.hammer("Escape", {
        until,
        arm: SHOWING,
        gap: c.gap,
        budget: c.budget,
        what: c.step.opts.until ? `${c.step.opts.until} (skipping clips)` : "the cutscene to end",
      });
      c.say(`${n} ESC`);
    },
  },
  movieok: {
    args: [0, 0],
    wait: "taken",
    sig: "movieOk()",
    help: "click the OK/exit region of a movie parked on its regions",
    run: dismissMovie,
  },
  /**
   * Answer a parked movie, by the name of the region rather than its place in the
   * list.
   *
   * A parked film is the engine asking a question, and its regions are the
   * answers — but only two of the three things a region carries are worth naming
   * it by. `target` is where a type-2 jumps to and `event` is the clip a type-3/4
   * chains into (SetViewer.movieRegions), and between them they say what the
   * answer DOES; the rectangle says only where it is drawn. So both are matched,
   * `target` first.
   *
   * The Purser is the case that asked for this. Walk into his office and
   * `dopuppet()` parks `mainc.mov` on five regions, one of them a type-2 named
   * "openit" — his window, and the only one that runs the clip on to the frame
   * that opens `purs1.pup`. By index that is `movieRegion(1)` and there is nothing
   * in the sheet to say why 1; by name it is the gesture the game's own author
   * wrote down.
   *
   * An index still works, and has to: plenty of parked films name nothing.
   *
   * The wait in front is the other half. A press that starts a clip returns as
   * soon as the clip starts, so the film is usually still PLAYING when the next
   * line runs and there is nothing parked to click yet — clicking there is a
   * click into a cutscene, which the engine takes as "skip" or ignores outright.
   * Waiting for the park is waiting for the question to be asked.
   */
  movieregion: {
    args: [1, 1],
    wait: "taken",
    sig: "movieRegion(openit)",
    help: "answer a parked movie by region name or 0-based index — movieRegion(openit)",
    run: async (c) => {
      const want = c.step.args[0];
      const parked = predicate("asking");
      if (!(await c.d.evaluate<boolean>(parked))) await c.d.tryHold(parked, c.budget);
      const found = await c.d.evaluate<{ x: number; y: number } | null>(`(() => {
        const rs = (window.dbg.viewer && window.dbg.viewer.movieRegions) || [];
        const want = ${JSON.stringify(want.toLowerCase())};
        const i = Number(want);
        const r = /^[0-9]+$/.test(want)
          ? rs[i]
          : rs.find((x) => String(x.target || "").toLowerCase() === want) ||
            rs.find((x) => String(x.event || "").toLowerCase().replace(/\.mov$/, "") === want.replace(/\.mov$/, ""));
        return r ? { x: Math.floor((r.x0 + r.x1) / 2), y: Math.floor((r.y0 + r.y1) / 2) } : null;
      })()`);
      // What IS parked, because "no region called openit" is half an answer and
      // the other half is one round trip away — and it is the half that gets the
      // line written.
      if (!found) {
        const rs = await c.d.evaluate<{ type: number; target: string; event: string }[]>(`(() => {
          return ((window.dbg.viewer && window.dbg.viewer.movieRegions) || [])
            .map((r) => ({ type: r.type, target: String(r.target || ""), event: String(r.event || "") }));
        })()`);
        const list = rs.length
          ? rs.map((r, i) => `${i}: type ${r.type}${r.target ? ` -> ${r.target}` : ""}${r.event ? ` (${r.event})` : ""}`).join(", ")
          : "nothing is parked — the movie is still playing, or there is no movie";
        throw new Error(`no movie region "${want}" here. Parked: ${list}`);
      }
      await c.d.clickAt(found.x, found.y, c.wait, c.budget);
    },
  },

  // -- conversation ---------------------------------------------------------
  talk: {
    args: [1, 1],
    bevels: true,
    wait: "none",
    opts: ["otherwise", "maxturns", "then"],
    sig: "talk(purser[102,101])",
    help: "click someone and answer them — talk(purser[1,3,5]); then: leave|stop once the list runs out",
    run: async (c) => {
      const then = thenOf(c.step);
      await clickThing(c, c.step.args[0], "none");
      await c.d.hold(
        `!!(window.dbg.viewer && window.dbg.viewer.conversing)`,
        `${c.step.args[0]} to start talking`,
        c.budget,
      );
      await converse(c, c.step.bevels ?? [], otherwiseOf(c.step), then);
    },
  },
  /**
   * Answer a conversation — one that is open, or one that is about to be.
   *
   * `patience:` is the whole difference between answering a person you walked
   * up to and answering a person who walks up to YOU, and a literal route
   * through a populated ship needs the second.
   *
   * A puppet does not open on the frame the gesture lands. `STAIR2C.SET
   * runcsea()` dispatches `sendtoactor("csea", mousedown(0))` and the officer
   * becomes visible some frames later; a `say` placed immediately after the
   * move samples `conversing`, sees false, reports "said nothing" and returns —
   * and the NEXT move then cannot be pressed at all, because by then he is
   * talking and the engine refuses the key. Measured three times on the
   * second-class stair, each time one gesture past where the answer was put.
   *
   * So `patience` is "wait this long for someone to start, then answer them",
   * and its absence is "answer whoever is talking NOW". It is not a default:
   * waiting costs its full budget wherever nobody speaks, so it belongs on the
   * one line that expects an interruption and nowhere else.
   */
  say: {
    args: [0, 0],
    bevels: true,
    wait: "none",
    opts: ["otherwise", "maxturns", "patience", "then"],
    sig: "say([102,101])",
    help: "answer a conversation — say([1,3,5]); then: leave|stop once the list runs out; patience: 3000 for one still arriving",
    run: async (c) => {
      const then = thenOf(c.step);
      const patience = Number(c.step.opts.patience ?? 0);
      if (patience > 0 && !(await c.d.evaluate<boolean>(predicate("talking")))) {
        if (await c.d.tryHold(predicate("talking"), patience)) c.say("waited for them to start");
      }
      return converse(c, c.step.bevels ?? [], otherwiseOf(c.step), then);
    },
  },
  skiplines: {
    args: [0, 0],
    wait: "none",
    opts: ["until"],
    sig: "skipLines()",
    help: "ESC through spoken lines only — stops dead at a plaque rather than answering it",
    run: async (c) => {
      const until = c.step.opts.until
        ? `(${condition(c.step.opts.until)})`
        : `(() => { const v = window.dbg.viewer; return !v || !v.conversing || v.awaitingChoice; })()`;
      const n = await c.d.hammer("Escape", {
        until,
        arm: `!!(window.dbg.viewer && window.dbg.viewer.speaking)`,
        gap: c.gap,
        budget: c.budget,
        what: "the lines to run out",
      });
      c.say(`${n} ESC`);
    },
  },

  combo: {
    args: [1, Infinity],
    groups: true,
    wait: "none",
    opts: ["until", "max"],
    sig: "combo([256,300], [256,100], until: global.vladpower < -50)",
    help: "click a cycle of bracketed x,y points until a condition holds — combo([256,300], [256,210], until: …)",
    run: async (c) => {
      // The fight and the fencing are LIGHT GUNS: FIGHT.STG's stage mousedown
      // forwards the click to the `fists` prop, and `playerpunch(x, y, side)`
      // reads the blow out of the POINT. There is no button bar, so a punch is a
      // coordinate and a combo is a cycle of them — which is exactly what a sheet
      // should be able to say in one line and reorder in one edit.
      //
      // Cycling three DIFFERENT blows is not stylistic: FIGHT.SHP c76 `punch`
      // hands the turn back to Vlad and refuses him a counter for four
      // repetitions — three jabs, four crosses, a cross straight after a kick,
      // and a cross or uppercut on the same side twice running. A varied cycle
      // trips none of them, so he never swings back and the fight is
      // deterministic; only Vlad's blows roll dice.
      if (!c.step.opts.until) throw new Error(`combo needs an until: condition, or it would never stop`);
      const until = condition(c.step.opts.until);
      /**
       * ONE BRACKETED PAIR PER BLOW — `combo([256,300], [256,210])`.
       *
       * The brackets are the point. A sheet splits on every top-level comma, so
       * an unbracketed `combo(256,300, 256,210)` arrives as four arguments and
       * the pairing is left to the spacing — which is not something a reader can
       * check and not something a typo announces. (That spelling was this verb's
       * printed signature for a while and never once worked; it rejected its own
       * example with `"256" is not an x,y point`.)
       */
      const points = c.step.args.map((a) => {
        const m = /^\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]$/.exec(a);
        if (!m) {
          throw new Error(
            `"${a}" is not a point — combo takes bracketed pairs, combo([256,300], [256,210], until: …)`,
          );
        }
        return { x: Number(m[1]), y: Number(m[2]) };
      });
      const max = Number(c.step.opts.max ?? 400);
      const deadline = Date.now() + c.budget;
      let thrown = 0;
      for (; thrown < max; thrown++) {
        if (await c.d.evaluate<boolean>(`(() => !!(${until}))()`)) break;
        if (Date.now() > deadline) throw new Error(`combo ran past its ${c.budget} ms budget after ${thrown}`);
        /**
         * ONE BLOW PER IDLE ENGINE, and both halves of that are load-bearing.
         *
         * A click made while the engine is mid-anything is FILED rather than
         * acted on (see IDLE), and a filed click is one `flushevents()` away
         * from never having happened. That is not a lost click in isolation: the
         * step advances on every attempt, so a cycle whose blows are being
         * dropped comes apart — the same point lands three times running while
         * the ones between it are swallowed, which is exactly the shape reported
         * here ("low and uppercut are good but the jab is almost never
         * executed"). A varied combo that is not actually varied is the one
         * thing this verb exists to guarantee.
         *
         * And the pause is the other half. FIGHT.STG's fists mousedown opens
         * with `stoploop("prop", "vlad")` so that a blow interrupts whatever he
         * was about to do — and what he was about to do is the idle handler that
         * ENDS the fight (`if vladpower < -50` -> `sendtoflat(currentflat(),
         * endfight())`), armed on a loop of 2 to 40 ticks. A driver clicking as
         * fast as it can pump cancels that loop every time and starves its own
         * win condition: measured in the playthrough at 400 blows and
         * `vladpower` -520 with the flat still open. Waiting for idle is what
         * gives the loop its window, so raising `max` is the wrong lever — a
         * fight that needs more than a few hundred blows is not a slow fight, it
         * is one whose ending is being postponed by the clicking.
         */
        await c.d.tryHold(IDLE, Math.min(c.budget, 5_000));
        const p = points[thrown % points.length];
        await c.d.clickAt(p.x, p.y, "none", c.budget);
        if (c.gap) await c.d.sleep(c.gap);
      }
      if (thrown >= max) {
        throw new Error(
          `${max} clicks and ${c.step.opts.until} never came true — either the blows are ` +
            `not landing (a cycle the script REFUSES throws nothing) or the ending is on a ` +
            `timer the clicking keeps cancelling. Raising max: fixes neither.`,
        );
      }
      c.say(`${thrown} clicks`);
    },
  },

  /**
   * Click a named thing every time it comes back, until a condition holds.
   *
   * For the plaque a minigame puts between its rounds — the thing that has to be
   * pressed again and again for the game to keep going, and that a sheet cannot
   * count in advance because how many times it appears is the score.
   *
   * The fencing bout is the case. FENCE.STG walks the piste back to the middle
   * after every point and puts "en garde" (`startfence`) back up, and `fighting`
   * stays false until it is clicked — so a bout left alone stops dead after the
   * first point, whoever won it. Losing 0-5 on purpose therefore costs five
   * presses of a plaque whose appearances are exactly the thing being waited for,
   * and `wait(global.fencecount == 1)` on its own waits for something that will
   * never happen.
   *
   * Nothing else, deliberately. It clicks the ONE thing it was named and only
   * when the engine's own hit test offers it, so between presses it throws no
   * attacks — which is the whole technique for losing (`playeridle` reads the
   * block off the cursor's X, and after a click the cursor is where it clicked).
   * A verb that also lunged would win points by accident.
   */
  hammer: {
    args: [1, 1],
    wait: "none",
    opts: ["until", "max"],
    interruptible: true,
    sig: "hammer(startfence, until: global.fencecount == 1)",
    help: "click a named thing every time it reappears, until a condition holds — a minigame's between-rounds plaque",
    run: async (c) => {
      const name = c.step.args[0];
      if (!c.step.opts.until) throw new Error(`hammer needs an until: condition, or it would never stop`);
      const until = condition(c.step.opts.until);
      const max = Number(c.step.opts.max ?? 400);
      const deadline = Date.now() + c.budget;
      let taps = 0;
      for (;;) {
        if (await c.d.evaluate<boolean>(`!!(${until})`)) break;
        if (Date.now() > deadline) {
          throw new Error(
            `hammered ${name} ${taps} time(s) in ${c.budget} ms and ${c.step.opts.until} never came true`,
          );
        }
        if (taps >= max) throw new Error(`${max} clicks on ${name} and ${c.step.opts.until} never came true`);
        // Only when it is actually offered. `aim` is the engine's own hit test,
        // so "not there" and "there but under something" are the same answer and
        // both mean wait — a click sent into the gap is a click on whatever the
        // round is doing.
        const at = await c.d.aim("thing", name);
        if (at) {
          await c.d.clickAt(at.x, at.y, "none", c.budget);
          taps++;
        }
        await c.d.sleep(c.gap);
      }
      c.say(`${taps} clicks on ${name}`);
    },
  },
  bailout: {
    args: [0, 0],
    wait: "none",
    sig: "bailOut()",
    help: "ESC out of a conversation entirely — answers the plaque -1 and walks away",
    run: async (c) => {
      // The deliberate use of the thing `skipLines` exists to avoid. ESC at a
      // plaque does not skip it, it ANSWERS it with -1 and ends the conversation
      // (#131) — which is a bug to a route that wanted the story and a technique
      // to a run that already has what it came for. Its own verb precisely so it
      // can never happen by accident: `skipLines` stops dead at a plaque, and
      // only this one presses through one.
      //
      // For a conversation this run is ANSWERING, `say([...], then: leave)` is
      // the cheaper form of the same idea (#265): the loop in `converse` already
      // knows the plaque is up, so it spends one press where this spends a
      // hammer. This one is for the conversations nothing is holding up that end
      // of — an interruption to walk out of, a puppet already talking when the
      // line is reached.
      //
      // Whatever the puppet would have said after the plaque is forfeit, so a
      // bail is only correct where the beat is already banked.
      const n = await c.d.hammer("Escape", {
        until: `!(window.dbg.viewer && window.dbg.viewer.conversing)`,
        arm: `!!(window.dbg.viewer && window.dbg.viewer.conversing)`,
        gap: c.gap,
        budget: c.budget,
        what: "the conversation to be walked out of",
      });
      c.say(`${n} ESC`);
    },
  },
  face: {
    args: [1, 1],
    wait: "none",
    opts: ["dir"],
    sig: "face(View55)",
    help: "turn until you are facing a named view — face view78",
    run: async (c) => {
      const want = c.step.args[0].toLowerCase();
      const dir = (c.step.opts.dir ?? "right") === "left" ? "ArrowLeft" : "ArrowRight";
      const viewNow = `String(window.dbg.viewer.scene.views[window.dbg.viewer.viewIdx].viewName || "").toLowerCase()`;
      for (let turn = 0; turn <= 8; turn++) {
        if ((await c.d.evaluate<string>(viewNow)) === want) {
          if (turn) c.say(`${turn} turns`);
          return;
        }
        await arrow(dir)({ ...c, wait: "none" });
      }
      throw new Error(
        `turned the whole ring and never faced ${want} — it is not a view of this ` +
          `scene. \`face\` only turns; \`stand(${want})\` turns AND walks between ` +
          `the scenes of this room.`,
      );
    },
  },

  // -- control --------------------------------------------------------------
  wait: {
    args: [1, Infinity],
    wait: "none",
    interruptible: true,
    sig: "wait(set == c73)",
    help: "wait for a condition — wait(set == c73), wait(global.phase == 2), wait(quiet)",
    run: async (c) => {
      const expr = c.step.args.map(condition).map((e) => `(${e})`).join(" && ");
      await c.d.hold(expr, c.step.args.join(" "), c.budget);
    },
  },
  /**
   * Stop here, and be resumable — a breakpoint in a sheet.
   *
   * The pointer is left on the line AFTER this one, which is the only choice
   * that works: leaving it on the `pause()` would make Resume pause again
   * immediately, and a breakpoint you cannot get past is a deadlock rather than
   * a tool.
   *
   * Ignored where there is nobody to resume it. An unattended CLI run steps over
   * it with a note, so a sheet can be left with breakpoints in it while a leg is
   * being worked on and still time end to end under `npm run speedrun -w taoot`.
   */
  pause: {
    args: [0, 0],
    once: true,
    wait: "none",
    sig: "pause()",
    help: "stop here and wait for Play — a breakpoint. Ignored by the CLI runner",
    run: async (c) => {
      if (!c.d.pause) {
        c.say("nothing to pause in this runner — carrying on");
        return;
      }
      c.d.pause();
    },
  },
  settle: {
    args: [0, 0],
    wait: "quiet",
    interruptible: true,
    sig: "settle()",
    help: "wait until the engine is completely idle. Needed before anything that reads the world",
    run: async (c) => c.d.settle("quiet", "the world", c.budget),
  },
  /**
   * Write a checkpoint — AFTER the world has stopped moving.
   *
   * The settle is the whole correctness of this verb, and leaving it out was a
   * real bug rather than a missing nicety. `snapshotSave` reads the live engine
   * at the instant it is called, and a speedrun calls it one action after a
   * click whose script is still running — so the file recorded a game that had
   * taken the bag but not yet been given it. Measured, saving at the same point
   * with and without the settle and reloading each:
   *
   *     mid-flight   carried held=[trunkkey,bag,map]  ->  loaded held=[map]
   *                  bag frank/darkclosed/2d          ->  none/small/3d
   *     settled      carried held=[trunkkey,bag,map]  ->  loaded held=[trunkkey,bag,map]
   *
   * `none/small/3d` is not a lost record, which is what made this read as a
   * savegame-format limit: it is the SHIPPED TEMPLATE's own bag — the skeleton a
   * snapshot patches, whose slots keep the base's values wherever the live game
   * had nothing to say. So the band came back empty and the file looked fine.
   *
   * `wait: none` opts out, for a sheet that means to catch a moving game.
   */
  save: {
    args: [1, 1],
    rest: true,
    once: true,
    wait: "quiet",
    sig: "save(m1p2)",
    help: "write a load point here — save(m1p2), then load(m1p2) to start from it",
    run: async (c) => {
      const name = c.step.args[0];
      if (!c.d.putSave) throw new Error(`this runner cannot keep save files`);
      if (c.wait !== "none") await c.d.settle(c.wait, `the world before save(${name})`, c.budget);
      // snapshotSave reports what would not fit through `onLog` — a dropped
      // theme, a global with no free slot. That is the one moment anybody wants
      // to hear it, and the game log is not where a sheet author is looking, so
      // it is captured here and put in the run report.
      const got = await c.d.evaluate<{ bytes: number[] | null; notes: string[] }>(`(() => {
        const s = window.dbg.session;
        const notes = [];
        const prev = s.onLog;
        s.onLog = (m) => { notes.push(String(m)); if (prev) prev(m); };
        let b = null;
        try { b = s.snapshotSave(); } finally { s.onLog = prev; }
        return { bytes: b ? Array.from(b) : null, notes: notes.filter((n) => /^savegame:/.test(n)) };
      })()`);
      if (!got.bytes) throw new Error(`the engine would not produce a save here`);
      await c.d.putSave(name, new Uint8Array(got.bytes));
      c.say(`${(got.bytes.length / 1024).toFixed(1)} kB`);
      for (const note of got.notes) c.say(note.replace(/^savegame: /, ""));
    },
  },
  /**
   * Put the game back to the very beginning — a checkpoint whose state is the
   * boot.
   *
   * IDEMPOTENT, and that is what makes it usable as the first line of a sheet.
   * If the game has not been started yet it does nothing at all, so a sheet
   * opening `reset()` costs nothing on a fresh page and costs a reload on the
   * second attempt — which is exactly the difference between the two, and
   * exactly what a runner starting over does by hand.
   *
   * "Not started yet" is asked as "has the boot opened its prop shops", because
   * that is the thing a beginning actually lacks: `openshop` runs when the title
   * menu's GAME region is clicked, so an empty prop table means the logos or the
   * menu are still up and nothing has happened. It is the same question `load()`
   * asks before it will restore into a session, for the same reason.
   *
   * A reload rather than a second `coldBoot`, because only a reload is honestly
   * the beginning: `coldBoot` assumes a fresh session, and re-running it over a
   * played game would leave that game's globals, cast, open shops and scheduler
   * tables underneath — a state no player can be in.
   */
  reset: {
    args: [0, 0],
    once: true,
    wait: "quiet",
    sig: "reset()",
    help: "boot the game from the beginning — does nothing if it is already there",
    run: async (c) => {
      const started = await c.d.evaluate<boolean>(
        `!!(window.dbg && window.dbg.session) && window.dbg.session.propRuntime.props.size > 0`,
      );
      if (!started) {
        c.say("already at the beginning");
        return;
      }
      if (!c.d.restart) throw new Error(`this runner cannot restart the game`);
      c.say("reloading");
      // In the workbench this never returns — the reload takes the run with it,
      // and the page resumes itself on the other side. Under Playwright the run
      // is outside the page and simply carries on, so the waits below are real.
      await c.d.restart();
      await c.d.hold(`!!(window.dbg && window.dbg.viewer)`, "the game to come back up", c.budget);
      await c.d.settle("quiet", "the fresh boot", c.budget);
    },
  },
  load: {
    args: [1, 1],
    rest: true,
    once: true,
    wait: "quiet",
    sig: "load(m1p2)",
    help: "start from a load point written by save() — load(m1p2)",
    run: async (c) => loadPoint(c, c.step.args[0]),
  },
  watchfor: {
    args: [2, 2],
    once: true,
    wait: "none",
    sig: "watchFor(movie == sink1.mov, skipMovie(until: awaiting))",
    help: "a standing rule: whenever the condition becomes true, run the action. `off` as the action forgets it",
    run: async (c) => {
      const cond = c.step.args[0];
      const body = c.step.args[1];
      const expr = predicate(cond);
      const at = WATCHES.findIndex((w) => w.expr === expr);
      if (body.trim().toLowerCase() === "off") {
        if (at < 0) throw new Error(`no watch on "${cond}" to turn off`);
        WATCHES.splice(at, 1);
        c.say(`stopped watching ${cond}`);
        return;
      }
      // the action is a sheet line like any other, so it is PARSED like one —
      // which is what makes `watchFor` take every verb rather than a list of
      // the ones somebody remembered to allow
      const { parseSheet } = await import("@dreamfactory/engine/web/speedrun/sheet");
      const parsed = parseSheet(body, { verbs: c.verbs });
      if (parsed.length !== 1) {
        throw new Error(`watchFor's action must be exactly one line, got ${parsed.length}: ${body}`);
      }
      if (parsed[0].verb === "watchfor") throw new Error(`a watch cannot register a watch`);
      if (at >= 0) WATCHES.splice(at, 1); // re-registering replaces
      WATCHES.push({ source: cond, expr, action: parsed[0], armed: false, fired: 0 });
      c.say(`watching ${cond} -> ${parsed[0].source}`);
    },
  },
  split: {
    args: [1, 1],
    rest: true,
    once: true,
    wait: "none",
    sig: "split(flat scored)",
    help: "a stopwatch split: close this segment, name it, print its time. Does nothing to the game",
    run: async () => {
      /* the runner handles splits; this exists so the verb parses and reports */
    },
  },
  note: {
    args: [1, 1],
    rest: true,
    once: true,
    wait: "none",
    sig: "note(anything at all)",
    help: "a note in the report; does nothing to the game",
    run: async (c) => c.say(c.step.args[0]),
  },
};
