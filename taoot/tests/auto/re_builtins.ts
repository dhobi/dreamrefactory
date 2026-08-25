/**
 * Builtins reverse-engineered from TI.EXE:
 *  - calcvectx/calcvecty — (dx, dy) components of a vector at a 0..255 bearing
 *    (cores 0x43ad90/0x43adc0, "TRIG" resource tables).
 *  - path — the 9-slot resource search-path table (getter 0x427fb0, setter
 *    0x43dd70).
 *
 *   npx vitest run taoot/tests/auto/re_builtins.ts
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gamefilePath } from "../../tools/gamefiles";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { Value } from "@dreamfactory/engine/runtime/interp";
import { bearing } from "@dreamfactory/engine/runtime/geometry";
import { readSetFile } from "@dreamfactory/engine/df/set";

function callBuiltin(session: GameSession, name: string, ...args: Value[]): Value {
  const interp = session.interp;
  return interp.builtins.get(name)!(interp, args, { t: "call", name, args: [] } as never, null as never) as Value;
}

/** a latin1 string of the given bytes — what BinaryReader.pstr hands a script */
const raw = (...bytes: number[]): string => String.fromCharCode(...bytes);

function vectors() {
  const session = new GameSession(() => null, new NullAudioSink());
  const call = (name: string, ...args: Value[]) => Number(callBuiltin(session, name, ...args));
  return {
    x: (angle: number, mag: number) => call("calcvectx", angle, mag),
    y: (angle: number, mag: number) => call("calcvecty", angle, mag),
  };
}

test("calcvectx/calcvecty give the engine's cardinal directions", () => {
  const v = vectors();
  // bearing 0 = +x, 64 (90°) = +y, 128 = -x, 192 = -y
  expect([v.x(0, 1000), v.y(0, 1000)]).toEqual([1000, 0]);
  expect([v.x(64, 1000), v.y(64, 1000)]).toEqual([0, 1000]);
  expect([v.x(128, 1000), v.y(128, 1000)]).toEqual([-1000, 0]);
  expect([v.x(192, 1000), v.y(192, 1000)]).toEqual([0, -1000]);
});

test("calcvectx/calcvecty round-trip through bearing() for every angle", () => {
  const v = vectors();
  const mag = 1000; // large enough that the direction is unambiguous
  for (let a = 0; a < 256; a++) {
    const dx = v.x(a, mag);
    const dy = v.y(a, mag);
    // the vector we produced must report back the same bearing
    expect.soft(bearing(dx, dy), `angle ${a} -> (${dx},${dy})`).toBe(a);
  }
});

test("angle wraps mod 256 and magnitude scales linearly", () => {
  const v = vectors();
  expect(v.x(320, 1000)).toBe(v.x(64, 1000)); // 320 & 0xff == 64
  expect(v.x(0, -500)).toBe(-500); // negative magnitude flips direction
  expect(v.y(64, 250)).toBe(250);
});

test("the *script debugger family is registered as inert no-ops", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const family = [
    "propscript", "buttonscript", "scenescript", "flatscript", "stagescript",
    "bootscript", "postscript", "setscript", "paintingscript", "puppetscript",
    "castscript", "actorscript", "shopscript", "serverscript",
  ];
  // registered (so calls never fall through to onUnknown) and side-effect-free
  let unknown = 0;
  session.interp.onUnknown = () => unknown++;
  for (const name of family) {
    expect.soft(session.interp.builtins.has(name), `${name} registered`).toBe(true);
    callBuiltin(session, name, "me"); // must not throw
  }
  expect(unknown).toBe(0);
});

test("fileexists reports availability via the provider (case-insensitive)", async () => {
  const present = new Set(["tour1.mov", "b59.set"]);
  const session = new GameSession(
    (name) => (present.has(name.toLowerCase()) ? new Uint8Array([1]) : null),
    new NullAudioSink(),
  );
  const fe = (name: string) => callBuiltin(session, "fileexists", name) as unknown as Promise<number>;
  expect(await fe("tour1.mov")).toBe(1);
  expect(await fe("TOUR1.MOV")).toBe(1);
  expect(await fe("nope.mov")).toBe(0);
  expect(await fe("")).toBe(0);
});

test("sendtoactorfx / sendtocastfx are registered as dispatch special forms", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  for (const cmd of ["sendtoactorfx", "sendtocastfx", "sendtoactor", "sendtocast"]) {
    expect.soft(session.interp.specialForms.has(cmd), `${cmd} registered`).toBe(true);
  }
});

