/**
 * GameSession's own small rules (engine/src/runtime/session.ts): naming the
 * dispatches in flight, the prop-owner trace's line, an absent script
 * container, `wavevolume` as the device's volume (DreamFactory 4) or the
 * channels' (Dust), an untyped engine turning true and false into 1 and 0,
 * `runGlobal` passing on a failure that is not the script's, and a prop
 * with no picture shown over text.
 *
 *   npx vitest run engine/tests/session-edges.ts
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { Frame } from "@dreamfactory/engine/runtime/interp";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const session = () => {
  const audio = new NullAudioSink();
  const s = new GameSession(() => null, audio);
  s.onLog = () => {};
  return { s, audio };
};

test("the dispatches in flight are named where the caller named them, and '?' where it did not", async () => {
  const { s } = session();
  let release = (): void => {};
  const hold = new Promise<void>((r) => (release = r));
  void s.track(hold, "keydown");
  void s.track(hold.then(() => {}));
  expect(s.pending()).toEqual(["keydown", "?"]);
  release();
  await hold;
  await Promise.resolve();
  await Promise.resolve();
  expect(s.pending()).toEqual([]);
});

test("the prop-owner trace: only watched props, only real changes, and '-' or '?' for what is empty", () => {
  const { s } = session();
  const inst = s.instanceFrom(compileScript("code go ()\n\tlocal x\nendcode\n"), "inven")!;
  const lines: string[] = [];
  const frame = (handler: string, me: string) => new Frame(inst, { me, target: "" }, handler);
  // nobody listening: nothing
  s.propTrace.add("bone");
  s.tracePropOwner("bone", "", "anne", frame("go", "x"));
  s.onPropTrace = (l) => lines.push(l);
  s.tracePropOwner("bone", "anne", "anne", frame("go", "x"));
  s.tracePropOwner("cup", "", "anne", frame("go", "x"));
  s.currentSetName = "town";
  s.setVisible = false;
  s.tracePropOwner("Bone", "", "anne", frame("", ""));
  s.setVisible = true;
  s.tracePropOwner("bone", "anne", "", frame("give", "anne"));
  expect(lines.map((l) => l.replace(/ flat=\S*/, "").replace(/ @frame=.*/, ""))).toEqual([
    "#001 Bone - -> anne by=inven.? me=- set=town vis=0",
    "#002 bone anne -> - by=inven.give me=anne set=town vis=1",
  ]);
});

test("no container is no script", () => {
  expect(session().s.instanceFrom(undefined, "nobody")).toBeNull();
});

test("wavevolume is the wave device's volume in DreamFactory 4, music too, and the channels' alone in Dust", () => {
  const v4 = session();
  v4.s.themeVolume = 128;
  expect(v4.s.setWaveVolume(4.4)).toBe(4);
  const g = Math.trunc((4 * 0xffff) / 9) / 0xffff;
  expect(v4.audio.channelVolume).toEqual({ sound: g, voice: g, theme: (128 / 255) * g });
  const v1 = session();
  v1.s.dfVersion = 1;
  v1.s.setWaveVolume(12);
  v1.s.setWaveVolume(4);
  expect(v1.audio.channelVolume).toEqual({ sound: 4 / 9, voice: 4 / 9, theme: 0.6 });
});

test("an untyped engine keeps true and false as 1 and 0, set before it said so", () => {
  const { s } = session();
  s.interp.globals.set("lit", true);
  s.interp.globals.set("dark", false);
  s.interp.globals.set("n", 3);
  s.isV5 = true;
  expect([s.interp.globals.get("lit"), s.interp.globals.get("dark"), s.interp.globals.get("n")]).toEqual([1, 0, 3]);
});

test("runGlobal: a script error is the script's and answers 0; any other failure is passed on", async () => {
  const { s } = session();
  s.onSetChange = () => {
    throw new Error("the disc is gone");
  };
  s.bootScripts = [s.instanceFrom(compileScript("code bad ()\n\tlocal x\n\tx = puppetclear ()\nendcode\ncode lost ()\n\topensetfile (\"gone\")\nendcode\n"), "boot")!];
  s.refreshFallbacks();
  expect(await s.runGlobal("bad")).toBe(0);
  await expect(s.runGlobal("lost")).rejects.toThrow("the disc is gone");
});

test("a prop shown with no picture covers nothing, so the text under where it would be stays", async () => {
  const { s } = session();
  const shp = buildShpBytes({ palette: [0, 0, 0], groups: [{ name: "patch", states: [{ identifier: "blank", frames: [] }] }] });
  (s as unknown as { files: (n: string) => Uint8Array | null }).files = (n) => (n === "t.shp" ? shp : null);
  await s.openShop("t.shp");
  s.textOverlay.push({ text: "$100", x: 0, y: 0, color: 1, size: 12 });
  await s.interp.builtins.get("propvisible")!(s.interp, ["patch", 1], {} as never, {} as never);
  expect(s.propRuntime.props.get("patch")?.visible).toBe(true);
  expect(s.textOverlay.map((t) => t.text)).toEqual(["$100"]);
});
