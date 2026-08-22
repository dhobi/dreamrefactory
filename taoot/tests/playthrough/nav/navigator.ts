/**
 * Walking a route.
 *
 * Given "go to the gym", this works out the rooms (shipgraph.ts), the turns
 * and walks inside each one (setpath.ts), and makes the gestures. A route
 * therefore names destinations, not coordinates — which is what keeps it
 * legible, keeps it working when a hotspot moves, and lets the same route data
 * drive a test, a browser replay, and a demo that plays itself.
 *
 * The engine is reached through {@link NavDriver} rather than directly, because
 * "make a gesture and wait for it to land" means different things headless (pump
 * a virtual clock) and in a browser (real events, real frames). The navigator
 * doesn't want to know which it is.
 */
import type { SetFile } from "@dreamfactory/engine/df/set";
import { Gesture, Standpoint, atStandpoint, planWithin } from "./setpath";
import { FlowState, ShipTrip, routeTo, tripsFrom } from "./shipgraph";
import { TalkPlan, TalkResult, converse } from "./converse";
import { DragDial, DragLever, setLever, turnDial } from "./dials";
import { MAP_EXIT_REGION, MAP_JUMPS, MapJump, currentPage, jumpTo, mapUsable, pageButton } from "./mapjumps";
import type { ActorSpot } from "./reach";
import { isHarnessPaced } from "@dreamfactory/engine/runtime/masks";

