/**
 * Dust's own verbs — two, so far, and both earned by the route rather than
 * guessed at.
 *
 * {@link GOTO} walks to a grid CELL, which is the shape this game's whole map
 * has and the shape its own record of the route is written in — every rung of
 * the golden thread names a standpoint as one (docs/dust/thread.md). It is 223
 * of the playthrough's gestures and the reason a sheet had to count `move(u,u,r)`
 * by hand until now. {@link GIVE} drops what is in your hand on somebody, which
 * lands on `offerobject ()` on a cast script — DF1's way of giving something
 * away, with no counterpart in TI.EXE.
 *
 * Everything else a route needs is
 * the engine's already ({@link CORE_ACTIONS}): the four arrows and Space, a
 * click at a named thing or a raw pixel, a held press, ESC through a film, a
 * conversation answered by bevel, the waits, and the run's own bookkeeping. All
 * of it is written against a DreamFactory session, and Dust is one — the same
 * `hittest`, the same props, the same conversation machinery, read by the same
 * engine two years earlier.
 *
 * So a Dust sheet works out of the box, and this file is where the things that
 * do NOT go. Still missing, from what the disc actually asks of a player:
 *
 *   - **the inventory**, which is the one that blocks most: 31 of the ladder's
 *     rungs TAKE something, and there is no verb that puts a thing in your hand.
 *     A carried prop is laid out on the inventory flat — measured in the page,
 *     `sugarcubes` sits at 130,264 in state "panel" — but `visible` is false
 *     while the play panel is up, so there is nothing on screen for a pointer to
 *     click. What opens that flat outside a conversation is the open question;
 *     the harness sidesteps it by dispatching the prop's `mousedown` at the
 *     interpreter (`clickProp`), which a verb may not do.
 *   - **the conversation gift.** `offerInTalk` is 10 more, and it is not
 *     {@link GIVE}: the plaque is reply 55555 from `addhandbevel ()`, and with
 *     `handflag = 1` the first press opens a picker that has to be worked.
 *   - **the shooting range**, and the gun generally: a light-gun aim, which is
 *     `combo`'s shape (a cycle of points until a condition) but wants naming.
 *   - **the saloon's card games**, whose scripts this port already runs
 *     (dust/tests/salgames.ts) and which are a plaque-and-bevel dialogue that
 *     `say` may or may not be able to hold up its end of.
 *
 * None of those is guessed at here. A verb earns its place by a route needing
 * it, and a table of verbs written before any route exists is a table that will
 * be wrong in ways nobody can see yet — which is the mistake Titanic's own
 * `travel` was invented to avoid making.
 */
import type { VerbSpec } from "@dreamfactory/engine/web/speedrun/sheet";
import { CORE_ACTIONS } from "@dreamfactory/engine/web/speedrun/actions-core";
import {
  composeActions,
  type ActionContext,
  resolveIn,
  verbsOf,
  type Action,
  type ActionTable,
} from "@dreamfactory/engine/web/speedrun/action";

/**
 * Give the thing in your hand to somebody, or to something.
 *
 * The gesture, not a shortcut for it: press on the item where the panel has
 * drawn it, drag it onto the target, let go there. What receives it is
 * `offerobject (what)` on the target's cast script — the birdcage's takes a seed
 * or an apple (`EXTRA.CST/0198`), Marie's takes the sugarcubes, Dell's takes a
 * pie — and the engine only ever calls that handler because a drop landed on
 * them. A verb that ran `offerobject` directly would time a route that cannot be
 * played, which is the difference between this and `offerTo` in the playthrough
 * harness (dust/tests/playthrough/route.ts): that one is a shortcut, deliberately,
 * because a headless suite has no pointer.
 *
 * ## Why `dragOnto` and not `drag` or `dragProp`
 *
 * Because the item's own script is POLLING, and because a drop is the START of
 * something rather than the end of it.
 *
 * `INVEN.PRP/0001 stdmouse ()` runs `while stilldown () … arg = mouse () …
 * endwhile` and moves the prop with `propxy (what, pointx (arg), pointy (arg))`
 * every turn — so the thing being dragged is its own progress bar. A press that
 * arrives before that loop is entered is dropped silently, and a release that
 * arrives before the loop has redrawn the item at the far end drops it back where
 * it was picked up. Both are waited for here, and they are the SAME two the
 * headless `dropOn` arrived at after each was found twice independently
 * (dust/tests/playthrough/route.ts).
 *
 * What is deliberately NOT waited for is the release being acted on. That is
 * `dragProp`'s contract and it is right for a turbine dial, which snaps when the
 * button comes up; here it is the dog's two films and a conversation. Written
 * that way this verb held the sheet through the whole cutscene — reported as
 * "give(bone, to, dog) waits until the dog movie is played out" — so the drag
 * ends at the release and the film is the next line's business. That is the
 * difference {@link SpeedrunDriver.dragOnto} exists to make.
 *
 * ## Where it presses
 *
 * `propxy (item, 1|2)` — the engine's own answer to where it drew the thing, and
 * not `aim`. The hit test finds what is in the ROOM; a held item is on the panel,
 * whose props the director does not test while the view is showing, so aiming at
 * it comes back null (the note on `dragTo` in route.ts records the same thing
 * from the other side). The builtin is asked the way the harness asks it.
 *
 * ## `wait: none`
 *
 * Deliberate, and the one thing to know when writing a line with this in it. A
 * drop is often the start of something long and modal — at the dog it is two
 * films and a conversation, and `offerobject` handlers turn the camera and then
 * WAIT on it — so settling here would be waiting for the very thing the gesture
 * exists to cause. This line ends at the RELEASE and hands the sheet back; what
 * the gift then sets off is the next line's business, which is how `talk` and
 * `accost` are written too. Say what you expect, and skip it your own way:
 *
 *     give(bone, to, dog)
 *     skipMovie(until: quiet, budget: 60000)
 */
const GIVE: Action = {
  args: [2, 3],
  wait: "none",
  sig: "give(bone, to, dog)",
  help: "drag the thing in your hand onto somebody or something — give(bone, to, dog)",
  run: async (c) => {
    // `to`/`on` are noise a sheet reads better WITH, exactly as Titanic's `use`
    // takes them (taoot/src/speedrun/actions.ts) — one grammar for the two verbs
    // that drag something onto something else.
    const [item, ...rest] = c.step.args;
    const target = rest.filter((w) => !["to", "on", "at"].includes(w.toLowerCase()))[0];
    if (!target) throw new Error(`give needs somebody to give it to — give(${item}, to, dog)`);

    const held = await c.d.evaluate<string>(
      `String(window.dbg.session.interp.globals.get("handitem") ?? "")`,
    );
    if (held.toLowerCase() !== item.toLowerCase()) {
      // WHICH, because "not in hand" and "the wrong thing is in hand" are
      // different mistakes with different fixes, and the panel is the only place
      // either is repaired.
      throw new Error(
        held
          ? `"${held}" is in hand, not ${item} — pick the ${item} up in the panel first`
          : `nothing is in hand — the ${item} has to be picked up before it can be given`,
      );
    }

    const from = await c.d.evaluate<{ x: number; y: number } | null>(`(() => {
      const i = window.dbg.session.interp;
      const f = i.builtins.get("propxy");
      if (!f) return null;
      const x = Number(f(i, [${JSON.stringify(item)}, 1]));
      const y = Number(f(i, [${JSON.stringify(item)}, 2]));
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })()`);
    if (!from) throw new Error(`the engine will not say where the ${item} is drawn`);
    const to = await c.d.aim("thing", target);
    if (!to) throw new Error(`no ${target} here to give the ${item} to`);

    /*
     * The two waits, as expressions the driver polls — and the second is why one
     * move is enough where a hand would sweep: the item is carried across by the
     * WAIT, not by the path.
     *
     * `pollingInput ()` is the engine's own answer to "is a script sitting in an
     * input poll right now", which is exactly "has `stdmouse ()` taken this
     * press". The landing is the item's own `propxy`, compared to where the drop
     * is aimed — the same reading the harness waits on, and the same builtin the
     * grab point came from.
     */
    const item$ = JSON.stringify(item);
    const landed = `(() => {
      const i = window.dbg.session.interp;
      const f = i.builtins.get("propxy");
      if (!f) return false;
      return Number(f(i, [${item$}, 1])) === ${to.x} && Number(f(i, [${item$}, 2])) === ${to.y};
    })()`;
    const got = await c.d.dragOnto(from, to, {
      armed: `window.dbg.session.pollingInput()`,
      landed,
      budget: c.budget,
    });
    // Nothing took the press, so nothing was dragged and nothing was given —
    // there is no gesture here to report the far end of.
    if (!got.armed) {
      throw new Error(
        `the ${item} never took the press at ${from.x},${from.y} — it is not the panel's to drag from here`,
      );
    }

    // What the hand says afterwards, REPORTED and not checked, because the two
    // outcomes are both real and this verb cannot tell them apart: some
    // `offerobject` handlers take the item and some open a conversation that
    // takes it later, so an emptied hand is evidence and not the contract. It
    // goes in the run's notes so the line after can be written against what
    // actually happened.
    const after = await c.d.evaluate<string>(
      `String(window.dbg.session.interp.globals.get("handitem") ?? "")`,
    );
    c.say(
      `${item} ${from.x},${from.y} -> ${target} ${to.x},${to.y}` +
        // Said and not thrown: the release has happened either way, and by now
        // whatever it set off may itself be the reason the item stopped being
        // redrawn. A line that means to check has the world to look at.
        (got.landed ? "" : ", but it never arrived under the pointer") +
        (after ? `, still holding "${after}"` : ", hand empty"),
    );
  },
};