test("currentcd remembers the mounted disc (always available in the web build)", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const cd = (...a: Value[]) => String(callBuiltin(session, "currentcd", ...a));
  expect(cd()).toBe(""); // nothing mounted yet
  // BOOTFILE's setpath pattern: select then verify non-empty
  expect(cd("Titanic1")).toBe("Titanic1");
  expect(cd()).toBe("Titanic1"); // never "" -> the CD check passes
});

test("dialog builtins delegate to host hooks with the right return shapes", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const seen: string[] = [];
  session.onNoteDialog = (m) => void seen.push(m);
  session.onQuestionDialog = (m) => m.includes("yes");
  session.onTextDialog = (_p, initial) => initial || "typed";
  let quit = 0;
  session.onQuit = () => void quit++;

  await callBuiltin(session, "notedialog", "hello");
  expect(seen).toEqual(["hello"]);
  expect(await (callBuiltin(session, "questiondialog", "say yes") as unknown as Promise<number>)).toBe(1);
  expect(await (callBuiltin(session, "questiondialog", "say no") as unknown as Promise<number>)).toBe(0);
  expect(await (callBuiltin(session, "textdialog", "name?", "dflt") as unknown as Promise<string>)).toBe("dflt");
  await callBuiltin(session, "quit");
  expect(quit).toBe(1);
});

// #105: the player was asked "本当に終了しますか？" as
// `◇{◇◇◇É◇±◇|◇\◇t◇g◇...` — a script literal's bytes reaching `confirm()` one
// character each. The dialog builtins are the only player-facing text that was
// not decoded out of the tree's code page on its way to the host; drawstring and
// puppetbevel already were. Measured over the six shipped trees: 11 dialog
// strings carry high bytes (ja 6, ru 4, fr 1) and 25 are pure ASCII, which is
// why this was invisible in en/de/nl.
test("dialog text is decoded out of the tree's code page (#105)", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  let asked = "";
  let noted = "";
  session.onQuestionDialog = (m) => {
    asked = m;
    return false;
  };
  session.onNoteDialog = (m) => void (noted = m);

  // BOOTFILE's quit question in the Japanese tree, as the bytes it is stored as
  const sjis = raw(0x96, 0x7b, 0x93, 0x96, 0x82, 0xc9, 0x8f, 0x49, 0x97, 0xb9,
                   0x82, 0xb5, 0x82, 0xdc, 0x82, 0xb7, 0x82, 0xa9, 0x81, 0x48);
  session.textEncoding = () => "shift_jis";
  await callBuiltin(session, "questiondialog", sjis);
  expect(asked, "the Japanese quit question reaches the host as Japanese").toBe("本当に終了しますか？");

  // ...and the same defect in the Russian tree, which nobody reported
  const cp1251 = raw(0xc2, 0xfb, 0x20, 0xf3, 0xe2, 0xe5, 0xf0, 0xe5, 0xed, 0xfb, 0x2c, 0x20,
                     0xf7, 0xf2, 0xee, 0x20, 0xf5, 0xee, 0xf2, 0xe8, 0xf2, 0xe5, 0x20,
                     0xe2, 0xfb, 0xe9, 0xf2, 0xe8, 0x3f);
  session.textEncoding = () => "windows-1251";
  await callBuiltin(session, "notedialog", cp1251);
  expect(noted, "and the Russian one as Russian").toBe("Вы уверены, что хотите выйти?");

  // French is Mac OS Roman, where the accent is one byte
  session.textEncoding = () => "macintosh";
  await callBuiltin(session, "notedialog", `jouer ${raw(0x88)} Titanic`);
  expect(noted, "Mac OS Roman accents survive too").toBe("jouer à Titanic");

  // What the player TYPES goes back the other way, because the answer re-enters
  // the game as script bytes (TAOOT: `propowner(me, textdialog("cricket name"))`).
  session.textEncoding = () => "shift_jis";
  session.onTextDialog = () => "本当";
  const typed = await (callBuiltin(session, "textdialog", "name?", "") as unknown as Promise<string>);
  expect([...typed].map((c) => c.charCodeAt(0)), "the typed name comes back as Shift-JIS bytes")
    .toEqual([0x96, 0x7b, 0x93, 0x96]);
});