export interface NavDriver {
  /** the active set's data */
  set(): SetFile;
  /** its name, lowercase, no extension */
  setName(): string;
  /** where the player is standing */
  at(): Standpoint;
  /** the flow globals a trip guard can read */
  flow(): FlowState;
  /** is this prop visible right now (doors: open)? */
  propVisible(name: string): boolean;
  /**
   * Who holds this prop — "frank" for anything in the bag. The map's own
   * `mapdisabled()` is written in these terms (no bag or no watch, no fast
   * travel), so a navigator that wants to know whether it may travel has to be
   * able to ask the same question the game asks.
   */
  propOwner(name: string): string;
  /**
   * Where a character is standing, and whether they are drawn — null when no such
   * actor is loaded.
   *
   * {@link Navigator.answers} is the one consumer, and it asks the smallest question
   * this can answer: has this person moved? Four attempts at using the position for
   * PLANNING all broke routes, and the measurement that followed them says why the
   * fifth cannot be one either — an actor's mousedown is gated on `realdist(me) <
   * hotdist()` = `calcdist(actorxyz(name, 4), playerxyz(4))`, and every click the
   * route ever got an answer to came from beyond that line as this side computes it
   * (nav/reach.ts). So: movement, not distance, and never to refuse a gesture.
   */
  actorSpot(name: string): { x: number; z: number; visible: boolean } | null;
  /**
   * Is this character crossing the room right now — the script's own
   * `iswalk(name)`.
   *
   * A route needs it because handlers are written against it. TURKSTRS.SET c7 is
   * the one that refuses: the door to the Turkish bath hands the first knock to
   * Morrow and then will not open at all while `iswalk("morrow")`, and
   * `walktopuppet` sends whoever you just spoke to back to their star when the
   * puppet closes — so the moment a conversation there ends is the one moment the
   * door is guaranteed shut. HALLA.SET c277 reads the same guard and WAITS on it
   * (`while iswalk("jay1") forceupdate()`), which is the same fact from the other
   * side.
   *
   * Distinct from {@link actorSpot}: a walk TURNS before it moves (scheduler.ts),
   * so for its first few passes a walking character is at the same coordinates as
   * a standing one, and "has he moved" cannot tell them apart.
   */
  walking(name: string): boolean;
  /**
   * A prop's current state name (`propview`), lowercase.
   *
   * The interface band is a state machine and its scripts read themselves in
   * these terms: house.shp's `bagidle()` is "the bag is not mid-animation", and
   * a bag mousedown does nothing at all unless both it and the watch are idle. So
   * a gesture that gets no answer can say WHICH state refused it instead of
   * reporting "it would not open" and leaving the next person to guess.
   */
  propState(name: string): string;
  /**
   * A prop's `deg` — a dial's number, a switch's position, a gauge's needle.
   *
   * The turbine plant is read and written entirely in these: the six controls are
   * dials whose deg IS the setting, and the four gauges are props whose deg is
   * the reading the OK button is judged on (`propdeg("electrical") > 13`). So a
   * route that works the plant has to see them, and see them between the frames
   * of a single gesture — {@link dragProp} refreshes before every step for that
   * reason.
   */
  propDeg(name: string): number;
  /**
   * A prop's `propvalue` — the scratch number a shop keeps on it, which is a
   * different fact from its deg.
   *
   * The wireless set is worked in these: `tunerneedle`'s value IS the frequency
   * (14..200), and `tuned()` compares it against a band six units wide, while the
   * needle's deg is only which of ten pictures the small view draws. A route that
   * has to land inside that band cannot see it any other way.
   */
  propValue(name: string): number;
  /**
   * The overlay flat currently covering the set, or null. A flat (the inventory
   * bag, an instrument close-up, the deck map) hides the room and takes every
   * click, so turning and walking are not available until it is closed — by
   * clicking its OK plaque, which is a gesture like any other.
   */
  inFlat(): string | null;
  /** turn one standpoint, settling before returning */
  turn(dir: number): Promise<void>;
  /**
   * Press up, settling before returning. This is both moves: a script may
   * consume the key to leave the set, and if it doesn't, you walk the road.
   * main.ts does exactly this for ArrowUp.
   */
  pressUp(): Promise<void>;
  /** press space */
  pressSpace(): Promise<void>;
  /**
   * Click a named hotspot in the current view. False when it isn't in this view
   * — and also when it IS but nothing in its rectangle resolves to it, because
   * something is standing in front of it. Both are "you cannot click that from
   * here", and reporting a click that landed on someone's back as a success is
   * how a route ends up blaming the game for a gesture it never made.
   */
  clickHotspot(id: string): Promise<boolean>;
  /**
   * Click whatever is called `name` in the current view — a hotspot, a
   * character, or an object lying in the room — and answer false when it isn't
   * visible from here. One primitive because a route doesn't care which kind a
   * thing is: Penny is an actor, the bag is a world prop, a door is a hotspot,
   * and all three are "click the thing".
   */
  clickThing(name: string): Promise<boolean>;
  /**
   * The music that is playing — and a route needs it for the same reason the
   * trace records it: `playnewtheme` is a CONSEQUENCE, and it lands late.
   *
   * The handlers that change it do it at the very end, after a conversation they
   * suspended on has finished — `c73.set` c9 runs `for count = 1 to 40
   * forceupdate()` and only then `playnewtheme`, and mission 4's phase advance
   * does `playnewtheme("sink" @ phase @ ".trk")` the same way. A pumped host runs
   * that tail in less time than it takes a browser to ask, so a beat taken on
   * "the conversation stopped" records two different tunes on the two hosts and
   * neither engine has done anything wrong. Waiting on the tune is the fix, and
   * that means being able to read it.
   */
  theme(): string;
  /** a conversation close-up is on screen (speaking or waiting on a choice) */
  conversing(): boolean;
  /** who it is with — the open puppet's name, "" when nobody is on screen */
  conversingWith(): string;
  /** it is parked on a choice */
  awaitingChoice(): boolean;
  /** the plaques on offer, in screen order */
  choices(): { text: string; id: number }[];
  /**
   * Click plaque number `index`, returning once the puppet has TAKEN the answer
   * — not once it has finished replying.
   *
   * Same reason as {@link skipLine}: what follows an answer is usually several
   * spoken lines, and waiting for the room to go quiet means waiting for the next
   * plaque, i.e. playing every one of them. The caller's loop skips them instead.
   */
  chooseBevel(index: number): Promise<void>;
  /** the item in your hand (`handitem`), or "" */
  handItem(): string;
  /** type a key at whatever has the keyboard — a stage flat, or the room */
  typeKey(key: string): Promise<void>;
  /**
   * Drag the item in your hand onto `target`, which is how this game uses an
   * object: inven.shp's stdmouse holds a `while stilldown()` loop that carries
   * the item with the cursor, and on release hit-tests the drop point and sends
   * `offerobject(item)` to whatever was under it. A click is not enough — the
   * trunk opens for `offerobject("trunkkey")` and for nothing else.
   * False when either end can't be found from here.
   */
  dragHandItemOnto(target: string): Promise<boolean>;
  /**
   * Take hold of a prop and drag it: press on it, keep the button down, move the
   * cursor to each point `next` returns, and release when it returns null.
   *
   * `next` is handed the point the drag started from and is called once per
   * cursor position, with the driver's state refreshed first — so a caller can
   * decide where to go next from what the last move DID (nav/dials.ts steers a
   * dial by reading its deg back). It must terminate; the caller owns the budget.
   *
   * Distinct from {@link dragHandItemOnto}, which is the inventory's press-carry-
   * release between two known points. This one is for the scripts that hold the
   * input themselves for as long as the button is down and read the cursor every
   * frame: the turbine dials, and the wireless knobs after them. False means
   * there was nothing called `name` to take hold of from here.
   */
  dragProp(name: string, next: (from: { x: number; y: number }) => { x: number; y: number } | null): Promise<boolean>;
  /**
   * Click something WITHOUT waiting for the gesture to finish, answering a probe
   * that says when it has (null if there was nothing to click).
   *
   * Most gestures settle on their own. Some park a script in a poll loop that
   * only ends when the player does something else — the Enigma's decode lever
   * spins the rotors, prints, and then waits for a held click on the printout —
   * so "click, then wait for quiet" would wait for a quiet that this gesture is
   * itself preventing.
   */
  startClick(name: string): Promise<(() => boolean) | null>;
  /** pump until `until` holds; false if it never did */
  /**
   * Wait until `until` holds, and report whether it did.
   *
   * `budgetMs` is game milliseconds and must be given whenever "it didn't
   * happen" is an EXPECTED answer rather than a fault — otherwise the wait
   * inherits the run's whole timeout, and a caller that meant to try something
   * else instead sits there for minutes. That is not hypothetical: it is what
   * made the browser run appear to hang on the bag (see takeInHand).
   */
  waitFor(until: () => boolean, what: string, budgetMs?: number): Promise<boolean>;
  /**
   * Pump until the screen has stopped changing — the same settle every gesture
   * already ends with, exposed for a screen the route did NOT click open.
   *
   * The bag is why. `use()` waits for the flat to exist, but the flat exists from
   * `openstagefile` — partway through the boot's `transtoflat`, which then flashes
   * a held item and ends that with `flushevents()`. A click made in the gap is
   * posted (the fade makes the viewer busy) and then thrown away by that flush, so
   * the item was never selected: "clicked trunkkey but zeitgram is in hand", and
   * only ever when something was already in hand, which is the one case that runs
   * `flashitem`.
   */
  settled(what: string): Promise<void>;
  /**
   * Press at a point and KEEP the button down until `until` holds, then release.
   * For scripts that poll `button()`/`mouse()` themselves rather than taking a
   * dispatched click (the Enigma's `while not (button() & pointinprop(...))`).
   */
  holdUntil(x: number, y: number, until: () => boolean, what: string): Promise<boolean>;
  /**
   * ESC past the line being spoken — and return as soon as the key has
   * registered, NOT when the room goes quiet.
   *
   * The engine skips a line by racing it against ESC (`puppetSpeak`'s
   * speakSkip), which is what the original's players did to get to the plaques.
   * Waiting for quiet after the key undoes the whole point: the script moves
   * straight on to the next line, so a skip that settles skips exactly one line
   * and then sits through every remaining one. That cost minutes per
   * conversation in a browser, where lines play in real time.
   */
  skipLine(): Promise<void>;
  /**
   * A movie is parked waiting for a click. It can happen on top of a
   * conversation: the Smethells briefing plays an interactive note over the
   * close-up, and clicks reach the movie first (SetViewer.click), so a
   * conversation loop that only knows how to skip lines waits forever.
   */
  movieWaiting(): boolean;
  /**
   * A movie owns the screen at all — running its frames OR parked on a region.
   *
   * The pair with {@link movieWaiting} is what tells a cutscene from a prompt:
   * playing and not waiting is the engine showing you something, playing and
   * waiting is the engine asking you something. {@link Navigator.rush} skips the
   * first and never the second.
   */
  moviePlaying(): boolean;
  /** click the parked movie's exit region */
  dismissMovie(): Promise<void>;
  /**
   * The parked movie's click regions, with the type code that says what each
   * one DOES (1 exit · 2 jump to a named frame · 6/7 step). An interactive movie
   * is a little state machine, and "the region under the OK plaque" is not
   * automatically its way out: the wireless message stack pages through the
   * telegrams on a type-2 region and only walks off the end on the plaque, so a
   * route that dismisses it blind leaves without having read anything.
   */
  movieRegions(): { type: number; target: string; event: string }[];
  /** click the parked movie's region number `index` (in movieRegions order) */
  clickMovieRegion(index: number): Promise<void>;
  /**
   * Click a bare screen point, with no name to aim at.
   *
   * Almost nothing needs this — a gesture is normally "click the thing called X",
   * and naming it is what keeps a route readable and a click honest. The fencing
   * match is the exception: `FENCE.STG`'s `mousedown(arg)` passes the point
   * straight to `playerattack`, which reads the QUADRANT out of it (x against 256,
   * y against 193) to decide where the lunge lands, and `playeridle` re-reads
   * `mouse()` every tick to decide which side you are guarding. The coordinates
   * are the input, like a light gun, so there is nothing to name.
   */
  clickAt(x: number, y: number): Promise<void>;
  /**
   * Press ESC at the movie on screen, aborting it and its chain — the original's
   * own way past a long cutscene (MoviePlayer.key). False means there was
   * nothing playing to press at.
   *
   * Bounded and does NOT settle. A cutscene is usually one of several: the
   * script comes straight back with the next `playmovie`, so "wait for quiet"
   * would wait for the whole sequence we are trying to skip. This waits only
   * for THIS clip to leave the screen.
   *
   * A route should reach for this only where a player would — see
   * {@link Navigator.rush} for the rule and why the London close-ups are
   * exempt from it.
   */
  skipMovie(): Promise<boolean>;
  log?(message: string): void;
}

export interface NavResult {
  ok: boolean;
  /** what went wrong, for a route that can't be walked */
  reason?: string;
  /** gestures actually made */
  gestures: number;
}

/** a step budget, so a mis-planned route fails instead of walking forever */
const MAX_GESTURES_PER_ROOM = 60;

/**
 * How many times to click a band prop before calling it stuck.
 *
 * More than the two the band's two-state design needs, because a click on the bag
 * or the map can be dropped for a reason that is nobody's fault: house.shp's
 * mousedown exits without doing anything unless `bagidle()` AND `watchidle()`,
 * i.e. unless neither the bag nor the pocketwatch is mid-animation. In a browser
 * the watch runs in real time (`calctime` is gated on drawn frames), so a click
 * can land in that window — intermittently, which is how it presented: three
 * attempts was enough most of the time and segment 3 failed outright when it
 * wasn't. A player clicks again; so does this.
 */
const INTERFACE_ATTEMPTS = 6;

/** how long {@link Navigator.rush} watches before looking again for a clip to skip */
const RUSH_SLICE_MS = 1500;

