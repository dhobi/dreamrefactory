/**
 * The playthrough in a real browser — every segment, through real mouse and
 * keyboard events against a live dev server, diffed against the same golden
 * traces the headless run asserts.
 *
 *   npm run dev
 *   npm run test:browser:playthrough          # headless, asserts, exits
 *   npm run watch:playthrough                 # a real window, slowed down, stays open
 *   npm run watch:mission0                    # the boot, the flat, the bomb, the crossing
 *   npm run watch:mission1                    # every segment of mission 1 so far
 *   npm run watch:m1p2                        # just the one that starts at phase 2
 *   APP_URL=… HEADED=1 SLOWMO=400 npx tsx tests/browser/playthrough.ts
 *
 * The per-segment scripts are named for the CHECKPOINT they resume from, not for
 * their segment number, so the script and the savegame it loads have the same
 * name — `watch:m1p2` reads out/checkpoints/m1p2.ti, and that is also what the
 * error names if you haven't recorded one yet. `watch:mission1` is the whole
 * mission and grows a segment at a time; the phase ones are for working on one.
 *
 * Segment 1 is the boot, so it is played from the boot. Every later segment
 * CONTINUES the game the one before it left standing (see LEAVES_AT), exactly as
 * the headless run does, and loads the same `.ti` checkpoint its headless twin
 * starts from (out/checkpoints, written by `npm run test:playthrough`) only when
 * there is no such game — a filtered run, or a segment after a segment that threw.
 * Loading is why you can watch mission 1 without sitting through
 * the crossing first; carrying is why the trace compares against a golden recorded
 * in the same mode.
 *
 * The headless run is the oracle; this one is the diff target. Everything the
 * two share (the engine, the route, the seed, the snapshotter) is identical by
 * construction, so a divergence is by elimination a browser-layer fact: canvas
 * coordinate mapping, DOM event plumbing, rAF pacing through the poll loop that
 * turns you to the window, or the live disc switch (setpath(2) is an HTTP fetch
 * from the other volume here, a synchronous index swap there).
 *
 * It costs roughly what the game costs, in real time — conversations play their
 * lines, walks play their frames. What it no longer pays for is cutscene: ESC
 * skips a clip in the original and does here (docs/formats/mov.md), so `rush`
 * presses it through every stretch that isn't asking the player anything, which
 * took ~160 s off the crossing alone. Timed loops still take their time, which
 * is the case for keeping the headless run as the one that gates a commit.
 */
import { chromium, Browser, Page } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseZeitelAgain, segment2, segment3, segment4, segment5, segment6, segment7, segment8, segment9, segment10, segment11, segment12, segment13, segment14, segment15, segment16, segment17, segment18, segment19, segment20, segment21, segment22, segment23, segment24, segment25, segment26, segment27 } from "../playthrough/segments";
import { PLANT_GAUGES, PLANT_LEVELS } from "../playthrough/segments";
import { isCoinFlip, isHarnessPaced } from "../../src/engine/masks";
import { browserStory } from "./story";
import { appUrl, type BrowserDriver } from "./driver";
import { installRepaintProbe, readRepaintProbe, reportRepaint } from "./repaint";
import { installPropTrace, readPropTrace } from "./proptrace";

// the language is pinned here (see appUrl): an install with several would
// otherwise stop on the chooser before the landing screen exists
const APP_URL = appUrl();

/**
 * Watch it play. `HEADED=1` opens a real window instead of running headless, and
 * `SLOWMO=<ms>` pads every Playwright action so the gestures are followable by
 * eye — the route is the same either way, so watching it is watching exactly
 * what the assertion asserts. The window stays open at the end when watching
 * (KEEPOPEN=0 to close it anyway); headless still exits on the verdict.
 */
const HEADED = !!process.env.HEADED && process.env.HEADED !== "0";
const SLOWMO = Number(process.env.SLOWMO ?? (HEADED ? 250 : 0));
const KEEPOPEN = HEADED && process.env.KEEPOPEN !== "0";
/** also check the renderer's skipped frames against the pixels — see ./repaint.ts */
const REPAINT_CHECK = !!process.env.REPAINT_CHECK && process.env.REPAINT_CHECK !== "0";
/**
 * Which segments to run, in order — a subset is for watching, not for gating.
 *
 * The default is every segment, endgame included — which it has not always been.
 * A default that stopped at 20 while 21-24 sat in the tables below reported
 * "PASSED — 68 beats over 20 segment(s)" without replaying the fight or the
 * smokestack. Extending it to 29 then failed 10 ways, and the cause was not the
 * routes: `serviceGameClock` was gated on `hasRealFrames`, so headless the
 * sinking never started, `clock` kept the pending event name the save restored,
 * and the mission-4 goldens were traces of a ship that isn't sinking. With the
 * clock running on both hosts the two agree to the minute — 13:15 in each — and
 * what was left was the route racing the game rather than the hosts disagreeing:
 * the last segment was taking a lifeboat before `sinkmovie()` had had its chance
 * on a crowded deck, and sampling the ending while the closing narration was still
 * reading the papers out. Both are waits now, and the endgame gates.
 *
 * The count is written here, so adding segment 29 to the tables below is a
 * deliberate line in this file rather than a silent extension of the gate.
 *
 * **The gate is one carried game, cold boot to credits, and nothing in it loads.**
 * That took removing a segment rather than fixing one. There used to be a
 * twenty-ninth, and the old twenty-eighth went six decks down to trade Clariss's
 * shawl for the real necklace — a segment that could only ever LOAD, because the
 * trip crosses the boat deck, where `DECKBD2.SET` c1012 stands the Gorse-Joneses at
 * the rail the first time you press up, and their offer of a place in a lifeboat is
 * a one-shot that a walk-through answers away. A carried version of it left the
 * ending segment with nobody at the rail, and routing it through C deck in both
 * directions was measured and did not avoid that (`jonesphase` 0 when it started
 * and 1 by the time it reached `turb`).
 *
 * What removed it was getting the necklace somewhere else: the sub-plot in mission 1
 * phase 4 (segments.ts `necklace`) leaves `propowner("realneck")` = "frank" from the
 * first hour, so the trade had nothing left to buy. The boat deck is now visited
 * exactly once, by the segment that ends the game there.
 *
 * A second retirement followed, for the same shape of reason. The antidote errand and
 * the blackjack table both existed only to undo segment 26 handing the painting to
 * Zeitel; refusing his deal keeps it, and the pass it was buying back is not needed
 * for anything else. That took the RNG out of the endgame — what Buick deals is 52
 * draws off the seeded stream, so the run's verdict used to depend on where the
 * stream happened to be (docs/reference/route.md). Each retirement handed its number back, so these
 * run 1..27 with no gap.
 */
const GATED_SEGMENTS = Array.from({ length: 27 }, (_, i) => String(i + 1)).join(",");
const SEGMENTS = (process.env.SEGMENTS ?? GATED_SEGMENTS).split(",").map((n) => n.trim()).filter(Boolean);
const HERE = dirname(fileURLToPath(import.meta.url));
const golden = (n: string) => join(HERE, "..", "playthrough", "golden", `playthrough-${n}.json`);
const checkpoint = (name: string) => join(HERE, "..", "..", "out", "checkpoints", `${name}.ti`);

/** the savegame each later segment starts from, exactly as headless does */
const STARTS_AT: Record<string, string> = {
  "2": "m1p0", "3": "m1p1", "4": "m1p2", "5": "m1p3", "6": "m1p4", "7": "m2p0", "8": "m2gram", "9": "m2sent", "10": "m2man", "11": "m2link", "12": "m2keys", "13": "m2p1", "14": "m2fence", "15": "m2p2", "16": "m2p3", "17": "m3p0", "18": "m3clue", "19": "m3phrase", "20": "m3cigs", "21": "m3p1", "22": "m3thanks", "23": "m3p2", "24": "m3top",
  "25": "m4p0", "26": "m4penny", "27": "m4anti",
};