test("headless dialog defaults are safe (question answers no, text returns default)", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  expect(await (callBuiltin(session, "questiondialog", "quit?") as unknown as Promise<number>)).toBe(0);
  expect(await (callBuiltin(session, "textdialog", "p", "init") as unknown as Promise<string>)).toBe("init");
});

test("count/index enumeration is empty when nothing is loaded", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const num = (name: string, ...a: Value[]) => Number(callBuiltin(session, name, ...a));
  const str = (name: string, ...a: Value[]) => String(callBuiltin(session, name, ...a));
  for (const c of ["countscenes", "countshops", "countcasts", "counttracks", "countpaintings"]) {
    expect.soft(num(c), c).toBe(0);
  }
  expect(num("countviews", "nope")).toBe(0);
  expect(num("countsounds", "nope")).toBe(0);
  expect(num("countbuttons", "nope")).toBe(0);
  // index queries return "" out of range / when empty
  for (const [c, ...a] of [
    ["indextoscene", 1], ["indextoshop", 1], ["indextocast", 1], ["indextotrack", 1],
    ["indextopainting", "s", "v", 1], ["indextoview", "s", 1], ["indextosound", "b", 1],
  ] as [string, ...Value[]][]) {
    expect.soft(str(c, ...a), c).toBe("");
  }
});

test("scene/view enumeration reflects the loaded set (B59.SET)", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const set = readSetFile(new Uint8Array(readFileSync(gamefilePath("b59.set"))));
  // the builtins only read currentBinding.set — stub it to avoid booting a viewer
  (session as unknown as { currentBinding: { set: typeof set } }).currentBinding = { set };

  expect(Number(callBuiltin(session, "countscenes"))).toBe(set.scenes.length);
  expect(set.scenes.length).toBeGreaterThan(0);
  expect(callBuiltin(session, "indextoscene", 1)).toBe(set.scenes[0].sceneName);
  expect(callBuiltin(session, "indextoscene", 9999)).toBe(""); // out of range

  const s0 = set.scenes[0];
  expect(Number(callBuiltin(session, "countviews", s0.sceneName))).toBe(s0.views.length);
  if (s0.views.length) {
    expect(callBuiltin(session, "indextoview", s0.sceneName, 1)).toBe(s0.views[0].viewName);
    // case-insensitive scene lookup
    expect(Number(callBuiltin(session, "countviews", s0.sceneName.toUpperCase()))).toBe(s0.views.length);
  }
});