/** a conversation is open — the engine's own reading, and the one thing a walk
 *  has to check before it presses anything */
const TALKING = `!!(window.dbg.viewer && window.dbg.viewer.conversing)`;

/**
 * Walk to a CELL of the room you are in, turning and walking.
 *
 * The verb the whole route was waiting on — `walkTo` is 223 of the playthrough's
 * gestures (dust/tests/playthrough), and without this every one of them is a
 * hand-counted `move(u,u,r,u)` that has to be recounted the moment the leg
 * before it changes.
 *
 * A CELL and not a view name, because that is what this game is made of and what
 * its own record of the route is written in: every rung of the golden thread
 * names its standpoint as one (`nite.set (10,10)`, docs/dust/thread.md), so a
 * line here can be copied straight off the ladder. Cell to scene name is the
 * game's own spelling — letter for x, number for z, both 1-based — so 10,10 is
 * `Scene K11`; that spelling is never relied on below, only the geometry.
 *
 * ## The plan
 *
 * Titanic's `stand` in all but its target (taoot/src/speedrun/actions.ts), and
 * deliberately so — the two rooms are the same shape to a planner. Breadth-first
 * over SCENES, each road one `face(leave); up()`, because every road costs the
 * same single walk however far apart two cells are drawn, so the shortest chain
 * of roads is the fewest gestures.
 *
 * What makes it possible in the page at all is that the geometry is already
 * there: the cell is `Scene.sceneLocation` (a cell centre is `x * 256 + 128`,
 * engine/src/df/set-v1-to-v4.ts) and the roads are the translated set's
 * transitions, view id to view id. So this needs no disc and no pathfinder
 * process — which is the difference between it and `travel`, Titanic's escape
 * hatch, that only the Playwright runner can run.
 *
 * ## Only the cells that can be stood on
 *
 * 173 of the town's 225 cells are built on and carry no views at all; the 52
 * that are left are the street. A cell with no views is not a place, so it is
 * not in the graph, and asking for one says so rather than planning a route to
 * a wall. `build` is the disc's own answer to which is which (V1Scene.build) and
 * it is reported, because "that is a building" and "that cell is not in this
 * room" are different mistakes.
 *
 * ## The settle in front
 *
 * `settle("quiet")` before reading anything, and it is not politeness: the
 * session names an arriving room BEFORE its viewer is built (host.ts), so a plan
 * made in that window is a correct route through a room nobody is standing in.
 * Titanic's `stand` carries the same line and the note that earned it.
 *
 * ## A WALK HAS TO BE ABLE TO ANSWER
 *
 * Which is most of the length below, and it is the half that is not `stand`'s.
 *
 * Characters here do not wait to be spoken to. The first thing this verb was
 * asked to do — the boot's cell to the thread's first standpoint, `goto(10, 10,
 * north)` in `nite` — planned correctly, walked three cells, and then died on
 * "stuck waiting for the engine to be ready for ArrowUp" with the readout saying
 * `talking to help1.pup · script busy`. Nothing was wrong with the route. A
 * conversation had opened in the middle of it, and from that moment every
 * remaining key belonged to a puppet.
 *
 * So the walk clears its throat and then re-plans FROM WHERE IT ACTUALLY IS,
 * up to `tries:` times, which is also the answer to a second thing: arriving is
 * not the same as having arrived, because the world moves while you walk, and a
 * standpoint's own `openscene` may turn you as you land on it.
 *
 * How it answers is at `clearOrSay` below — whatever the plaque offers, and an
 * honest refusal when nothing closes it. `replies:` names the reply for a leg
 * that knows which one it wants.
 */