/**
 * Where each segment LEAVES the game standing — the checkpoint name the next one
 * would otherwise load. This is what lets the browser run carry one game instead
 * of loading twenty-seven times, exactly as headless does.
 *
 * Derived from {@link STARTS_AT} rather than written out twice: a segment hands over
 * wherever THE NEXT ONE begins — by story ORDER, not by N + 1. The numbers are
 * consecutive again, but deriving from arithmetic on them is what broke a full run
 * once: retiring a segment left a hole, `N - 1` put m4geo against a number that no
 * longer existed, 27 handed over to nobody and the ending segment loaded. Order
 * survives the next renumbering; arithmetic did not survive the last one. The only
 * chain end is 28, which finishes the game.
 *
 * Why carry at all, when loading is simpler: a `.ti` is not a snapshot of the
 * running game. Its variable table is fixed-size, so globals that do not fit are
 * dropped (the boiler and turbine sim, handitem); its skeleton is a SHIPPED save,
 * so slots nothing overwrites still hold that save's values (oldset "c73",
 * deckc.trk playing in the bedsit); `actorvalue` has no record at all; and the
 * load rebuilds loops, crickets, music and actor positions by re-running the
 * room's own openset/openscene at the restored progress. All faithful — the
 * original reloads the same way — but it means a chain of loads is not the run a
 * player makes, and the goldens are recorded from the run a player makes. Every
 * segment that loads is therefore compared against a trace of the other mode and
 * disagrees about fifty globals that have nothing to do with the story.
 */
const LEAVES_AT: Record<string, string> = {};
{
  // segment 1 boots rather than loading, so it is not in STARTS_AT but is in the chain
  const order = ["1", ...Object.keys(STARTS_AT)].sort((a, b) => Number(a) - Number(b));
  for (let i = 0; i + 1 < order.length; i++) LEAVES_AT[order[i]] = STARTS_AT[order[i + 1]];
}

/** the segments that are a Story, by number — segment 1 is the boot and is not */
const PLAY: Record<string, (s: Awaited<ReturnType<typeof browserStory>>) => Promise<void>> = {
  "2": segment2,
  "3": segment3,
  "4": segment4,
  "5": segment5,
  "6": segment6,
  "7": segment7,
  "8": segment8,
  "9": segment9,
  "10": segment10,
  "11": segment11,
  "12": segment12,
  "13": segment13,
  "14": segment14,
  "15": segment15,
  "16": segment16,
  "17": segment17,
  "18": segment18,
  "19": segment19,
  "20": segment20,
  "21": segment21,
  "22": segment22,
  "23": segment23,
  "24": segment24,
  "25": segment25,
  "26": segment26,
  "27": segment27,
};
const GOLDEN = golden("1");

/** must match tests/playthrough/playthrough.ts — the trace is only comparable per-seed */
const SEED = 19120415;
const OK_BUTTON = { x: 460, y: 352 };
const MENU_GAME = { x: 266, y: 254 };
const BEDSIT_OBJECTS = ["memory", "obit", "paper", "cabinet", "cards", "poster", "mantle"];

/**
 * Game-clock globals, excluded from the comparison.
 *
 * Not flakiness — a real difference in what the two hosts do, and one that
 * survives `serviceGameClock` no longer being gated on hasRealFrames. The clock
 * now runs on both hosts, but it deliberately discards any time that passes
 * while a script is busy (BOOTFILE's `idle()` only ran between events, so it
 * cannot tick through a movie or a walk). What is left is IDLE time — and a
 * browser spends real seconds idle between gestures while a pumped host spends
 * none at all, because the pump only advances the virtual clock while it is
 * waiting for something. So the pocketwatch ticks in a browser and barely moves
 * headless, and that is faithful on both sides rather than a bug on either.
 *
 * `clock` is in the list because it IS one of these: BOOTFILE's calctime does
 * `clock = hrs * 100 + min`, so it carries exactly the same information as the
 * masked `hrs`/`min` pair. It was missing, which is why the endgame's first
 * browser run reported `clock: browser 1301 vs golden "startdisk1"` — the
 * golden's value being the pending clock-event name the save restored, which
 * nothing had yet overwritten. What mission 4 actually turns on is `phase`, and
 * that is compared: `canadvance()` pins hrs/min at each threshold until
 * sinkmovie() takes, so the phase a route reaches does not depend on how many
 * seconds the host spent getting there. The arrival time the route asserts
 * (9:30) is checked explicitly below.
 *
 * `idlecount` joins them for the same reason one step removed: it is BOOTFILE's
 * own idle-pass counter, `idlecount + 1` mod 4 in `idle()`, so its value is
 * "how many idle passes have gone by" and nothing else. It became visible at all
 * only once the clock ran on both hosts.
 */
const CLOCK_GLOBALS = ["clock", "clockcount", "sec", "secframe", "min", "hrs", "idlecount"];

/**
 * Frame-counter globals, also excluded — and for a related reason.
 *
 * `frame()` counts DISPLAYED frames, and the two hosts do not display the same
 * number of them: headless pumps a virtual clock as fast as it likes, a browser
 * draws on rAF. Anything a script stores a frame number in therefore differs
 * legitimately. `attentionspan` is gang.cst's hasattention() timer (how long a
 * character has had your attention before addressing you unprompted); the
 * `…frame` names are the same idea per sub-plot.
 *
 * The list itself is {@link isHarnessPaced}, shared with the headless comparison,
 * because it had been copied and the copies drifted: `lastsail` was masked there
 * and not here, so every segment from 13 on reported `lastsail: browser 9926 vs
 * golden 7478` — a frame stamp the fencing bout sets, already measured at 7473
 * and 7481 across two identical headless runs. `curattention` is added here and
 * not there for the ordinary reason this comparison masks more than that one.
 */
const isFrameCounter = (name: string): boolean =>
  isHarnessPaced(name) || name === "curattention";

/**
 * The turbine plant's four water levels, excluded for the sixth variant of the
 * same reason — and this one is a family segments.ts tried to avoid needing.
 *
 * `TURBINE.STG changedone` re-arms itself every ten engine steps and runs one
 * `iterateone()` each time, so how many passes fit around the six dial drags is a
 * count of frames. The route already knows this and handles it the right way: the
 * beat is taken at the plant's FIXED POINT rather than mid-transient, and being
 * stationary is exactly the four flows being equal — which is what
 * `PLANT_STEADY` waits for and what this comparison still asserts, to the unit,
 * at `boilpres`/`valvpres`/`seaspres`/`condpres` = 2238.
 *
 * What the fixed point does not pin is where the water is STANDING when the flows
 * equalise, and the two hosts stand one unit apart: measured `turbine 17219 /
 * condensor 40691` in a browser against `17218 / 40692` headless. That is the same
 * equilibrium and not another one — the total is conserved (17219 + 40691 =
 * 17218 + 40692 = 57910), which is why segments.ts compares the levels within
 * {@link PLANT_LEVELS}'s `PLANT_DRIFT` of 16 rather than to the unit. A golden
 * diff has no tolerance to spend, so the four levels come out here instead.
 *
 * The cost is bounded and the plant is still examined: `electrical > 13` is the
 * whole of TURBINE.STG's own test and segment 4 asserts it, the flows are
 * compared, and nothing but a dial ever moves the six control globals.
 */
const isPlantLevel = (name: string): boolean => PLANT_LEVELS.has(name);

/**
 * ...and the plant's DERIVED readings, for the stronger reason written out at
 * {@link PLANT_GAUGES}: `waitForThePlant` already asserts every one of them to the
 * unit on BOTH hosts, and segment 21 asserts them again, so the golden's copy adds
 * nothing — while also firing at `beat("m1.2 at the turbine controls")`, which is
 * sampled before a dial is touched and while `changedone` is still iterating. That
 * beat is where the flaky segment-4 divergence lived.
 */
const isPlantGauge = (name: string): boolean => PLANT_GAUGES.has(name);

