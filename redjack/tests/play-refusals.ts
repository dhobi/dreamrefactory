/**
 * The moves RedJack's routes are written in (`src/play/route.ts`) and the fights
 * (`src/play/fight.ts`), where they give up: each one checks that it did what it
 * says, and the reason it fails with is all a day suite that stops has to go on.
 *
 *   npx vitest run --project redjack redjack/tests/play-refusals.ts
 *
 * The day suites play these against the game and see them succeed; this holds
 * each to its refusal — a node that is not in the room, an exit a turn never
 * faces, an "up" that leaves you where you were, a thing nowhere on screen, a
 * conversation that asks what the route has no answer for, an inventory chest
 * that is not there, a fight whose stage is not up — against a stand-in player
 * whose room does exactly the wrong thing asked of it. And three of the fights
 * played to their end against a scripted opponent who answers each move, for
 * the turns of them the day suites' one playing never takes: the whip ending
 * before the sword, the cauldron stepped down to and clicked, Marquez sent back
 * to his switch from either side. No rip, no engine.
 */
import { beforeEach, expect, test } from "vitest";
import { TURN } from "@dreamfactory/engine/df/sett";
import type { Player } from "../src/play/player";
import {
  carry,
  clickFilm,
  closeInventory,
  converse,
  distanceTo,
  drag,
  face,
  global,
  goTo,
  openInventory,
  pathTo,
  rattle,
  step,
  upFacing,
  walkScenes,
  walkUpTo,
} from "../src/play/route";
import { lavaPath, pullTheVine, swingTheChain } from "../src/play/lava";
import { pullTheHandle, takeTheLift } from "../src/play/bbisland";
import { playGems } from "../src/play/gems";
import {
  cauldronFight,
  duel,
  marquezFight,
  schoolOfDefense,
  schoolOfDodging,
  schoolOfStriking,
  whipFight,
} from "../src/play/fight";

/* ------------------------------------------------------------------ *
 * The stand-in
 * ------------------------------------------------------------------ */

type Hit = { name: string; type: string };
type Node = { name: string; node: number; x: number; y: number; exits: string[] };

interface Room {
  name: string;
  nodes: Node[];
  here: string;
  heading: number;
  /** which exit (1-based) `nearexit` finds ahead of a heading */
  nearExit: (heading: number) => number;
  /** what a key does to the room */
  onTap: (key: string) => void;
  /** what is under a screen point */
  hit: (x: number, y: number) => Hit;
  globals: Map<string, unknown>;
  props: Map<string, Record<string, unknown>>;
  actors: Map<string, Record<string, unknown>>;
  stage: string;
  view: string;
  scene: { name: string; views: { name: string; road?: { to: number; toScene: number } }[] } | null;
  sceneView: string;
  camera: { x: number; y: number } | null;
  noMaze: boolean;
  director: {
    awaitingChoice: boolean;
    choices: { id: number; text: string }[];
    choiceRects: { x: number; y: number; w: number; h: number }[];
    movies: { waitingRegions: { x0: number; y0: number; x1: number; y1: number }[]; playing: boolean };
  };
  /** after each frame */
  onFrame: () => void;
  /** a script is running between two plaques */
  busy: boolean;
  /** after a click, and after a press or release of the button */
  onClick: (x: number, y: number) => void;
  onMouse: (what: string) => void;
  pointer: { x: number; y: number };
}

let r: Room;
const taps: string[] = [];
const clicks: string[] = [];
/** keys held and let go, and the button pressed and released, in order */
const hands: string[] = [];

function room(): Room {
  return {
    name: "liznite",
    nodes: [
      { name: "Node1", node: 1, x: 0, y: 0, exits: ["Node2"] },
      { name: "Node2", node: 2, x: 100, y: 0, exits: ["Node1", "Node3"] },
      { name: "Node3", node: 3, x: 200, y: 0, exits: ["Node2"] },
      { name: "Node9", node: 9, x: 900, y: 900, exits: [] },
    ],
    here: "Node1",
    heading: 0,
    nearExit: () => 1,
    onTap: () => {},
    hit: () => ({ name: "", type: "none" }),
    globals: new Map(),
    props: new Map(),
    actors: new Map(),
    stage: "none",
    view: "node",
    scene: null,
    sceneView: "",
    camera: { x: 0, y: 0 },
    noMaze: false,
    director: { awaitingChoice: false, choices: [], choiceRects: [], movies: { waitingRegions: [], playing: false } },
    onFrame: () => {},
    busy: false,
    onClick: () => {},
    onMouse: () => {},
    pointer: { x: 0, y: 0 },
  };
}