const GOTO: Action = {
  args: [2, 3],
  wait: "none",
  opts: ["set", "replies", "tries"],
  sig: "goto(10, 10, north)",
  help: "walk to a grid cell of this room — goto(10, 10), and goto(10, 10, north) to face a way as well",
  run: async (c) => {
    const [xs, zs, want] = c.step.args;
    const x = Number(xs);
    const z = Number(zs);
    if (!Number.isInteger(x) || !Number.isInteger(z)) {
      throw new Error(
        `goto takes a cell of this room — goto(10, 10), or goto(10, 10, north). ` +
          `"${xs}, ${zs}" is not one`,
      );
    }
    const spoken = (c.step.opts.replies ?? "").trim().toLowerCase();
    const tries = Math.max(1, Number(c.step.opts.tries ?? 4));
    const talking = (): Promise<boolean> => c.d.evaluate<boolean>(TALKING);

    /**
     * A conversation in the way of the walk — answered if it can be, named if it
     * cannot.
     *
     * Characters here do not wait to be spoken to, and a walk of any length runs
     * into one: the harness spends most of `walkTo`'s length on exactly this
     * (`clearInterruption`, dust/tests/playthrough/route.ts) because every
     * remaining key belongs to a puppet the moment one opens.
     *
     * WHAT IS OFFERED, first choice each turn, and the two things that shaped it:
     *
     *   - A preference list is wrong. `say` answers a list IN ORDER and errors on
     *     the first entry a plaque does not carry, so the playthrough's own
     *     leaving order died on `bevel 301 not offered by help1.pup; got 101 ...
     *     102 ... 103`. Every leaving number belongs to somebody.
     *   - `bailOut` is wrong too. ESC does not end every conversation: one
     *     survived it across four re-plans, still talking, and put `helpbut` in
     *     the hand on the way.
     *
     * And it does not always work, which is why it gives up out loud. `help1.pup`
     * is the case: it is the game's HELP overlay rather than a character —
     * `talk(help[...])` clicks the help BUTTON prop open — and nothing on its
     * plaque closes it. A route meets that one in the opening and deals with it
     * on its own line; this verb's job is to say so rather than to spin.
     *
     * `replies:` names the reply for a leg that knows which it wants, which
     * matters because a leaving line is often the line that sets a character's
     * phase — a rung whose whole point is Marie's 202 should not let a walk
     * spend the beat on something else. `replies: none` refuses to answer at all.
     */
    const clearOrSay = async (): Promise<void> => {
      if (!(await talking())) return;
      if (spoken === "none") {
        throw new Error(
          `a conversation is open and goto(replies: none) was told not to answer it`,
        );
      }
      if (spoken) {
        const ids = spoken.split(/[|\s]+/).map(Number).filter((n) => Number.isFinite(n));
        await CORE_ACTIONS.say.run({
          ...c,
          step: { ...c.step, args: [], bevels: ids, opts: { ...c.step.opts, then: "leave" } },
          wait: "none",
        });
        return;
      }
      for (let turn = 0; turn < 10 && (await talking()); turn++) {
        const offered = await c.d.evaluate<number[]>(
          `((window.dbg.viewer && window.dbg.viewer.choices) || []).map((ch) => ch.id)`,
        );
        if (!offered.length) {
          /*
           * A LINE IS BEING SPOKEN, so cut it short and look again.
           *
           * Waiting alone was not enough: a sweep reported a walk giving up with
           * "Nothing is on its plaque — it is still speaking", which is a
           * conversation that would have got there and a verb that stopped
           * asking. One ESC skips the line, which is what `converse` does at the
           * same beat — never a hammer, because ESC at a plaque ANSWERS it.
           */
          const SPEAKING = `!!(window.dbg.viewer && window.dbg.viewer.speaking)`;
          const CHOICES = `((window.dbg.viewer && window.dbg.viewer.choices) || []).map((ch) => ch.id)`;
          if (await c.d.evaluate<boolean>(SPEAKING)) {
            await c.d.key("Escape", "none", c.budget);
            await c.d.tryHold(`!(${SPEAKING}) || (${CHOICES}).length > 0 || !(${TALKING})`, 6000);
            continue;
          }
          if (!(await c.d.tryHold(`(${CHOICES}).length > 0 || !(${TALKING})`, 6000))) break;
          continue;
        }
        await CORE_ACTIONS.say.run({
          ...c,
          step: { ...c.step, args: [], bevels: [offered[0]], opts: { ...c.step.opts, then: "stop" } },
          wait: "none",
        });
      }
      if (await talking()) {
        const offered = await c.d.evaluate<{ id: number; text: string }[]>(
          `((window.dbg.viewer && window.dbg.viewer.choices) || []).map((ch) => ({ id: ch.id, text: String(ch.text || "") }))`,
        );
        throw new Error(
          `a conversation interrupted the walk and would not close — answer it in the ` +
            `sheet (talk(...) or say([...])), or pass replies: to this line. ` +
            (offered.length
              ? `Its plaque offers ${offered.map((o) => `${o.id}:${o.text}`).join(" | ")}`
              : `Nothing is on its plaque — it is still speaking, which is what the ` +
                `HELP overlay does and no reply closes`),
        );
      }
      c.say("answered something on the way");
    };

    interface Cell {
      name: string;
      x: number;
      z: number;
      build: boolean;
      views: { name: string; id: number }[];
    }
    const READ = `(() => {
      const v = window.dbg.viewer, s = window.dbg.session;
      if (!v || !v.set) return null;
      return {
        set: String(s.currentSetFile || "").toLowerCase().replace(/\.set$/, ""),
        here: String(v.scene.sceneName || "").toLowerCase(),
        cells: v.set.scenes.map((sc) => ({
          name: String(sc.sceneName || "").toLowerCase(),
          x: Math.round((sc.sceneLocation[0] - 128) / 256),
          z: Math.round((sc.sceneLocation[2] - 128) / 256),
          build: !!sc.build,
          views: sc.views.map((w) => ({ name: String(w.viewName || "").toLowerCase(), id: w.viewID })),
        })),
        roads: v.set.transitions.map((t) => [t.viewIDstart, t.viewIDend]),
      };
    })()`;

    let spent = 0;
    let last = "";
    /*
     * Re-planned from where we ACTUALLY are, every pass — the note above says
     * why both halves of that are needed. Each pass: answer anything open,
     * settle, read the room, plan, walk it.
     */
    for (let attempt = 1; attempt <= tries; attempt++) {
      await clearOrSay();
      await c.d.settle("quiet", `the room before planning the walk to ${x},${z}`, c.budget);

      const room = await c.d.evaluate<{
        set: string;
        here: string;
        cells: Cell[];
        roads: [number, number][];
      } | null>(READ);
      if (!room) throw new Error(`there is no room in memory to plan a walk through`);

      // The guard `stand` earned the hard way, and it costs one word: a plan made
      // in the wrong room is not obviously wrong, it is a correct route through
      // somewhere else.
      const mustBe = (c.step.opts.set ?? "").toLowerCase();
      /**
       * `nite` AND `town` ARE THE SAME PLACE, and the guard has to know it.
       *
       * The town by day is `TOWN.SET` and the same town at night is `NITE.SET` —
       * one 15x15 grid drawn twice, which is why the engine answers `"town"` for
       * `currentset ()` in both (`hotdist ()` reads it, and the rungs say so).
       * The playthrough plans over whichever of the two its rung happens to have
       * bound and never asks the room's name, because either file's geometry is
       * the right geometry.
       *
       * So a guard that compares names is stricter than the thing it is
       * guarding, and it failed three legs of a sweep that were perfectly well
       * placed: "goto(6, 8) expects to be in nite and this is town". Everything
       * else stays strict — `hub` against `snake`, `hotupper` against
       * `hotlower` are different rooms and a plan made in the wrong one is the
       * mistake this guard exists to catch.
       */
      const sameRoom = (a: string, b: string): boolean => {
        if (a === b) return true;
        const town = new Set(["nite", "town"]);
        return town.has(a) && town.has(b);
      };
      if (mustBe && !sameRoom(room.set, mustBe)) {
        /**
         * THE ROOM MAY BE ARRIVING, so wait for it before saying it is wrong.
         *
         * An interior is entered by CONSEQUENCE here, not by a gesture aimed at
         * it: an `uparrow` into the right cell runs `gotointerior ("court.set")`
         * from the scene's own script, and a puzzle's last act is
         * `sendtoset (gotohub ())`. Either way the press that causes it has
         * already returned by the time the next line reads the room, and the
         * room changes a moment later.
         *
         * So five legs of a sweep failed on a room that was on its way — "goto(2,
         * 4) expects to be in hub and this is tbird" — which is the guard being
         * right about the instant and wrong about the leg. Waiting costs nothing
         * where the room is already correct, because this branch is only reached
         * when it is not.
         */
        const ROOM = `String(window.dbg.session.currentSetFile || "").toLowerCase().replace(/\.set$/, "")`;
        const arrived = await c.d.tryHold(
          `${ROOM} === ${JSON.stringify(mustBe)}` +
            (sameRoom("nite", mustBe) ? ` || ${ROOM} === ${JSON.stringify(mustBe === "nite" ? "town" : "nite")}` : ""),
          Math.min(Math.max(c.budget, 20_000), 30_000),
        );
        if (!arrived) {
          throw new Error(
            `goto(${x}, ${z}) expects to be in ${mustBe} and this is ${room.set}, and it ` +
              `did not become ${mustBe} while we waited — whatever opens that room has not ` +
              `been done yet`,
          );
        }
        // the room changed under us, so the plan has to be made again in it
        c.say(`waited for ${mustBe} to open`);
        continue;
      }

      const goal = room.cells.find((s2) => s2.x === x && s2.z === z);
      if (!goal || !goal.views.length) {
        const walkable = room.cells.filter((s2) => s2.views.length);
        throw new Error(
          !goal
            ? `${room.set} has no cell at ${x},${z} — its grid does not reach that far`
            : `${room.set}'s cell ${x},${z} (${goal.name}) cannot be stood on` +
              (goal.build ? " — it is built on" : " — it has no views") +
              `. The ${walkable.length} that can: ` +
              walkable.map((s2) => `${s2.x},${s2.z}`).join(" "),
        );
      }

      // ARRIVED, which is asked at the top of the pass rather than the bottom so
      // that a walk the world finished for us costs nothing
      if (room.here === goal.name) {
        if (want) {
          await CORE_ACTIONS.face.run({ ...c, step: { ...c.step, args: [want] }, wait: "none" });
        }
        c.say(
          `${room.set} ${goal.name} (${x},${z})` +
            (spent ? `, ${spent} road(s)${attempt > 1 ? ` over ${attempt} plans` : ""}` : ", already there"),
        );
        await c.d.settle(c.wait, `the walk to ${x},${z}`, c.budget);
        return;
      }

      // where every view id lives, so a road can say which cell it joins
      const at = new Map<number, { scene: string; view: string }>();
      for (const s2 of room.cells) for (const w of s2.views) at.set(w.id, { scene: s2.name, view: w.name });

      const steps: { face: string }[] = [];
      const prev = new Map<string, { from: string; leave: string }>();
      const seen = new Set([room.here]);
      const queue = [room.here];
      while (queue.length) {
        const now = queue.shift()!;
        if (now === goal.name) break;
        /*
         * ONE WAY, and this is the one place Dust's geometry is not Titanic's.
         *
         * `stand` walks a road in either direction, and here that plans routes
         * that cannot be walked: a road joins STANDPOINTS, so `viewIDstart` is
         * both where you stand and which way you face, while `viewIDend` is the
         * view you arrive facing — which looks onward, not back the way you
         * came. Taken backwards it reads as "stand at the far view and walk",
         * and the far view faces the wrong way.
         *
         * Measured: from `scene g15` (6,14) the bidirectional version planned
         * `south -> south -> south -> south` up a street that runs the other
         * way, and the first press reported "three ArrowUp presses and the world
         * did not move ... nothing is refusing it, so there is simply nowhere to
         * go" — the correct diagnosis of a plan that was nonsense.
         *
         * Nothing is lost by it. The town authors both directions separately:
         * 110 roads over the 52 cells that can be stood on, which is every
         * adjacency twice, once each way.
         */
        for (const [from, to] of room.roads) {
          const side = at.get(from);
          const other = at.get(to);
          if (!side || !other || side.scene !== now || seen.has(other.scene)) continue;
          seen.add(other.scene);
          prev.set(other.scene, { from: now, leave: side.view });
          queue.push(other.scene);
        }
      }
      if (!prev.has(goal.name)) {
        throw new Error(
          `no way through ${room.set} from ${room.here} to ${goal.name} (${x},${z}) — ` +
            `nothing joins them, so one of the two is off the street`,
        );
      }
      for (let sc = goal.name; sc !== room.here; sc = prev.get(sc)!.from) {
        steps.unshift({ face: prev.get(sc)!.leave });
      }

      const where = `${room.set} (from ${room.here})`;
      const via = steps.map((s2) => s2.face).join(" -> ");
      /**
       * NOT INTO A FROZEN WORLD.
       *
       * `lockevents` is the strongest refusal in the engine and the only one
       * that is not a state of the viewer: it is a script global, so `quiet`,
       * `faded` and `ready` all answer true through it, and a gesture made
       * while it is set is THROWN AWAY — not queued, not logged. `arrow`'s own
       * gate is `IDLE`, which is `!inputLocked && no events`, and `inputLocked`
       * does not read it.
       *
       * So a walk that arrives during one of the scripts that freeze the world
       * spends its presses on nothing and reports the truth in a way that reads
       * like a bad plan: "three ArrowUp presses and the world did not move ...
       * the world is FROZEN (lockevents)". Waiting is all that is needed, and it
       * is bounded — a freeze that never lifts is worth failing on.
       */
      /** the engine will act on a press rather than file it or drop it */
      const IDLE_ENOUGH = `(() => {
        const v = window.dbg.viewer, s = window.dbg.session;
        if (!v) return false;
        if (v.moviePlaying || v.conversing) return true;
        return !v.inputLocked && s.events.length === 0;
      })()`;
      const FROZEN = `(() => {
        const v = window.dbg.session.interp.globals.get("lockevents") ?? 0;
        return typeof v === "number" ? v !== 0 : String(v).length > 0;
      })()`;
      /**
       * ONE STEP AT A TIME, CHECKED — because the world moves while you walk.
       *
       * A plan is a list of facings made from one standpoint, and Dust's
       * standpoints act when you land on them: a scene's `openscene` can turn
       * you, a `hasattention` can start a conversation, a trigger cell can run
       * `gotointerior`. Press the rest of the plan into that and every remaining
       * step is aimed from a cell you are no longer standing in — which arrives
       * as "three ArrowUp presses and the world did not move", a true report
       * about a plan that stopped being true after its first step.
       *
       * So each step is followed by a look: still where the plan thinks? If not,
       * stop pressing and re-plan from where we actually are, which is what the
       * outer loop is for. It costs one read per cell and it is the difference
       * between a walk that recovers and a leg that fails.
       */
      const CELL = `(() => {
        const v = window.dbg.viewer;
        if (!v) return "";
        return String(v.scene.sceneName || "").toLowerCase();
      })()`;
      let expected = room.here;
      let drifted = "";
      try {
        for (const step of steps) {
          /*
           * Wait for the world to be BOTH unfrozen and willing to take a press.
           *
           * Two different refusals and a walk meets both: `lockevents` throws a
           * gesture away, and a script still running makes `inputLocked` true so
           * the press waits on its own gate and dies there — "stuck waiting for
           * the engine to be ready for ArrowRight", which is a leg that arrived
           * a moment after something else started rather than a bad plan. The
           * bound is generous because the thing being waited out is somebody
           * else's script, not ours.
           */
          await c.d.tryHold(
            `!(${FROZEN}) && (${IDLE_ENOUGH})`,
            Math.min(Math.max(c.budget, 20_000), 30_000),
          );
          await CORE_ACTIONS.face.run({ ...c, step: { ...c.step, args: [step.face] }, wait: "none" });
          // `wait: none` because `arrow` confirms the walk itself, by the
          // standpoint changing, and presses again when it did not — a settle
          // here would be paid once per cell for nothing
          await CORE_ACTIONS.up.run({ ...c, step: { ...c.step, args: [] }, wait: "none" });
          spent++;
          // where the step actually put us — a walk arrives in ONE of the cells
          // the road could reach, and anything else means the world intervened
          const now = await c.d.evaluate<string>(CELL);
          if (now && now !== expected) {
            expected = now;
          }
          if (now === goal.name) break; // there already; the rest of the plan is moot
        }
        // and if the plan ran out somewhere other than the goal, say so and let
        // the outer loop plan again from here rather than reporting success
        const ended = await c.d.evaluate<string>(CELL);
        if (ended && ended !== goal.name) {
          drifted = ended;
          throw new Error(
            `the walk ended at ${ended} rather than ${goal.name} — the world moved while we walked`,
          );
        }
      } catch (e) {
        /*
         * A walk that stops is USUALLY somebody talking, and the next pass
         * answers it and re-plans from wherever we got to. Only the last pass
         * fails, and it fails with the plan in the message — the room a plan was
         * made in has been the answer twice.
         */
        last =
          `${(e as Error).message}\n    planning in ${where} via ${via}` +
          (drifted ? ` (ended at ${drifted})` : "");
        if (attempt === tries) throw new Error(last);
        c.say(`plan ${attempt} stopped after ${spent} road(s); re-planning`);
        continue;
      }
    }
    throw new Error(
      last || `${tries} plans and never reached ${x},${z} — the walk kept being interrupted`,
    );
  },
};