/**
 * The fight's power counters AND its punch history, excluded for the seventh
 * variant of the same reason — and, like the plant, a family the ROUTE had
 * already decided about.
 *
 * The fight with Vlad is real-time: `vladpower` comes down 14 or so a blow and the
 * route throws as many as it takes, so how many blows fit is a count of frames.
 * Measured across the hosts: 123 blows in a browser against the golden's 121, and
 * with them `playerpower` 492 vs 497 and `vladpower` -55 vs -56.
 *
 * segments.ts says why that is not a defect, in as many words — "Winning is the
 * assertion; a spotless win is not". Vlad's blows are the only dice in the fight
 * (`random(5) + 2` up to `+ 16`), so which position of the stream the route
 * arrives on decides whether he lands one before the combo settles; pinning
 * `playerpower` to its opening 512 made the run depend on that. What is asserted
 * instead is a floor of `512 - 4 * 16`, which still fails a real degradation, and
 * the WIN itself — `vladpower` past FIGHT_DOWN, the flat closing on his own
 * `endfight()`, and `actorowner("vlad") = "lostfight"` — none of which is masked.
 *
 * `firstpunch`/`secondpunch`/`thirdpunch` joined them, and they are the same fact
 * wearing different clothes. FIGHT.SHP 0076 keeps them as a shift register of the
 * last three blows thrown —
 *
 *     thirdpunch = secondpunch ; secondpunch = firstpunch ; firstpunch = arg
 *
 * so if the two hosts throw a different NUMBER of punches, they stop on a
 * different window of the same repeating combo. They agreed for five runs by luck
 * of where 121 and 123 happen to land in a cycle, and then a run came back with
 * `firstpunch "cross"/"upper"` and `secondpunch "upper"/"cross"` — the pair
 * swapped, which is the signature of being one blow out rather than of a different
 * fight. Masking them where the counts they are computed from are already masked
 * is the consistent thing; leaving them would be asserting a coincidence.
 *
 * The route throws cross, cross, uppercut on a loop, so a swapped adjacent pair is
 * precisely one blow's offset in a three-cycle — and they survive the fight as
 * sticky globals, which is why this was ONE divergence reported eighteen times, at
 * every beat from the fight to the end of the game.
 *
 * This does not blind the route to them. segments.ts reads all three every
 * iteration — a run of three crosses is what makes it throw the uppercut — and
 * that is untouched; only the beat comparison drops them. After `endfight()`
 * nothing reads them at all.
 */
const isFightPower = (name: string): boolean =>
  name === "playerpower" || name === "vladpower" ||
  name === "firstpunch" || name === "secondpunch" || name === "thirdpunch";

/**
 * The smokestack maze, excluded for the eighth variant of the same reason — and
 * this one is a DRAW rather than a count, so it is the `isExtra` case, not the
 * plant's.
 *
 * `ENGINE.SET` c1's keydown at View120 — the door into the false smokestack — does
 * `mazenumber = random (4)`, and `setupblocks()` turns that into `blocks`, a
 * comma-list of the gaps shut on the current floor (four mazes × nine levels, all
 * written out in the script). `blocked`, `thisblock` and `nextblock` are where in
 * the ring that leaves you. So the whole family is one `random(4)` and its
 * consequences.
 *
 * The seed is shared but the number of draws taken before that door is not — the
 * crowd and the crickets have drawn in a browser where a pumped host has not yet
 * reached them, which is the same reason `isExtra` exists. Measured: browser drew
 * maze 4 against the golden's 3, and with it `blocks "2,3,5,6,8," vs "3,8,"` on the
 * first floor. They are GLOBALS, so once they differ they differ in every beat
 * after the stack, which is why this covers segments 23 to 29 and not just 23.
 *
 * Masking them costs nothing, because a route cannot hardcode a path here and this
 * one does not: nav/smokestack.ts holds the eight `blocks` strings per maze and
 * breadth-firsts over (level, position), so the route SOLVES whichever maze it
 * drew and asserts every move against that solution — `faceStandpoint` per move
 * and `expect(sceneNow(d)).toBe(entry.scene)` on arrival. That is a stricter test
 * of the climb than a golden's fixed value, which only records the maze headless
 * happened to draw. Maze 4 is also the hard one — one of its four entries is a
 * dead end (docs/reference/route.md), so `pickEntry` choosing a solvable way up is
 * itself exercised here. It climbed in 18 moves.
 */
const isMazeState = (name: string): boolean =>
  name === "mazenumber" || name === "blocks" || name === "blocked" ||
  name === "thisblock" || name === "nextblock";

/**
 * The three smokestack sets, where the STANDPOINT is maze-dependent too.
 *
 * Dropping a compared field per-beat rather than per-name, because this is the one
 * place where where-you-are-standing is a function of a masked draw: the ladder
 * that reaches the top sits at a different point of the ring in each maze, so the
 * browser arrives in `smstack3` at Scene39/View56 and the golden at Scene42/View43.
 * Measured at exactly one beat, "m3.2 at the top of the stack" — which appears in
 * both segment 23's trace and segment 24's, since 24 opens there.
 *
 * `set` is NOT dropped, so reaching `smstack3` at all is still asserted, and so is
 * every global that is not maze state. Outside these three sets the standpoint is
 * compared as strictly as ever.
 */
const MAZE_SETS = new Set(["smstack1", "smstack2", "smstack3"]);

/**
 * Ambient sequencers, excluded for the third variant of the same reason: how far
 * one has got depends on how long you actually SPENT somewhere.
 *
 * `ladycount` is BEDSIT1's woman-in-the-street voice — `lady()` plays lady0..lady4
 * as crickets, re-arming a scene loop between them, so the sequence takes ~350
 * engine steps to finish. A browser sitting through the air raid in real time
 * finishes it; the headless route reaches its beats in fewer steps than that and
 * snapshots the counter part-way. Both are right for their host, and neither
 * means anything to the story — it is which of five voice clips has played.
 *
 * (This one only became visible once timer loops stopped losing ticks to a busy
 * script — see Scheduler.fireDueLoops. Before that the browser starved the
 * sequencer badly enough to match headless by accident.)
 */
const isAmbientSequencer = (name: string): boolean =>
  name === "ladycount" || isStockLineRotator(name);

/**
 * The stock-line rotators, which are the same idea as `ladycount` wearing a
 * different name: "which of N interchangeable lines does this character say next".
 *
 * `twocount`/`threecount`/`fourcount`/`fivecount` are seeded together as a family
 * (src/engine/session.ts, the `handitem` block) and every use has one shape — a
 * `switch <n>count` over `case 1..N` of alternative `puppetspeak` lines, then
 * `do<n>count()` to move it on. BSEA1.PUP's `brushoff()` is the clearest: four
 * ways for a seaman to tell you to go away.
 *
 * So its value is "how many times has someone brushed me off", and being brushed
 * off is something a character's own idle does unprompted — `hasattention()`, the
 * same machinery `attentionspan` counts and which is already masked here. A
 * browser idles in real seconds between gestures and a pumped host barely idles at
 * all, so the two do not arrive at a beat having been addressed the same number of
 * times. Measured: `fourcount` browser 2 against golden 1 at "m2.0 mission 1
 * signed off", and nothing else in that beat.
 *
 * Nothing reads them but the switch that picks the line, so no branch the story
 * takes depends on one.
 */
const isStockLineRotator = (name: string): boolean =>
  name === "twocount" || name === "threecount" || name === "fourcount" || name === "fivecount";

/**
 * The fencing match's scratch globals, excluded for the fifth variant of the same
 * reason: they are the state of a real-time minigame, and their values come out of
 * `random()` draws whose COUNT depends on how many frames went by.
 *
 * `FENCE.SHP willieidle` re-rolls `willieblock` — Haderlitz's four guarded
 * quadrants — every five ticks from the cursor's position, four `random(100)`
 * draws at a time, and `willieside` is another draw at every intent. A browser and
 * a pumped clock do not run the same number of ticks through a bout, so the pair
 * that happens to be showing when the bout ends is not the same pair. What the
 * bout DECIDES is compared and does agree: `fencelevel`, `fencewins`, `fencecount`
 * and `actorowner("willie")` — see segment 13 on why it wins 5-0 rather than 5-3.
 *
 * `FENCE.STG closestage` calls `dumpglobal` on exactly these, and what that means
 * is an open question: they appear in 0 of the 109 shipped
 * saves while `playerblock` and `attacktot`, dumped on the same line, appear in 25
 * and 33. If it turns out to mean "delete", this mask goes away with it.
 */