test("misc scalar builtins: machinetype/tick/frame/setparam/menuvisible/keyaborts", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  expect(callBuiltin(session, "machinetype")).toBe("win");

  /**
   * `tick()` is the engine's 60 Hz counter, not milliseconds — TI.EXE's 0x41de90
   * returns `timeGetTime() * 3 / 50`, which this port already relies on for the
   * wipe pacer, and the scripts say the same in their own arithmetic. Timelapse
   * writes a five-second wait as `tick () - tonaltick > 60 * 5`, and paces its
   * stage animations with `flatticknum * 60 / flatframerate` — sixty per second
   * over frames per second. Read as milliseconds those animations ran ten times
   * too fast, finishing a 53-cel run before a sampler could catch two frames of
   * it.
   *
   * This game's one use gets more sensible with it, not less: `blkjack.shp`'s
   * barman fidgets `if tick () - bjtime > 1200`, twenty seconds of the player
   * sitting still — a cue for a bigger idle animation, where 1.2 seconds had him
   * tilting almost continuously.
   */
  session.clock.now = 4200;
  expect(Number(callBuiltin(session, "tick")), "4200 ms is 252 sixtieths").toBe(252);
  expect(Number(callBuiltin(session, "frame"))).toBe(0);
  // frame() counts DISPLAYED frames, and framerate() is ticks per displayed
  // frame (default 3) — so one frame every 3/60 s = 50 ms of the CLOCK, which
  // is TI.EXE's own rule: 0x43a940 holds a frame until
  // `now >= lastFrame + framerate` ticks. 4300 establishes the baseline stamp;
  // the 500 ms from there to 4800 is ten 50 ms frames.
  for (let i = 0; i < 6; i++) session.tickTime(4300 + i * 100);
  expect(Number(callBuiltin(session, "frame"))).toBe(10);
  session.frameRate = 1; // unthrottled: one frame per tick, 16.67 ms apart
  session.tickTime(5000); // 200 ms more, so 12 further frames
  expect(Number(callBuiltin(session, "frame"))).toBe(22);

  // and the property that matters: gang.cst's hasattention(seconds) waits
  // `(seconds * 60) / framerate()` frames, so FOUR SECONDS of clock must be
  // exactly what it takes to cross hasattention(4). Counting the host's calls
  // instead had Georgia and Morrow accosting the player mid-walk.
  const timed = new GameSession(() => null, new NullAudioSink());
  timed.frameRate = 3;
  const threshold = (4 * 60) / timed.frameRate; // 80 displayed frames
  timed.tickTime(0); // baseline
  // ticked one displayed frame at a time (50 ms at framerate 3), the way a host
  // that is keeping up delivers them — a single four-second JUMP is the stall
  // case instead, and is deliberately clamped (MAX_FRAME_CATCHUP)
  for (let ms = 50; ms <= 4000 - 50; ms += 50) timed.tickTime(ms);
  expect(timed.frameCounter).toBeLessThan(threshold);
  timed.tickTime(4000);
  expect(timed.frameCounter).toBe(threshold);

  // ...and it must not matter HOW OFTEN the host ticks, which is the whole
  // point: the same four seconds delivered in 40 calls and in 400 calls is the
  // same number of displayed frames. Counting calls made this 40 vs 400.
  for (const step of [100, 10]) {
    const host = new GameSession(() => null, new NullAudioSink());
    host.frameRate = 3;
    host.tickTime(0);
    for (let ms = step; ms <= 4000; ms += step) host.tickTime(ms);
    expect(host.frameCounter, `${4000 / step} calls over four seconds`).toBe(threshold);
  }

  // setparam / menuvisible / keyaborts round-trip
  expect(Number(callBuiltin(session, "setparam", 3))).toBe(0); // default
  callBuiltin(session, "setparam", 3, 77);
  expect(Number(callBuiltin(session, "setparam", 3))).toBe(77);
  callBuiltin(session, "menuvisible", 1);
  expect(Number(callBuiltin(session, "menuvisible"))).toBe(1);
  callBuiltin(session, "keyaborts", 0);
  expect(Number(callBuiltin(session, "keyaborts"))).toBe(0);
});

test("actorinstance clones a cast sprite; actordelete/actordist behave", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const rt = session.actorRuntime;
  // seed a source actor by hand (cast loading is exercised elsewhere)
  const src = rt.get("life1");
  expect(src).toBeNull(); // none loaded -> instance is a safe no-op
  callBuiltin(session, "actorinstance", "life1", "life10");
  expect(rt.get("life10")).toBeNull();
  // actordist with no actor/listener -> 32000 sentinel
  expect(Number(callBuiltin(session, "actordist", "vlad"))).toBe(32000);
  // propis3d is always 0 (web props are 2D); propdelete is a safe no-op here
  expect(Number(callBuiltin(session, "propis3d", "binoculars"))).toBe(0);
  callBuiltin(session, "propdelete", "plant2");
});

test("countbevels / currentvoice idle defaults", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  expect(Number(callBuiltin(session, "countbevels"))).toBe(0);
  expect(await (callBuiltin(session, "currentvoice") as unknown as Promise<string>)).toBe("");
});

test("paintings + roadahead drive the nav-arrow (GSTAIR1.SET)", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const set = readSetFile(new Uint8Array(readFileSync(gamefilePath("gstair1.set"))));
  (session as unknown as { currentBinding: { set: typeof set } }).currentBinding = { set };
  const num = (name: string, ...a: Value[]) => Number(callBuiltin(session, name, ...a));

  // countpaintings/indextopainting enumerate a view's hotspot objects — the
  // "door"/"locked" identifiers setuparrow() turns yellow on
  let found = false;
  for (const sc of set.scenes) {
    for (const v of sc.views) {
      if (!v.objects.length) continue;
      found = true;
      expect(num("countpaintings", sc.sceneName, v.viewName)).toBe(v.objects.length);
      expect(callBuiltin(session, "indextopainting", sc.sceneName, v.viewName, 1)).toBe(
        v.objects[0].identifier,
      );
    }
  }
  expect(found).toBe(true); // GSTAIR1 has door/locked hotspots

  // roadahead: a view at EITHER endpoint of a transition is a walkable road
  // (green), else red. Roads are bidirectional — walk()/availableRoads() take a
  // road from viewIDstart OR viewIDend — so roadahead must match both, or the
  // arrow reads red at a road's far end even though ArrowUp walks it.
  const endpoints = new Set(set.transitions.flatMap((t) => [t.viewIDstart, t.viewIDend]));
  expect(endpoints.size).toBeGreaterThan(0);
  for (const sc of set.scenes) {
    for (const v of sc.views) {
      expect.soft(num("roadahead", sc.sceneName, v.viewName), `${sc.sceneName}/${v.viewName}`).toBe(
        endpoints.has(v.viewID) ? 1 : 0,
      );
    }
  }
});

