import { toStr, toNum, Value } from "../interp";
import { pointX, pointY } from "../point";
import { CAMERA_ID_TAKEN, CAMERA_NO_PHOTO, CAMERA_OK, PHOTO_X, PHOTO_Y } from "../photos";
import { BuiltinCtx } from "./context";

/**
 * `plugin(name, …)` / `pluginfx(name, …)` — the native plugin bus.
 *
 * What each of the three named plugins is, and why only one of them is
 * implemented, is in `engine/src/runtime/plugins.ts` — this module is the
 * dispatch and the argument shapes, that one is the story.
 */
export function registerPluginBuiltins(ctx: BuiltinCtx): void {
  const { session, r, log } = ctx;

  /**
   * The `xray` reveal, and the three forms it is called in — told apart by arity
   * and by the TYPE of the first argument after the name.
   *
   * A string there is a flat name and arms the reveal; a number is a packed point
   * and moves it; nothing at all tears it down. Nothing in the corpus is
   * ambiguous between them, and anything that does not match is logged rather
   * than guessed at, because a reveal armed from arguments this did not
   * understand would draw a hole somewhere the author never put one.
   */
  const xray = (args: Value[]): Value => {
    const bus = session.plugins;
    if (args.length === 0) {
      // teardown. Not conditional on there being a reveal: the scripts guard it
      // with `if mirrorflat != 0` themselves and a second disarm is harmless,
      // but `leaveframe` also fires on stages the player never used the light on.
      bus.xray = null;
      return 0;
    }
    if (typeof args[0] === "string") {
      const [hidden, base, mask, light] = args.map((a) => toStr(a));
      if (!hidden || !mask) {
        log(`plugin("xray"): armed with no ${!hidden ? "hidden flat" : "mask prop"}`);
        return 0;
      }
      bus.xray = { hidden, base, mask, light, x: 0, y: 0, aimed: false };
      log(`xray: ${hidden} through ${mask} over ${base || "(current flat)"}`);
      return 0;
    }
    const pt = toNum(args[0]);
    if (!bus.xray) {
      // A drive call with nothing armed. `e.shp`'s `invpickup` calls `drawme`
      // directly, and `drawme` only arms when the frame is one of the fourteen
      // the specs work on — so on any other frame this is the script's normal
      // path and not a fault. Silent for that reason.
      return 0;
    }
    bus.xray.x = pointX(pt);
    bus.xray.y = pointY(pt);
    bus.xray.aimed = true;
    return 0;
  };

  /**
   * Both spellings reach the same table. `pluginfx` is the value-returning
   * variant — the `fx` suffix means the same thing it does across the `sendto*`
   * family, and the camera's callers read its answer as an error code where the
   * xray's callers ignore it.
   */
  /**
   * The `camera`, and its three forms — told apart by argument count, which is
   * how `docamera` and the album flat's `updateflat` loop distinguish them.
   *
   * The contract, the answers each form may give and the geometry are all in
   * `engine/src/runtime/photos.ts`, off `tz.dll`. The one thing worth repeating
   * here is why the save may only ever fail for a taken id: `docamera` retries
   * in a `while true`, so any other refusal hangs the game inside the shutter.
   */
  const camera = async (args: Value[]): Promise<Value> => {
    const album = session.photos;
    // every form opens first — the scripts do it themselves before a display,
    // and before the shutter's retry loop
    await album.open();
    if (args.length <= 1) return CAMERA_OK;

    const id = toNum(args[1] ?? 0);
    if (args.length >= 3) {
      /**
       * SAVE. The COLLISION is tested first, before anything is grabbed: it is
       * the one answer `docamera`'s `while true` acts on, and a shot that
       * reported success under an id already in the album would leave that
       * loop's `pic<n>` pointing at somebody else's photograph. Cheaper too — a
       * rejected roll costs no pixels.
       */
      if (album.get(id)) return CAMERA_ID_TAKEN;
      // ...and the third argument is the viewfinder point the shot is centred on
      const pt = toNum(args[2] ?? 0);
      const photo = session.grabPhoto?.(pointX(pt), pointY(pt)) ?? null;
      if (!photo) {
        // No framebuffer to grab (a headless run, or a screen too small for a
        // 320x240 window). Answering "taken" would spin `docamera` forever, so
        // this reports success and the album simply has nothing under that id —
        // which is exactly what the album then says about it.
        log(`plugin("camera"): nothing to photograph — the shot is empty`);
        return CAMERA_OK;
      }
      return album.save(id, photo);
    }

    // DISPLAY: over the album flat, at the rect tz.dll draws it in
    const photo = album.get(id);
    if (!photo) return CAMERA_NO_PHOTO;
    session.photoOverlay = { photo, x: PHOTO_X, y: PHOTO_Y };
    /**
     * ...and showing a photograph LIGHTS THE ALBUM.
     *
     * Every photo in `camera.fil` carries its own 256-entry palette — the only
     * reason to store one is that displaying the shot installs it — and the
     * album is the only flat that ever displays one. That is what lifts the dim
     * the album was entered under, and the album is entered under one by both
     * of its doors:
     *
     *   - the panel's button (P.Stg container 7) is `screentoblack ("stage",
     *     10)`, `gotoflat (3)`, `sendtoflat (currentflat (), openflatx ())` —
     *     inside the stage file that is already open, so nothing else in this
     *     port would clear it;
     *   - Control+P is `InterfaceCommand ("P")` -> `photoalbum ()` ->
     *     `begininterface (3)`, which swaps the stage file and is cleared there
     *     instead (StageController.openStageFile).
     *
     * And the album's `openflatx` (container 32) is the one panel flat that
     * never calls `blacktoscreen`, so without this the caption, the furniture
     * and the photograph were all painted into a framebuffer nobody could see.
     *
     * The game guarantees the pairing, which is what makes this safe to hang on
     * the display: both doors refuse to enter flat 3 at all unless there is a
     * photograph to show — `if pictotal < 1` answers "You haven't taken any
     * pictures yet" and stays where it is.
     */
    session.fade.queue.length = 0;
    session.fade.snapshot = null;
    session.fade.level = 0;
    session.fade.pendingReveal = false;
    return CAMERA_OK;
  };

  for (const cmd of ["plugin", "pluginfx"]) {
    r(cmd, (_i, args) => {
      const name = toStr(args[0] ?? "").toLowerCase();
      const rest = args.slice(1);
      switch (name) {
        case "xray":
          return xray(rest);
        case "camera":
          return camera(rest);
        case "scrollflat":
          // Unreachable while the memory report keeps `minMemory` true, which is
          // the whole point of that report. If this ever appears in a log, the
          // turn transitions have moved onto a path this port does not implement
          // and turning will have stopped working — so it says so loudly.
          log(`plugin("scrollflat"): the smooth turn is not implemented — expected minMemory to route around it`);
          return 0;
        default:
          log(`${cmd}("${name}"): unknown plugin`);
          return 0;
      }
    });
  }
}