const isFencingScratch = (name: string): boolean => name === "willieblock" || name === "willieside";

const masked = (name: string): boolean =>
  CLOCK_GLOBALS.includes(name) || isFrameCounter(name) || isAmbientSequencer(name) ||
  isFencingScratch(name) || isPlantLevel(name) || isPlantGauge(name) ||
  isFightPower(name) || isMazeState(name) || isCoinFlip(name);

/**
 * Props whose owner is the interface's own bookkeeping rather than the story's.
 *
 * Only `light`, and it is not a light. `HOUSE.SHP hideinterface` remembers whether
 * the band was LIT as it puts it away, so `showinterface` can put it back:
 *
 *     if propvisible ("light")   propowner ("light", "on")
 *     else                       propowner ("light", "off")
 *     ...
 *     if propowner ("light") = "on"          <- showinterface, the only reader
 *
 * Those three lines are every reference to it in the corpus — written twice in
 * HOUSE.SHP c1, read once in HOUSE.SHP c1, and nowhere else in any script in the
 * tree. No branch the story takes depends on it.
 *
 * It was the last cross-host divergence, and PROPTRACE=light says exactly why.
 * Over a full carried run headless writes it twice and the browser four times:
 *
 *   headless  #001 none -> on  in c73      #002 on -> off in c59
 *   browser   #001 none -> on  in c73      #002 on -> off in CONTROL
 *             #003 off  -> on  in HALLA    #004 on -> off in c59
 *
 * — an extra off/on pair, opening in the turbine control room and closing in
 * halla, which is exactly the segment 4 to segment 5 window where `props.light`
 * diverged and nothing else did. Both hosts run the same `hideinterface`; they
 * disagree about whether the band happened to be LIT when it ran. And that is a
 * real-time fact about the band: `house.shp`'s mousedown does nothing unless
 * `bagidle()` AND `watchidle()`, the watch animates on drawn frames, so a browser
 * needs retries where a pumped host lands the click first time (Navigator's
 * INTERFACE_ATTEMPTS, and its own note on why six). Different clicks, different
 * band state, same story.
 *
 * Replaced with a token rather than deleted, so the prop stays in the comparison
 * and every other owner in the map is still asserted.
 */
const isInterfaceMemo = (prop: string): boolean => prop === "light";

/**
 * The extras, excluded for the fourth variant of the same reason: WHICH of them
 * is standing there is drawn, and the draw is not in step between the hosts.
 *
 * `extra.cst` is the ship's background crowd, and a room fills its extra marks
 * from that cast — `ex.b.1` and `ex.b.2` on the C-deck landing outside the
 * Purser's office. Both hosts put two people on those two marks; they are just
 * not the same two (browser molly1/paul1 against headless jay1/jim1). The seed is
 * shared, but the number of `random()` draws made before the room opens is not,
 * because a browser has drawn for things a pumped clock has not yet reached.
 *
 * Their names went first and their PRESENCE had to follow, because whether a room
 * fills its extra marks at all is itself a draw: `GSTAIR3.SET openset` places its
 * pair behind `if savedeck = "b" & random(100) < 50`, a coin flip that comes down
 * differently in the two hosts for the same reason the names do. Segment 13 caught
 * it — two extras on the C-deck landing in a browser, none headless — so the crowd
 * is dropped entirely rather than half-compared.
 *
 * What that costs is small and bounded: anyone with a line, an owner the story
 * reads, or a puppet is in `gang.cst`, not `extra.cst`. What it would cost to keep
 * is a suite that fails on a coin flip.
 */
const isExtra = (mark: string): boolean => /^ex\./.test(mark);

/**
 * The fade level, also excluded, and for the same underlying reason.
 *
 * It is a ramp advanced one engine step per drawn frame, and the deferred reveal
 * that ends it is held back while any script is in flight (`session.tickFade`).
 * A conversation keeps a script suspended for its whole length, so a beat taken
 * mid-conversation — which is now most of them, since not waiting out the talking
 * is what makes a route watchable — catches the two hosts at different points in
 * that ramp: a browser holds the dim behind the close-up, headless does not.
 *
 * What the browser run therefore asserts is the STORY: every script global that
 * isn't a clock or a frame count, the room, the standpoint, the theme, and who
 * owns what. Not how far a dissolve had got.
 */
const COMPARED_FIELDS = ["set", "scene", "view", "theme"] as const;

const t0 = Date.now();
const mark = (s: string) => console.log(`${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s  ${s}`);

/**
 * canvas-pixel (512x384) -> page coordinates, so clicks are real mouse events —
 * and then waits until the engine has TAKEN the press.
 *
 * A press made while a script is in flight is queued rather than dispatched
 * (`GameSession.events`), faithfully: the shipped premovie/playmovie/postmovie
 * call no `flushevents()`, so TI.EXE leaves one queued too. Dispatched and queued
 * look identical from out here for a moment, so a caller that carries on reads a
 * queued press as "nothing happened" and the replay lands later as an effect
 * nobody asked for. That is what stalled the London flat all afternoon: a queued
 * press opening a close-up behind the route's back while the route waited for the
 * engine to go idle — `pending: ["queued click 334,193"]`, parked on 4 regions.
 *
 * The condition is an EMPTY QUEUE, which holds both when the press went straight
 * through and once a queued one has been taken. Deliberately not "the engine is
 * idle": a click that opens a conversation leaves it busy for the length of the
 * conversation, and the caller has bevels to press. Same rule as the driver's own
 * {@link browserDriver} click, because every route click needs it.
 */
async function canvasClick(page: Page, x: number, y: number): Promise<void> {
  const pt = await page.evaluate(
    ([x, y]: number[]) => {
      const c = document.getElementById("screen") as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { px: r.left + ((x + 0.5) / c.width) * r.width, py: r.top + ((y + 0.5) / c.height) * r.height };
    },
    [x, y],
  );
  await page.mouse.click(pt.px, pt.py);
  await waitFor(page, "dbg.session.events.length === 0", "the press to be taken", 30_000);
}

/** wait on engine state, never on a sleep */
const waitFor = (page: Page, fn: string, what: string, timeout = 300_000) =>
  page.waitForFunction(`(() => { const dbg = window.dbg; return ${fn}; })()`, null, { timeout }).catch(
    async (e) => {
      // A stall is almost always the engine refusing input, and `scriptBusy` is a
      // SET of promises — so "stuck waiting for the engine to take an arrow" used
      // to be the whole story. GameSession.pending() names the dispatches that are
      // still out, which is the difference between a guess and a lead.
      const held = await page
        .evaluate(`(() => { const d = window.dbg; const v = d.viewer; return JSON.stringify({
            pending: d.session.pending(), busy: v.busy, scriptBusy: d.session.scriptBusy,
            movie: v.moviePlaying, regions: v.movieRegions.length, puppet: !!d.session.puppet?.visible,
            fade: d.session.fade.level, lockevents: d.session.interp.globals.get("lockevents") }); })()`)
        .catch(() => "");
      throw new Error(`stuck waiting for ${what}: ${e.message}${held ? `\n  engine holding: ${held}` : ""}`);
    },
  );

const settle = (page: Page, what: string) => waitFor(page, "dbg.viewer && dbg.viewer.quiescent", `${what} to settle`);

/**
 * Press past the nightdive intro, if this edition and this deployment have one.
 *
 * It runs BEFORE the boot — there is no viewer and no session set until the boot
 * activates one — so every viewer-shaped predicate in this file is `undefined`
 * while it is on screen, `rush`'s included. That is how a run came to spend its
 * whole 300 s budget "stuck waiting for the boot menu" at a film that was itself
 * waiting: the page had reached `nightdive.mov segment 2/2 (3 frames,
 * interactive)`, which is the ownership question, and `rush` only presses Escape
 * while `dbg.viewer.moviePlaying`, so it pressed nothing and watched.
 *
 * ESC is the honest answer and the safe one. The film's own doc calls
 * `unanswered` "not a failure case — it is ESC", a player who has seen the
 * question before pressing past it, and `main.ts` boots the game for
 * `unanswered` exactly as for `owns`. Answering "wants" would navigate the page
 * to gog.com, which is not somewhere a test run comes back from.
 *
 * Silent when there is no intro: a tree without `public/nightdive.mov`, or any
 * edition but English, never opens one (src/nightdive.ts `introPlaysFor`) — and
 * that is the shape this harness was written against, which is why it went so
 * long without noticing.
 */
