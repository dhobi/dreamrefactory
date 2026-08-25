/**
 * The native plugin bus — `plugin(name, …)` and `pluginfx(name, …)`.
 *
 * DreamFactory 4 could hand work to a *native code plugin* addressed by name,
 * and *Timelapse* (1996) is the only rip here that uses it: 42 `plugin` calls
 * and 4 `pluginfx`, naming three plugins between them. Titanic and Dust name
 * none, which is why the port went this long without the opcode at all.
 *
 * A plugin call is not one signature. Each of the three has its own, and each is
 * a small state machine over successive calls rather than a function — the first
 * call arms it, the middle ones drive it, and the bare `plugin("name")` tears it
 * down. That shape is why this is a module with state in it and not four lines
 * in `builtins/scene.ts`.
 *
 * ## The three, and what became of each
 *
 * **`xray`** — 32 calls, and implemented here. A moving aperture that reveals a
 * SECOND flat through the one on screen: the flashlight in world A, the glowstick
 * in the insect room, the x-ray specs in world E. See {@link XRayReveal}.
 *
 * **`scrollflat`** — 10 calls, and deliberately not implemented, because the game
 * itself does not reach them. It is the smooth turn: `lefttoframe` pans from the
 * mid-turn flat to the destination flat through the plugin. But the BOOTFILE
 * writes that handler TWICE —
 *
 *     if minMemory
 *         lefttoframeMin (framenum)     / / gotoflat + visualeffect (turnhalfleft)
 *     else
 *         lefttoframe (framenum)        / / plugin ("scrollflat", …)
 *     endif
 *
 * — and the `Min` twin does the same turn out of plain engine opcodes this port
 * already has. `minMemory` is set from {@link freemem}/{@link sysmem} (see
 * `builtins/helpers.ts`), which report a 1996-sized machine here for exactly this
 * reason: it routes Timelapse onto the path built out of primitives we have. So
 * these ten calls are unreachable in normal play, and a `scrollflat` that did
 * nothing would be worse than one that says so.
 *
 * **`camera`** — 4 `pluginfx` calls, and registered without a store behind it.
 * `pluginfx("camera", path(0))` opens the photo album at the application folder
 * and `pluginfx("camera", path(0), variable("pic" @ n))` displays one shot,
 * each answering an error code the script turns into a dialog. The photographs
 * are FILES the player made in the game folder, which a browser has no equivalent
 * of; it answers 0 (no error) rather than raising a dialog about a store that was
 * never going to be there, and the album shows its furniture with nothing in it.
 */

/**
 * `plugin("xray", …)` — the reveal aperture, and the one plugin this port
 * implements.
 *
 * Three inventory items in Timelapse work this way, and all three are the same
 * mechanic: a light you drag across a dark picture, and what it passes over is
 * lit. The trick the 1996 engine plays is that the lit version is a WHOLE SECOND
 * FLAT sitting in the same stage file, and the "light" is a stencil — so nothing
 * is being illuminated, a second picture is being let through a hole.
 *
 * The naming makes it plain once you have `framename`, which the BOOTFILE builds
 * as `curworldchar @ frametype @ region @ "." @ frame`. The ordinary view is
 * frametype `0`; the hidden layers take a LETTER:
 *
 *   | call site        | visible (`0`) | hidden      | aperture     | held prop       |
 *   |------------------|---------------|-------------|--------------|-----------------|
 *   | `a.shp` 1963     | `a0005.…`     | `a0005.113` | `flashmask`  | `invflashlight` |
 *   | `a.shp` 1206     | `a0001.371`   | `ab001.371` | `glowmask`   | `invglowstick`  |
 *   | `e.shp` 0463     | `e0004.…`     | `ex004.…`   | `e4.13m`     | `e4.13o`        |
 *
 * `b` for the glowstick's black-light layer, `x` for the x-ray one. Measured
 * against the discs, every hidden flat lives in the SAME stage file as the
 * visible one it is revealed through — `ab001.371` and `a0001.371` are both in
 * `a027.stg`, `ex004.001` and `e0004.001` both in `e009.stg` — so the reveal
 * needs no second stage load, which is the fact that makes this cheap.
 *
 * ## The call sequence
 *
 * From `a.shp`'s glowstick, which is the clearest of the three:
 *
 *     propvisible (me, false)
 *     plugin ("xray", "ab001.371", currentflat (), "glowmask", "invglowstick")
 *     …
 *     propxy (me, x, y)
 *     visualeffect (nodraw, 0)
 *     plugin ("xray", makepoint (x, y), curstagenum, makepoint (x, y), curstagenum)
 *     …
 *     plugin ("xray")
 *
 * Arm with four names, drive with a packed point, tear down with none — and the
 * two forms are told apart by the TYPE of the second argument, a string naming a
 * flat against a number holding a point. The trailing stage number is repeated
 * on the drive call and carries nothing this port needs; the original plugin
 * presumably used it to confirm the caller had not walked off the stage the
 * aperture was armed for.
 *
 * `aimed` is false until the first drive call, and the reveal draws nothing while
 * it is: `invpickup` arms before the pointer has been anywhere, and centring the
 * aperture on a default anchor would flash a hole in the middle of the picture.
 */
export interface XRayReveal {
  /** the flat let through the aperture — a name in the OPEN stage file */
  hidden: string;
  /** the flat it is revealed over: `currentflat()` when the reveal was armed */
  base: string;
  /** the prop whose opaque pixels ARE the aperture — a stencil, never drawn */
  mask: string;
  /**
   * the prop the player is dragging.
   *
   * Recorded and not read: this port composites props after the flat on every
   * frame, so the glowstick already lands on top of its own glow without the
   * reveal having to place it. Kept because the original was told, and because a
   * reader comparing this to the script would otherwise wonder where it went.
   */
  light: string;
  /** aperture centre in screen space, valid only once `aimed` */
  x: number;
  y: number;
  /** whether a drive call has given the aperture a position yet */
  aimed: boolean;
}

/**
 * What the plugin bus is holding right now.
 *
 * One field today. It is a class rather than a bare `session.xray` so that the
 * next plugin — `scrollflat` if the memory report is ever raised, `camera` if the
 * photographs ever get somewhere to live — has an obvious place to land, and so
 * that {@link reset} stays one call rather than a list a new field can fall off.
 */
export class PluginBus {
  /** the armed `plugin("xray", …)` reveal, or null */
  xray: XRayReveal | null = null;

  /**
   * Drop everything the bus holds.
   *
   * A reveal is script-scoped state that survives a flat change — the aperture
   * stays armed while the player drags the glowstick around one picture — so the
   * scripts disarm it themselves, and thoroughly: `invdrop`, `leaveframe` and
   * both save-game entry points all check `mirrorflat != 0` and call
   * `plugin("xray")`. This exists for the paths a script is not on: a new game,
   * a loaded one, `closestagefile`. An aperture left armed over a stage that is
   * no longer open would reveal a flat name the new stage does not have, which
   * reads on screen as nothing happening and in the log as nothing at all.
   */
  reset(): void {
    this.xray = null;
  }
}