/* ------------------------------------------------------------------ *
 * The avatar panel, which two verbs work
 * ------------------------------------------------------------------ */

/** what the game says is in your hand, lower-cased */
const HAND = `String(window.dbg.session.interp.globals.get("handitem") ?? "")`;
/** the flat on screen — `mainpanel` while playing, `avatar` while the panel is up */
const FLAT = `String(window.dbg.session.currentFlat || "").toLowerCase()`;

/**
 * A named region of a flat, as a point to click.
 *
 * NOT `click(self)`, and the reason is the one thing about this panel that
 * surprises: the aim sweep only tests a flat's regions when the game is IN that
 * flat (`inFlat` is `!viewShowing && stageScript`, aim.ts), and during play the
 * room view is showing — `mainpanel` is the frame AROUND it, so its three
 * buttons are outside everything the sweep looks at. Measured: `click(self)`
 * answers "nothing called self is clickable from here" with the panel plainly on
 * screen.
 *
 * So the rectangle is read from the stage's own table, which is where
 * `dust/tools/flatprops.ts` reads it too — the name is still the name, it is
 * simply looked up rather than hunted for.
 */
async function flatRegion(
  c: ActionContext,
  flat: string,
  name: string,
): Promise<{ x: number; y: number }> {
  const at = await c.d.evaluate<{ x: number; y: number } | null>(`(() => {
    const r = window.dbg.session.stageCtrl.flatRegion(${JSON.stringify(flat)}, ${JSON.stringify(name)});
    return r ? { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) } : null;
  })()`);
  if (at) return at;
  /**
   * THE RECTANGLE, WHEN THE TABLE WILL NOT ANSWER.
   *
   * `flatRegion` reads the CURRENT stage file's regions, and which file that is
   * depends on what opened the panel: `takeInHand` opens it from `mainpanel` and
   * the lookup works, while a conversation's `selhandbevel ()` opens it over a
   * stage of its own and the same lookup comes back with nothing at all —
   * `avatar has no button called "OK" — it has none`, with the panel plainly on
   * screen and its OK plainly on it.
   *
   * So these two fall back to the numbers `new.flt` itself carries, which is
   * where `dust/tools/flatprops.ts` reads them and what the playthrough fires at
   * directly (`p.fire((266 + 367) / 2, (321 + 345) / 2)`). Hard-coded on
   * purpose and only for the two the route cannot do without; anything else
   * still fails loudly, because a wrong rectangle is a click into the game.
   */
  const KNOWN: Record<string, { x: number; y: number }> = {
    "avatar/ok": { x: 317, y: 333 },
    "mainpanel/self": { x: 451, y: 324 },
  };
  const known = KNOWN[`${flat.toLowerCase()}/${name.toLowerCase()}`];
  if (known) return known;
  const had = await c.d.evaluate<string[]>(
    `window.dbg.session.stageCtrl.flatButtonNames(${JSON.stringify(flat)})`,
  );
  throw new Error(`${flat} has no button called "${name}" — it has ${had.join(", ") || "none"}`);
}

/**
 * The avatar panel, already open: click a carried thing, then OK.
 *
 * Shared by {@link TAKE_IN_HAND} and {@link OFFER} because it is the same panel
 * in both — the difference is only what opened it, `mainpanel`'s `self` button in
 * one case and a conversation's own plaque in the other.
 *
 * ## The wait nobody expects
 *
 * `pollingInput ()` before the item is clicked, and it is not caution. The panel
 * is not listening the moment it is on screen: whatever opened it fades to it
 * (`blacktoscreen ("stage", 30)`) and only THEN enters `handleselect ()`, whose
 * `if button ()` is what a press has to arrive at. A press that beats the loop is
 * dropped in silence, the OK a moment later closes the panel with `handitem`
 * unchanged, and the next thing that reads the hand gets whatever was in it
 * before — measured in the harness as the harmonica going to Trotter with
 * `trotterphase` still 3. `pollingInput ()` is the engine's own answer to "is a
 * script sitting in an input poll right now", which is exactly the question.
 *
 * OK is pressed WHATEVER happened, because a panel left open is a game with no
 * room on screen and every later gesture aimed at the wrong flat. Whether the
 * item made it is the return value, not an exception — the two callers report it
 * differently.
 */
async function pickFromAvatar(c: ActionContext, item: string): Promise<boolean> {
  const want = item.toLowerCase();
  const held = async (): Promise<string> => (await c.d.evaluate<string>(HAND)).toLowerCase();
  await c.d.tryHold(`window.dbg.session.pollingInput()`, Math.min(c.budget, 10_000));

  // Where the panel drew it, asked each time round: `showprop ()` lays the
  // carried props out when the flat opens, so this is only answerable now.
  for (let go = 0; go < 4 && (await held()) !== want; go++) {
    const at = await c.d.evaluate<{ x: number; y: number } | null>(`(() => {
      const i = window.dbg.session.interp;
      const f = i.builtins.get("propxy");
      if (!f) return null;
      const x = Number(f(i, [${JSON.stringify(item)}, 1]));
      const y = Number(f(i, [${JSON.stringify(item)}, 2]));
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })()`);
    if (!at) throw new Error(`the engine will not say where the panel drew ${item}`);
    /**
     * A HELD PRESS, not a click — on both the item and the OK.
     *
     * This panel is a POLL LOOP rather than an event handler, and the release is
     * what carries the meaning, twice over: `handleselect ()` ends its pass on
     * `while button () endwhile`, and the OK button's `trackbut ()` returns
     * `not theres` only once `while stilldown ()` has let go. A quick
     * press-release can begin and end between two turns of that loop and never
     * be seen at all.
     *
     * Which is exactly how a continuous run died at `offer(jug)`: the jug
     * reached the hand — so the item's press was seen — and then "stuck waiting
     * for the avatar panel to close", with the last press the engine logged
     * being the jug's own slot and never OK's. The harness holds both presses
     * for twenty frames for this reason; `holdAt` is that, and it holds until
     * the thing it is waiting for has happened rather than for a count.
     */
    await c.d.holdAt(
      at.x,
      at.y,
      { until: `${HAND}.toLowerCase() === ${JSON.stringify(want)}` },
      Math.min(c.budget, 8000),
    );
  }
  const got = (await held()) === want;

  const ok = await flatRegion(c, "avatar", "OK");
  await c.d.holdAt(ok.x, ok.y, { until: `${FLAT} !== "avatar"` }, Math.min(c.budget, 10_000));
  await c.d.hold(`${FLAT} !== "avatar"`, "the avatar panel to close", c.budget);
  return got;
}

/** everything the player is carrying, by name — for an error worth reading */
async function carried(c: ActionContext): Promise<string[]> {
  return c.d.evaluate<string[]>(`(() => {
    const out = [];
    for (const [n, p] of window.dbg.session.propRuntime.props) {
      if (String(p.owner ?? "").toLowerCase() === "stranger") out.push(n);
    }
    return out;
  })()`);
}

