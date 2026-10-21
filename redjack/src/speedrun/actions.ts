/**
 * RedJack's verbs, over the engine's ({@link CORE_ACTIONS}).
 *
 * Each is one of the moves the machine suites play the game with
 * (src/play/: the walk, the click on a named thing, the conversation, the set
 * pieces), played through the speedrun driver by `playerFor` (./player.ts) — so a sheet
 * line does what the suite's line does, a pass at a time, and the route a sheet
 * writes down is the suites' route (tests/machine/days/).
 *
 * The suites' moves wait the way the suites' harness waits: on the game's own
 * state, counted in service passes. A verb here is `wait: none` to the runner
 * for that reason — what it waits for it has already waited for — and `budget:`
 * on a line is its limit in passes' worth of game time (50 ms a pass) where the
 * move would otherwise take the suites' own.
 */
import type { VerbSpec } from "@dreamfactory/speedrun/sheet";
import { CORE_ACTIONS } from "@dreamfactory/speedrun/actions-core";
import { composeActions, resolveIn, verbsOf, type Action, type ActionTable } from "@dreamfactory/speedrun/action";
import type { Player } from "../play/player";
import {
  carry, clickFilm, clickOn, closeInventory, converse, drag, face, filmWaits, global, goTo, openInventory, rattle, upFacing,
  walkScenes, walkUpTo, waitNear, type HitType,
} from "../play/route";
import {
  cauldronFight, duel, fighting, marquezFight, schoolOfDefense, schoolOfDodging, schoolOfStriking, shootout, whipFight,
} from "../play/fight";
import { sinkTheDinghies } from "../play/cannons";
import { sinkTheGalleons } from "../play/ballista";
import { playGems } from "../play/gems";
import { crossTheLava, pullTheVine, runTheFlames, swingTheChain } from "../play/lava";
import { rideTheMine } from "../play/mine";
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { move, num, passesOf } from "./move";
import { DAY2_ACTIONS } from "./day2";
import { DAY3_ACTIONS } from "./day3";
import { DAY4_ACTIONS } from "./day4";
import { DAY5_ACTIONS } from "./day5";
import { DAY6_ACTIONS } from "./day6";
import { DAY7_ACTIONS } from "./day7";

/** wait for the game to open `stage`, and nothing to be running in it */
const stageUp = (h: Player, stage: string, max = 3_000): Promise<number> =>
  h.until(() => fighting(h, stage) && h.running().length === 0, `${stage} to open`, max);

/** a fight stage: wait for it to open, then the suites' player for it */
const fight = (sig: string, help: string, stage: string, play: (h: Player) => Promise<void>): Action =>
  move({ args: [0, 0], sig, help }, async (h) => {
    await h.until(() => fighting(h, stage), `${stage} to open`, 3_000);
    await play(h);
  });