/**
 * A cutscene sequence needing more presses than this is a fault, not a long
 * sequence. The longest in the game is the crossing to the Titanic (the blast,
 * the newsreel, the boarding), which is a handful.
 */
const MAX_RUSH_SKIPS = 60;

/**
 * How long a click on somebody may take to become a conversation.
 *
 * Long, because it is not the puppet load being waited for — it is the WALK. A
 * cast idle that has been clicked from out of range can come over
 * (`walktopuppet`), and eight seconds is what that takes on the boat deck.
 */
const ACCOST_ANSWER_MS = 8000;

/**
 * How much of {@link ACCOST_ANSWER_MS} to spend before asking whether anyone is
 * actually coming — see {@link Navigator.answers}.
 *
 * Enough for a landed click to have opened its conversation: every accost wait in
 * the route that was ever answered was answered at **0 engine steps** except one,
 * Georgia in B70, which took **19** (~1 s) because she was walking. Measured over a
 * full headless run with `TAOOT_WAITCOST`.
 */
const ACCOST_WATCH_MS = 1500;

/**
 * How long a click on a THING may take to show that it did something — see
 * {@link Navigator.tookEffect}. Same budget as {@link ACCOST_WATCH_MS} and for the
 * same reason: a landed click's first consequence is immediate (a flat opens, an
 * owner moves, a movie starts), and what takes longer is somebody walking over,
 * which is `accost`'s business rather than this one's.
 */
const HUNT_WATCH_MS = 1500;

/**
 * Globals that move without anyone clicking anything, and so cannot be evidence
 * that a click did something.
 *
 * The harness-paced list is the same one the trace comparison drops (engine/src/runtime/masks.ts) and
 * for a related reason — those count frames. The clock family is added here and not
 * there: `min`/`hrs`/`clock` are asserted by a golden precisely BECAUSE game time
 * advances on its own, which is exactly what disqualifies them here. A `min` that
 * rolls over inside the watch window would otherwise make a dud click look live.
 */
const selfMoving = (name: string): boolean =>
  isHarnessPaced(name) || name === "min" || name === "hrs" || name === "clock";

export class Navigator {
  private count = 0;

  constructor(private readonly d: NavDriver) {}

  get gestures(): number {
    return this.count;
  }

  private say(msg: string): void {
    this.d.log?.(msg);
  }

  private async gesture(g: Gesture): Promise<void> {
    this.count++;
    if (g.kind === "turn") await this.d.turn(g.dir);
    else await this.d.pressUp();
  }

  /**
   * Hold up your end of a conversation — see taoot/tests/playthrough/nav/converse.ts. Routes call
   * this explicitly: which answer you give is the story, so the navigator will
   * not pick one to get itself unstuck.
   */
  talk(plan: TalkPlan = {}): Promise<TalkResult> {
    return converse(this.d, plan);
  }

  /**
   * Set a control that has to be dragged — see taoot/tests/playthrough/nav/dials.ts. Which
   * setting is the route's business, exactly as with an answer in a conversation;
   * what a dial DOES with a gesture is the game's, and lives there.
   */
  async setDial(dial: DragDial | DragLever, want: number): Promise<NavResult> {
    const flat = this.d.inFlat();
    if (!flat) {
      return { ok: false, reason: `no flat is open to work ${dial.prop} on`, gestures: this.count };
    }
    const turned = "pivot" in dial ? await turnDial(this.d, dial, want) : await setLever(this.d, dial, want);
    this.count++;
    if (!turned.ok) return { ok: false, reason: turned.reason, gestures: this.count };
    this.say(`${dial.prop} to ${turned.deg}`);
    return { ok: true, gestures: this.count };
  }

  /**
   * Click a region of the movie that is parked waiting for one, chosen by what
   * the region does rather than by where it sits.
   *
   * Interactive movies here are little state machines with no convention about
   * which corner leaves: the London close-ups have no exit region at all and you
   * walk them off the end on the plaque, while the wireless message stack uses
   * the plaque for exactly that and pages the telegrams on a type-2 jump. So the
   * route says which it means — `type === 2` to turn the page, `type === 6` to
   * close — and gets told when the region it asked for isn't there.
   */
  async clickMovie(
    pick: (r: { type: number; target: string; event: string }) => boolean,
    what = "a movie region",
  ): Promise<NavResult> {
    if (!this.d.movieWaiting()) {
      return { ok: false, reason: `no movie is waiting for ${what}`, gestures: this.count };
    }
    const regions = this.d.movieRegions();
    const index = regions.findIndex(pick);
    if (index < 0) {
      const had = regions.map((r) => `type${r.type}${r.target ? `->${r.target}` : ""}`).join(" ");
      return { ok: false, reason: `no ${what} on this frame (regions: ${had || "none"})`, gestures: this.count };
    }
    this.say(`movie: ${what}`);
    await this.d.clickMovieRegion(index);
    return { ok: true, gestures: ++this.count };
  }

  /**
   * Wait for something the engine is going to do on its own, pressing ESC past
   * every cutscene on the way — what a player does to a stretch of the game
   * that isn't asking them anything.
   *
   * The rule is one line of code and worth stating plainly: skip a movie that is
   * PLAYING AND NOT WAITING, never one that is waiting. A movie parked on its
   * regions is the engine asking a question — the boot menu's GAME/TOUR, the
   * wireless telegrams, the OK plaque on a London close-up — and its answer is
   * story. A movie running its frames is the engine showing you something, and
   * ESC is the authored way past that (every movie in the corpus sets the
   * skippable bit; see docs/engine/formats/mov.md).
   *
   * Which is why the London close-ups are NOT rushed even though they are
   * movies. bedcards.mov carries six of the eleven points needed to arm the
   * bomb on its two action frames, and BEDSIT1 reads `actionframe(1)` after
   * `spotmovie` returns — abort the clip before those frames and the score is
   * simply lower. The route clicks that one through by hand.
   *
   * `budgetMs` is how long the wait itself may take; the ESCs are on top, since
   * a press cannot make the wait longer.
   */
  async rush(until: () => boolean, what: string, budgetMs: number): Promise<NavResult> {
    let skipped = 0;
    /** a cutscene is on screen and not asking anything — the one thing ESC is for */
    const showing = (): boolean => this.d.moviePlaying() && !this.d.movieWaiting();
    for (let round = 0; round < Math.ceil(budgetMs / RUSH_SLICE_MS) + MAX_RUSH_SKIPS; round++) {
      if (until()) {
        if (skipped) this.say(`${what}: skipped ${skipped} clip${skipped === 1 ? "" : "s"}`);
        return { ok: true, gestures: this.count };
      }
      if (showing()) {
        if (skipped >= MAX_RUSH_SKIPS) {
          return { ok: false, reason: `${what}: still playing clips after ${skipped} ESCs`, gestures: this.count };
        }
        if (await this.d.skipMovie()) {
          skipped++;
          this.count++;
          continue;
        }
      }
      // nothing to press at this instant — wait for the goal, or for the next
      // clip to start, whichever comes first. Waiting out the slice when neither
      // happens is what keeps a quiet stretch from spinning.
      await this.d.waitFor(() => until() || showing(), what, RUSH_SLICE_MS);
    }
    return { ok: false, reason: `${what} did not happen (skipped ${skipped})`, gestures: this.count };
  }