/**
 * Put a thing you are CARRYING into your hand — the avatar panel, worked.
 *
 * Three gestures, and they are the game's own: open the avatar, click the thing
 * where the panel has laid it out, press OK. `new.flt` names both ends of that
 * (dust/tools/flatprops.ts prints the file):
 *
 *     mainpanel  self  395,268-507,379   ->  gotoflat (3)   the avatar
 *     avatar     OK    266,321-367,345   ->  gotoflat (1)   back to the game
 *
 * so neither is a hardcoded rectangle here — both are clicked BY NAME, because a
 * flat's region hit-tests as a button and `click` already finds those.
 *
 * ## Why it is not just `click(item)`
 *
 * Because a carried prop is not on the screen. Measured in the page with the
 * sugarcubes carried: `click(sugarcubes)` answers "nothing called sugarcubes is
 * clickable from here", and the prop's own record says why — it has a slot
 * (130,264) and a view of "panel", and `visible` is FALSE. The avatar's
 * `openflat ()` is what changes that: it runs `showprop ()` over
 * `indextoday4 ()`, which is what sets each carried prop's view to "panel" —
 * the view `INVEN.PRP/0001 stdmouse ()` insists on before a click on it can
 * become `handitem`.
 *
 * A prop lying in a ROOM needs none of that, and this verb takes that case too —
 * see the note in the body. One intention, two gestures, and the caller should
 * not have to know which: the playthrough's own helper does not distinguish them
 * either, and `opening.ts` uses it on a Bone lying in the street.
 *
 * ## The wait nobody expects
 *
 * `pollingInput ()` before the item is clicked, and it is not caution. The panel
 * is not listening the moment it is on screen: `selhandbevel ()` fades to it
 * (`blacktoscreen ("stage", 30)`) and only THEN enters `handleselect ()`, whose
 * `if button ()` is what a press has to arrive at. A press that beats the loop is
 * dropped in silence, the OK a moment later closes the panel with `handitem`
 * unchanged, and the NEXT thing that reads the hand gets whatever was in it
 * before — measured in the harness as the harmonica going to Trotter with
 * `trotterphase` still 3. `pollingInput ()` is the engine's own answer to "is a
 * script sitting in an input poll right now", which is exactly the question.
 */
const TAKE_IN_HAND: Action = {
  args: [1, 1],
  wait: "quiet",
  sig: "takeInHand(mask)",
  help: "open the avatar, pick a carried thing up into your hand, press OK — takeInHand(mask)",
  run: async (c) => {
    const item = c.step.args[0];
    if ((await c.d.evaluate<string>(HAND)).toLowerCase() === item.toLowerCase()) {
      c.say(`already in hand`);
      return;
    }

    /**
     * CARRIED ALREADY? Then the room is not where it is, and the hunt below is
     * four view turns spent proving it.
     *
     * This comment was here without the code under it, and the cost was the
     * whole common case: `takeInHand(jug)` for a thing in the inventory swept
     * four views, clicked whatever it found, waited for a hand that was never
     * going to fill, turned the ring three times, and only then opened the
     * panel — where the jug had been the whole time. One cheap read of
     * `propowner` skips all of it.
     *
     * The room search stays for the other case, and it is the case the route
     * actually names first: the Bone lies in the street and is nobody's.
     */
    const mineNow = await carried(c);
    const owned = mineNow.some((n) => n.toLowerCase() === item.toLowerCase());

    /**
     * WHERE THE ENGINE SAYS IT DREW IT, before hunting for it.
     *
     * `propxy` first and `aim` only after, because the aim sweep is a grid — it
     * hit-tests every few pixels — and the things a route picks up are often
     * exactly what a grid steps over. The Bone is the case: `INVEN.PRP/0002
     * setupprop ("street")` puts it at `town.bone` with `propview = "small"`,
     * one cell west of the standpoint it is taken from, and the sweep came back
     * with nothing at all — "it is not on screen".
     *
     * It was never a question about the picture. `INVEN.PRP/0001 stdmouse ()`
     * for a `"small"` prop is `if realdist (what) < hotdist () → addinven
     * (what)`, a WORLD distance — 190 against `hotdist ()`'s 512 — which is why
     * the harness takes it by dispatching the prop's `mousedown` at the
     * interpreter and never asks where it is drawn. A verb may not do that: it
     * has to click. So it clicks the point the engine itself drew the thing at.
     */
    const drawnAt = async (): Promise<{ x: number; y: number; visible: boolean } | null> =>
      c.d.evaluate<{ x: number; y: number; visible: boolean } | null>(`(() => {
        const s = window.dbg.session, i = s.interp;
        const f = i.builtins.get("propxy");
        if (!f) return null;
        const x = Number(f(i, [${JSON.stringify(item)}, 1]));
        const y = Number(f(i, [${JSON.stringify(item)}, 2]));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const p = s.propRuntime.get(${JSON.stringify(item.toLowerCase())});
        return { x, y, visible: !!(p && p.visible) };
      })()`);
    const drawn = owned ? null : await drawnAt();

    const want = item.toLowerCase();
    const inHand = `${HAND}.toLowerCase() === ${JSON.stringify(want)}`;
    /**
     * How long a TAKEN click gets to fill the hand — 4 seconds once, and that
     * was the whole delay before every ring turn.
     *
     * `stdmouse ()` is not asynchronous: `addinven (what)` runs in the pass that
     * handles the press, so `handitem` is set by the time the gesture has been
     * consumed and `clickAt(..., "taken")` has already waited for that. What is
     * left to wait for is a frame, not a second — and a click that missed waited
     * the full four every time, twice a view, which is 32 seconds of a verb
     * whose whole job takes three gestures.
     */
    const TOOK = 700;
    let looked = "";
    for (let turn = 0; !owned && turn < 4; turn++) {
      /**
       * AND TURN TO LOOK FOR IT, which is the other half of clicking a thing.
       *
       * A route arrives facing the way the rung's walk asked for, and that
       * facing was chosen for what happens NEXT rather than for what is being
       * picked up: the Bone is taken from `nite` (6,14) facing north and it lies
       * one cell WEST, at (5,14). The harness does not care — it dispatches the
       * prop's `mousedown` and the pickup is a world distance — but a click has
       * to have the thing on screen, so this looks round the cell for it. Four
       * turns, because a cell has four views and the fifth would be the first
       * again.
       *
       * The same shape `accost` uses on a person who is not in reach, for the
       * same reason: turning and trying again is what a player does.
       */
      const at = turn === 0 ? drawn : await drawnAt();
      const tried: string[] = [];
      /*
       * The sweep is the FALLBACK and is now only run as one.
       *
       * Both points used to be gathered before either was clicked, so every
       * view paid for a full grid hit-test even when `propxy` had already said
       * where the thing was. The sweep is the expensive read in this verb; a
       * lazy list means the common case never performs it.
       */
      for (const find of [
        async () =>
          at && at.visible && at.x > 0 && at.y > 0 && at.x < 512 && at.y < 384 ? { x: at.x, y: at.y } : null,
        () => c.d.aim("thing", item),
      ]) {
        const spot = await find();
        if (!spot) continue;
        // the sweep landing on the point `propxy` just named is the same click
        if (tried.some((t) => t === `${spot.x},${spot.y}`)) continue;
        tried.push(`${spot.x},${spot.y}`);
        await c.d.clickAt(spot.x, spot.y, "taken", c.budget);
        if (await c.d.tryHold(inHand, TOOK)) {
          c.say(
            `${item} picked up where it lay, at ${spot.x},${spot.y}` +
              (turn ? ` after ${turn} turn${turn > 1 ? "s" : ""}` : ""),
          );
          await c.d.settle(c.wait, `the world after taking ${item}`, c.budget);
          return;
        }
      }
      looked += `${tried.length ? tried.join("+") : "nothing"} `;
      if (turn < 3) await CORE_ACTIONS.right.run({ ...c, step: { ...c.step, args: [] }, wait: "none" });
    }
    // carried, or nowhere round this cell: the panel is the other thing that can
    // put it in hand, and it is where a thing you are already CARRYING lives
    const wasOpen = (await c.d.evaluate<string>(FLAT)) === "avatar";
    if (!wasOpen) {
      // mainpanel's `self` is `gotoflat (3)`, the avatar — new.flt says so
      const self = await flatRegion(c, "mainpanel", "self");
      await c.d.clickAt(self.x, self.y, "taken", c.budget);
      await c.d.hold(`${FLAT} === "avatar"`, "the avatar panel to open", c.budget);
    }
    const got = await pickFromAvatar(c, item);
    if (!got) {
      const now = await c.d.evaluate<string>(HAND);
      const mine = await carried(c);
      throw new Error(
        `${item} would not go in hand. ` +
          // which halves actually ran, because "the panel refused a thing you
          // own" and "it is in neither the room nor the panel" are different
          // faults and the message used to report an empty room search for both
          (owned
            ? `The player is carrying it, so the panel is the only place it could come from, and it `
            : `Round the four views of this cell it was at [${looked.trim()}], and the panel `) +
          `would not take it${owned ? "" : " either"}; the hand holds "${now || "nothing"}" ` +
          `and the player is carrying ${mine.join(", ") || "nothing"}` +
          (drawn ? `. The engine draws it at ${drawn.x},${drawn.y}${drawn.visible ? "" : ", invisible"}` : ""),
      );
    }
    c.say(`${item} in hand${wasOpen ? " (the panel was already open)" : ""}`);
    await c.d.settle(c.wait, `the panel after taking ${item}`, c.budget);
  },
};

