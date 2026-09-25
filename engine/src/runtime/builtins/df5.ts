import { Builtin, Value, toNum, toStr, truthy } from "../interp";
import { packPoint } from "../point";
import type { ActorInstance } from "../actors";
import type { PropInstance } from "../props";
import { BuiltinCtx } from "./context";

/**
 * DreamFactory 5's commands outside the room ({@link file://./maze.ts} has the
 * room's): what RedJack's scripts ask that no earlier game did, each read out of
 * `RedJack.exe`. `redjack/tools/rjdis.mts cmd NAME` prints a command's handlers.
 *
 * Every one of these is v5's alone. Several ids are in the v4 table too
 * (`propsnap`, `stageorigin`, `actorflip`…), so in any other game they stay the
 * unknown commands they always were.
 */
export function registerDf5Builtins(ctx: BuiltinCtx): void {
  const { session, interp } = ctx;
  const r5 = (name: string, fn: Builtin): void => {
    interp.register(name, (i, args, call, frame) => {
      if (session.isV5) return fn(i, args, call, frame);
      i.onUnknown(name, args);
      return 0;
    });
  };
  const prop = (n: Value): PropInstance | null => session.propRuntime.get(toStr(n ?? ""));
  const actor = (n: Value): ActorInstance | null => session.actorRuntime.get(toStr(n ?? ""));
  /** a getter/setter pair, as every 16xxx command is: one argument reads, two write */
  const acc5 = <T>(name: string, find: (n: Value) => T | null, get: (e: T) => Value, set: (e: T, v: Value) => void): void =>
    r5(name, (_i, [n, v]) => {
      const e = find(n);
      if (!e) return 0;
      if (v === undefined) return get(e);
      set(e, v);
    });

  // spacebar (): the key held right now — `GetAsyncKeyState (VK_SPACE)` (0x469c10).
  // The chests and crates play their opening until it is, `while (not spacebar () & i != 35)`
  r5("spacebar", () => (session.spaceDown ? 1 : 0));
  // calcrgb (r, g, b): one colour, 0x00RRGGBB (0x417ad0) — the control panel's
  // `puppetparam (3, calcrgb (255, 255, 255))`
  r5("calcrgb", (_i, [red, green, blue]) =>
    ((toNum(red ?? 0) & 0xff) << 16) | ((toNum(green ?? 0) & 0xff) << 8) | (toNum(blue ?? 0) & 0xff),
  );
  // calcpoint (x, y, z): where a point of the room is on the screen (0x4177f0 puts
  // it through the camera, 0x435740); behind the camera it is (32000, 32000). The
  // mine's `pointinactor (thename, calcpoint (hx, hy, hz))` is a hit by a thrown thing
  r5("calcpoint", (_i, [x, y, z]) => {
    const m = session.maze;
    const cam = m?.spriteCamera(m.size.width, m.size.height);
    const p = cam?.project(toNum(x ?? 0), toNum(y ?? 0), toNum(z ?? 0));
    return p ? packPoint(p.x, p.y) : packPoint(32000, 32000);
  });

  /**
   * proporder (p, what) and actororder (a, what): where a sprite is in its
   * animation (0x42a5b0, 0x404040). 1 is the length of the order it plays, 2 the
   * step it is on counted from 1, 3 the picture at that step, 7 how many pictures
   * the view has; 4 to 6 are maxima over the pictures' own records, which no
   * script asks. `for i = 1 to proporder (thename, 1)` + `forceupdate ()` is how
   * the drinks and the doors play a view through once before going on.
   */
  r5("proporder", (_i, [n, what]) => {
    const p = prop(n);
    const st = p?.state();
    if (!p || !st) return 0;
    switch (toNum(what ?? 0)) {
      case 1: return p.frameCount(st);
      case 2: return Math.min(p.frameIdx, p.frameCount(st) - 1) + 1;
      case 3: return p.currentFrameIdx(st);
      case 7: return st.frames.length;
    }
    return 0;
  });
  r5("actororder", (_i, [n, what]) => {
    const a = actor(n);
    const pose = a?.pose();
    if (!a || !pose) return 0;
    const len = pose.play.length;
    switch (toNum(what ?? 0)) {
      case 1: return len;
      case 2: return len ? (a.step % len) + 1 : 0;
      case 3: return len ? pose.play[a.step % len] : 0;
      case 7: return pose.steps.length;
    }
    return 0;
  });

  /**
   * propistrue3d (p, on) and propisfacer (p, on): a prop drawn as a flat picture
   * standing in the room, turned by its `propdeg` and tilted by its `proppitch`,
   * rather than a sprite that is always square to the screen (0x42caa0 hands it
   * to the 3D renderer, 0x456540). A facer — every prop until told otherwise
   * (0x427783) — is turned to the camera, so only `propisfacer (p, false)` makes
   * a difference you can see: Cartagena's planks lie flat on the ground, and its
   * lock's chains hang against the door. See PropRuntime.cardOf.
   */
  acc5("propistrue3d", prop, (p) => (p.true3d ? 1 : 0), (p, v) => { p.true3d = truthy(v); });
  acc5("propisfacer", prop, (p) => (p.facer ? 1 : 0), (p, v) => { p.facer = truthy(v); });
  acc5("proppitch", prop, (p) => p.pitch, (p, v) => { p.pitch = toNum(v); });
  // actoristrue3d (a, on): the same card for an actor. No script turns an actor's
  // facer off (`actorisfacer`, 0x403860, is never called), and a facer draws as
  // the sprite it already was
  acc5("actoristrue3d", actor, (a) => (a.true3d ? 1 : 0), (a, v) => { a.true3d = truthy(v); });
  // propsnap (p, on): the screen prop moves with the stage when a fight scrolls it
  // (`stageorigin`); 0x42cf2f adds the origin to its anchor (0x416420)
  acc5("propsnap", prop, (p) => (p.snap ? 1 : 0), (p, v) => { p.snap = truthy(v); });
  // actorflip (a, bits): propflip's twin (0x403c80) — 1 mirrors across, 2 upside down
  acc5("actorflip", actor, (a) => a.flip, (a, v) => { a.flip = Math.trunc(Number(v)) || 0; });

  /**
   * propbrightness (p, r, g, b), actorbrightness and screenbrightness (r, g, b):
   * a number added to each channel of a sprite's (or the whole screen's)
   * colours, each held to -255..255 (0x40a7f0). The shading record beside it has
   * a multiplier too (0x46f180), which these leave alone. Tavern bottles are lit
   * `propbrightness (…, 10, 10, 10)`; the big fight turns the screen red when Nick
   * is hit and back with `screenbrightness (0, 0, 0)`.
   */
  const level = (v: Value | undefined): number => Math.max(-255, Math.min(255, Math.trunc(toNum(v ?? 0))));
  const bright = (e: { bright: [number, number, number] }, [red, green, blue]: Value[]): void => {
    e.bright = [level(red), level(green), level(blue)];
  };
  r5("propbrightness", (_i, [n, ...rgb]) => {
    const p = prop(n);
    if (!p) return 0;
    if (!rgb.length) return p.bright[0];
    bright(p, rgb);
  });
  r5("actorbrightness", (_i, [n, ...rgb]) => {
    const a = actor(n);
    if (!a) return 0;
    if (!rgb.length) return a.bright[0];
    bright(a, rgb);
  });
  r5("screenbrightness", (_i, rgb) => {
    if (rgb.length === 1) return session.screenBright[Math.max(0, Math.min(2, toNum(rgb[0]) - 1))];
    session.screenBright = [level(rgb[0]), level(rgb[1]), level(rgb[2])];
  });

  // screencontrast (r, g, b): the BOOTFILE's Brighter and Darker, 5 a step. Each
  // is a gamma: 0x40a870 keeps 128 - c (held to 0..256) and the table it indexes
  // (0x46ecd0) is 255 · (v / 255) ^ (m / (256 - m)), so 0 is the picture as it is
  // and a positive number lifts it (ScreenPresenter.blit)
  r5("screencontrast", (_i, rgb) => {
    if (rgb.length === 1) return session.screenContrast[Math.max(0, Math.min(2, toNum(rgb[0]) - 1))];
    const c = (v: Value | undefined): number => Math.max(-128, Math.min(128, Math.trunc(toNum(v ?? 0))));
    session.screenContrast = [c(rgb[0]), c(rgb[1]), c(rgb[2])];
  });

  // stageflat (name) and stageflat (): v5's gotoflat and currentflat, whose own
  // ids have no handler in RedJack.exe (0x413110, 0x414140). The fights keep their
  // camera in the flat's name: `findword (stageflat (), " ", 2)`
  r5("stageflat", (_i, [n]) =>
    n === undefined ? session.currentFlat : session.stageCtrl.gotoFlat(toStr(n)).then(() => {}),
  );
  // stageorigin (x, y) and stageorigin (1 | 2): where the open stage's top-left is
  // drawn, which a fight moves to shake the screen and follow a leap (0x415730);
  // the snapped props go with it. Without a stage open, nothing (0x41573c)
  r5("stageorigin", (_i, [x, y]) => {
    if (session.stageName === "none") return 0;
    if (y === undefined) return toNum(x ?? 0) === 2 ? session.stageOrigin.y : session.stageOrigin.x;
    session.stageOrigin = { x: Math.trunc(toNum(x ?? 0)), y: Math.trunc(toNum(y)) };
  });

  // themeorder (theme, "1,2,3…", …): the order a theme's loops play in, 1-based
  // into its bank's loop records — the big fight gets louder by phases this way
  r5("themeorder", (_i, [n, order]) => {
    const name = toStr(n ?? "");
    const list = toStr(order ?? "").split(",").map((s) => parseInt(s, 10)).filter((v) => v > 0);
    if (!session.audioLib.setThemeOrder(name, list)) return;
    // playing already: the new order takes over from its start
    if (session.currentThemeName.toLowerCase() !== name.toLowerCase()) return;
    const theme = session.audioLib.theme(name);
    if (theme) session.audio.play("theme", theme, { loop: true });
  });

  // doublebuffer (w, h, depth) and singlebuffer (…): the control panel switching
  // the monitor between 16 and 32 bits. The canvas is true-colour whichever is
  // asked, so a switch always works — `if doublebuffer ()` — and `sysparam (10)`
  // answers the depth asked for, which is what lights the panel's buttons
  for (const name of ["doublebuffer", "singlebuffer"]) {
    r5(name, (_i, [, , depth]) => {
      if (depth !== undefined) session.screenDepth = toNum(depth) === 16 ? 16 : 32;
      return 1;
    });
  }

  // flatwarm, castwarm, flushcache: load something ahead of need, or drop what
  // was loaded — the port reads a file whole the first time it is asked. reboot
  // is only behind `isdebugging ()`, which is 0 (0x41a6f0)
  for (const name of ["flatwarm", "castwarm", "flushcache", "reboot"]) r5(name, () => {});
  r5("isdebugging", () => 0);
}
