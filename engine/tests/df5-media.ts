/**
 * DreamFactory 5's outside movie players and its later net commands, as
 * RedJack.exe's handlers answer them on a machine with neither the players nor
 * a peer (engine/src/runtime/builtins/df5-media.ts, df5-net.ts), and the
 * sprite left under no record by a load (runtime/shading.ts, LIT_NONE).
 *
 *   npx vitest run engine/tests/df5-media.ts
 *
 * Needs no game data.
 */
import { test, expect } from "vitest";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { Df5Random, netIdToString, stringToNetId } from "@dreamfactory/engine/runtime/builtins/df5-net";
import { LIT_NONE, Lights, plainShade, shadedPalette } from "@dreamfactory/engine/runtime/shading";

function v5() {
  const session = new GameSession(() => null, new NullAudioSink());
  session.df5Disk.setTree([["RJDisk1/movies/intro.mpg", 4000], ["RJDisk1/movies/intro.smk", 4000]]);
  const logs: string[] = [];
  session.onLog = (l) => void logs.push(l);
  const unknown: string[] = [];
  session.interp.onUnknown = (name) => unknown.push(name);
  const call = (name: string, ...args: (number | string)[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, {} as never);
  const fails = (name: string, ...args: (number | string)[]) => expect(async () => call(name, ...args)).rejects;
  return { session, logs, unknown, call, fails };
}

test("the movie players check what RedJack.exe checks, then find no player", async () => {
  const { session, logs, unknown, call, fails } = v5();
  expect(await call("plaympeg", "intro.mpg")).toBe(0);
  expect(unknown).toEqual(["plaympeg"]);
  session.isV5 = true;
  session.pathSlots[3] = "RJDisk1:movies:";

  // playqt reads nothing and does nothing (0x409ae0)
  expect(await call("playqt", 1, "x")).toBeUndefined();

  for (const cmd of ["plaympeg", "playactivemovie", "playsmacker"]) {
    await fails(cmd, 5).toMatchObject({ code: 0xe });
    // a lone integer is the jump table's error case (0x409c1e), a string among them 0xe too
    await fails(cmd, "intro.mpg", 100).toMatchObject({ code: 0xe });
    await fails(cmd, "intro.mpg", 0, "1000").toMatchObject({ code: 0xe });
    // the file is looked for in path slots 1..8 only (0x409f57..0x409f9d)
    await fails(cmd, "nothing.mpg").toMatchObject({ code: 0x6b });
    // the players answer 0 whatever happened, so the statement does too
    expect(await call(cmd, "intro.mpg", 0, 5000, packPoint(10, 20), packPoint(320, 240), 1)).toBeUndefined();
  }
  expect(logs.filter((l) => l.startsWith("plaympeg:")).at(-1)).toBe(
    'plaympeg: RJDisk1:movies:intro.mpg to MCI "MpegVideo" (0x48c320), 0..5000 ms, 320x240 at 10,20, mode 1 — no such player here',
  );
  await call("playactivemovie", "intro.mpg");
  expect(logs.at(-1)).toContain("0..2147483647 ms, 720x480 centred, mode 2");
  // playsmacker's player is `xor ax, ax` (0x48c6d0): nothing to hand on
  const before = logs.length;
  await call("playsmacker", "intro.smk");
  expect(logs).toHaveLength(before);

  // playdvd (file, player, ...): both expressions, then both strings, then the file
  await fails("playdvd", "intro.mpg").toMatchObject({ code: 0x1c });
  await fails("playdvd", 1, "auto").toMatchObject({ code: 0xe });
  await fails("playdvd", "intro.mpg", 2).toMatchObject({ code: 0xe });
  await fails("playdvd", "nothing.vob", "auto").toMatchObject({ code: 0x6b });
  // DirectShow's DVD graph and every MCI device fail here, and playdvd says so (0x409d60)
  await fails("playdvd", "intro.mpg", "auto").toMatchObject({ code: 0x2a });
  expect(logs.at(-1)).toContain("DirectShow's DVD graph, then MCI Mpeg2Video, DVDVideo, PCDVDVideo, MpegVideo");
  await fails("playdvd", "intro.mpg", "").toMatchObject({ code: 0x2a });
  expect(logs.at(-1)).toContain('MCI "dvdvideo"');
});

test("with no peer every connected net command is error 0x40, before its argument is read", async () => {
  const { session, call, fails } = v5();
  session.isV5 = true;
  await fails("netcatchup", "not a number").toMatchObject({ code: 0x40 });
  await fails("netsync").toMatchObject({ code: 0x40 });
  await fails("netclientlatency", 3).toMatchObject({ code: 0x40 });
  await fails("netrandom", 6).toMatchObject({ code: 0x40 });
  await fails("nettick").toMatchObject({ code: 0x40 });
  // the conversions need no connection
  expect(await call("netidtostring", 0x0400a8c0)).toBe("192.168.0.4");
  expect(await call("netidtostring", -1)).toBe("255.255.255.255");
  await fails("netidtostring", "1.2.3.4").toMatchObject({ code: 0xe });
  expect(await call("stringtonetid", "192.168.0.4")).toBe(0x0400a8c0);
  await fails("stringtonetid", 4).toMatchObject({ code: 0xe });
});

test("stringtonetid reads its text as 0x492cf0 does", () => {
  expect(stringToNetId("10,0:0-1")).toBe(0x0100000a);
  // leading separators are skipped; after the first number each one ends one
  expect(stringToNetId("..1.2.3.4")).toBe(0x04030201);
  expect(stringToNetId("1..2.3.4")).toBe(0x03020001);
  // added, not or-ed; atol's white space and sign; a fifth number ignored
  expect(stringToNetId("1.256.0.0")).toBe(0x10001);
  expect(stringToNetId(" 7.+1.x.255.9")).toBe(((255 << 24) | (1 << 8) | 7) | 0);
  // fewer than four numbers, or none, and RedJack.exe reads address 0
  expect(() => stringToNetId("1.2.3")).toThrow(/address 0/);
  expect(() => stringToNetId("1.2.3.")).toThrow(/address 0/);
  expect(() => stringToNetId("")).toThrow(/address 0/);
  expect(() => stringToNetId("...")).toThrow(/address 0/);
  expect(netIdToString(stringToNetId("127.0.0.1"))).toBe("127.0.0.1");
});

test("RedJack.exe's generator (0x469290), seeded as 0x469aa0 seeds it", () => {
  const r = new Df5Random();
  r.seed(1000);
  expect(r.table.slice(0, 3)).toEqual([1000, 31001, (31001 * 31 + 1) % 0xffff]);
  // by hand from the seed: index 1 becomes t[24] ^ t[0], index 2 t[25] ^ the new t[1]
  const t = r.table.slice();
  const hi = (t[24] ^ t[0]) % 0xffff;
  const lo = (t[25] ^ hi) % 0xffff; // t[1] is the word just drawn
  expect(r.draw()).toBe(((hi << 16) | lo) >>> 0);
  expect(r.index).toBe(2);
  // it wraps its index at 55
  for (let k = 0; k < 30; k++) r.draw();
  expect(r.index).toBe(62 % 55);
});

test("a sprite under no record is drawn as if the screen's were not over it", () => {
  const lights = new Lights();
  const screen = { bright: [40, 0, 0] as [number, number, number], contrast: [0, 0, 0] as [number, number, number] };
  lights.screenOf = () => screen;
  const pal = new Uint8ClampedArray([100, 100, 100, 255, 10, 200, 30, 255]);
  const own = plainShade();
  // under the screen: the palette as it is, and the presenter adds 40 to red
  expect(lights.spritePalette(pal, own, 1)).toBe(shadedPalette(pal, own));
  // under nothing: red handed down by 40, where the curve can reach it
  const none = lights.spritePalette(pal, own, LIT_NONE);
  expect(Array.from(none)).toEqual([60, 100, 100, 255, 0, 200, 30, 255]);
  screen.bright = [0, 0, 0];
  expect(lights.spritePalette(pal, own, LIT_NONE)).toBe(shadedPalette(pal, own));
});