function player(): Player {
  const maze = {
    get sett() {
      return { nodes: r.nodes.map(({ name, node, x, y }) => ({ name, node, x, y })) };
    },
    exits: (name: string) =>
      (r.nodes.find((n) => n.name === name)?.exits ?? []).map((to) => ({ to: r.nodes.find((n) => n.name === to)!.node })),
    exitField: () => 0,
    get heading() {
      return r.heading;
    },
    nearExit: (_here: string, heading: number) => r.nearExit(heading),
    get view() {
      return r.view;
    },
    get scene() {
      return r.scene;
    },
    get sceneView() {
      return r.sceneView;
    },
    camera: () => r.camera,
  };
  const session = {
    get maze() {
      return r.noMaze ? null : maze;
    },
    hitTestAt: (x: number, y: number) => r.hit(x, y),
    propRuntime: { get: (n: string) => r.props.get(n) },
    actorRuntime: { get: (n: string) => r.actors.get(n) },
    interp: { globals: r.globals },
    get stageName() {
      return r.stage;
    },
    setVisible: true,
  };
  const host = {
    director: {
      screen: { width: 640, height: 480 },
      get awaitingChoice() {
        return r.director.awaitingChoice;
      },
      get choices() {
        return r.director.choices;
      },
      get choiceRects() {
        return r.director.choiceRects;
      },
      get movies() {
        return r.director.movies;
      },
    },
  };
  const frame = async (n = 1): Promise<void> => {
    for (let i = 0; i < n; i++) r.onFrame();
  };
  return {
    host: host as unknown as Player["host"],
    session: session as unknown as Player["session"],
    running: () => [],
    frame,
    until: async (done, what, max = 1000) => {
      for (let i = 0; i < max; i++) {
        if (done()) return i;
        await frame();
      }
      throw new Error(`timed out: ${what}`);
    },
    idle: () => !r.director.awaitingChoice && !r.busy,
    settle: async () => 0,
    owner: () => (r.director.awaitingChoice ? "puppet" : "world"),
    room: () => r.name,
    node: () => r.here,
    click: (x, y) => {
      clicks.push(`${x},${y}`);
      r.onClick(x, y);
      return () => true;
    },
    point: (x, y) => void (r.pointer = { x, y }),
    mouseDown: (x, y) => {
      hands.push(`down ${x},${y}`);
      r.onMouse("down");
    },
    mouseUp: (x, y) => {
      hands.push(`up ${x},${y}`);
      r.onMouse("up");
    },
    tap: (key) => {
      taps.push(key);
      r.onTap(key);
    },
    key: (k) => void hands.push(`hold ${k}`),
    keyUp: (k) => void hands.push(`let go ${k}`),
  };
}

let h: Player;
beforeEach(() => {
  r = room();
  h = player();
  taps.length = 0;
  clicks.length = 0;
  hands.length = 0;
});

/** a thing drawn over a rectangle of the screen */
const drawn = (name: string, type: string, x0: number, y0: number, x1: number, y1: number) => (x: number, y: number): Hit =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1 ? { name, type } : { name: "", type: "none" };

/* ------------------------------------------------------------------ *
 * walking
 * ------------------------------------------------------------------ */

test("a path is planned only in a room, between nodes it has, along exits that join them", () => {
  expect(pathTo(h, "node3")).toEqual(["Node2", "Node3"]);
  expect(() => pathTo(h, "Node7")).toThrow(/^no node Node7 in liznite$/);
  r.here = "Node5";
  expect(() => pathTo(h, "Node3")).toThrow(/^no node Node5 in liznite$/);
  r.here = "Node1";
  expect(() => pathTo(h, "Node9")).toThrow(/^liznite: no way from Node1 to Node9$/);
  r.noMaze = true;
  expect(() => pathTo(h, "Node3")).toThrow(/^no room on screen$/);
});