async function escapeIntro(page: Page): Promise<void> {
  // it is fetched and opened before it appears, so give it a moment to show up;
  // no intro at all is the common case and must not cost the run anything
  const showed = await page
    .waitForFunction("!!window.dbg && (!!window.dbg.intro || !!window.dbg.viewer)", null, { timeout: 20_000 })
    .then(() => page.evaluate(() => !!(window as any).dbg.intro))
    .catch(() => false);
  if (!showed) return;
  for (let press = 0; press < 20; press++) {
    await page.keyboard.press("Escape");
    const gone = await page
      .waitForFunction("!window.dbg.intro", null, { timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (gone) {
      mark(`   escaped the intro (${press + 1} press${press ? "es" : ""})`);
      return;
    }
  }
  throw new Error("the nightdive intro would not let go of Escape");
}

/**
 * A cutscene is on screen and is not asking anything — the one state ESC is for.
 * The same test as Navigator.rush's `showing`, in page terms; see that doc for
 * why a movie PARKED on its regions is never skipped.
 */
const SHOWING = "dbg.viewer && dbg.viewer.moviePlaying && dbg.viewer.movieRegions.length === 0";

/**
 * Wait for `done`, pressing a real Escape past every clip on the way — the
 * browser twin of Navigator.rush, and the reason this suite no longer costs the
 * ~160 s of crossing it used to. Both predicates are page-side expressions.
 */
async function rush(page: Page, done: string, what: string, budgetMs = 300_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  const holds = (expr: string) => page.evaluate(`(() => { const dbg = window.dbg; return !!(${expr}); })()`);
  for (let skipped = 0; skipped < 60; ) {
    await waitFor(page, `(${done}) || (${SHOWING})`, what, Math.max(1_000, deadline - Date.now()));
    if (await holds(done)) return;
    const clip = (await page.evaluate(() => (window as any).dbg.viewer?.movieFile)) as string | null;
    if (!clip) continue; // it ended by itself between the wait and the look
    await page.keyboard.press("Escape");
    // only until THIS clip is gone: the script usually answers with the next one
    await waitFor(page, `!dbg.viewer || dbg.viewer.movieFile !== ${JSON.stringify(clip)}`, `${clip} to be let go`, 30_000);
    mark(`   skipped ${clip}`);
    skipped++;
  }
  await waitFor(page, done, what, Math.max(1_000, deadline - Date.now()));
}

const snapshot = (page: Page, beat: string) =>
  page.evaluate((b) => (window as any).dbg.snapshotState((window as any).dbg.session, (window as any).dbg.viewer, b), beat);

const globalOf = (page: Page, name: string) =>
  page.evaluate((n) => (window as any).dbg.session.interp.globals.get(n), name);

/**
 * Segment 1 in the browser: the boot, the London flat, the bomb, the crossing.
 *
 * Hand-written rather than driven through the NavDriver, because it is mostly
 * NOT navigation — it is a menu movie, seven scored close-ups, and then a long
 * stretch during which the engine plays itself and the player has nothing to do
 * but hold ESC down.
 */
async function playSegment1(page: Page): Promise<unknown[]> {
  const trace: unknown[] = [];

  // -- 1-2. cold boot --------------------------------------------------------
  // Nothing to click: the page boots itself now (src/main.ts). There WAS a
  // "Cold boot" button and this clicked it; the landing screen it stood on is
  // gone, and `rush` below waits for the boot it starts either way.
  // ESC past the logos. rush stops at the menu by itself: playmode.mov parks on
  // its GAME/TOUR regions, and a parked movie is a question
  await rush(page, "dbg.viewer && dbg.viewer.awaitingInput", "the boot menu");
  mark("boot menu is waiting");
  await canvasClick(page, MENU_GAME.x, MENU_GAME.y);

  // -- 3. the London flat ----------------------------------------------------
  await waitFor(
    page,
    "dbg.session.currentThemeName === 'bedrad1.trk' && dbg.session.fade.level === 0 && !dbg.viewer.moviePlaying",
    "the London flat",
  );
  await settle(page, "the flat");
  trace.push(await snapshot(page, "3. london flat"));
  mark("3. london flat");

  // -- 4. the seven objects --------------------------------------------------
  const clicked = new Set<string>();
  for (let turn = 0; turn < 24 && clicked.size < BEDSIT_OBJECTS.length; turn++) {
    const objects: { id: string; cx: number; cy: number }[] = await page.evaluate(() => {
      const v = (window as any).dbg.viewer;
      return v.scene.views[v.viewIdx].objects.map((o: any) => ({
        id: (o.identifier ?? "").toLowerCase(),
        cx: Math.floor((o.startRegionX + o.endRegionX) / 2),
        cy: Math.floor((o.startRegionY + o.endRegionY) / 2),
      }));
    });
    for (const o of objects) {
      if (!BEDSIT_OBJECTS.includes(o.id) || clicked.has(o.id)) continue;
      // Every one of the seven is worth at least a point the FIRST time it is
      // clicked, and the scoring happens in the mousedown before the close-up
      // even plays — so a click that leaves bombpoints where it was is a click
      // that did not land, and clicking again is what a player does. Without
      // this the run sails on to an air raid that can never come: eleven points
      // arm the bomb and there are exactly eleven, so ONE missed click means the
      // route waits forever for a raid, five minutes from the beat that caused
      // it. (Seen intermittently in a browser, never headless.)
      let pts = Number(await globalOf(page, "bombpoints"));
      for (let attempt = 1; ; attempt++) {
        const before = pts;
        // Click only when the engine will TAKE it, which `settle` does not
        // establish: `quiescent` is `awaitingInput || !inputLocked`, so it is TRUE
        // while a parked clip holds the engine AND during the script tail after a
        // close-up (postmovie's fade). A click sent in that window is QUEUED
        // rather than dispatched — faithfully, the shipped premovie/postmovie call
        // no `flushevents()` — and it replays afterwards as a SECOND close-up
        // nobody dismisses. Which is exactly how this stalled: the retry below
        // scored, the run went looking for an arrow, and `pending()` named what
        // was holding the engine — `queued click 334,193`, parked on 4 regions.
        // Same lesson as the arrow press twenty lines down, now on the clicks too.
        // canvasClick does not return until the engine has TAKEN the press, so a
        // queued one has replayed by the time the close-up is looked for — see
        // there for why that matters and what it cost.
        await canvasClick(page, o.cx, o.cy);
        await playCloseUp(page, o.id);
        await settle(page, o.id);
        pts = Number(await globalOf(page, "bombpoints"));
        if (pts !== before) break;
        if (attempt === 3) {
          throw new Error(
            `${o.id} scored nothing in ${attempt} clicks at ${o.cx},${o.cy} ` +
              `(bombpoints ${before}) — the raid needs all eleven points`,
          );
        }
        mark(`   ${o.id} scored nothing — clicking it again`);
      }
      clicked.add(o.id);
      // The object that tips bombpoints past 10 arms the raid on a RANDOM fuse
      // (bedsit1.set: makeloop("scene","scene1","bomb",random(100)) — 0..100
      // engine steps), so whether the theme has flipped by the time we look is
      // not a property of the route. Wait for the raid this click caused; see
      // the same note in segments.ts, which the headless twin needs too.
      if (pts < 0) {
        await waitFor(page, "dbg.session.currentThemeName === 'bedsit1.trk'", `the raid ${o.id} sets off`);
      }
      trace.push(await snapshot(page, `4. ${o.id} (${pts} points)`));
      mark(`4. ${o.id} (${pts} points)`);
    }
    if (clicked.size < BEDSIT_OBJECTS.length) {
      const before = await page.evaluate(() => (window as any).dbg.viewer.viewIdx);
      // Wait until the press will actually be TAKEN, which is not the same as the
      // engine being settled. `SetViewer.keyDown` refuses on `inputLocked`, and
      // `quiescent` is `awaitingInput || !inputLocked` — so a press sent on
      // quiescent alone can still be refused, and a refused nav press is dropped
      // silently (the fade infidelity, written up at `pressNav` in src/viewer.ts).
      // This stalled a full run here after nine of the flat's eleven points, on a room
      // with nothing wrong with it. Retried as well, because a player who pressed
      // an arrow and saw nothing happen presses it again.
      for (let press = 1; press <= 3; press++) {
        await waitFor(page, "!dbg.viewer.inputLocked", "the engine to take an arrow", 15_000);
        await page.keyboard.press("ArrowRight"); // the real key, not viewer.turn()
        // the turn animation starts on the next rAF, so quiescent is briefly
        // still true from before the press — wait for the view to actually change
        const turned = await page
          .waitForFunction(`window.dbg.viewer.viewIdx !== ${before}`, null, { timeout: 5_000 })
          .then(() => true, () => false);
        if (turned) break;
        if (press === 3) throw new Error("the turn never started: three arrows, no view change");
        mark("   the arrow was dropped — pressing again");
      }
      await settle(page, "the turn");
      mark(`   turned to ${await page.evaluate(() => (window as any).dbg.viewer.scene.views[(window as any).dbg.viewer.viewIdx].viewName)}`);
    }
  }
  return finishSegment1(page, trace);
}

/**
 * Click a London close-up off the end of its film.
 *
 * The close-up parks on a region frame; OK walks it off. The gesture is over when
 * the script that opened it returns — NOT when `!moviePlaying`, which is briefly
 * true right after the click while the movie is still being fetched over HTTP
 * (headless reads it off disk and never shows that window). pointerdown routes
 * through session.track, so scriptBusy is set synchronously by the time the click
 * returns.
 *
 * NOT rushed with ESC, and that is the scoring rule rather than caution:
 * bedcards.mov pays +3 on each of its two action frames — six of the eleven points
 * that arm the bomb — and BEDSIT1 reads actionframe(1) only after spotmovie
 * returns. See the same note in segments.ts.
 */
async function playCloseUp(page: Page, id: string): Promise<void> {
  for (let ok = 0; ok < 12; ok++) {
    await waitFor(page, "dbg.viewer.awaitingInput || !dbg.session.scriptBusy", `${id}'s close-up`);
    // Only press OK if OK is THERE — i.e. if a region of a parked movie actually
    // covers that point. Otherwise 460,352 is a point in the ROOM, and a stray
    // click there once landed on `cards`, setting xxcards with no close-up to
    // score from: the real click later added nothing and the raid never armed,
    // one point short at 10 of 11.
    //
    // Asked as one question, in the page, about the frame that is up. Testing it
    // in a round trip of its own is the trap the wait above already exists to
    // avoid — the answer is about a moment that has passed by the time it
    // arrives, and a movie still being fetched over HTTP reads as "gone".
    const onOK = await page.evaluate(
      ([x, y]: number[]) =>
        (window as any).dbg.viewer.movieRegions.some(
          (r: any) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1,
        ),
      [OK_BUTTON.x, OK_BUTTON.y],
    );
    if (!onOK) break;
    await canvasClick(page, OK_BUTTON.x, OK_BUTTON.y);
  }
}

/** the flat's story is over; the engine plays the rest of segment 1 by itself */
async function finishSegment1(page: Page, trace: unknown[]): Promise<unknown[]> {
  // -- 5-7. the engine takes over -------------------------------------------
  await waitFor(page, "dbg.session.currentThemeName === 'bedsit1.trk'", "the bomb to fall");
  trace.push(await snapshot(page, "5. the bomb falls"));
  mark("5. the bomb falls — the blast, the newsreel and the boarding, ESC'd through");

  // -- 8. aboard -------------------------------------------------------------
  // the blast, the newsreel, the boarding: minutes of clips, not one of them a
  // question, so ESC through the lot
  await rush(page, "dbg.session.currentSetName === 'c73'", "the crossing to the Titanic");
  await settle(page, "the cabin");
  trace.push(await snapshot(page, "8. c73, mission 1"));
  mark("8. c73, mission 1");
  return trace;
}

/**
 * Diff a browser trace against the golden the headless run recorded. Reports
 * every difference rather than the first, because a systematic one (a whole
 * global family, a room) reads very differently from a single wrong field.
 *
 * A golden speaks for ONE mode, and `carried` is which mode this segment ran in.
 * Every golden is now recorded from a carried run (headless `LOADS_IN_A_FULL_RUN`
 * is empty), so a segment that had to LOAD — a filtered run, or anything after a
 * segment that threw — is being compared against a trace of the other mode and
 * will disagree about twenty globals that have nothing to do with the story: the
 * boiler and turbine sim, `saveprops`, `goodmess`, `countdial`, all of which a
 * `.ti` simply has no room for. Headless has always stood the comparison down for
 * that and this did not, so `SEGMENTS=6` reported twenty divergences that were the
 * savegame format rather than the browser. The segment's own expectations still
 * ran and still caught a route break; only the trace diff stands aside.
 */
function compare(trace: unknown[], goldenFile: string, label: string, carried = true): number {
  if (!existsSync(goldenFile)) throw new Error(`no golden trace at ${goldenFile} — run npm run test:playthrough first`);
  if (!carried) {
    console.log(`${label}: loaded, not carried — trace not compared (${trace.length} beats)`);
    return 0;
  }
  const golden = JSON.parse(readFileSync(goldenFile, "utf8")) as any[];
  const strip = (b: any) => ({
    ...b,
    fade: 0,
    // inside the false smokestack the standpoint is a function of which maze was
    // drawn, and the maze is not in step between the hosts — see MAZE_SETS. Both
    // sides are replaced with the same token rather than deleted, so the fields
    // stay present and every OTHER set still compares them.
    ...(MAZE_SETS.has(String(b.set).toLowerCase()) ? { scene: "(maze)", view: "(maze)" } : {}),
    globals: Object.fromEntries(Object.entries(b.globals).filter(([k]) => !masked(k))),
    props: Object.fromEntries(
      Object.entries(b.props ?? {}).map(([k, v]) => [k, isInterfaceMemo(k) ? "(band)" : v]),
    ),
    // the crowd: dropped, marks and all — see isExtra on why presence had to go
    // the same way as the names. Sorted, because dropping entries reorders the
    // object and the compare is a JSON string.
    actors: Object.fromEntries(
      Object.entries(b.actors ?? {})
        .filter(([, mark]) => !isExtra(String(mark)))
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ),
  });

  let failures = 0;
  const beats = (t: any[]) => t.map((b) => b.beat);
  if (JSON.stringify(beats(trace as any[])) !== JSON.stringify(beats(golden))) {
    failures++;
    console.error(`\n${label}: BEAT MISMATCH\n  browser: ` + beats(trace as any[]).join("\n           ") +
      "\n  golden:  " + beats(golden).join("\n           "));
    return failures;
  }
  for (let i = 0; i < golden.length; i++) {
    const a = strip(trace[i]), b = strip(golden[i]);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    failures++;
    console.error(`\n${label}: DIVERGED at beat "${golden[i].beat}":`);
    for (const k of new Set([...Object.keys(a.globals), ...Object.keys(b.globals)]))
      if (JSON.stringify(a.globals[k]) !== JSON.stringify(b.globals[k]))
        console.error(`  globals.${k}: browser ${JSON.stringify(a.globals[k])} vs golden ${JSON.stringify(b.globals[k])}`);
    for (const k of COMPARED_FIELDS)
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k]))
        console.error(`  ${k}: browser ${JSON.stringify(a[k])} vs golden ${JSON.stringify(b[k])}`);
    for (const side of ["props", "actors"] as const)
      if (JSON.stringify(a[side]) !== JSON.stringify(b[side]))
        console.error(`  ${side}: browser ${JSON.stringify(a[side])} vs golden ${JSON.stringify(b[side])}`);
  }
  return failures;
}