  /**
   * Take an item out of the bag and into your hand.
   *
   * Three gestures, because the band is dark until you wake it: the first click
   * on the bag runs house.shp's activateinterface(), the second opens inven1.stg,
   * and clicking an item there makes it `handitem` (inven.shp's stdmouse). OK
   * closes the screen. Already holding it is not a gesture at all.
   */
  async takeInHand(item: string): Promise<NavResult> {
    if (this.d.handItem().toLowerCase() === item.toLowerCase()) return { ok: true, gestures: this.count };
    // The interface band is a TWO-STATE thing, and that costs a click: house.shp's
    // bag mousedown answers a `darkclosed` bag with activateinterface() and
    // nothing else — the click that lights the band cannot also open the bag —
    // and main.stg's mousedown fall-through darkens it again on any click that
    // hits nothing. So the first click here often just turns the lights on, and a
    // closed inventory is an EXPECTED answer to it, not a fault. Hence the short
    // per-click budget: waiting the run's full timeout for something we already
    // plan to retry is how this looked like a hang in a browser while passing
    // headless, where the same wait costs a few thousand instant ticks. How MANY
    // retries, and why more than two, is INTERFACE_ATTEMPTS.
    for (let i = 0; i < INTERFACE_ATTEMPTS && !this.d.inFlat(); i++) {
      if (!(await this.d.clickThing("bag"))) {
        return { ok: false, reason: `no bag to open (is it still on the bed?)`, gestures: this.count };
      }
      this.count++;
      // doinven() opens the screen from a prop loop a few frames after the click
      await this.d.waitFor(() => !!this.d.inFlat(), "the inventory to open", 4000);
    }
    // the flat exists from openstagefile, which is mid-transtoflat — wait for the
    // rest of it (the fade, and the flash of anything already in hand) before
    // clicking, or the click lands in the gap and is flushed. See NavDriver.settled.
    await this.d.settled("the inventory");
    const flat = this.d.inFlat();
    if (!flat) {
      // name the states, because the bag's own mousedown is written in them: it
      // exits without doing anything unless bagidle() AND watchidle() (house.shp)
      const states = ["bag", "watch", "lid", "map"].map((p) => `${p}=${this.d.propState(p) || "-"}`);
      return { ok: false, reason: `the bag would not open (${states.join(" ")})`, gestures: this.count };
    }
    if (!(await this.d.clickThing(item))) {
      return { ok: false, reason: `no ${item} in the bag`, gestures: this.count };
    }
    this.count++;
    if (this.d.handItem().toLowerCase() !== item.toLowerCase()) {
      return { ok: false, reason: `clicked ${item} but ${this.d.handItem() || "nothing"} is in hand`, gestures: this.count };
    }
    if (!(await this.d.clickThing("ok"))) {
      return { ok: false, reason: `no ok plaque to close the "${flat}" flat`, gestures: this.count };
    }
    this.count++;
    if (this.d.inFlat()) return { ok: false, reason: `the "${flat}" flat would not close`, gestures: this.count };
    this.say(`holding the ${item}`);
    return { ok: true, gestures: this.count };
  }

  /**
   * Use an item on something: fetch it into your hand, then put it on the thing.
   * Reports which half failed, because they fail for different reasons — a
   * missing item is a story problem, a missing target is a standpoint problem.
   */
  async use(item: string, on: string): Promise<NavResult> {
    const held = await this.takeInHand(item);
    if (!held.ok) return held;
    if (!(await this.d.dragHandItemOnto(on))) {
      return { ok: false, reason: `could not put the ${item} on ${on} from here`, gestures: this.count };
    }
    this.count++;
    this.say(`used the ${item} on ${on}`);
    return { ok: true, gestures: this.count };
  }

  /**
   * Turn and walk until standing somewhere the goal accepts. Re-plans from live
   * state after every gesture — a walk's arrival facing is decided by the
   * engine, so a plan longer than its first gesture would be fiction.
   */
  /**
   * Name the conversation that is in the way. "a conversation is open in
   * gstair3" leaves you to work out which of the four people in that room it
   * was — and the run that reported it is over, so nobody can go and look. The
   * engine knows (`currentpuppet()`), so say it.
   */
  private withWhom(): string {
    const who = this.d.conversingWith();
    return who ? `${who} is talking to you` : "a conversation is open";
  }

  async faceStandpoint(views: string[], scenes: string[] = []): Promise<NavResult> {
    const goal = atStandpoint(views, scenes);
    const startedIn = this.d.setName();
    // don't walk off the room by accident: every exit standpoint except the one
    // we're heading for is a place where pressing up leaves
    const want = new Set(views.map((v) => v.toLowerCase()));
    const avoidWalkFrom = new Set(
      tripsFrom(startedIn, this.d.flow())
        .flatMap((t) => t.stand)
        .filter((v) => !want.has(v)),
    );
    if (this.d.conversing()) {
      // A visible puppet makes SetViewer.busy true, so turn() and walk() refuse
      // — correctly; you don't wander off mid-sentence. Say so rather than
      // grinding out the gesture budget against a conversation.
      return { ok: false, reason: `${this.withWhom()} in ${startedIn}; answer it first`, gestures: this.count };
    }
    const flat = this.d.inFlat();
    if (flat) {
      // Without this the room behind the flat still answers set()/at(), so a
      // plan gets made and every gesture lands on the flat instead — the
      // navigator paces on the spot and blames the room.
      return { ok: false, reason: `the "${flat}" flat is covering ${startedIn}; close it first`, gestures: this.count };
    }
    for (let i = 0; i <= MAX_GESTURES_PER_ROOM; i++) {
      if (this.d.setName() !== startedIn) {
        return { ok: false, reason: `left ${startedIn} for ${this.d.setName()} while looking for ${views.join("|")}`, gestures: this.count };
      }
      const plan = planWithin(this.d.set(), this.d.at(), goal, { avoidWalkFrom });
      if (plan === null) {
        return { ok: false, reason: `no way to ${views.join("|")} inside ${startedIn}`, gestures: this.count };
      }
      if (!plan.length) return { ok: true, gestures: this.count };
      await this.gesture(plan[0]);
    }
    // Say what the room was DOING, not just that we gave up. A walk that never
    // progresses looks identical from here whatever the cause, and the causes are
    // different in kind: a parked movie makes `quiescent` true while owning the
    // input, so every gesture is swallowed and the planner re-plans from the same
    // standpoint until the budget runs out.
    const at = this.d.at();
    const state = [
      `at scene${at.sceneIdx}/view${at.viewIdx}`,
      this.d.moviePlaying() ? "a movie is playing" : null,
      this.d.movieWaiting() ? `a movie is PARKED on ${this.d.movieRegions().length} region(s)` : null,
      this.d.conversing() ? "conversing" : null,
      this.d.inFlat() ? `in the "${this.d.inFlat()}" flat` : null,
    ].filter(Boolean).join(", ");
    return {
      ok: false,
      reason: `gave up reaching ${views.join("|")} in ${startedIn} (${state})`,
      gestures: this.count,
    };
  }