test("a hop turns to the exit and walks it, and says which of the two never happened", async () => {
  await expect(step(h, "Node3")).rejects.toThrow(/^liznite\/Node1 has no exit to Node3 \(it has Node2\)$/);

  // the exit ahead is never the one wanted, however often the room is turned
  r.here = "Node2";
  r.nearExit = () => 1;
  await expect(step(h, "Node3")).rejects.toThrow(/^Node2: turning never faced the exit to Node3$/);
  expect(taps).toEqual(["right", "right", "right", "right"]);

  // faced, but "up" goes nowhere
  taps.length = 0;
  r.nearExit = () => 2;
  await expect(step(h, "Node3")).rejects.toThrow(/^Node2: "up" at the exit to Node3 left us at Node2$/);
  expect(taps).toEqual(["up", "up", "up"]);
});

test("a walk stops at a conversation that opens on the way, before the next hop", async () => {
  r.onTap = (key) => {
    if (key !== "up") return;
    r.here = "Node2";
    r.director.awaitingChoice = true;
  };
  await expect(goTo(h, "Node3")).rejects.toThrow(/^walking to Node3: a conversation opened at Node2$/);
});

test("turning to a heading and going on: a heading never reached, an up that goes nowhere", async () => {
  r.heading = TURN / 2; // 180 degrees, and the turn key does nothing
  await expect(upFacing(h, 0)).rejects.toThrow(/^Node1: turning never faced 0 degrees$/);
  expect(taps).toHaveLength(16);
  await expect(upFacing(h, 180)).rejects.toThrow(/^Node1: "up" at 180 degrees went nowhere$/);
  r.noMaze = true;
  await expect(upFacing(h, 180)).rejects.toThrow(/^no room$/);
});

test("walking out through scenes needs a road it wants, a view it can face, and an end", async () => {
  r.scene = { name: "Scene10", views: [{ name: "a" }, { name: "b", road: { to: 5, toScene: 2 } }] };
  r.sceneView = "a";
  await expect(walkScenes(h, () => false)).rejects.toThrow(/^Scene10 has no road the walk wants$/);
  await expect(walkScenes(h, () => true)).rejects.toThrow(/^Scene10: turning never faced b$/);
  // the road is walked, and leads back into the same scene for ever
  r.onTap = (key) => {
    if (key === "right") r.sceneView = "b";
  };
  await expect(walkScenes(h, () => true, 3)).rejects.toThrow(/^the scenes never led out \(Scene10 > Scene10 > Scene10\)$/);
});

test("walking up to somebody needs them in the room, and stays put when they are nearest already", async () => {
  await expect(walkUpTo(h, "liz")).rejects.toThrow(/^no actor liz in liznite$/);
  r.actors.set("liz", { worldX: 10, worldY: 0 });
  await walkUpTo(h, "liz");
  expect(taps).toEqual([]);
});

test("a distance is measured from the camera to somebody, and needs both", () => {
  r.actors.set("liz", { worldX: 30, worldY: 40 });
  expect(distanceTo(h, "liz")).toBe(50);
  expect(() => distanceTo(h, "nick")).toThrow(/^no actor nick to measure from$/);
  r.camera = null;
  expect(() => distanceTo(h, "liz")).toThrow(/^no camera to measure from$/);
});

test("a global reads as text, and an unset one as nothing", () => {
  r.globals.set("margin", 40);
  expect(global(h, "margin")).toBe("40");
  expect(global(h, "nothing")).toBe("");
});

/* ------------------------------------------------------------------ *
 * finding things on screen
 * ------------------------------------------------------------------ */

test("facing a thing that is nowhere turns round, looks round the edges, and says so", async () => {
  await expect(face(h, "skull")).rejects.toThrow(/^liznite\/Node1: "skull" is nowhere on screen$/);
  expect(taps.filter((k) => k === "right")).toHaveLength(8);
});

