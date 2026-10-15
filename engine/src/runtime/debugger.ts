/**
 * The script debugger of TI.EXE: its "Debug" window, which no player ever sees.
 *
 * BeginGameSession (0x432170) opens it as the third channel, type 3
 * (InitDebugger, 0x40cb40), and every turn of the main loop resets it and hides
 * it again (message 9). Nothing outside the debugger's own code writes its
 * state: `debugger()` is a bare return (0x43e530), and the interpreter never
 * feeds it a frame, a depth or a listing. It is CyberFlix's in-house tool, left
 * linked in. tl.exe carries the same window (its strings "Step In", "Clear All",
 * "GLOBALS" … are TI.EXE's).
 *
 * The port keeps it the same way: opened when the session begins, closed
 * when it ends (message 4), hidden throughout. The main loop's per-turn
 * message 9 is not sent: it resets state that nothing else changes. What a click or a key
 * would do in it is here too, as state, because the exe has it. Its drawing is
 * not: the window is never shown. Nor is the text of its listing (see
 * {@link ScriptDebugger.rebuildListing}).
 *
 * Addresses are the October 1996 TI.EXE's (the en and ru trees).
 */

/** a rect as the exe keeps one, {top, left, bottom, right} */
export interface DebugRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** run modes ([0x460dc6]): go, or run until an error (the "Error" button, key E) */
const GO = 0;
const UNTIL_ERROR = 0xffff;
/** panes ([0x460dc2]): 0 GLOBALS, 1 LOCALS, 2 SCRIPTS */
const LOCALS = 1;
const SCRIPTS = 2;

/** the height of the button strip across the top of the window (0x3d) */
const BUTTON_STRIP = 0x3d;
/** GetSystemMetrics(SM_CXVSCROLL) on the Windows 95 the game was made for */
const CX_VSCROLL = 16;

/**
 * A button of the 3×3 grid, ComputeButtonRect (0x40cac0): rows 19 px apart from
 * y = 3, columns 66 px apart from x = 6, each 60 × 15.
 */
export function debuggerButtonRect(row: number, column: number): DebugRect {
  const top = row * 0x13 + 3;
  const left = column * 0x42 + 6;
  return { top, left, bottom: top + 0xf, right: left + 0x3c };
}

/** the engine faults the window can raise, codes as FatalError takes them */
export class DebuggerFault extends Error {
  constructor(readonly code: number) {
    super(`fatal error ${code} (the Debug window)`);
  }
}

export class ScriptDebugger {
  /** is the window open (channel C's resource, [0x460ad0] + 0x12)? */
  open = false;
  visible = false;
  /** where the window sits on screen (message 7) */
  viewport: DebugRect = { top: 0, left: 0, bottom: 0, right: 0 };
  /** the caret's byte offset in the listing, -1 for none (0x460dbc) */
  caretOffset = -1;
  /** call depth (0x460dc4) and the depth a step waits for (0x460dc8) */
  depth = 0;
  targetDepth = 0;
  /** {@link GO} or {@link UNTIL_ERROR} */
  runMode = GO;
  /** 0 none, 1 step, 2 step in, 3 step out ([0x460dc0]) */
  stepMode = 0;
  /** 0 GLOBALS, 1 LOCALS, 2 SCRIPTS */
  pane = SCRIPTS;
  /** the text the window would list, lines ending in CR; nothing fills it */
  listing = "";
  breakpointCount = 0;
  watchCount = 0;
  /** message 5's nesting count (0x460dcc) */
  windowRefs = 0;

  /**
   * InitDebugger (0x40cb40): empty breakpoints, watches and listing, the reset
   * state, and the window opened as channel C and sized by message 7 to a box
   * 204 px plus a scroll bar wide and 200 high, its centre 100 px right of the
   * scene's, its bottom 100 px above the scene's. `scene` is the scroll rect
   * ([0x48a2c0]). Opening it twice is fatal 0x112b.
   */
  init(scene: DebugRect): void {
    this.breakpointCount = 0;
    this.watchCount = 0;
    this.listing = "";
    this.reset();
    if (this.open) throw new DebuggerFault(0x112b);
    this.windowRefs = 0;
    this.open = true;
    this.message(7, this.centred(scene));
  }

  /** ShutdownDebugger (0x40cb10): its three resources freed, at EndGameSession */
  shutdown(): void {
    this.listing = "";
    this.breakpointCount = 0;
    this.watchCount = 0;
  }

  /** ResetDebuggerState (0x40cc80) */
  reset(): void {
    this.caretOffset = -1;
    this.depth = 0;
    this.runMode = GO;
    this.pane = SCRIPTS;
    this.stepMode = 0;
    this.listing = "";
  }