/**
 * Offer what you are carrying to whoever you are TALKING to.
 *
 * The other half of giving, and the commoner half: the harness reaches for this
 * ten times against `dropOn`'s one. {@link GIVE} drags a thing onto somebody
 * standing in the room; this hands it over inside a conversation, which is the
 * only way for a character who is never an actor on the screen at all. Ruby is
 * exactly that — "Ruby is never an actor on this landing" — so the ring reaches
 * her through her own plaque and could not reach her any other way.
 *
 * ## The plaque, and the picker behind it
 *
 * `INVEN.PRP/0001 addhandbevel ()` adds one reply to whatever conversation is
 * open, numbered **55555**, and `selhandbevel ()` answers it by calling
 * `gift (handitem)` on that character's boot script. But only sometimes: with
 * `handflag = 1` it opens the inventory picker instead, and `handflag` is set by
 * every `addinven ()`, so it is 1 for most of the game. The plaque then reads
 * "Would you like something...?" rather than "Would you like this jug?", and the
 * first press is the panel asking WHICH.
 *
 * So this presses it, works the picker if one comes up, and presses it again —
 * now naming the thing, which is the press that gifts.
 *
 * ## Three ways it can end, not two
 *
 * `selhandbevel ()` can open the panel; it can gift and leave the conversation
 * running, which shows as a NEW question; or it can gift and END the
 * conversation — `TROTTER.PUP/0076 hesdrunk ()` and `RUBY.PUP/0007 gift ()`
 * both do, the latter by setting `rubyphase = 2` which its own `twopm ()` then
 * exits on. Waiting only for the first two hangs on the third with the answered
 * plaque still framed, which is why the wait below takes all three.
 */
const OFFER: Action = {
  args: [1, 1],
  wait: "none",
  opts: ["tries"],
  sig: "offer(ring)",
  help: "hand what you are carrying to whoever you are talking to — the 55555 plaque, and its picker",
  run: async (c) => {
    const item = c.step.args[0];
    const want = item.toLowerCase();
    const tries = Math.max(1, Number(c.step.opts.tries ?? 3));
    const TALKING = `!!(window.dbg.viewer && window.dbg.viewer.conversing)`;
    const QUESTION = `((window.dbg.viewer && window.dbg.viewer.choices) || []).map((ch) => ch.id).join(",")`;
    const PLAQUE = `((window.dbg.viewer && window.dbg.viewer.choices) || []).some((ch) => ch.id === 55555)`;

    if (!(await c.d.evaluate<boolean>(TALKING))) {
      throw new Error(
        `offer(${item}) needs a conversation — nobody is talking. ` +
          `To drop it on somebody standing in the room, that is give(${item}, to, them)`,
      );
    }
    const mine = await carried(c);
    if (!mine.some((n) => n.toLowerCase() === want)) {
      throw new Error(`you are not carrying ${item} — the player has ${mine.join(", ") || "nothing"}`);
    }

    for (let go = 0; go < tries; go++) {
      if (!(await c.d.evaluate<boolean>(TALKING))) {
        c.say(`the conversation ended — ${item} went with it`);
        return;
      }
      if (!(await c.d.evaluate<boolean>(PLAQUE))) {
        // the offer plaque is not up yet; it arrives with the next question
        if (!(await c.d.tryHold(PLAQUE, Math.min(c.budget, 8000)))) {
          const now = await c.d.evaluate<string>(QUESTION);
          throw new Error(
            `no offer plaque (55555) in this conversation — it is asking ${now || "nothing"}. ` +
              `That reply is the inventory's own and only appears where a gift is possible`,
          );
        }
      }
      const before = await c.d.evaluate<string>(QUESTION);
      await CORE_ACTIONS.say.run({
        ...c,
        step: { ...c.step, args: [], bevels: [55555], opts: { ...c.step.opts, then: "stop" } },
        wait: "none",
      });
      // the three endings, as alternatives — see the note above
      await c.d.tryHold(
        `(${FLAT} === "avatar") || !(${TALKING}) || (${QUESTION} !== ${JSON.stringify(before)})`,
        Math.min(c.budget, 20_000),
      );
      if ((await c.d.evaluate<string>(FLAT)) !== "avatar") {
        // gifted outright, or the conversation moved on with it
        const owner = await c.d.evaluate<string>(
          `String(window.dbg.session.propRuntime.get(${JSON.stringify(want)})?.owner ?? "")`,
        );
        c.say(`offered ${item}${owner ? `, and it belongs to "${owner}" now` : ""}`);
        return;
      }
      if (!(await pickFromAvatar(c, item))) {
        const now = await c.d.evaluate<string>(HAND);
        throw new Error(`the picker would not take ${item} — the hand holds "${now || "nothing"}"`);
      }
      // and round again: the plaque now names the thing, and that press gifts
    }
    throw new Error(`${item} was never taken — ${tries} presses of the offer plaque`);
  },
};

/**
 * A door: clicked where the SCENE shows through it, then walked into.
 *
 * 115 of the playthrough's gestures, which makes it the second-biggest thing a
 * Dust route does after walking. It is not the engine's `door()` — that is
 * Space, and Titanic's doors answer Space. This game's answer a CLICK inside a
 * rectangle the set's own script owns (`SALUPPER.SET/0034` gates its knock on
 * `pointinruby` 138,2-327,263), so the rectangle is the argument, exactly as the
 * rungs write it.
 *
 * ## The aim is the whole verb
 *
 * Not the middle of the rectangle. `walktopuppet ()` walks whoever you were just
 * talking to onto the PLAYER's own cell — which is the cell a door is opened
 * from — so after any conversation in a doorway that person is drawn across it,
 * and the hit test answers `actor` before it answers the scene. The click then
 * opens their file instead of the door, silently, six times over. Three rungs
 * found that independently: Buick across the hotel door, Laurel across the
 * courthouse, the Mayor across the doctor's.
 *
 * So the engine is asked which part of this rectangle is currently the SCENE and
 * the click goes there. A rectangle with no such point is one somebody is
 * standing squarely in front of, and the answer to that is to wait for them to
 * move, which the retry loop does.
 *
 * ## Being through it already
 *
 * `owner:` is how a door says it opened — `propowner("door")` becomes the
 * name the set's script gives it — and it is optional because the more reliable
 * evidence is cruder: the room changed. A press still in the queue when the
 * click lands is an ungated `uparrow`, which at a door standpoint is
 * `currentscene ("strait")` — straight through the door that click just opened.
 * The prop is then the ARRIVED room's `door`, which is nobody's, so a check on
 * the owner says "not open" about a door already behind you and the retry walks
 * in a room the standpoint does not exist in. Going through is what the caller
 * wanted, so it is noticed and taken. Found at the jail door once a change
 * shortened every move by a tick and moved which press was outstanding.
 */
const DOOR_AT: Action = {
  args: [4, 4],
  wait: "quiet",
  opts: ["owner", "tries"],
  sig: "doorAt(241, 92, 307, 201, owner: saloon)",
  help: "click a door's rectangle where the scene shows through it and walk in — doorAt(x0,y0,x1,y1)",
  run: async (c) => {
    const box = c.step.args.map(Number);
    if (box.some((n) => !Number.isFinite(n))) {
      throw new Error(`doorAt takes four numbers — doorAt(241, 92, 307, 201)`);
    }
    const [x0, y0, x1, y1] = box;
    const owner = (c.step.opts.owner ?? "").toLowerCase();
    const tries = Math.max(1, Number(c.step.opts.tries ?? 6));
    const ROOM = `String(window.dbg.session.currentSetFile || "").toLowerCase()`;
    const startedIn = await c.d.evaluate<string>(ROOM);
    const wentThrough = async (): Promise<boolean> =>
      (await c.d.evaluate<string>(ROOM)) !== startedIn;
    const opened = async (): Promise<boolean> => {
      if (!owner) return false;
      return (
        (
          await c.d.evaluate<string>(`(() => {
            const i = window.dbg.session.interp;
            const f = i.builtins.get("propowner");
            return String(f ? f(i, ["door"]) ?? "" : "");
          })()`)
        ).toLowerCase() === owner
      );
    };

    /**
     * A point inside the rectangle that the SCENE answers for.
     *
     * One round trip rather than one per candidate: the sweep is the engine's
     * own hit test and it is cheap in the page, but a hundred `evaluate` calls
     * across the wire is not. The step is 6 px, which is what the harness uses.
     */
    const aim = (): Promise<{ x: number; y: number } | null> =>
      c.d.evaluate<{ x: number; y: number } | null>(`(() => {
        const s = window.dbg.session;
        const isScene = function (x, y) {
          const h = s.hitTestAt(x, y);
          return !!h && String(h.type || "").toLowerCase() === "scene";
        };
        const mx = Math.round((${x0} + ${x1}) / 2), my = Math.round((${y0} + ${y1}) / 2);
        if (isScene(mx, my)) return { x: mx, y: my };
        for (let y = ${y0} + 4; y <= ${y1} - 4; y += 6) {
          for (let x = ${x0} + 4; x <= ${x1} - 4; x += 6) if (isScene(x, y)) return { x, y };
        }
        return null;
      })()`);

    let blocked = 0;
    for (let go = 0; go < tries; go++) {
      if (await wentThrough()) break;
      if (await opened()) break;
      const at = await aim();
      if (!at) {
        // somebody is standing across the whole of it; give them a moment
        blocked++;
        await c.d.sleep(Math.min(1000, c.budget));
        continue;
      }
      await c.d.clickAt(at.x, at.y, "taken", c.budget);
      await c.d.tryHold(`${ROOM} !== ${JSON.stringify(startedIn)}`, 1500);
    }

    if (await wentThrough()) {
      c.say(`already through — the room changed to ${await c.d.evaluate<string>(ROOM)}`);
      await c.d.settle(c.wait, `the room beyond`, c.budget);
      return;
    }
    if (owner && !(await opened())) {
      const standing = await c.d.evaluate<string>(`(() => {
        const s = window.dbg.session, v = window.dbg.viewer;
        return [String(s.currentSetFile || ""), v ? String(v.scene.sceneName || "") : "?",
                v ? String(v.scene.views[v.viewIdx].viewName || "") : "?"].join(" ");
      })()`);
      throw new Error(
        `the door did not open — its prop is not "${owner}", standing at ${standing}` +
          (blocked ? `; ${blocked} of ${tries} tries found somebody across the whole rectangle` : ""),
      );
    }
    // and through it, which is the half a click does not do
    await CORE_ACTIONS.up.run({ ...c, step: { ...c.step, args: [] }, wait: "none" });
    c.say(`through${blocked ? ` (waited out ${blocked} blocked look${blocked > 1 ? "s" : ""})` : ""}`);
    await c.d.settle(c.wait, `the room beyond the door`, c.budget);
  },
};