test("a thing found by looking round, and lost when the view stops, is reported lost", async () => {
  // it comes into view only while the pointer rests on the right edge
  r.hit = (x, y) => (r.pointer.x > 600 ? drawn("skull", "prop", 300, 200, 340, 240)(x, y) : { name: "", type: "none" });
  await expect(face(h, "skull")).rejects.toThrow(/^Node1: "skull" is gone once the view stopped$/);
});

test("a thing in the margin is rested on until it comes out, or given up on", async () => {
  r.globals.set("margin", 64);
  // in the margin and staying there: a hundred rests, then the reason
  r.hit = drawn("skull", "prop", 0, 200, 40, 240);
  await expect(face(h, "skull")).rejects.toThrow(
    /^Node1: resting on the edge never brought "skull" out of the margin \(at \d+,\d+, the middle answers \)$/,
  );

  // brought out by the rest, then gone when the view stops
  let rests = 0;
  r.hit = (x, y) => (rests < 3 ? drawn("skull", "prop", 0, 200, 40, 240)(x, y) : { name: "", type: "none" });
  r.onFrame = () => void rests++;
  await expect(face(h, "skull")).rejects.toThrow(/^Node1: "skull" is gone once the view stopped$/);
});

test("a near thing in the margin is taken where it is, without resting on it", async () => {
  r.globals.set("margin", 64);
  r.hit = drawn("skull", "prop", 0, 200, 40, 240);
  r.props.set("skull", { dist: -1 });
  expect(await face(h, "skull")).toEqual({ x: 24, y: 216 });
  r.hit = drawn("liz", "actor", 0, 200, 40, 240);
  r.actors.set("liz", { dist: -5 });
  expect(await face(h, "liz")).toEqual({ x: 24, y: 216 });
  expect(taps).toEqual([]);
});

test("dragging, rattling and carrying need the thing, and dragging a place to drop it", async () => {
  await expect(drag(h, "rum", "liz")).rejects.toThrow(/^Node1: nothing called "liz" to drop rum on$/);
  r.hit = drawn("liz", "actor", 300, 100, 340, 300);
  await expect(drag(h, "rum", "liz")).rejects.toThrow(/^Node1: "rum" is not on screen to pick up$/);
  await expect(rattle(h, "rum", { x: 320, y: 240 })).rejects.toThrow(/^Node1: "rum" is not on screen to pick up$/);
  await expect(carry(h, "rum", { x: 320, y: 240 })).rejects.toThrow(/^Node1: "rum" is not on screen to pick up$/);
});

/* ------------------------------------------------------------------ *
 * the inventory chest
 * ------------------------------------------------------------------ */

test("the inventory opens and closes by its chest, which has to be there and on screen", async () => {
  await expect(openInventory(h)).rejects.toThrow(/^no inventory chest$/);
  await expect(closeInventory(h)).rejects.toThrow(/^no inventory chest$/);
  r.props.set("chest", { visible: true, ink: 7, deg: 0 });
  await expect(openInventory(h)).rejects.toThrow(/^the chest is not on screen$/);
  // closed already: nothing to do
  await closeInventory(h);
  expect(clicks).toEqual([]);
  r.props.get("chest")!.deg = 12;
  await expect(closeInventory(h)).rejects.toThrow(/^the open chest is not on screen$/);
});

/* ------------------------------------------------------------------ *
 * conversations and films
 * ------------------------------------------------------------------ */

/** a plaque of choices, one row each */
function ask(...texts: string[]): void {
  r.director.awaitingChoice = true;
  r.director.choices = texts.map((text, i) => ({ id: 101 + i, text }));
  r.director.choiceRects = texts.map((_, i) => ({ x: 100, y: 300 + i * 20, w: 200, h: 20 }));
}

test("a conversation that asks with no answer left fails, unless the route expects another question", async () => {
  ask("Aye.", "Nay.");
  await expect(converse(h, [], "Liz")).rejects.toThrow(/^Liz: the game asks again \(Aye\. \| Nay\.\) and the route has no answer$/);
  await converse(h, [], "Liz", { thenAsks: true });
  expect(clicks).toEqual([]);
});