  /** message 0x10's arithmetic, and InitDebugger's: half of SM_CXVSCROLL + 204 either side */
  private centred(scene: DebugRect): DebugRect {
    const centre = ((scene.left + scene.right) >> 1) + 100;
    const half = (CX_VSCROLL + 0xcc) >> 1;
    const bottom = scene.bottom - 100;
    return { top: bottom - 200, left: centre - half, bottom, right: centre + half };
  }

  /**
   * DebuggerChannelHandler (0x40bad0), for the messages that do something
   * without a screen: 4 end of session, 5/6 the window's reference count, 7
   * place it, 9 reset and hide it, 0x10 centre it on `scene` again, 2 a key
   * (see {@link key}), 0 a click (see {@link click}). 1 (draw) and 3 (refresh)
   * only paint, and 8 (idle) has no arm.
   */
  message(msg: number, param?: DebugRect | number | { x: number; y: number }): void {
    switch (msg) {
      case 0:
        this.click(param as { x: number; y: number });
        return;
      case 2:
        this.key(param as number);
        return;
      case 4:
        if (!this.open) throw new DebuggerFault(0x1129);
        this.open = false;
        return;
      case 5:
        this.windowRefs++;
        return;
      case 6:
        if (this.windowRefs === 0) throw new DebuggerFault(0x112a);
        this.windowRefs--;
        return;
      case 7:
        this.viewport = { ...(param as DebugRect) };
        return;
      case 9:
        this.reset();
        this.visible = false;
        return;
      case 0x10:
        this.viewport = this.centred(param as DebugRect);
        return;
    }
  }

  /**
   * DispatchDebuggerKey (0x40be20), case-blind: A clears every breakpoint and
   * watch; E runs until an error and G just goes, both hiding the window; S, I
   * and O step, step in and step out. 3 shows the SCRIPTS pane.
   */
  key(cmd: number): void {
    const c = cmd === 3 ? 3 : String.fromCharCode(cmd).toUpperCase();
    switch (c) {
      case 3:
        // the pane is left at LOCALS after the listing is rebuilt for SCRIPTS
        // (0x40be20's first arm), unless it was SCRIPTS already
        if (this.pane !== SCRIPTS) {
          this.pane = SCRIPTS;
          this.rebuildListing();
          this.pane = LOCALS;
        }
        return;
      case "A":
        this.breakpointCount = 0;
        this.watchCount = 0;
        return;
      case "E":
        this.visible = false;
        this.stepMode = 0;
        this.runMode = UNTIL_ERROR;
        return;
      case "G":
        this.visible = false;
        this.stepMode = 0;
        this.runMode = GO;
        return;
      case "I":
        this.targetDepth = this.depth + 1;
        this.stepMode = 2;
        this.runMode = GO;
        return;
      case "O":
        this.targetDepth = this.depth - 1;
        this.stepMode = 3;
        this.runMode = GO;
        return;
      case "S":
        this.targetDepth = this.depth;
        this.stepMode = 1;
        this.runMode = GO;
        return;
    }
  }

  /**
   * HandleDebuggerClick (0x40c1b0), the point in window coordinates. Above the
   * strip's bottom edge it is a button, hit inside its rect inset by one pixel
   * (and, in the exe, released there too: TrackButtonPress). Below it, a line of
   * the listing, of which there are none.
   */
  click(at: { x: number; y: number }): void {
    if (at.y >= BUTTON_STRIP) return; // a listing line: CountDebuggerListingLines is 0
    const hit = (row: number, column: number): boolean => {
      const r = debuggerButtonRect(row, column);
      return at.y >= r.top + 1 && at.y < r.bottom - 1 && at.x >= r.left + 1 && at.x < r.right - 1;
    };
    for (let i = 0; i < 3; i++) {
      if (hit(0, i)) {
        this.pane = i;
        this.rebuildListing();
        return;
      }
    }
    for (let i = 0; i < 3; i++) {
      if (hit(1, i)) {
        this.stepMode = i + 1;
        if (this.stepMode === 1) this.targetDepth = this.depth;
        if (this.stepMode === 2) this.targetDepth = this.depth + 1;
        if (this.stepMode === 3) this.targetDepth = this.depth - 1;
        this.runMode = GO;
        return;
      }
    }
    for (let i = 0; i < 3; i++) {
      if (!hit(2, i)) continue;
      if (i === 2) {
        this.breakpointCount = 0;
        this.watchCount = 0;
        return;
      }
      this.visible = false;
      this.stepMode = 0;
      this.runMode = i === 0 ? GO : UNTIL_ERROR;
      return;
    }
  }

  /**
   * RebuildDebuggerListing (0x40ccc0) lists the globals' properties
   * (ListNodePropertiesToDebugger, 0x40ced0), the locals of the debugger's frame
   * or the current script's source (0x40d0a0). The frame and its locals are
   * never set in the exe. The GLOBALS listing would have content, but only a
   * click or key in the window asks for it, and the window is never shown. The
   * port does not build that text.
   */
  private rebuildListing(): void {
    this.listing = "";
  }
}