/**
 * Start a later segment where its headless twin starts: load the checkpoint
 * savegame through the host's own loadSavedGame, and re-seed `random()` first so
 * the two runs draw the same numbers from the same point in the stream.
 */
async function loadCheckpoint(page: Page, name: string): Promise<boolean> {
  // Reload first. Headless gives every segment a brand-new session; here they
  // would otherwise share one page, and loading a save restores the globals it
  // recorded WITHOUT clearing the ones it doesn't know about — so segment 3
  // inherited hallside, savedeck, handflag and curattention from segment 2 and
  // diverged on globals the golden had never heard of.
  await page.goto(APP_URL);
  await page.waitForFunction(() => !!(window as any).dbg, null, { timeout: 20_000 });
  await escapeIntro(page); // a reload replays it, so every checkpoint pays this too
  // Then play the boot, rather than loading over the top of it.
  //
  // The page boots itself now (src/main.ts, "Straight into the game"), so a fresh
  // goto leaves `session.track(host.coldBoot())` suspended on playmode.mov parked
  // on its GAME/TOUR regions — and a parked movie is a question, so that dispatch
  // never resolves on its own. Loading the save on top of it restored the right
  // game behind a script that was still in flight: `scriptBusy` stayed true
  // forever, and since a load leaves nothing `awaitingInput`, `quiescent` never
  // came and every segment but 1 died at its own checkpoint after a 300 s wait —
  // reporting the state it should have had (c73, deckc.trk, 9:30) as the state it
  // was stuck in. Segment 1 was the only survivor because it PLAYS the boot, and
  // at the parked menu `awaitingInput` makes the boot itself read as quiescent.
  //
  // The bridge is what a player does, because it is the only thing a player CAN
  // do: the boot menu offers Play and Guided Tour, and `opengame` lives on the
  // in-game CTL panel — a save is never loaded from anywhere but a running game.
  // So press GAME and let boot() run out to its hand-over before loading.
  await rush(page, "dbg.viewer && dbg.viewer.awaitingInput", "the boot menu");
  await canvasClick(page, MENU_GAME.x, MENU_GAME.y);
  await waitFor(page, "!dbg.session.scriptBusy", "the boot to hand the game over", 120_000);
  const file = checkpoint(name);
  if (!existsSync(file)) {
    throw new Error(`no checkpoint at ${file} — run npm run test:playthrough to write one`);
  }
  const bytes = [...new Uint8Array(readFileSync(file))];
  // FIRED, never awaited — the same shape as headless resume(), for the same two
  // reasons (tests/playthrough/play.ts): a restored room may delay(), and m4anti's
  // restored lounge ASKS — its own openscene opens Zeitel's conversation and the
  // load dispatch waits inside it for an answer. Awaiting here is what used to
  // hang this evaluate with no timeout until somebody killed the run (TODO 7a).
  // The flags live on WINDOW, not on dbg: window.dbg is a getter that builds a
  // fresh object per read (src/main.ts), so a property set on one read is gone
  // by the next — a flag written there is a flag nobody ever sees again.
  await page.evaluate(
    ([seed, data]: [number, number[]]) => {
      const w = window as any;
      w.dbg.session.seedRandom(seed);
      w.__loadDone = false;
      w.__loadError = "";
      w.dbg.session.track(w.dbg.host.loadSavedGame(new Uint8Array(data))).then(
        () => (w.__loadDone = true),
        (e: unknown) => (w.__loadError = String((e as Error)?.stack ?? e)),
      );
    },
    [SEED, bytes] as [number, number[]],
  );
  await waitFor(
    page,
    "dbg.viewer && (window.__loadDone ? dbg.viewer.quiescent : dbg.viewer.conversing)",
    `the ${name} checkpoint to settle`,
  );
  const settled = (await page.evaluate(() => (window as any).__loadDone)) as boolean;
  mark(settled ? `loaded checkpoint ${name}` : `loaded checkpoint ${name} — it came back asking`);
  return settled;
}