  /**
   * Look around the room for something and click it — judged on what the click
   * DID, not on where it landed.
   *
   * Objects and people are only clickable from the standpoints they're visible
   * from — the bag is on the bed in one view of C73, Penny stands in one corner
   * of the gym — so this sweeps the room's standpoints in shortest-first order
   * until the thing is under the cursor.
   *
   * Landing is not enough, and that was this method's long-standing lie.
   * `inven.shp`'s `stdmouse` gates every object lying in a room on
   * `realdist(what) < hotdist()`, so a click from across the room hits the thing
   * and is then thrown away — and answering `ok` to that sends the failure
   * downstream, to whichever later assertion notices the object was never picked
   * up. An hour went into that once; `nav/wireless.ts` worked around it by hand and
   * five comments in segments.ts warned about it.
   *
   * So a standpoint only counts when the click MOVED something
   * ({@link tookEffect}); otherwise this keeps sweeping, exactly as
   * {@link accost} does for people, and the cost is one wasted click per
   * standpoint that was too far — which is what a player does anyway.
   */
  async hunt(name: string): Promise<NavResult> {
    const startedIn = this.d.setName();
    if (this.d.conversing()) {
      return { ok: false, reason: `${this.withWhom()} in ${startedIn}; answer it first`, gestures: this.count };
    }
    // inside a flat, hunting means clicking what the flat shows — one click, no
    // walking, and a miss is a miss rather than a tour of the room behind it
    const flat = this.d.inFlat();
    if (flat) {
      if (await this.d.clickThing(name)) {
        this.say(`clicked ${name} in ${flat}`);
        return { ok: true, gestures: ++this.count };
      }
      return { ok: false, reason: `no ${name} on the "${flat}" flat`, gestures: this.count };
    }
    const avoidWalkFrom = new Set(tripsFrom(startedIn, this.d.flow()).flatMap((t) => t.stand));
    const visited = new Set<string>();
    let landed = 0;
    for (let i = 0; i <= MAX_GESTURES_PER_ROOM; i++) {
      // Say so the moment somebody takes the room over, rather than grinding.
      //
      // A conversation is only checked on the way IN above, and that was not
      // enough: a cast idle can open one MID-hunt (`hasattention`, gang.cst — Max
      // does it in recept1c after four seconds inside `hotdist`). A visible puppet
      // makes SetViewer.busy true, so from here every click misses and every walk
      // refuses, the planner keeps handing back the same plan, and sixty gestures
      // later this reported `gave up hunting for cufflink1 in recept1c` — which
      // describes the budget running out and nothing about the cause. That message
      // sent a day's debugging at the cufflink, the chairs and the interface band
      // before the actual answer (a man walking over to say hello) turned up.
      // `faceStandpoint` already ends by reporting what the room was DOING; this
      // reports it at the gesture, which is better still.
      if (this.d.conversing()) {
        return {
          ok: false,
          reason:
            `a conversation opened while hunting for ${name} in ${startedIn} — ` +
            `somebody in the room started talking to us; answer them first`,
          gestures: this.count,
        };
      }
      // Two clicks from this standpoint before moving, because "nothing moved" has
      // two causes and they are indistinguishable from out here. Out of reach is
      // the positional one, and walking on is the answer to it. The other is
      // TRANSIENT: `stdmouse`'s `realdist < hotdist` test is the outer gate and
      // `if iswalk (me) exitcode` sits inside it (gang.cst 0442, turkstrs.set's
      // bath door), so a character who happens to be mid-stride or mid-turn refuses
      // the click and looks exactly like one standing too far away.
      //
      // Retrying in place is what a player does, and — the reason this is here —
      // it does not MOVE THE CAMERA. Repositioning on a transient refusal is what
      // made the browser answer View17 where the headless golden said View13 for
      // the C-deck seaman: same route, same engine, different recovery. One extra
      // click costs a fraction of a second when the target really is out of reach,
      // and the sweep below still runs.
      let took = false;
      for (let attempt = 0; attempt < 2 && !took; attempt++) {
        const before = this.clickStamp(name);
        if (!(await this.d.clickThing(name))) break;
        this.count++;
        landed++;
        took = await this.tookEffect(name, before);
      }
      if (took) {
        this.say(`clicked ${name}${landed > 1 ? ` (after ${landed} clicks)` : ""}`);
        return { ok: true, gestures: this.count };
      }
      if (landed) this.say(`clicked ${name} and nothing moved — out of reach (hotdist); walking on`);
      const at = this.d.at();
      visited.add(`${at.sceneIdx}:${at.viewIdx}`);
      const plan = planWithin(
        this.d.set(),
        at,
        (scene, viewIdx) => !visited.has(`${this.d.set().scenes.indexOf(scene)}:${viewIdx}`),
        { avoidWalkFrom },
      );
      if (!plan?.length) {
        return {
          ok: false,
          reason: landed
            ? `clicked ${name} from ${landed} standpoint(s) in ${startedIn} and nothing moved — ` +
              `every one was out of reach (stdmouse's realdist < hotdist)`
            : `no ${name} anywhere in ${startedIn}`,
          gestures: this.count,
        };
      }
      await this.gesture(plan[0]);
      if (this.d.setName() !== startedIn) {
        return { ok: false, reason: `left ${startedIn} while hunting for ${name}`, gestures: this.count };
      }
    }
    // Not just "gave up" — the same reasoning as faceStandpoint's ending, and for
    // the same reason: every cause looks identical from here unless it is asked.
    const at = this.d.at();
    const state = [
      `at scene${at.sceneIdx}/view${at.viewIdx}`,
      `${visited.size} standpoint(s) swept`,
      this.d.moviePlaying() ? "a movie is playing" : null,
      this.d.movieWaiting() ? `a movie is PARKED on ${this.d.movieRegions().length} region(s)` : null,
      this.d.inFlat() ? `in the "${this.d.inFlat()}" flat` : null,
    ].filter(Boolean).join(", ");
    return {
      ok: false,
      reason: `gave up hunting for ${name} in ${startedIn} (${state})`,
      gestures: this.count,
    };
  }

  /**
   * Everything a click on `name` could plausibly move, as one string.
   *
   * Read entirely through the driver surface both hosts already share, so this
   * needed no new page-side plumbing: the browser mirrors all of it in the single
   * sample it takes anyway (taoot/tests/browser/driver.ts `Mirror`).
   *
   * The screen-level four come first because they are the decisive ones and they
   * are quiet during a dud — a live click on a thing opens a close-up flat, starts
   * a clip, opens a conversation, or leaves the room. Then `handitem` (picking
   * something up puts it in your hand), then the clicked thing's own owner, view,
   * visibility, deg and value — an object taken becomes `propowner` "frank", a
   * door opens, a switch flips. Then the globals, minus {@link selfMoving}, which
   * is what catches a click whose only trace is elsewhere: the London flat's
   * objects award points and nothing else.
   *
   * It is deliberately generous rather than exact. A global that a loop moves on
   * its own inside the watch window can still make a dud look live — that is the
   * behaviour this replaces, so being fooled occasionally is no worse than before,
   * whereas being too strict would refuse a click that genuinely worked.
   */
  private clickStamp(name: string): string {
    const g = this.d.flow();
    return JSON.stringify([
      this.d.setName(), this.d.inFlat(), this.d.conversing(), this.d.moviePlaying(),
      this.d.handItem(),
      this.d.propOwner(name), this.d.propState(name), this.d.propVisible(name),
      this.d.propDeg(name), this.d.propValue(name),
      Object.keys(g).filter((k) => !selfMoving(k)).sort().map((k) => `${k}=${g[k]}`),
    ]);
  }

  /** did the click just made on `name` move anything? waits a little for it to */
  private async tookEffect(name: string, before: string): Promise<boolean> {
    if (this.clickStamp(name) !== before) return true;
    return this.d.waitFor(
      () => this.clickStamp(name) !== before,
      `${name} to answer the click`,
      HUNT_WATCH_MS,
    );
  }