test("a conversation answer that is not offered names what is", async () => {
  ask("Aye.", "Nay.");
  await expect(converse(h, ["Maybe"], "Liz")).rejects.toThrow(/^Liz: no "Maybe" among 101 Aye\. \| 102 Nay\.$/);
  await expect(converse(h, [105], "Liz")).rejects.toThrow(/^Liz: no 105 among/);
});

test("a conversation that ends with answers unused says which", async () => {
  ask("Aye.", "Nay.");
  // the click is taken and the conversation closes
  r.onFrame = () => void (r.director.awaitingChoice = false);
  await expect(converse(h, [102, "Later"], "Liz")).rejects.toThrow(/^Liz: ended with 1 answer\(s\) unused: Later$/);
  expect(clicks).toEqual(["200,330"]);
});

test("a plaque still up after its answer is waited on, and the next one answered when it comes", async () => {
  ask("Aye.");
  let frames = 0;
  // the answered plaque lingers, goes, a script runs, and the next one is put
  r.onFrame = () => {
    frames++;
    if (frames === 6) {
      r.director.awaitingChoice = false;
      r.busy = true;
    }
    if (frames === 10) {
      ask("Off with you.");
      r.busy = false;
    }
    if (frames === 14) r.director.awaitingChoice = false;
  };
  await converse(h, ["Aye", "Off"], "Liz");
  expect(clicks).toEqual(["200,310", "200,310"]);
});

test("a plaque that is asked again and again is answered again after five looks", async () => {
  ask("Another hand?");
  await expect(converse(h, ["Another", "Another"], "Jan")).rejects.toThrow(
    /^Jan: the game asks again \(Another hand\?\) and the route has no answer$/,
  );
  // the second answer only after the plaque had been seen unchanged five times
  expect(clicks).toEqual(["200,310", "200,310"]);
});

test("a parked film is clicked in its first region's middle, and must let the click go", async () => {
  r.director.movies.waitingRegions = [{ x0: 100, y0: 100, x1: 200, y1: 140 }];
  await expect(clickFilm(h)).rejects.toThrow(/^timed out: the film to take the click at 150,120$/);
  expect(clicks).toEqual(["150,120"]);
});

/* ------------------------------------------------------------------ *
 * fights whose stage is not up
 * ------------------------------------------------------------------ */

test("every fight refuses to start when its stage is not the one up", async () => {
  r.stage = "none";
  await expect(schoolOfDefense(h)).rejects.toThrow(/^the school of defense is not up \(stage none\)$/);
  await expect(schoolOfDodging(h)).rejects.toThrow(/^the school of dodging is not up \(stage none\)$/);
  await expect(schoolOfStriking(h)).rejects.toThrow(/^the school of striking is not up \(stage none\)$/);
  await expect(duel(h, "combat.stag", "the fight with Lyle")).rejects.toThrow(
    /^the fight with Lyle: the stage is not up \(stage none\)$/,
  );
  await expect(whipFight(h)).rejects.toThrow(/^the whip: the stage is not up \(stage none\)$/);
  await expect(cauldronFight(h)).rejects.toThrow(/^the cauldron: the stage is not up \(stage none\)$/);
  await expect(marquezFight(h)).rejects.toThrow(/^Marquez: the stage is not up \(stage none\)$/);
});

/* ------------------------------------------------------------------ *
 * the set pieces, missing their pieces
 * ------------------------------------------------------------------ */