/**
 * Load one of the DISC's own saved games — the fifty-five the original player
 * left behind.
 *
 * Not {@link CORE_ACTIONS}'s `load`, which restores a checkpoint this run wrote
 * with `save()`. This one reaches for `dust/gamefiles/save/*.RTD`, which is where
 * the golden thread lives (docs/dust/thread.md): every rung of the playthrough
 * starts by loading one off the disc, and that is what makes a rung independent
 * of every rung before it.
 *
 * ## Why a route wants it
 *
 * Because a standpoint is not a state. Walking to where a save was taken puts
 * the CAMERA in the right place and nothing else: the cast is wherever the
 * world's own clocks have carried it, and a character who walks a beat behind is
 * a character the sheet's next click misses. Reported from a real run at
 * `click(leroy)` — "nothing called leroy is clickable from here", with Leroy
 * present in the cast and not in the view, from a standpoint reached by a
 * different route than the one the save records.
 *
 * Loading the save settles all of it at once: the standpoint, the cast, the
 * props, the phases and the clock, exactly as the rung that plays the leg
 * expects to find them.
 *
 * ## The promise nobody awaits
 *
 * `loadSave` is asynchronous and a sheet's `evaluate` is not: the page driver
 * runs an expression through `new Function(...)()` and hands back whatever it
 * returns, so a promise comes back as a promise and awaiting it here would await
 * nothing at all. So the call is started, its answer is parked on the window, and
 * this waits for THAT — which is also what makes the failure legible, because a
 * rejection lands somewhere a predicate can read it.
 */
const LOAD_SAVE: Action = {
  args: [1, 1],
  once: true,
  wait: "quiet",
  sig: "loadSave(D1E_001)",
  help: "load one of the disc's own saved games — loadSave(D1E_001). Not load(), which is a checkpoint",
  run: async (c) => {
    const name = c.step.args[0];
    if (!(await c.d.evaluate<boolean>(`typeof window.dbg.loadSave === "function"`))) {
      throw new Error(`this page publishes no loadSave — it is dust/src/main.ts's, on window.dbg`);
    }
    await c.d.evaluate(`(() => {
      window.__srLoad = { done: false, ok: false, error: null };
      Promise.resolve(window.dbg.loadSave(${JSON.stringify(name)})).then(
        function (r) { window.__srLoad = { done: true, ok: !!r, error: null }; },
        function (e) { window.__srLoad = { done: true, ok: false, error: String((e && e.message) || e) }; }
      );
      return true;
    })()`);
    await c.d.hold(`!!(window.__srLoad && window.__srLoad.done)`, `${name} to load`, c.budget);
    const got = await c.d.evaluate<{ ok: boolean; error: string | null }>(`window.__srLoad`);
    if (!got.ok) {
      throw new Error(
        `loadSave(${name}) would not load${got.error ? `: ${got.error}` : ""}` +
          ` — the names are the disc's own, D1E_001 through ENDING`,
      );
    }
    await c.d.settle(c.wait, `the loaded game`, c.budget);
    // WHERE it landed, because that is the whole reason the line is there
    const at = await c.d.evaluate<string>(`(() => {
      const s = window.dbg.session, v = window.dbg.viewer;
      if (!v) return String(s.currentSetFile || "") + " (no viewer)";
      return [
        String(s.currentSetFile || ""),
        String(v.scene.sceneName || ""),
        String(v.scene.views[v.viewIdx].viewName || ""),
      ].join(" ") + ", day " + String(s.interp.globals.get("day") ?? "?") +
        " clock " + String(s.interp.globals.get("clock") ?? "?");
    })()`);
    c.say(`${name}: ${at}`);
  },
};

/**
 * Go and find somebody, wherever they have got to, and get them talking.
 *
 * {@link CORE_ACTIONS.accost} turns the ring and presses; this WALKS. The
 * difference is the one a route notices: Dust's cast moves on its own errands,
 * so the person a leg wants is often not in the room's view at all — "jones is
 * far far away (like 3-4 ups in the town)" is how it was reported, with `accost`
 * having turned all four ways and found nobody.
 *
 * The playthrough's `meet` (dust/tests/playthrough/route.ts) is what this is,
 * and its shape is worth keeping intact because every part of it was earned:
 *
 *   1. **Wait for them to stand still.** A cell read off somebody mid-stride is
 *      a cell they are no longer in by the time you get there.
 *   2. **Read the cell they are standing in**, from `actorxyz`, and ask again if
 *      it is not a standpoint at all — they are between two of them for a moment.
 *   3. **Stand on THAT cell**, facing any way. Standing on it is the whole
 *      point: `walktopuppet ()`'s row/column test is what reads it, and the
 *      facing is not part of that. Which is also why the facing is left to the
 *      planner — a set's move table is authored per cell AND facing, so some
 *      standpoints cannot be stood in every way round, and naming one would
 *      fail where turning up at all would have done.
 *   4. **Then press**, and start over if they set off again in the meantime.
 *
 * `goto` does the third of those and `accost` the fourth, so this verb is mostly
 * the loop and the reasons for it.
 */
const MEET: Action = {
  args: [1, 1],
  wait: "none",
  opts: ["rounds"],
  sig: "meet(jones)",
  help: "walk to somebody wherever they have got to and get them talking — meet(jones)",
  run: async (c) => {
    const who = c.step.args[0].toLowerCase();
    const rounds = Math.max(1, Number(c.step.opts.rounds ?? 8));
    const TALK = `!!(window.dbg.viewer && window.dbg.viewer.conversing)`;
    const talking = (): Promise<boolean> => c.d.evaluate<boolean>(TALK);
    const WALKING = `!!(window.dbg.session.scheduler.isWalk(${JSON.stringify(who)}))`;
    /** the cell they are standing in, or null if they are between two */
    const cellOf = (): Promise<{ x: number; z: number } | null> =>
      c.d.evaluate<{ x: number; z: number } | null>(`(() => {
        const i = window.dbg.session.interp;
        const f = i.builtins.get("actorxyz");
        if (!f) return null;
        const x = Number(f(i, [${JSON.stringify(who)}, 1]));
        const z = Number(f(i, [${JSON.stringify(who)}, 2]));
        if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
        // a cell centre is x * 256 + 128, so this is the cell they stand in
        return { x: Math.round((x - 128) / 256), z: Math.round((z - 128) / 256) };
      })()`);

    let went = "";
    for (let round = 0; round < rounds; round++) {
      if (await talking()) {
        c.say(round ? `${who} after ${round} round${round > 1 ? "s" : ""}` : `already talking`);
        return;
      }
      // 1. let them stand still — a cell read mid-stride is already stale
      await c.d.tryHold(`!(${WALKING})`, Math.min(c.budget, 20_000));
      if (await talking()) continue;
      // 2. where are they
      const at = await cellOf();
      if (!at) {
        await c.d.sleep(Math.min(1000, c.budget));
        continue;
      }
      // 3. stand on their cell, facing whatever the roads allow
      try {
        await GOTO.run({
          ...c,
          step: { ...c.step, args: [String(at.x), String(at.z)], opts: { ...c.step.opts } },
          wait: "none",
        });
      } catch {
        /*
         * THEIR CELL IS NOT ALWAYS REACHABLE, and that is not the end of it.
         *
         * The harness insists on standing ON them because `walktopuppet ()`'s
         * row/column test reads the cell — but a click that merely REACHES them
         * opens a conversation too, and `realdist (me) < hotdist ()` is a world
         * distance rather than a cell. Five legs of a sweep died on "10,10
         * unreachable" and "2,4 unreachable" with the person visible on screen.
         *
         * So try pressing from where we are before giving the round up. It is
         * `accost`, which turns to find them, and it either works or costs a
         * turn of the ring.
         */
        went += `${at.x},${at.z} unreachable; `;
        try {
          await CORE_ACTIONS.accost.run({ ...c, step: { ...c.step, args: [who] }, wait: "none" });
          c.say(`${who} from where we stand — their cell ${at.x},${at.z} has no road to it`);
          return;
        } catch {
          // not from here either; let the loop try again once they have moved
        }
        continue;
      }
      if (await talking()) continue;
      /**
       * 4. HER ROW OR HER COLUMN IS ENOUGH — she does not have to be standing on
       *    the cell we walked to, and insisting on it is a race nobody wins.
       *
       * This used to require her exact cell, and against a character who walks
       * CONTINUOUSLY that is the losing condition: the Mayor's wife crossing the
       * night street cost eight rounds of "3,8 left before we arrived; 3,3 gone
       * by the press" and five minutes, because every round read a cell, walked
       * to it, and found her somewhere else on arrival.
       *
       * The engine asks for less. `GANG.CST/0001 walktopuppet ()` opens with `if
       * thex != 0 & they != 0 exitcode` over the cell deltas — so a click opens
       * something whenever the two of us SHARE a row or a column — and the
       * pickup test behind it, `realdist (me) < hotdist ()`, is a world distance
       * and not a cell at all. The rungs already knew: Blood is clicked "from
       * cell (9,5), which is his own column", because he shuttles (9,4) to (9,6)
       * for ever and his column is the one thing about him that holds still.
       *
       * So having walked once, we WAIT on our line instead of chasing hers. A
       * shuttling character crosses it again; a crossing one crosses it once,
       * which is all this needs.
       */
      let missed = "";
      for (let press = 0; press < 6; press++) {
        if (await talking()) {
          c.say(`${who} after ${round + 1} round${round ? "s" : ""}`);
          return;
        }
        const now = await cellOf();
        if (!now) {
          await c.d.sleep(Math.min(700, c.budget));
          continue;
        }
        if (now.x !== at.x && now.z !== at.z) {
          missed = `${now.x},${now.z} off our line; `;
          await c.d.sleep(Math.min(700, c.budget));
          continue;
        }
        try {
          await CORE_ACTIONS.accost.run({ ...c, step: { ...c.step, args: [who] }, wait: "none" });
          c.say(
            `${who} from ${at.x},${at.z} with them at ${now.x},${now.z}` +
              (round ? ` after ${round + 1} rounds` : ""),
          );
          return;
        } catch {
          // they set off again between the check and the press
          missed = `${now.x},${now.z} gone by the press; `;
        }
      }
      went += missed || `${at.x},${at.z} never shared a line; `;
    }
    throw new Error(
      `could not get to ${who} in ${rounds} rounds` + (went ? ` — ${went.trim()}` : ""),
    );
  },
};