  /**
   * Walk up to someone and get them talking — a hunt judged on the ANSWER.
   *
   * {@link hunt} answers `ok` when a click LANDS on the named thing, which is not
   * the same as the click having done anything, and for a person the difference is
   * the whole gesture: `gang.cst` c3 gates an actor's mousedown on
   * `realdist(me) < hotdist()`, so a click from across the room hits them and is
   * discarded. Reaching one of them is not a rare problem either — hotdist is 3500
   * in the first-class lounge and Zeitel stands 7782 from the standpoint the door
   * leaves you at, and **500** on the boat deck, which is the tightest reach in the
   * game.
   *
   * So this sweeps the room the same way hunt does, but a standpoint only counts
   * when the click actually opens the conversation; otherwise it keeps walking. The
   * cost is one wasted click per standpoint that was too far, which is what a
   * player does anyway, and the benefit is that "he did not answer" is reported at
   * the gesture rather than three assertions later — which is the hour a false
   * success cost the first time.
   */
  async accost(name: string): Promise<NavResult> {
    const startedIn = this.d.setName();
    if (this.d.conversing()) return { ok: true, gestures: this.count };
    const flat = this.d.inFlat();
    if (flat) {
      return { ok: false, reason: `the "${flat}" flat is covering ${startedIn}; close it first`, gestures: this.count };
    }
    const avoidWalkFrom = new Set(tripsFrom(startedIn, this.d.flow()).flatMap((t) => t.stand));
    const visited = new Set<string>();
    let landed = 0;
    for (let i = 0; i <= MAX_GESTURES_PER_ROOM; i++) {
      // Getting close enough is sometimes all it takes: a cast idle that finds
      // you inside `hotdist()` calls `hasattention(4)` and opens the conversation
      // itself (gang.cst's morrowidle is the pattern, and Vlad's is the same).
      // That is the game starting the conversation, and it counts.
      if (this.d.conversing()) {
        this.say(`${name}'s room started talking to us on its own`);
        return { ok: true, gestures: this.count };
      }
      if (await this.d.clickThing(name)) {
        this.count++;
        landed++;
        if (await this.answers(name)) {
          this.say(`${name} is talking (after ${landed} click${landed > 1 ? "s" : ""})`);
          return { ok: true, gestures: this.count };
        }
        this.say(`clicked ${name} and got nothing — too far to reach; walking on`);
      }
      const at = this.d.at();
      visited.add(`${at.sceneIdx}:${at.viewIdx}`);
      const plan = planWithin(
        this.d.set(),
        at,
        (scene, viewIdx) => !visited.has(`${this.d.set().scenes.indexOf(scene)}:${viewIdx}`),
        { avoidWalkFrom },
      );
      if (!plan?.length) {
        return {
          ok: false,
          reason: landed
            ? `clicked ${name} from ${landed} standpoint(s) in ${startedIn} and none was close enough (hotdist)`
            : `no ${name} anywhere in ${startedIn}`,
          gestures: this.count,
        };
      }
      await this.gesture(plan[0]);
      if (this.d.setName() !== startedIn) {
        return { ok: false, reason: `left ${startedIn} while looking for ${name}`, gestures: this.count };
      }
    }
    return { ok: false, reason: `gave up reaching ${name} in ${startedIn}`, gestures: this.count };
  }

  /**
   * Did the click just made on `name` turn into a conversation? Waits for it — and
   * stops waiting for somebody who is standing perfectly still.
   *
   * The wait is load-bearing and stays: a cast idle clicked from out of range can
   * WALK over, and removing the wait outright loses Georgia on A deck, whose
   * `hotdist()` is 500. What is not load-bearing is spending the whole budget on a
   * person who is not moving, and that is nearly all of it. Measured over one full
   * headless run (`TAOOT_WAITCOST`) and one browser run:
   *
   *   22 of the run's 26 timed-out waits are accost clicks nobody answered —
   *     Zeitel 15x in the lounge, Georgia 4x, Charles 3x
   *   every one of them: the actor's position IDENTICAL to the unit from the first
   *     sample to the last, over all 160 steps of the wait
   *   the only answer that ever needed time was Georgia in B70, and she was
   *     visibly closing (6969 -> 6964 units while it waited)
   *
   * So the test is not "is he in reach" — nav/reach.ts is emphatic that a
   * snapshot must never refuse a gesture, and the numbers say why: every click that
   * WAS answered was answered from beyond `hotdist()` as this side computes it. The
   * test is "is anybody coming", asked of the one thing a snapshot can honestly
   * answer: has this person moved at all. Not moving after
   * {@link ACCOST_WATCH_MS} means no walk is on its way, and the remaining
   * six and a half seconds buy nothing. An actor we cannot see, or a set whose
   * scenes carry no map coordinates, reads as null and waits the full budget out,
   * exactly as before.
   *
   * In a browser a dud click cost 8.1 s of real time and now costs 1.6 s: segment 26
   * 185.7 s -> 89.8 s, segment 6 311.9 s -> 256.0 s. Headless it costs almost
   * nothing either way, which is why it hid for so long — and why it moved the
   * oracle when it went (TODO §4a).
   */
  private async answers(name: string): Promise<boolean> {
    const where = (): ActorSpot | null => this.d.actorSpot(name);
    const before = where();
    if (await this.d.waitFor(() => this.d.conversing(), `${name} to answer`, ACCOST_WATCH_MS)) return true;
    const now = where();
    if (before && now && before.visible && now.visible && before.x === now.x && before.z === now.z) {
      this.say(`${name} has not moved a unit in ${ACCOST_WATCH_MS} ms — nobody is walking over`);
      return false;
    }
    return this.d.waitFor(() => this.d.conversing(), `${name} to answer`, ACCOST_ANSWER_MS - ACCOST_WATCH_MS);
  }

  /**
   * Open the doors a trip needs.
   *
   * Space first, because that is the game's own "the door in front of me": the
   * boot script's keydown does `sendtopainting(currentscene(), currentview(),
   * "door", mousedown(0))`, so it finds the doorway hotspot without caring where
   * it sits on screen or who is standing in it. Clicking the hotspot is the same
   * gesture by hand, and is the fallback for a doorway the boot chain doesn't
   * reach.
   *
   * A door that won't open after both is a real answer about the game, not a
   * failure of the navigator: the wireless door refuses because Morrow turns you
   * away until you have talked him into it (DECKBD.SET c110). Name the door and
   * let the route deal with it.
   */
  private async openFor(trip: ShipTrip): Promise<boolean> {
    for (const prop of trip.needsVisible) {
      if (this.d.propVisible(prop)) continue;
      this.say(`opening ${prop}`);
      await this.d.pressSpace();
      this.count++;
      if (this.d.propVisible(prop)) continue;
      if (await this.d.clickHotspot(prop)) this.count++;
      if (!this.d.propVisible(prop)) return false;
    }
    return true;
  }

  /** Take one trip: stand where it wants, open what it needs, go through. */
  async takeTrip(trip: ShipTrip): Promise<NavResult> {
    if (trip.by === "walkto") return this.walkTo(trip);
    const faced = await this.faceStandpoint(trip.stand, trip.standScene);
    if (!faced.ok) return faced;
    if (!(await this.openFor(trip))) {
      return { ok: false, reason: `${trip.needsVisible.join("/")} would not open in ${trip.from}`, gestures: this.count };
    }
    if (trip.by === "keydown") {
      await this.d.pressUp();
      this.count++;
    } else if (trip.by === "mousedown") {
      // the hotspot the guard tested is the door under the cursor; the door
      // hotspots are named for what they are
      const clicked = (await this.d.clickHotspot("door")) || (await this.d.clickHotspot(trip.to));
      this.count++;
      if (!clicked) return { ok: false, reason: `no hotspot to click for ${trip.from} -> ${trip.to}`, gestures: this.count };
    } else {
      return { ok: false, reason: `don't know how to take a "${trip.by}" trip`, gestures: this.count };
    }
    if (this.d.setName() !== trip.to) {
      return { ok: false, reason: `${trip.from} -> ${trip.to} left us in ${this.d.setName()}`, gestures: this.count };
    }
    this.say(`arrived in ${trip.to}`);
    return { ok: true, gestures: this.count };
  }