test("the lava, the chain and the vine each need their room or their prop", async () => {
  r.noMaze = true;
  expect(() => lavaPath(h)).toThrow(/^no room$/);
  r.noMaze = false;
  await expect(swingTheChain(h, "Node3")).rejects.toThrow(/^no chain in the hub$/);
  await expect(pullTheVine(h)).rejects.toThrow(/^no vine on the skeleton's stage$/);
  // the lean right that brings the vine into reach came first
  expect(taps).toEqual(["right"]);
});

test("Blackbeard's lift goes to bb1 or bb2, by a handle that has to be on screen", async () => {
  await expect(takeTheLift(h, "bb3")).rejects.toThrow(/^the lift goes to bb1 or bb2, not bb3$/);
  await expect(pullTheHandle(h, [[1, 0, 3]])).rejects.toThrow(/^the handle is not on screen$/);
});

test("the gem lifts need their stage, and each lift or gem on screen to click", async () => {
  await expect(playGems(h)).rejects.toThrow(/^the gem lifts are not up \(stage none\)$/);
  r.stage = "gem.stag";
  r.props.set("nick", { stateName: "1" });
  r.props.set("anne", { stateName: "1" });
  await expect(playGems(h)).rejects.toThrow(/^the gem lifts: "[^"]+" is not on screen$/);
  expect(clicks).toEqual([]);
});

/* ------------------------------------------------------------------ *
 * fights, played against a scripted opponent
 * ------------------------------------------------------------------ */

/** the enemy prop: its view, and the shop that is playing it */
const enemy = (view: string, shop: string): void => void r.props.set("enemy", { stateName: view, shop: { name: shop } });

test("the whip leans away from each lash, and says so when the fight ends before the sword", async () => {
  r.stage = "tcombat.stag";
  r.globals.set("wonfight", 0);
  enemy("s left", "tenemy1.shop");
  let f = 0;
  r.onFrame = () => {
    f++;
    if (f === 3) enemy("idle", "tenemy1.shop");
    if (f === 5) r.stage = "none";
  };
  await expect(whipFight(h)).rejects.toThrow(/^the whip: the fight ended before the sword was taken up \(wonfight 0\)$/);
  expect(hands).toEqual(["hold left", "let go left"]);
});

test("the whip takes the sword up where it lies, and is over when the torturer turns to fight", async () => {
  r.stage = "tcombat.stag";
  r.globals.set("znode", 4);
  enemy("idle", "tenemy1.shop");
  r.hit = drawn("fsword", "prop", 100, 400, 140, 420);
  r.onClick = () => enemy("idle", "tenemy2.shop");
  await whipFight(h);
  expect(clicks).toHaveLength(1);
  expect(hands).toEqual([]);
});

test("the whip looks for a sword that is not there without clicking anything", async () => {
  r.stage = "tcombat.stag";
  r.globals.set("znode", 4);
  enemy("idle", "tenemy1.shop");
  let f = 0;
  r.onFrame = () => void (++f === 25 && enemy("idle", "tenemy2.shop"));
  await whipFight(h);
  expect(clicks).toEqual([]);
});

test("the cauldron: down from the far side, the cauldron clicked, a stroke in, and the button let go at the end", async () => {
  r.stage = "tcombat.stag";
  r.globals.set("znode", 9);
  enemy("idle", "tenemy3.shop");
  r.hit = drawn("couldron", "prop", 300, 200, 340, 240);
  // each move moves Nick on; the stroke ends the fight while the button is down
  r.onTap = (k) => void (k === "down" && r.globals.set("znode", 6));
  r.onClick = () => r.globals.set("znode", 3);
  r.onMouse = (what) => void (what === "down" && (r.stage = "none"));
  await cauldronFight(h);
  expect(taps).toEqual(["down"]);
  expect(clicks).toHaveLength(1);
  expect(hands).toEqual(["down 260,300", "up 320,300"]);
});

test("Marquez: back to the switch from either side, the switch pulled mid-swing, then Anne", async () => {
  r.stage = "mcombat.stag";
  r.globals.set("znode", 0);
  enemy("idle", "menemy1.shop");
  const lever = drawn("fswitch", "prop", 500, 100, 540, 140);
  const anne = drawn("fanne", "prop", 50, 100, 90, 140);
  r.hit = (x, y) => (lever(x, y).name ? lever(x, y) : anne(x, y));
  // up overshoots to node 3, down lands on the switch's node 2, where he winds up a strike
  r.onTap = (k) => {
    if (k === "up") r.globals.set("znode", 3);
    if (k === "down") {
      r.globals.set("znode", 2);
      enemy("s left", "menemy1.shop");
    }
  };
  // the switch drops the door, and the second Marquez is at the far end; Anne's click ends it
  r.onClick = (x) => {
    if (x > 400) {
      enemy("idle", "menemy2.shop");
      r.globals.set("znode", 16);
    } else r.stage = "none";
  };
  await marquezFight(h);
  expect(taps).toEqual(["up", "down"]);
  expect(clicks).toHaveLength(2);
});
