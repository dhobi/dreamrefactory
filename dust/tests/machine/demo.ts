/**
 * The cow skull's long demo, run — `NEW.FLT/0032`.
 *
 *   npm run test:machine -w dust -- tests/machine/demo.ts
 *
 * The `cowskull` button on the horn's panel asks "Would you like to run a long
 * demo of Dust?", and on yes `runlist ()` alternates for ever between two
 * playlists, a film out of `randomovie` and a scene out of `randompuppet`,
 * each with its own counter: eleven films (`intro.mov` … `dieh1.mov`, with
 * `kiddie.mov` fetched from `dust:kid:` and the path put back) and twenty-four
 * puppet scenes, each spoken in front of a random standpoint of the open set.
 * Holding the button down between two of them ends it, and the panel comes back
 * with the theme, the scene and the view the demo found.
 *
 * The thing worth pinning is the ORDER: the two counters run side by side, so
 * the demo is film 0, scene 0, film 1, scene 1, … and wraps films at 11 and
 * scenes at 24 independently. Both full lists are walked, plus the first wrap
 * of the films, which is where the two counters part company.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SAVES, haveRip, newDustHost, pumped } from "../playthrough/harness";

const run = haveRip() ? test : test.skip;

/** `randomovie`'s switch, case 0 to 10 */
const FILMS = [
  "intro.mov", "d1nd2m.mov", "d2md2a.mov", "d2ad2n.mov", "d2nd3m.mov", "d3md3a.mov",
  "d3ad3n.mov", "d3nd4m.mov", "bountdie.mov", "kiddie.mov", "dieh1.mov",
];
/** `randompuppet`'s switch, case 0 to 23 */
const PUPPETS = [
  "cobb.pup", "trotter.pup", "mwife.pup", "todd.pup", "mayor.pup", "jones.pup", "robber.pup", "buick.pup",
  "flippo.pup", "dell1.pup", "marie.pup", "fear.pup", "mwife.pup", "jones.pup", "mayor.pup", "buick.pup",
  "jan.pup", "todd.pup", "help1.pup", "ned.pup", "teller.pup", "doc.pup", "gus.pup", "marie.pup",
];

run("the demo plays its films and puppet scenes in turn, and a held button ends it", async () => {
  const { host, logs } = await newDustHost();
  const p = pumped(host, logs);
  const s = p.session;
  // the day town, with town.snd's theme going and no conversation open.
  //
  // `randomscene` jumps with `currentscene (name)`, and DF.EXE runs the scene
  // events of a jump on the spot (0x40ee30: closescene at 0x40f100, openscene
  // at 0x40f050). TOWN.SET's openscene robs a penniless player one time in
  // fifty by day — `dayrobber = 0 & playeraccount <= 0 & clock < 3 & random
  // (1000) < 20` sends `runpuppet ("robber.pup")` — so the original's demo
  // can stop on the robber, waiting for an answer. D2A_009 is the same
  // afternoon with the bank paid (playeraccount 587), where it cannot fire,
  // and so the playlist is the scripts' and not the dice's.
  expect(await s.loadGame(new Uint8Array(readFileSync(`${SAVES}/D2A_009.RTD`)))).toBe(true);
  await p.settle("D2A_009");
  expect(s.currentSetName, "the town").toBe("town");
  expect(Number(s.interp.globals.get("playeraccount")), "money in the bank: no robbery").toBeGreaterThan(0);
  const theme = s.currentThemeName;
  const scene = s.currentSceneName();
  const view = s.currentViewName();
  expect(theme).not.toBe("none");

  // what the demo plays, in the order it plays it
  const played: string[] = [];
  const films = s.onPlayMovie;
  s.onPlayMovie = (name, startFrame) => {
    played.push(String(name).toLowerCase());
    return films(name, startFrame);
  };
  const pc = s.puppetCtrl;
  const opened = pc.openPuppetFile.bind(pc);
  pc.openPuppetFile = async (name: string) => {
    played.push(String(name).toLowerCase());
    return opened(name);
  };
  // "Would you like to run a long demo of Dust?" — yes
  const asked: string[] = [];
  s.onQuestionDialog = (m) => {
    asked.push(m);
    return true;
  };

  const horn = p.fire(200, 325);
  await p.pump(horn, "the horn");
  await p.settle("the score flat");
  expect(s.currentFlat).toBe("score");
  const demo = p.fire(253, 127);

  // play until both lists have gone round, skipping each film with ESC as a
  // player may (the films' own lengths are not what is under test)
  const want = FILMS.length + PUPPETS.length + 2;
  const director = host.director;
  await p.pump(
    () => {
      if (director.movies.playing) void s.track(director.keyDown(".", true));
      return played.length >= want;
    },
    `${want} items of the playlist`,
    200_000,
  );
  expect(asked).toEqual(["Would you like to run a long demo of Dust?"]);

  // film i, scene i, film i+1, ... — each counter on its own wrap
  const expected: string[] = [];
  for (let i = 0; expected.length < want; i++) {
    expected.push(FILMS[i % FILMS.length]);
    if (expected.length < want) expected.push(PUPPETS[i % PUPPETS.length]);
  }
  expect(played.slice(0, want)).toEqual(expected);

  // hold the button: runlist's `button ()` between two items ends it
  s.pointerDown = true;
  await p.pump(
    () => {
      if (director.movies.playing) void s.track(director.keyDown(".", true));
      return demo();
    },
    "the demo to end",
    200_000,
  );
  s.pointerDown = false;
  await p.settle("the panel");
  expect(s.currentFlat, "back on the horn's panel").toBe("score");
  expect(s.currentThemeName, "the theme the demo found").toBe(theme);
  expect(s.currentSceneName(), "the scene").toBe(scene);
  expect(s.currentViewName(), "and the view").toBe(view);
  expect(s.scheduler.loops.some((l) => l.kind === "flat" && l.handler === "update"), "the panel's update loop").toBe(true);
}, 600_000);