  /**
   * Climb the grand staircase — a trip whose gesture is only the walk.
   *
   * The four flights up (shipgraph's CLIMB_TRIPS) are `openscene` handlers: they
   * fire when the top scene of a flight OPENS, so there is nothing to press. Walk
   * into it and `changeset` happens under you, which means `faceStandpoint` is
   * ALWAYS going to report failure when the trip works — its "left gstair3 for
   * gstair2 while looking for view68" is the success. So the trip is judged on
   * where we ended up and not on what the walk said.
   *
   * `savedeck` is part of "where", because two of the four flights land in the
   * same set they left: gstair3 is B deck and C deck both, and a climb from C
   * arrives in gstair3 with `savedeck = "b"`.
   */
  private async walkTo(trip: ShipTrip): Promise<NavResult> {
    const arrived = (): boolean =>
      this.d.setName() === trip.to &&
      (!trip.sets.savedeck || String(this.d.flow().savedeck ?? "") === String(trip.sets.savedeck));
    const walked = await this.faceStandpoint(trip.stand, trip.standScene);
    this.count++;
    if (arrived()) {
      this.say(`climbed to ${trip.to}${trip.sets.savedeck ? ` (deck ${trip.sets.savedeck})` : ""}`);
      return { ok: true, gestures: this.count };
    }
    // Standing on the stair view without the set having changed is the one case
    // worth naming: `openscene` runs on ENTRY, so a standpoint we were already in
    // does not re-fire it, and turning to it is not arriving at it.
    if (walked.ok) {
      return {
        ok: false,
        reason: `stood at ${trip.stand.join("|")} in ${trip.from} and the stairs did not take us — already in that scene?`,
        gestures: this.count,
      };
    }
    return { ok: false, reason: `${trip.from} -> ${trip.to}: ${walked.reason}`, gestures: this.count };
  }

  /**
   * Which deck plan is on screen, or null. `openstage` opens the plan for the
   * deck you are standing on (`gotopage(currentpage())`), so which page the map
   * comes up on is not knowable in advance — it has to be read back.
   */
  private mapPage(): number | null {
    return currentPage(this.d.inFlat());
  }

  /** Close the map having gone nowhere — its exitmap() plaque. */
  private async closeMap(): Promise<void> {
    if (this.mapPage() === null) return;
    if (await this.d.clickThing(MAP_EXIT_REGION)) this.count++;
  }

  /**
   * Open the deck map, turn to a plan, and press a red area — the game's own
   * fast travel, three gestures for any distance.
   *
   * Every step is a click a player makes. The map is a band prop like the bag and
   * costs the same first click to wake the interface (house.shp's map mousedown
   * answers a `dark` map with activateinterface() and nothing else, then `light`
   * with open()); the plans are pages you turn with the buttons along the bottom;
   * a red area runs `jumpbaby`, which stashes jumpset/jumpscene/jumpview and
   * closes the map, and the engine picks those up on the way out (Stage's
   * closeFlat). Nothing here reaches past the map.
   *
   * Fails rather than guesses when the map is refused — `mapdisabled()` is a real
   * part of the game (no bag, no watch, mission 4, the stack tops, the boiler
   * room) and "you cannot travel from here" is an answer a route should get told.
   */
  async jump(setName: string, choice?: MapJump): Promise<NavResult> {
    const goal = setName.toLowerCase();
    if (this.d.setName() === goal) return { ok: true, gestures: this.count };
    const here = this.d.setName();
    if (!mapUsable(here, this.d.flow(), (p) => this.d.propOwner(p) === "frank")) {
      return { ok: false, reason: `the map is no use in ${here} (mapdisabled)`, gestures: this.count };
    }
    // `choice` is a plan the caller already costed, and honouring it is the point:
    // several plans carry a red area for the same set (stair2c is on all seven), and
    // WHICH one you press decides the deck you arrive on — `savedeck`, the value the
    // next trip is guarded against. Re-deriving it here threw that away, and `jumpTo`
    // then preferred a plan on the deck you were standing on: the one you are leaving.
    const red = choice ?? jumpTo(goal, String(this.d.flow().savedeck ?? ""));
    if (!red) return { ok: false, reason: `no red area for ${goal} on any deck plan`, gestures: this.count };

    // -- open it. Two clicks, for the same reason the bag takes two --
    //
    // The two clicks do DIFFERENT things, so they must not be waited on the same
    // way. house.shp c609's mousedown switches on the map's own view: "dark" runs
    // activateinterface() — which lights the band and returns, with no animation
    // and nothing to load — and only "light" runs open(). Waiting for the map
    // PAGE after the first click therefore always waited out its full timeout,
    // because the first click was never going to produce one: measured at 4.8 s
    // per map use in the browser gate, every time the band started dark. Waiting
    // for "the band is lit OR the map is up" ends the moment either click lands.
    for (let i = 0; i < INTERFACE_ATTEMPTS && this.mapPage() === null; i++) {
      const flat = this.d.inFlat();
      if (flat) return { ok: false, reason: `the "${flat}" flat is already open`, gestures: this.count };
      const wasDark = this.d.propState("map") === "dark";
      if (!(await this.d.clickThing("map"))) {
        return { ok: false, reason: `no map to open in ${here} (has Smethells handed it over?)`, gestures: this.count };
      }
      this.count++;
      await this.d.waitFor(
        () => this.mapPage() !== null || (wasDark && this.d.propState("map") === "light"),
        wasDark ? "the band to light" : "the map to open",
        4000,
      );
    }
    if (this.mapPage() === null) {
      return { ok: false, reason: `the map would not open in ${here}`, gestures: this.count };
    }

    // -- turn to the deck, unless it opened on it --
    if (this.mapPage() !== red.page) {
      const button = pageButton(red.page);
      if (!button) return { ok: false, reason: `no button for deck plan ${red.page}`, gestures: this.count };
      if (!(await this.d.clickThing(button.region))) {
        await this.closeMap();
        return { ok: false, reason: `no "${button.region}" to turn to deck ${red.deck}`, gestures: this.count };
      }
      this.count++;
    }

    // -- press the stairwell --
    if (!(await this.d.clickThing(red.region))) {
      await this.closeMap();
      return { ok: false, reason: `no "${red.region}" on deck ${red.deck}'s plan for ${goal}`, gestures: this.count };
    }
    this.count++;
    // exitmap() runs the close animation and transfromflat() before the engine
    // consumes jumpset, so arriving takes a moment longer than the click
    await this.d.waitFor(() => this.d.setName() === goal && !this.d.inFlat(), `the jump to ${goal}`, 20_000);
    if (this.d.setName() !== goal) {
      await this.closeMap();
      return { ok: false, reason: `the map jump to ${goal} left us in ${this.d.setName()}`, gestures: this.count };
    }
    this.say(`took the map to ${goal} (deck ${red.deck})`);
    return { ok: true, gestures: this.count };
  }

  /**
   * Get to a set the quickest way the game allows: take the deck map as far as it
   * goes, then walk the rest.
   *
   * The map's live red areas are stairwells (see mapjumps.ts), so travelling is a
   * jump plus a walk almost every time — deck C's plan offers its staircases and
   * not cabin C73. The choice between them is made on the walk each would leave:
   * the shortest route from a landing point, plus the jump itself, against the
   * route from where we stand. A tie goes to walking, so this only ever shortens a
   * trip, and a set the map cannot help with is simply walked to.
   *
   * Worth the trouble even so: C73 to the gymnasium is ten rooms on foot and, by
   * map, four clicks to the boat-deck stairwell and two rooms — 17.6 s against
   * over a minute in a browser, where every hop is a turn or a walk animation
   * playing out in real time.
   */
  async travel(setName: string): Promise<NavResult> {
    const goal = setName.toLowerCase();
    const here = this.d.setName();
    if (here === goal) return { ok: true, gestures: this.count };
    const flow = this.d.flow();
    /** hops on foot, or null when there is no walking route at all */
    const walk = (from: string): number | null => {
      if (from === goal) return 0;
      const route = routeTo(from, goal, flow);
      return route?.length ? route.length : null;
    };
    const onFoot = walk(here);
    if (mapUsable(here, flow, (p) => this.d.propOwner(p) === "frank")) {
      const best = this.cheapestJump(goal, flow);
      if (best && (onFoot === null || best.cost < onFoot)) {
        const jumped = await this.jump(best.red.to, best.red);
        // a refused jump is not a dead end: fall through and walk it
        if (!jumped.ok) this.say(`map: ${jumped.reason} — walking instead`);
      }
    }
    return this.goto(goal);
  }