test("currentdeg returns -1 with no set, else the camera's 0..255 heading", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const deg = () => Number(callBuiltin(session, "currentdeg"));
  expect(deg()).toBe(-1); // no listener wired yet
  session.listener = () => ({ x: 0, y: 0, deg: 200 });
  expect(deg()).toBe(200);
  session.listener = () => ({ x: 0, y: 0, deg: 0x140 }); // wraps to 0..255
  expect(deg()).toBe(0x40);
});

test("soundvol/soundpan are per-name get/set with sane defaults", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const vol = (...a: Value[]) => Number(callBuiltin(session, "soundvol", ...a));
  const pan = (...a: Value[]) => Number(callBuiltin(session, "soundpan", ...a));

  // unset defaults: full volume (255), centred pan (128)
  expect(vol("windgust0")).toBe(255);
  expect(pan("windgust0")).toBe(128);

  // setter stores and returns the value; getter reads it back, per name
  expect(vol("windgust0", 200)).toBe(200);
  expect(pan("windgust0", 40)).toBe(40);
  expect(vol("windgust0")).toBe(200);
  expect(pan("windgust0")).toBe(40);
  expect(vol("other")).toBe(255); // independent per name
});

test("currentsound is idle by default and reports the playing channel name", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const cur = (ch: number) => callBuiltin(session, "currentsound", ch) as unknown as Promise<string>;
  expect(await cur(1)).toBe("");
  expect(await cur(2)).toBe("");
});

test("soundvol/soundpan feed the play, and looping sounds show in currentsound", () => {
  const sink = new NullAudioSink();
  const session = new GameSession(() => null, sink);
  const fake = { sampleRate: 8000, samples: new Float32Array(8000) };
  (session.audioLib as unknown as { sound: () => typeof fake }).sound = () => fake;

  // configure then play (the windgust pattern): mapped gain/pan reach the sink
  callBuiltin(session, "soundpan", "windgust0", 0); // 0 -> full left
  callBuiltin(session, "soundvol", "windgust0", 128); // 128/255
  session.scheduler.playSound("windgust0", false);
  const call = sink.calls.at(-1)!;
  expect(call.pan).toBeCloseTo(-1, 5);
  expect(call.volume).toBeCloseTo(128 / 255, 5);

  // a looping sound reports via currentsound(2) until halted
  session.scheduler.soundLoop("wloop", true);
  session.scheduler.playSound("wloop", true);
  expect(session.scheduler.currentSound(2)).toBe("wloop");
  session.scheduler.haltSounds();
  expect(session.scheduler.currentSound(2)).toBe("");
});

test("path stores/returns slots and gates the CD-copy check correctly", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  const path = (...args: Value[]) => callBuiltin(session, "path", ...args);
  const substring = (s: Value, needle: Value) => Number(callBuiltin(session, "substring", s, needle));

  // fresh slots read back empty; the CD check must NOT fire (path(1) != "titanic1:...")
  expect(path(1)).toBe("");
  expect(substring(path(1), "titanic1:")).not.toBe(1);

  // setpath()'s slot-1 assignment, then the exact BOOTFILE guard
  path(1, "tour:"); // path(0) is "" in the web build, so path(0) @ "tour:" == "tour:"
  expect(path(1)).toBe("tour:");
  expect(substring(path(1), "titanic1:")).not.toBe(1); // still passes -> game proceeds

  // setter accepts 1..8; slot 0 is engine-only and out-of-range is ignored/empty
  path(3, "titanic1:data:");
  expect(path(3)).toBe("titanic1:data:");
  path(0, "titanic1:"); // rejected (n=0 not script-writable)
  expect(path(0)).toBe("");
  expect(path(9)).toBe(""); // out of range
});