/** what a flat's "leave" region is called, commonest first — as tests/playthrough/playthrough.ts */
const FLAT_EXITS = ["ok", "exit", "back", "quit"];

/**
 * Put the interface back the way the next segment expects to find it.
 *
 * A carried game keeps everything a `.ti` would have dropped, the open enigma
 * machine and the parked clip included, and the next segment then finds its room
 * covered and says so. So the boundary does what a player does before walking
 * off: aborts whatever clip is parked (an abort is the only way out of one that
 * doesn't run its action frame) and closes what it opened.
 */
async function handBack(page: Page, d: BrowserDriver): Promise<void> {
  // Unless the game is over. `quit()` now puts the main menu back in place rather
  // than reloading the page, and that menu IS a flat with a parked clip on it —
  // "main 1", holding playmode.mov. Nothing here can close it (the exits it takes
  // clicks on are Play and the Guided Tour, and one of them would start a second
  // game), there is no next segment to hand anything to, and fighting it is what
  // printed `the "main 1" flat would not close` at the end of every run.
  if (d.flow().clock === "endgame") return;
  if (d.moviePlaying()) {
    await d.skipMovie();
    await d.sync();
  }
  for (let i = 0; i < 4 && d.inFlat() !== null; i++) {
    let clicked = false;
    for (const name of FLAT_EXITS) {
      if (await d.clickThing(name)) { clicked = true; break; }
    }
    if (!clicked) break;
    await settle(page, "the flat to close");
    await d.sync();
  }
  if (d.inFlat() !== null) mark(`  hand-back: the "${d.inFlat()}" flat would not close`);
}