/**
 * Get out of whatever is being said, and do not mind if nothing is.
 *
 * 71 of the playthrough's gestures — the commonest thing a Dust route does to a
 * conversation after answering one — and it is NOT `say([...], then: leave)`,
 * which is what it was transcribed as at first. Two differences, and a sweep of
 * the route failed seven legs in a row on them:
 *
 *   - `say` walks its list IN ORDER and errors when the conversation ends before
 *     the list does: "conversation ended before saying 301,201,104,102,101,103
 *     (picked nothing)". `talkOut` takes the list as an order of PREFERENCE and
 *     answers whichever of them is on the plaque.
 *   - `say` needs somebody to be talking. `talkOut` does not: it means "leave
 *     the conversation if there is one", and a leg reaching it with nobody
 *     speaking is a leg that already has what it came for.
 *
 * ## Why the list is an order of preference
 *
 * Dust's longer conversations are `while true` around their plaques and each has
 * exactly one leaving line, but not one leaving NUMBER: Buick's
 * `firstencounter ()` exits on 104, Laurel's `breakfast ()` on 301. Answering
 * anything else politely forever is a loop with no exit that looks, from
 * outside, exactly like a conversation that will not close. So the high numbers
 * come first — an author reaching for 301 is reaching for a door — and the
 * ordinary replies sit at the end, for the conversations that simply end when
 * answered.
 *
 * ## And why it waits for the first word
 *
 * Somebody who has to WALK to you is not talking yet when the route arrives, so
 * a "wait until quiet" that starts too early is satisfied by the silence in
 * front of them. Buick crossing the hotel landing took longer than three quiet
 * windows, and five attempts at that rung watched an empty screen, declared the
 * conversation over, and then walked into it.
 */
const TALK_OUT: Action = {
  args: [0, 0],
  bevels: true,
  wait: "none",
  opts: ["patience", "windows"],
  sig: "talkOut([301,201,104])",
  help: "leave a conversation, answering whichever of these replies is offered — fine if none is open",
  run: async (c) => {
    const prefer = c.step.bevels ?? [];
    const patience = Number(c.step.opts.patience ?? 20_000);
    const windows = Math.max(1, Number(c.step.opts.windows ?? 3));
    const TALK = `!!(window.dbg.viewer && window.dbg.viewer.conversing)`;
    const SPEAKING = `!!(window.dbg.viewer && window.dbg.viewer.speaking)`;
    const CHOICES = `((window.dbg.viewer && window.dbg.viewer.choices) || []).map((ch) => ch.id)`;
    const talking = (): Promise<boolean> => c.d.evaluate<boolean>(TALK);

    // the first word, before the last — see the note above
    if (!(await talking()) && !(await c.d.tryHold(TALK, patience))) {
      c.say(`nobody was talking`);
      return;
    }

    const said: number[] = [];
    /** which replies have been spent on each plaque, so none is spent twice */
    const tried = new Map<string, Set<number>>();
    let quiet = 0;
    for (let round = 0; round < 60 && quiet < windows; round++) {
      if (!(await talking())) {
        quiet++;
        await c.d.sleep(Math.min(400, c.budget));
        continue;
      }
      quiet = 0;
      const offered = await c.d.evaluate<number[]>(CHOICES);
      if (!offered.length) {
        /*
         * A line is being spoken and there is nothing to answer yet. ONE Escape,
         * never a hammer: ESC means two things a frame apart inside a
         * conversation — it cuts a spoken line short, and at a plaque it answers
         * -1 and LEAVES. A press that arrives a beat late does not skip
         * anything, it walks out. So press once and wait for the line to be over
         * before considering another.
         */
        if (await c.d.evaluate<boolean>(SPEAKING)) {
          await c.d.key("Escape", "none", c.budget);
          await c.d.tryHold(`!(${SPEAKING}) || (${CHOICES}).length > 0 || !(${TALK})`, 6000);
        } else {
          await c.d.tryHold(`(${CHOICES}).length > 0 || !(${TALK})`, 4000);
        }
        continue;
      }
      /**
       * WHICHEVER PREFERRED REPLY IS ON THIS PLAQUE — but never the same one
       * twice against a plaque that did not change.
       *
       * "Answer the first of these that is offered" alone is a loop with no
       * exit. Dust's long conversations are `while true` around their plaques, so
       * a reply that speaks a line and comes round again offers itself for ever:
       * a sweep caught this answering 301 thirty-four times in a row and
       * reporting, accurately, that the conversation would not close.
       *
       * So a pick that leaves the plaque as it was is a pick that does not work
       * HERE, and the next preference is tried instead — then anything else on
       * offer. Which is also the one place this can beat the preference order: a
       * conversation whose leaving line is not in the list at all is left by
       * whatever else it has, rather than not left.
       */
      const key = offered.join(",");
      const spent = tried.get(key) ?? new Set<number>();
      const pick =
        prefer.find((id) => offered.includes(id) && !spent.has(id)) ??
        offered.find((id) => !spent.has(id));
      if (pick === undefined) {
        throw new Error(
          `every reply on this plaque has been tried and it is still open — ` +
            `offered ${key}, answered ${said.join(",") || "nothing"}`,
        );
      }
      spent.add(pick);
      tried.set(key, spent);
      await CORE_ACTIONS.say.run({
        ...c,
        step: { ...c.step, args: [], bevels: [pick], opts: { ...c.step.opts, then: "stop" } },
        wait: "none",
      });
      said.push(pick);
      // and give the plaque a moment to become a different one, so the next
      // round is deciding about the conversation's next question and not this one
      await c.d.tryHold(`(${CHOICES}).join(",") !== ${JSON.stringify(key)} || !(${TALK})`, 6000);
    }
    if (await talking()) {
      throw new Error(
        `the conversation would not close — answered ${said.join(",") || "nothing"} and it is ` +
          `still going. Its plaque offers ${(await c.d.evaluate<number[]>(CHOICES)).join(",") || "nothing"}`,
      );
    }
    c.say(said.length ? `left on ${said.join(",")}` : `it closed on its own`);
  },
};

/** what Dust adds to the engine's vocabulary — see the header */
export const DUST_ACTIONS: ActionTable = {
  doorat: DOOR_AT,
  give: GIVE,
  goto: GOTO,
  loadsave: LOAD_SAVE,
  meet: MEET,
  offer: OFFER,
  takeinhand: TAKE_IN_HAND,
  talkout: TALK_OUT,
};

/**
 * Dust's whole vocabulary.
 *
 * The engine's verbs with this game's over the top, which is the order that
 * matters: a name in {@link DUST_ACTIONS} wins, so a disc-specific gesture can
 * replace a core one without the core table knowing. Composed once and exported,
 * because the workbench and the parser must be handed the SAME table
 * (`engine/src/web/speedrun/runner.ts`, `runSheet`) — otherwise a sheet means one
 * thing in the page and another to the runner.
 */
export const ACTIONS: ActionTable = composeActions(CORE_ACTIONS, DUST_ACTIONS);

/** the grammar half of {@link ACTIONS}, for the parser */
export const VERBS: Record<string, VerbSpec> = verbsOf(ACTIONS);

/** a verb by name, case-insensitively */
export const resolve = (verb: string): Action | undefined => resolveIn(ACTIONS, verb);