  /**
   * The cheapest deck plan to press for `goal`: one gesture for the jump, plus the
   * hops left after it lands.
   *
   * Costed on the deck each plan SETS, which is the whole subtlety. Several plans
   * carry a red area for the same set — `stair2c` is on all seven — and pressing one
   * writes its `deck` into `savedeck`, which is exactly what the ship graph's trips
   * are guarded on (GSTAIR3's landings are the same set with it flipped). Costing
   * every candidate against the savedeck you are LEAVING scored them identically, and
   * the tie then fell to table order.
   *
   * Measured, c73 -> the control room at mission 1 phase 2: the old rule presses the
   * C-deck plan and walks down six decks — 62 gestures, 661 ticks. Costing by the
   * deck the plan sets lands at the standpoint the next trip already stands at —
   * 37 gestures, 383 ticks.
   *
   * One gesture-count per hop is crude, but it is the same currency on both sides of
   * the comparison, and a jump is three clicks against a hop's turns.
   *
   * ## And a hop count cannot see inside a room
   *
   * The ship graph is a graph of ROOMS, and `stair2c` is one room — nine standpoints
   * in a line, from the F-deck landing at the bottom to the boat-deck landing at the
   * top (nav/stair2c.ts). So a plan that lands you at the top and one that lands you
   * at the bottom score IDENTICALLY for any goal below decks, while being twenty
   * gestures apart, and the tie fell to table order: page 1, the boat deck.
   *
   * Measured in the browser gate: four trips landed at `stair2c (deck bd)` and then
   * walked the whole staircase down to the F-deck exit at **27.1 s each**, where the
   * two jumps that landed on the deck their next hop wanted took **1.7 s**. The map
   * has a red area for the staircase on all seven plans and the F-deck one arrives at
   * Scene13/View28 — which IS the standpoint the `stair2c -> hallf2c` trip stands at.
   *
   * So an arrival AT the next hop's own standpoint breaks the tie, and the tie is all
   * it breaks: half a hop, against whole hops everywhere else. Both halves are
   * generated data (`MapJump.arrive`, `ShipTrip.stand`) rather than anything this
   * file knows about staircases.
   */
  private cheapestJump(goal: string, flow: FlowState): { red: MapJump; cost: number } | null {
    let best: { red: MapJump; cost: number } | null = null;
    for (const red of MAP_JUMPS) {
      const landed: FlowState = { ...flow, savedeck: red.deck };
      const rest = red.to === goal ? [] : routeTo(red.to, goal, landed);
      if (rest === null) continue;
      const atTheDoor = rest.length > 0 && rest[0].stand.includes(red.arrive[1]);
      const cost = 1 + rest.length + (atTheDoor ? 0 : 0.5);
      if (!best || cost < best.cost) best = { red, cost };
    }
    return best;
  }

  /**
   * {@link travel}, answering anyone who stops you on the way.
   *
   * A walk through an inhabited ship is interrupted, and `travel` is right to
   * refuse to continue: a visible puppet makes the viewer busy, so turning and
   * walking would be wandering off mid-sentence. It reports `a conversation is
   * open in <room>; answer it first` and hands the decision back, because WHICH
   * answer you give is the story and the navigator will not pick one to get
   * itself unstuck.
   *
   * That contract is kept here — the caller still supplies the plan — while the
   * mechanical part, "answer and carry on walking", stops being every route's
   * problem. The 2nd-class staircase is what forced it: climbing out of the
   * turbine room now passes decks C and B, where `setupshayhack()` and
   * `setupcsea()` place Shay, the Hacker and the Chief Engineer, and their
   * `hotdist()` is small enough that a passing walk gets stopped. Before the
   * staircase could be climbed at all this could not happen, so no route needed
   * it (docs/taoot/verification.md, on `exitcode` and the 2nd-class staircase).
   *
   * Each answered conversation buys one more attempt, capped: a room that keeps
   * re-opening a puppet is a route bug, and grinding forever hides it.
   */
  async travelThrough(setName: string, answer: TalkPlan = { otherwise: "last", maxTurns: 60 }): Promise<NavResult> {
    const MAX_ANSWERS = 6;
    let last: NavResult = { ok: false, reason: `never tried to reach ${setName}`, gestures: this.count };
    for (let answered = 0; answered <= MAX_ANSWERS; answered++) {
      if (this.d.conversing()) {
        const said = await this.talk(answer);
        if (!said.ok) {
          return { ok: false, reason: `stopped in ${this.d.setName()} and could not answer: ${said.reason}`, gestures: this.count };
        }
        this.say(`answered someone in ${this.d.setName()} on the way to ${setName}`);
      }
      last = await this.travel(setName);
      if (last.ok) return last;
      // only a conversation is worth another go; any other refusal is the same
      // refusal however many times it is asked
      if (!this.d.conversing()) return last;
    }
    return { ok: false, reason: `${MAX_ANSWERS} conversations on the way to ${setName}, still ${last.reason}`, gestures: this.count };
  }

  /**
   * Walk to a set, room by room. Re-derives the route after each hop from where
   * we actually ended up, so a hop that lands somewhere unexpected (a script
   * with its own opinion about where you're going) recovers instead of
   * marching on with a stale plan.
   */
  async goto(setName: string): Promise<NavResult> {
    const goal = setName.toLowerCase();
    for (let hop = 0; hop < 40; hop++) {
      const here = this.d.setName();
      if (here === goal) return { ok: true, gestures: this.count };
      // Ask the map again, every hop — not once at the start. `mapdisabled()` refuses
      // in `boil`, `cargo`, `bind`/`bing`/`binl` and the staircase tops, so a trip
      // DECIDED in one of those rooms used to walk the whole way even though the very
      // next room could travel. Measured in the browser run, segment 5:
      // `boil -> halla` planned NINE hops on foot — boil, engine, scot2, scot3,
      // stair2c, deckbd, decka, gstair2, halla — and took 94 seconds with twenty-odd
      // turns inside stair2c alone. It is two hops when the map is re-asked one room
      // out. (Segment 13 hand-patches the same thing with travelPast(carghall).)
      // Only taken when genuinely cheaper than the walk that remains, so a route one
      // hop from its goal does not open the map to save nothing.
      if (hop > 0) {
        const flowNow = this.d.flow();
        const remaining = routeTo(here, goal, flowNow)?.length ?? null;
        if (mapUsable(here, flowNow, (p) => this.d.propOwner(p) === "frank")) {
          const best = this.cheapestJump(goal, flowNow);
          if (best && (remaining === null || best.cost < remaining)) {
            const jumped = await this.jump(best.red.to, best.red);
            if (jumped.ok) continue; // landed somewhere new: re-plan from there
            this.say(`map: ${jumped.reason} — walking on`);
          }
        }
      }
      const route = routeTo(here, goal, this.d.flow());
      if (!route?.length) {
        return { ok: false, reason: `no route from ${here} to ${goal}`, gestures: this.count };
      }
      this.say(`${here} -> ${goal}: ${route.map((t) => t.to).join(" -> ")}`);
      const took = await this.takeTrip(route[0]);
      if (!took.ok) {
        // that exit didn't work; try any other available exit toward the goal
        const alts = tripsFrom(here, this.d.flow()).filter((t) => t !== route[0] && t.to === route[0].to);
        let recovered = false;
        for (const alt of alts) {
          const retry = await this.takeTrip(alt);
          if (retry.ok) {
            recovered = true;
            break;
          }
        }
        if (!recovered) return took;
      }
    }
    return { ok: false, reason: `too many hops looking for ${goal}`, gestures: this.count };
  }
}