async function main(): Promise<void> {
  const browser: Browser = await chromium.launch({ headless: !HEADED, slowMo: SLOWMO });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1300 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // ENGINELOG=<regexp> reports the page's OWN log as it grows, filtered.
  //
  // The engine says what it could not do through session.onLog, and main.ts sends
  // that to the `scriptlog` element rather than to console — so it is invisible to
  // page.on("console") and to this suite, which is why a browser divergence has so
  // far meant reasoning from the trace alone. `playnewtheme: no theme "deckc.trk"`
  // and `opentrackfile: "…" not available` are both in there, and either one names
  // the missing fetch outright.
  //
  // Filtered and opt-in because a full run's log is thousands of lines; polled off
  // the same beat boundaries the trace is sampled at, so it costs nothing when off.
  // The rule it exists for: a standalone probe that reaches a flat with
  // `session.transToFlat(...)` is NOT faithful, because `hitTestAt` answers nothing
  // there. Drive the real route, in the page, rather than a state jumped to.
  //
  // Read off `dbg.log()` rather than scraped out of the element: the pane is a
  // rolling buffer (src/log-buffer.ts), so past 5000 lines the oldest go and a
  // reader counting lines in the DOM would skip a whole batch. `dropped` says how
  // many left, so what has been seen stays an absolute count.
  const engineLog = process.env.ENGINELOG ? new RegExp(process.env.ENGINELOG, "i") : null;
  let logSeen = 0;
  const drainEngineLog = async (): Promise<void> => {
    if (!engineLog) return;
    const got = await page
      .evaluate(() => (window as any).dbg?.log?.() ?? { lines: [], dropped: 0 })
      .catch(() => ({ lines: [] as string[], dropped: 0 }));
    const from = Math.max(0, logSeen - got.dropped);
    for (const line of got.lines.slice(from)) if (engineLog.test(line)) mark(`  [engine] ${line}`);
    logSeen = got.dropped + got.lines.length;
  };
  // a route can take minutes per segment; if the page or browser goes away under
  // us, say so plainly instead of reporting it as the route failing
  page.on("crash", () => errors.push("the page CRASHED (renderer gone)"));
  page.on("close", () => errors.push("the page was CLOSED"));
  browser.on("disconnected", () => errors.push("the browser DISCONNECTED"));
  // REPAINT_CHECK=1 also asserts that every frame the renderer DECLINED to draw
  // was a frame that would have looked the same (tests/browser/repaint.ts). The
  // route is untouched by it — it rides along, because a route is the only thing
  // that reaches movies, conversations, walks and fades in the order a player
  // does. It makes the run slower, so it is off unless asked for.
  //
  // Before the goto, and before playSegment*'s own re-navigations: it is an init
  // script, and one installed after a load covers only that one document.
  // PROPTRACE=light[,other]: witness every write to those props' owners, in the
  // engine's own wording, so PROPTRACE_FILE can be diffed against the headless
  // run's (tests/browser/proptrace.ts).
  if (process.env.PROPTRACE) {
    await installPropTrace(page, process.env.PROPTRACE.split(",").map((p) => p.trim()).filter(Boolean));
  }
  if (REPAINT_CHECK) await installRepaintProbe(page);
  await page.goto(APP_URL);
  await page.waitForFunction(() => !!(window as any).dbg, null, { timeout: 20_000 });
  mark("app up" + (REPAINT_CHECK ? " (repaint probe armed)" : ""));
  await escapeIntro(page);

  // seed before anything runs: advanceday draws the arrival second at the very
  // end of the boot, and the bomb delay is drawn in the flat
  await page.evaluate((seed) => {
    const dbg = (window as any).dbg;
    dbg.session.seedRandom(seed);
  }, SEED);

  let failures = 0;
  let beats = 0;
  /**
   * Where the live game is standing, when it is standing anywhere a segment could
   * continue from. Null after a segment that threw — a half-played game must not
   * be handed on as if it were a clean boundary.
   */
  let live: string | null = null;
  /**
   * Where the wall clock goes, accumulated across segments.
   *
   * Each segment builds its own `browserStory` and so its own driver, so the
   * per-segment numbers come out of `story.d.waits()` and are folded in here. The
   * line item worth watching is TIMED OUT: headless `pump` manufactures game time by
   * incrementing a variable, so a wait that runs out costs it single-digit
   * milliseconds and costs this suite its whole budget in real seconds. That makes
   * timeouts the cost this host pays and the other does not — invisible in a headless
   * profile, and minutes across 27 segments. Counted, not timed, because a count is
   * immune to machine load (the same green headless suite has measured 77 s and 137 s).
   */
  const waitTotals = { resolved: 0, resolvedMs: 0, timedOut: 0, timedOutMs: 0, byLabel: {} as Record<string, number> };
  for (const n of SEGMENTS) {
    if (n === "1") {
      const trace = await playSegment1(page);
      await drainEngineLog();
      beats += trace.length;
      failures += compare(trace, golden("1"), "segment 1");
      // the two things the trace deliberately doesn't cover
      const [hrs, min] = [await globalOf(page, "hrs"), await globalOf(page, "min")];
      if (Number(hrs) !== 9 || Number(min) !== 30) {
        failures++;
        console.error(`\nboarding time is ${hrs}:${min}, expected 9:30`);
      }
      live = LEAVES_AT["1"] ?? null;
      continue;
    }
    const from = STARTS_AT[n];
    const play = PLAY[n];
    if (!from || !play) throw new Error(`no such segment: ${n}`);
    // the load is inside the try too: a segment that cannot even be started
    // should cost its own report, not the whole run's
    let story: Awaited<ReturnType<typeof browserStory>> | null = null;
    const carried = live === from;
    try {
      // Continue the game the last segment left standing here, and only fall back
      // to its checkpoint when it isn't. See LEAVES_AT for why carrying is the
      // mode that matches the goldens; "isn't" is not rare — a filtered run
      // (SEGMENTS=13) or anything after a segment that threw.
      let settled = true;
      if (carried) mark(`segment ${n}: carried from ${from}`);
      else settled = await loadCheckpoint(page, from);
      live = null; // a throw below must not hand a half-played game to the next segment
      story = await browserStory(page, { log: (m) => mark(`  ${m}`) });
      if (!settled) {
        // the load is parked on a question only the player can answer (m4anti's
        // lounge ambush — segments.ts refuseZeitelAgain says which and why); the
        // load's own tail runs after the answer, so wait for it before playing
        await refuseZeitelAgain(story);
        mark(`segment ${n}: ambush answered — waiting for the load's tail`);
        await waitFor(page, "window.__loadDone || window.__loadError", "the answered load to finish");
        const loadError = (await page.evaluate(() => (window as any).__loadError)) as string;
        if (loadError) throw new Error(`the answered load REJECTED: ${loadError}`);
        await waitFor(page, "dbg.viewer && dbg.viewer.quiescent", "the loaded game to settle");
      }
      mark(`segment ${n}: playing`);
      await play(story);
      await handBack(page, story.d);
      {
        const w = story.d.waits();
        waitTotals.resolved += w.resolved;
        waitTotals.resolvedMs += w.resolvedMs;
        waitTotals.timedOut += w.timedOut;
        waitTotals.timedOutMs += w.timedOutMs;
        for (const [k, v] of Object.entries(w.byLabel)) waitTotals.byLabel[k] = (waitTotals.byLabel[k] ?? 0) + v;
        if (w.timedOut) {
          mark(`segment ${n}: ${w.timedOut} wait(s) timed out, ${(w.timedOutMs / 1000).toFixed(0)}s burned`);
        }
      }
      live = LEAVES_AT[n] ?? null;
    } catch (e) {
      failures++;
      console.error(`\nsegment ${n} could not be played: ${(e as Error).message}`);
      // where it died, not just that it did. A mission-4 failure is almost
      // always the clock or the phase, and both are masked in the comparison
      // below — so without this the one number that explains the failure is the
      // one number the report never prints.
      const where = await Promise.all(
        ["clock", "phase", "mission", "sinkflag", "hrs", "min", "jonesphase"].map(
          async (k) => `${k}=${JSON.stringify(await globalOf(page, k))}`,
        ),
      ).catch(() => []);
      const stage = await page
        .evaluate(() => {
          const d = (window as any).dbg;
          return { stage: d.session.currentStageName ?? null, theme: d.session.currentThemeName ?? null,
                   busy: d.session.scriptBusy, movie: d.viewer?.movieFile ?? null };
        })
        .catch(() => null);
      console.error(`  state: ${where.join(" ")}${stage ? ` stage=${stage.stage} theme=${stage.theme} ` +
        `busy=${stage.busy} movie=${JSON.stringify(stage.movie)}` : ""}`);
    }
    await drainEngineLog();
    if (!story) continue;
    beats += story.trace.length;
    failures += compare(story.trace, golden(n), `segment ${n}`, carried);
    mark(`segment ${n}: ${story.trace.length} beats`);
  }

  if (REPAINT_CHECK) failures += reportRepaint(await readRepaintProbe(page), "repaint");

  if (process.env.PROPTRACE) {
    const lines = await readPropTrace(page);
    const out = process.env.PROPTRACE_FILE;
    if (out) writeFileSync(out, lines.join("\n") + (lines.length ? "\n" : ""));
    else for (const l of lines) console.log(`    ${l}`);
    mark(`prop trace: ${lines.length} write(s)${out ? ` -> ${out}` : ""}`);
  }

  // Where the wall clock went. The browser's cost is not the headless one: `pump`
  // manufactures game time by incrementing a variable, so a wait that RUNS OUT is
  // single-digit milliseconds there and its full budget in real seconds here. That
  // makes timed-out waits the one line item this suite pays for and the other does
  // not — invisible in a headless profile, and minutes across 27 segments. Reported
  // as a count and a total rather than a duration, because a count is immune to how
  // loaded the machine is (the same green headless suite has timed 77 s and 137 s).
  {
    const w = waitTotals;
    const worst = Object.entries(w.byLabel)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    mark(
      `waits: ${w.resolved} answered in ${(w.resolvedMs / 1000).toFixed(0)}s, ` +
        `${w.timedOut} TIMED OUT costing ${(w.timedOutMs / 1000).toFixed(0)}s`,
    );
    for (const [label, n] of worst) console.log(`      x${n}  ${label}`);
  }

  if (errors.length) {
    failures++;
    console.error("\npage errors:\n  " + errors.join("\n  "));
  }

  mark(failures ? `FAILED (${failures})` : `PASSED — ${beats} beats over ${SEGMENTS.length} segment(s) match the headless traces`);
  if (KEEPOPEN) {
    console.log("\nwatching mode: the window stays open — Ctrl-C to quit (KEEPOPEN=0 to close on finish)");
    await new Promise(() => {});
  }
  await browser.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