const REDJACK_ACTIONS: ActionTable = {
  /* ------------------------------------------------------------------ *
   * Being there
   * ------------------------------------------------------------------ */

  idle: move(
    { args: [0, 0], opts: ["budget"], sig: "idle()", help: "wait until the player has the game: the room on screen, nobody walking, no script — or a question asked" },
    (h, c) => h.settle("the game", passesOf(c) ?? 60_000),
  ),
  goto: move(
    { args: [1, 2], sig: "goto(Node48)", help: "walk to a node of this room by the shortest way; goto(Scene10, leave) when the last road leaves the room" },
    (h, c) => goTo(h, c.step.args[0], (c.step.args[1] ?? "").toLowerCase() === "leave"),
  ),
  walkfacing: move(
    { args: [1, 1], sig: "walkFacing(241)", help: "turn to face that heading (degrees) and go up — a door that is no exit of the node" },
    (h, c) => upFacing(h, num(c, 0, "the heading")),
  ),
  tap: move(
    { args: [1, 1], sig: "tap(right)", help: "a key pressed and let go: up, down, left, right, space — and let the game answer it" },
    async (h, c) => {
      h.tap(c.step.args[0]);
      await h.settle(`${c.step.args[0]} at ${h.node()}`);
    },
  ),

  /* ------------------------------------------------------------------ *
   * Hands
   * ------------------------------------------------------------------ */

  click: move(
    { args: [1, 2], sig: "click(bone)", help: "click what the game calls that — turning to it, or panning, if it is not in view; click(chest, quad) when two things share a name" },
    (h, c) => clickOn(h, c.step.args[0], c.step.args[1] as HitType | undefined),
  ),
  clickat: move(
    { args: [2, 2], sig: "clickAt(350, 430)", help: "click a point of the 640x480 screen — a button with no name" },
    async (h, c) => {
      h.click(num(c, 0, "x"), num(c, 1, "y"));
      await h.frame(3);
    },
  ),
  face: move(
    { args: [1, 2], sig: "face(lyle)", help: "turn, or pan the view, until that is on screen and clear of the scroll margin" },
    (h, c) => face(h, c.step.args[0], c.step.args[1] as HitType | undefined),
  ),
  near: move(
    { args: [2, 2], sig: "near(lyle, 65000)", help: "let the world run until that one comes within the distance a click on them needs" },
    (h, c) => waitNear(h, c.step.args[0], num(c, 1, "the distance")),
  ),
  approach: move(
    { args: [1, 1], sig: "approach(justice)", help: "walk to the node of this room nearest that one" },
    (h, c) => walkUpTo(h, c.step.args[0]),
  ),
  drag: move(
    { args: [2, 3], sig: "drag(charcoal, crate2)", help: "carry something from the inventory onto a thing, the button held — drag(horn, horn, quad)" },
    (h, c) => drag(h, c.step.args[0], c.step.args[1], c.step.args[2] as HitType | undefined),
  ),
  carry: move(
    { args: [3, 4], sig: "carry(key, 320, 300)", help: "carry a thing with the button held to a point, and let go there" },
    (h, c) => carry(h, c.step.args[0], { x: num(c, 1, "x"), y: num(c, 2, "y") }, c.step.args[3] as HitType | undefined),
  ),
  rattle: move(
    { args: [3, 4], sig: "rattle(cup, 320, 200)", help: "carry a thing to a point and scrape it to and fro there, then let go — the jail's bars" },
    (h, c) => rattle(h, c.step.args[0], { x: num(c, 1, "x"), y: num(c, 2, "y") }, c.step.args[3] ? num(c, 3, "the strokes") : undefined),
  ),
  inventory: move(
    { args: [0, 0], sig: "inventory()", help: "open the chest in the bottom left" },
    (h) => openInventory(h),
  ),
  closeinventory: move(
    { args: [0, 0], sig: "closeInventory()", help: "close the open chest" },
    (h) => closeInventory(h),
  ),

  /* ------------------------------------------------------------------ *
   * Talk
   * ------------------------------------------------------------------ */

  /**
   * A conversation, one plaque at a time: each id answers the next plaque
   * that asks — the number `puppetevent` hands the script, so two plaques of
   * one id are the same answer to it — and after the last, on to the next
   * question or the end. Without ids, a conversation that asks nothing played
   * to its end. A frame of a film that waits for a click on the way is
   * clicked through.
   */
  talkout: move(
    { args: [0, 0], bevels: true, sig: "talkOut([101,105,103])", help: "answer each plaque with the next of these ids, then on to the next question or the end; talkOut() for a talk that asks nothing" },
    async (h, c) => {
      const ids = c.step.bevels ?? [];
      if (ids.length) return converse(h, ids, `talkOut([${ids.join(",")}])`, { thenAsks: true });
      if (h.idle() && !h.host.director.awaitingChoice) return;
      await converse(h, [], "the conversation");
    },
  ),
  /**
   * ESC on a line being spoken: the line ends, and the rest of its speech run
   * with it (puppet.ts `skipLine`). Pressed now or not at all — a press that
   * waited a pass could find the line over and a plaque up, and ESC at a plaque
   * answers -1, which walks Nick out of the conversation (#131). For
   * `watchFor(speaking, hush())`, which halts the game the pass a line starts.
   */
  hush: move(
    { args: [0, 0], sig: "hush()", help: "ESC on the line being spoken, now — never at a plaque, where ESC walks out" },
    async (h) => {
      if (h.host.director.speaking) h.tap(ESCAPE_KEY, true);
    },
  ),
  clickfilm: move(
    { args: [0, 0], sig: "clickFilm()", help: "a film standing on a frame that waits for a click: click it on" },
    async (h) => {
      await h.until(() => filmWaits(h), "a film waiting for a click", 2_000);
      await clickFilm(h);
    },
  ),

  /* ------------------------------------------------------------------ *
   * Waiting on the game
   * ------------------------------------------------------------------ */

  stage: move(
    { args: [1, 1], opts: ["budget"], sig: "stage(firepit.stag)", help: "wait for that stage to be up and nothing running in it; stage(none) for it gone" },
    (h, c) => stageUp(h, c.step.args[0], passesOf(c)),
  ),
  owns: move(
    { args: [1, Infinity], sig: "owns(sword, pistol)", help: "wait until Nick has all of these and nothing is running" },
    (h, c) =>
      h.until(
        () => c.step.args.every((p) => h.session.propRuntime.get(p)?.owner === "nick") && h.running().length === 0,
        `${c.step.args.join(" and ")} into the inventory`,
        2_000,
      ),
  ),
  day: move(
    { args: [1, 1], opts: ["budget"], sig: "day(2)", help: "wait for that day to begin: the BOOTFILE's `day`, and the game asking or the player having it" },
    (h, c) =>
      h.until(
        () => String(h.session.interp.globals.get("day") ?? "") === c.step.args[0] && (h.host.director.awaitingChoice || h.idle()),
        `day ${c.step.args[0]}`,
        passesOf(c) ?? 20_000,
      ),
  ),

  /* ------------------------------------------------------------------ *
   * The set pieces
   * ------------------------------------------------------------------ */

  defense: fight("defense()", "Lyle's school of defense: guard where each wind-up says", "sdcombat.stag", schoolOfDefense),
  dodging: fight("dodging()", "Lyle's school of dodging: lean out of each bottle's lane", "sdocombat.stag", schoolOfDodging),
  striking: fight("striking()", "Lyle's school of striking: strike while he is open", "sscombat.stag", schoolOfStriking),
  duel: move(
    { args: [1, 1], sig: "duel(combat.stag)", help: "a sword fight on that stage, guarding and striking, to its end" },
    async (h, c) => {
      const stage = c.step.args[0];
      await h.until(() => fighting(h, stage), `${stage} to open`, 3_000);
      await duel(h, stage, `the fight on ${stage}`);
    },
  ),
  shootout: move(
    { args: [1, 1], sig: "shootout(4)", help: "Port Royal's street fight, three waves of Jan's men, until that day begins" },
    (h, c) => shootout(h, () => global(h, "day") === c.step.args[0]),
  ),
  whip: fight("whip()", "the torturer's whip: lean out of its way, then take up the sword", "tcombat.stag", whipFight),
  cauldron: move(
    { args: [0, 0], sig: "cauldron()", help: "the torturer at the cauldron, after the whip" },
    (h) => cauldronFight(h),
  ),
  marquez: fight("marquez()", "Marquez in the horn caves, with Anne", "mcombat.stag", marquezFight),
  cannons: move(
    { args: [0, 0], sig: "cannons()", help: "the Marauder's cannons: sink the four dinghies" },
    (h) => sinkTheDinghies(h),
  ),
  ballista: move(
    { args: [0, 0], sig: "ballista()", help: "the ballista on the island: sink the two galleons" },
    (h) => sinkTheGalleons(h),
  ),
  gems: move(
    { args: [0, 0], sig: "gems()", help: "the skull's gem lifts, with Anne's help, solved" },
    (h) => playGems(h),
  ),
  lava: move(
    { args: [0, 0], sig: "lava()", help: "across the lava, pillar to pillar" },
    (h) => crossTheLava(h),
  ),
  flames: move(
    { args: [1, Infinity], sig: "flames(Scene46, Scene47)", help: "step through the flame corridor between the bursts until standing in one of those scenes" },
    (h, c) => runTheFlames(h, () => c.step.args.some((a) => a.toLowerCase() === (h.session.maze?.sceneName ?? "").toLowerCase())),
  ),
  scenesback: move(
    { args: [0, 0], sig: "scenesBack()", help: "walk a room's old-style scenes back out to its nodes, the way you came" },
    async (h) => {
      const sett = (h.session.maze as unknown as { sett: { scenes: { name: string; scen: number }[] } }).sett;
      const num = (name: string): number => sett.scenes.find((x) => x.name === name)?.scen ?? 0;
      await walkScenes(h, (road, scene) => road.to !== 0 || (road.toScene !== 0 && road.toScene < num(scene)));
    },
  ),
  chain: move(
    { args: [1, 1], sig: "chain(Node196)", help: "swing across on the chain to that node" },
    (h, c) => swingTheChain(h, c.step.args[0]),
  ),
  vine: move(
    { args: [0, 0], sig: "vine()", help: "the skeleton holding the scepter: pull the vine that brings it down" },
    (h) => pullTheVine(h),
  ),
  mine: move(
    { args: [0, 0], sig: "mine()", help: "the mine carts and the harpoon gun, through three sets of Jan's men to the crash" },
    (h) =>
      rideTheMine(h, () => h.owner() === "puppet" || h.host.director.awaitingChoice || h.session.stageName === "bcombat.stag"),
  ),
};

/**
 * The engine's verbs and this game's over the top. Composed once and exported,
 * because the workbench and the parser must be handed the SAME table
 * (`speedrun/src/runner.ts`, `runSheet`).
 */
export const ACTIONS: ActionTable = composeActions(
  CORE_ACTIONS,
  REDJACK_ACTIONS,
  DAY2_ACTIONS,
  DAY3_ACTIONS,
  DAY4_ACTIONS,
  DAY5_ACTIONS,
  DAY6_ACTIONS,
  DAY7_ACTIONS,
);

/** the grammar half of {@link ACTIONS}, for the parser */
export const VERBS: Record<string, VerbSpec> = verbsOf(ACTIONS);

/** a verb by name, case-insensitively */
export const resolve = (verb: string): Action | undefined => resolveIn(ACTIONS, verb);
