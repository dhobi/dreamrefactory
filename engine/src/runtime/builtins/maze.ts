import { toNum, toStr } from "../interp";
import { calcTurn, degDiff, degMask, degToSimple, simpleToDeg } from "../maze";
import { packPoint, pointX, pointY } from "../point";
import { BuiltinCtx } from "./context";

/**
 * DreamFactory 5's room commands: the camera, the exits, the walk and the
 * angle arithmetic every RedJack room's main script is written in. They act on
 * the open room ({@link GameSession.maze}) and answer 0 without one — the same
 * as the commands of a set that is not open.
 *
 * The angles are 2²⁴ths of a turn; see engine/src/runtime/maze.ts.
 */
export function registerMazeBuiltins(ctx: BuiltinCtx): void {
  const { session, r } = ctx;
  const maze = () => session.maze;

  r("simpletodeg", (_i, [d]) => simpleToDeg(toNum(d ?? 0)));
  r("degtosimple", (_i, [d]) => degToSimple(toNum(d ?? 0)));
  r("degmask", (_i, [d]) => degMask(toNum(d ?? 0)));
  r("degdiff", (_i, [a, b]) => degDiff(toNum(a ?? 0), toNum(b ?? 0)));
  r("calcturn", (_i, [cur, target, step]) => calcTurn(toNum(cur ?? 0), toNum(target ?? 0), toNum(step ?? 0)));

  // camerapitch () / camerapitch (p), camerafov () / camerafov (f)
  r("camerapitch", (_i, [p]) => {
    const m = maze();
    if (!m) return 0;
    if (p === undefined) return m.pitch;
    m.setPitch(toNum(p));
  });
  r("camerafov", (_i, [f]) => {
    const m = maze();
    if (!m) return 0;
    if (f === undefined) return m.fov;
    m.setFov(toNum(f));
  });

  r("countexits", (_i, [scene]) => maze()?.exits(toStr(scene ?? "")).length ?? 0);
  r("indextoexit", (_i, [scene, i, what]) =>
    maze()?.exitField(toStr(scene ?? ""), toNum(i ?? 0), toNum(what ?? 1)) ?? 0,
  );
  r("nearexit", (_i, [scene, deg]) => maze()?.nearExit(toStr(scene ?? ""), toNum(deg ?? 0)) ?? 0);
  r("nodescroll", (_i, [head, pitch, fov, step]) => {
    const m = maze();
    if (!m) return 0;
    return m.nodeScroll(toNum(head ?? 0), toNum(pitch ?? 0), toNum(fov ?? 0), toNum(step ?? 0)) ? 1 : 0;
  });
  r("launchexit", async (_i, [scene, i]) => {
    await maze()?.launchExit(toStr(scene ?? ""), toNum(i ?? 0));
  });

  // pointinquad (name, point): is the point inside that quad as it is drawn now?
  r("pointinquad", (_i, [name, pt]) => {
    const m = maze();
    const n = toStr(name ?? "").toLowerCase();
    const q = m?.sett.quads.find((x) => x.name.toLowerCase() === n);
    if (!m || !q) return 0;
    const p = toNum(pt ?? 0);
    return m.quadAt(pointX(p), pointY(p), m.size.width, m.size.height) === q ? 1 : 0;
  });

  // nodequality (depth, detail, filter): the renderer's quality. Only the detail
  // is honoured — see MazeRuntime.detail
  r("nodequality", (_i, [, detail]) => {
    const m = maze();
    if (!m || detail === undefined) return 0;
    const d = toNum(detail);
    if (d !== m.detail) {
      m.detail = d;
      m.onChange();
    }
    return 0;
  });
  // the debugging hook a shift-click opens the script editor with
  r("quadscript", () => 0);

  // sysparam (n): the engine's own settings. v5 put it at 16026, which is v4's
  // `propspeed`, and the decoder does not know which engine a script is for —
  // so a v5 game's `propspeed (7)` lands here (see DF5_OPCODES). RedJack asks
  // two: 7, the button of the press being handled, and 10, the screen depth.
  // The canvas is true-colour, so the depth is whatever the control panel last
  // asked for (`doublebuffer`, builtins/df5.ts) — 32 until it asks.
  const sysparam = (n: number): number => (n === 7 ? session.pointerButton : n === 10 ? session.screenDepth : 0);
  r("sysparam", (_i, [n]) => sysparam(toNum(n ?? 0)));
  // roadahead (scene, view): v4 asks the set's transitions (scene.ts); a v5
  // room answers the film ahead of a scene's view
  const roadahead = ctx.interp.builtins.get("roadahead")!;
  ctx.interp.builtins.set("roadahead", (i, args, call, frame) =>
    session.isV5
      ? (maze()?.roadAhead(toStr(args[0] ?? ""), toStr(args[1] ?? "")) ?? 0)
      : roadahead(i, args, call, frame),
  );
  // cameraxyz (axis) and scenexyz (scene, axis): a v5 room's camera and places
  // are points in its own units (engine/src/df/sett.ts), which the scripts put
  // props on and turn them to — `propxyz (me, scenexyz ("scene10", 1), …)`,
  // `calcdeg (propxyz (me, 1), propxyz (me, 2), cameraxyz (1), cameraxyz (2))`
  const axisOf = (pt: { x: number; y: number; z: number }, axis: number): number =>
    axis === 1 ? pt.x : axis === 2 ? pt.y : axis === 3 ? pt.z : axis === 4 ? packPoint(pt.x, pt.y) : 0;
  for (const name of ["cameraxyz", "playerxyz"]) {
    const v4 = ctx.interp.builtins.get(name)!;
    ctx.interp.builtins.set(name, (i, args, call, frame) => {
      const cam = session.isV5 ? maze()?.camera() : null;
      return cam ? axisOf(cam, toNum(args[0] ?? 1)) : v4(i, args, call, frame);
    });
  }
  const scenexyz = ctx.interp.builtins.get("scenexyz")!;
  ctx.interp.builtins.set("scenexyz", (i, args, call, frame) => {
    const m = session.isV5 ? maze() : null;
    if (!m) return scenexyz(i, args, call, frame);
    const n = toStr(args[0] ?? "");
    const at = m.findNode(n) ?? m.findScene(n);
    return at ? axisOf(at, toNum(args[1] ?? 1)) : 0;
  });
  const propspeed = ctx.interp.builtins.get("propspeed")!;
  ctx.interp.builtins.set("propspeed", (i, args, call, frame) =>
    session.isV5 ? sysparam(toNum(args[0] ?? 0)) : propspeed(i, args, call, frame),
  );
}
