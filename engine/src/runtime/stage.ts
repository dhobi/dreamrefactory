import { FrameBuffer, decodeFrame, paletteToRGBA } from "../df/image";
import { StgFile, StgRegion, readStgFile, readStgRegions } from "../df/stg";
import { Frame, ScriptInstance, Value, toStr } from "./interp";
import type { GameSession } from "./session";

/**
 * The STG "stage" layer: full-screen 2D UI layers (flats) with their own
 * scripts — TAOOT's: the in-game band (main.stg), the inventory screens, the
 * deck map, and the mini-game overlays — plus the transtoflat/transfromflat overlay
 * stack, click-region routing, and flat-image decoding. Extracted from
 * GameSession, which delegates to it; the widely-shared fields (stage,
 * stageName, currentFlat, setVisible, currentThemeName, flatScripts, flatNames)
 * stay on the session and are reached through the session reference.
 */
export class StageController {
  constructor(private readonly session: GameSession) {}

  stageFile: StgFile | null = null;
  private flatImageCache = new Map<
    string,
    { pixels: Uint8Array; width: number; height: number; palette: Uint8ClampedArray }
  >();
  private regionCache = new Map<string, StgRegion[]>();

  /** engine primitive: load an STG stage and activate its first flat */
  async openStageFile(fileName: string): Promise<boolean> {
    const key = toStr(fileName).toLowerCase();
    if (this.session.stageName === key) return true;
    if (this.stageFile) await this.closeStageFile();
    // a fresh stage starts un-dimmed: clear any leftover stage CLUT dim so
    // TAOOT's darkroom mixclut("stage") (re-applied right after this in transtoflat)
    // doesn't bleed into the next stage you open (e.g. after leaving redphoto).
    this.session.onClut("stage", null);
    await this.session.ensureFile(key); // lazy browser provider: fetch before first read
    const data = this.session.files(key);
    if (!data) {
      this.session.onLog(`openstagefile: "${fileName}" not available`);
      return false;
    }
    let stg: StgFile;
    try {
      stg = readStgFile(data);
    } catch (e) {
      this.session.onLog(`openstagefile: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    this.stageFile = stg;
    this.session.stageName = key;
    /**
     * From this instant the screen is un-faded — for the same reason the stage
     * CLUT above is un-dimmed.
     *
     * `screentoblack(name, steps)` ramps a named CLUT to black — the port models
     * it as a level over the whole screen — and the name Timelapse hands it is
     * `curclutname`, which over a stage is `"stage"`. Replacing the stage file
     * replaces that palette, so a ramp against the OLD stage's cannot survive
     * into the new one; there is nothing left for it to be a ramp of.
     *
     * The interface panel is what needs this said out loud. `begininterface` is
     * `screentoblack (curclutname, 10)`, `closestagefile ()`, `openstagefile
     * ("P.Stg")`, `gotoflat (coder)`, `visualeffect (plain, 0)` — and then the
     * arriving flat's own `openflatx`. Three of the four panel flats end that
     * with `blacktoscreen`, and the PHOTO ALBUM (flat 3, container 32) does not:
     * its `openflatx` checks the film count and arms `makeloop ("flat", me,
     * "updateflat", 2)`, nothing more. So a level that outlived the stage swap
     * left the album's caption, its furniture and the photograph itself painted
     * correctly into a framebuffer nobody could see — reported from play as the
     * album being a black screen.
     *
     * `blacktoscreen` still ramps, because it reveals FROM black by definition —
     * see the note on it in builtins/scene.ts.
     *
     * ## HERE, and not before the bytes (#308)
     *
     * The clear used to be the first thing this method did, above `ensureFile` —
     * and the justification for it, that the palette it ramped against is gone,
     * is only true once the replacement is actually in hand. In TI.EXE the
     * distinction cannot arise: `openstagefile` reads the file with the
     * interpreter blocked inside it, nothing repaints, and the screen is still
     * the black `screentoblack` left until the new stage draws. Ours awaits a
     * NETWORK FETCH there, with the rAF loop compositing throughout — so
     * lifting the black first handed the screen back to `world` for the whole
     * download. First open of the map and of the save panel: fade to black, the
     * room you left painted over it again for as long as `p.stg` took to arrive,
     * then a snap back to black for `blacktoscreen` to ramp out of.
     *
     * And the post-movie hold (`fade.pendingReveal`, see ScreenDirector.
     * screenOwner) is not this method's to end at all. Opening a stage file is
     * not a script saying what the screen should look like; the four statements
     * that ARE end it, and `tickFade` lifts it when the script falls quiet.
     * TAOOT's boot is what that cost: `playmode.mov` ends, and the cast, four
     * shops and `main.stg` load before `advanceday` reaches `datebed.mov` with
     * no screen statement in between. `main.stg` is in that window, so ending
     * the hold there lit the apartment up — through `bedsit1.set`'s own load and
     * on until the date caption started — which is exactly the flash #209 was
     * about, one stage swap further along.
     */
    this.session.fade.queue.length = 0;
    this.session.fade.snapshot = null;
    this.session.fade.level = 0;
    // the container the STAGE names, not container 1 — see StgFile.mainScriptLocation
    // (this line hardcoded the index, and did not even use the constant that stood
    // beside the reader for it — #325)
    this.session.stageScript = this.session.instanceFrom(
      stg.file.containers[stg.mainScriptLocation]?.data,
      key,
    );
    this.session.refreshFallbacks();
    for (const f of stg.flats) {
      const inst = this.session.instanceFrom(stg.file.containers[f.locationScript]?.data, f.name);
      if (inst) this.session.flatScripts.set(f.name.toLowerCase(), inst);
      this.session.flatNames.push(f.name);
    }
    this.session.onLog(`stage loaded: ${key} (${stg.flats.length} flat(s))`);
    this.session.currentFlat = "none";
    // the stage's openstage handler runs first (TAOOT's map pages to the player's
    // current deck via gotopage(currentpage()) there); if it didn't pick a
    // flat, fall back to the first one
    await this.session.fireHandler(this.session.stageScript, "openstage", key);
    if (this.session.currentFlat === "none" && stg.flats.length) await this.gotoFlat(stg.flats[0].name);
    // Nothing per-stage happens here. `openstagefile` is the primitive — open the
    // file, run the stage's own openstage, land on a flat — and every stage-SPECIFIC
    // entry step is the game's `transtoflat` script's business — in TAOOT: its middle
    // switch (`sendtostage(openwireless())`), its flat switch (blkjack's `initgame`,
    // fight's `openfight`) and its entry effects (the darkroom's mixclut, the
    // trunk's trnkopen.mov). This used to mirror all three from tables of TAOOT
    // stage names, which both duplicated the script and confined the primitive to
    // one game's stages.
    return true;
  }

  /** engine primitive: close the current stage (closestagefile) */
  async closeStageFile(): Promise<void> {
    // Only the stage's own lifecycle handler. Its per-stage teardown
    // (TAOOT: `sendtostage(closewireless())`) belongs to the game's `transfromflat`,
    // which runs it BEFORE calling this — mirroring it here ran it twice.
    await this.session.fireHandler(this.session.stageScript, "closestage", this.session.stageName);
    await this.fireFlat(this.session.currentFlat, "closeflat");
    this.session.currentFlat = "none";
    this.stageFile = null;
    this.session.stageName = "none";
    this.session.stageScript = null;
    this.session.flatScripts.clear();
    this.session.flatNames = [];
    this.flatImageCache.clear();
    this.regionCache.clear();
    // An armed xray reveal names a flat in the file being closed. Timelapse's
    // own `leaveframe` disarms it on the way out of the insect room, but a stage
    // change from anywhere else does not, and a reveal held across one would
    // point at a flat the new stage has never heard of.
    this.session.plugins.reset();
    this.session.refreshFallbacks();
  }

  /**
   * Drop any pending transtoflat overlay frames. A hard navigation (loading a
   * saved game) rebuilds the screen from scratch, so an unclosed overlay stack
   * (TAOOT: the ctl.stg the load was triggered from, still remembering the room's
   * main.stg underneath) must not linger to be popped by a later transfromflat.
   *
   * The stack is the game's own `savestage1..3`/`saveflat1..3` globals now — the
   * boot's `savestages`/`restorestage` push and pop them — so clearing it means
   * clearing those, which is also what a fresh `boot()` does.
   */
  resetOverlayStack(): void {
    for (const n of [1, 2, 3]) {
      this.session.interp.globals.set(`savestage${n}`, "");
      this.session.interp.globals.set(`saveflat${n}`, "");
    }
  }

  /** resolve a flat reference — a name ("Map 3") or a 1-based index (3) */
  private resolveFlat(ref: string): string {
    const byName = this.session.flatNames.find((f) => f.toLowerCase() === ref.toLowerCase());
    if (byName) return byName;
    const idx = Number(ref);
    if (Number.isInteger(idx) && idx >= 1 && idx <= this.session.flatNames.length) {
      return this.session.flatNames[idx - 1];
    }
    return ref;
  }

  /** 1-based index of a flat (flattoindex builtin), 0 when unknown */
  flatToIndex(ref: string): number {
    const name = this.resolveFlat(ref);
    return this.session.flatNames.findIndex((f) => f.toLowerCase() === name.toLowerCase()) + 1;
  }

  /**
   * The art of the flat we are leaving, kept for the next one to be decoded over
   * — see the note in {@link flatImage}. Held here rather than read back out of
   * `currentFlat` because `gotoFlat` has already moved that on by the time
   * anything asks to be painted.
   */
  private outgoing: { pixels: Uint8Array; width: number; height: number } | null = null;

  /** engine primitive: switch the active flat (gotoflat) — by name or index */
  async gotoFlat(name: string): Promise<void> {
    const target = this.resolveFlat(toStr(name));
    this.outgoing = this.flatImage();
    await this.fireFlat(this.session.currentFlat, "closeflat");
    this.session.currentFlat = target;
    this.session.clearTextOverlay(); // a new flat starts with a blank text layer
    await this.fireFlat(target, "openflat");
  }


  /**
   * The open stage's own name — `currentstage()`'s answer, and empty when there is
   * no stage or the field was left blank (see {@link StgFile.refName}; both
   * versions carry one).
   */
  stageRefName(): string {
    return this.stageFile?.refName ?? "";
  }

  /** clickable regions of an arbitrary flat by name (current flat included) */
  private regionsFor(flatName: string): StgRegion[] {
    const stg = this.stageFile;
    if (!stg || flatName === "none") return [];
    const key = `${this.session.stageName}:${flatName}`;
    let regs = this.regionCache.get(key);
    if (!regs) {
      const flat = stg.flats.find((f) => f.name.toLowerCase() === flatName.toLowerCase());
      const data = flat && stg.file.containers[flat.locationClickLogic]?.data;
      // with the stage's OWN version: a v1 flat's region count sits at +0 of the
      // click-logic container and a v4's at +1028, so reading a Dust stage with
      // the v4 offset quietly returned no buttons at all
      regs = data ? readStgRegions(data, stg.version) : [];
      this.regionCache.set(key, regs);
    }
    return regs;
  }

  currentFlatRegions(): StgRegion[] {
    return this.regionsFor(this.session.currentFlat);
  }

  /** names of a flat's clickable regions ("buttons") — countbuttons/indextobutton */
  flatButtonNames(flatName: string): string[] {
    return this.regionsFor(flatName).map((r) => r.name);
  }

  /** a flat's named clickable region (the stage "button" system), or null */
  flatRegion(flatName: string, name: string): StgRegion | null {
    const lower = name.toLowerCase();
    return this.regionsFor(flatName).find((r) => r.name.toLowerCase() === lower) ?? null;
  }

  /**
   * Dispatch a deferred handler (mousedown/setcursor/…) to a flat's named
   * region — the "button" system stage mini-games use via sendtobutton. Like
   * a click on that region (stageClickAt), but invoked by name from a script
   * rather than resolved from a cursor position.
   */
  async sendToButton(
    flatName: string,
    regionName: string,
    handler: string,
    args: Value[],
    callerName: string,
    /** the frame a script sent it from — see {@link GameSession.sendEvent} */
    parent?: Frame,
  ): Promise<Value> {
    const stg = this.stageFile;
    if (!stg) return 0;
    const region = this.flatRegion(flatName, regionName);
    if (!region) {
      this.session.onLog(`sendtobutton: no region "${regionName}" in flat ${flatName}`);
      return 0;
    }
    const inst = this.session.instanceFrom(stg.file.containers[region.script]?.data, region.name || "region");
    if (inst && inst.script.codes.has(handler)) {
      inst.parent = this.session.flatScripts.get(this.session.currentFlat.toLowerCase()) ?? this.session.stageScript;
      // target is the ADDRESSEE, and a button region is a thing — the same value
      // stageClickAt gives this handler when the click resolves by position
      // rather than by name. It has to be: the boot dispatcher reaches every
      // button through here (`sendtobutton(currentflat(), thename, mousedown())`)
      // and those handlers are the trackbut call sites, whose shipped body reads
      // `pointinbutton(currentflat(), target, …)`. With the caller's name here
      // instead, every OK button in the game silently refused its confirm.
      const res = await this.session.interp.runHandler(inst, handler, args, {
        me: region.name,
        target: region.name,
      }, parent);
      return res.value;
    }
    // The region's own script doesn't define this handler — resolve it up the
    // containment/library chain, the way sendEvent does for scriptless targets.
    // TAOOT's INVEN.SHP handleselect confirms the OK button via `sendtobuttonfx(flat,
    // "ok", trackbut(...))`, but trackbut is a BOOTFILE helper (0002), not on the
    // "ok" region — without this fallback sendToButton returned 0, trackbut never
    // ran, and OK never registered (the bag wouldn't close). Run it on the first
    // library that has it, with me AND target = the button name so the BOOTFILE
    // trackbut's `pointinbutton(currentflat(), target, ...)` hit-tests THIS region.
    const libs: (ScriptInstance | null | undefined)[] = [
      this.session.flatScripts.get(this.session.currentFlat.toLowerCase()),
      this.session.stageScript,
      ...this.session.bootScripts,
    ];
    for (const lib of libs) {
      if (!lib || !lib.script.codes.has(handler)) continue;
      const res = await this.session.interp.runHandler(lib, handler, args, {
        me: region.name,
        target: region.name,
      }, parent);
      return res.value;
    }
    return 0;
  }

  /**
   * Route a click on a full-screen overlay stage (e.g. TAOOT's deck map) to the
   * region it lands in: hit-test the current flat's click-logic rects (Y-first) and
   * run that region's mousedown script — gotopage(n) for the deck buttons,
   * exitmap for OK, jumpbaby(...) for the red areas. Returns true if handled.
   */
  async stageClickAt(x: number, y: number): Promise<boolean> {
    const stg = this.stageFile;
    if (!stg) return false;
    const hit = this.currentFlatRegions().find(
      (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
    );
    if (!hit) return false;
    const region = this.session.instanceFrom(stg.file.containers[hit.script]?.data, hit.name || "region");
    // A region with no backing script is a bare hotspot. Two things may still
    // want the click: the flat/stage main can DISPATCH it by target (TAOOT's
    // fusebox fuse regions carry no script of their own — the FUSE.STG main
    // switches that fuse light->off keyed on `target`), and the prop beneath
    // handles the rest (its shop main does the off->on half). Run the stage-main
    // dispatch here, then fall through (return false) so propAt runs too. The
    // handlers switch on target, so a stage whose main doesn't know this hotspot
    // (the gramophone's horn/wax drop-zones) no-ops and the drag prop still gets it.
    if (!region) {
      const flat0 = this.session.flatScripts.get(this.session.currentFlat.toLowerCase());
      this.session.setPointer(x, y);
      for (const link of [flat0, this.session.stageScript]) {
        if (!link || !link.script.codes.has("mousedown")) continue;
        try {
          await this.session.interp.runHandler(link, "mousedown", [hit.name], { me: link.name, target: hit.name });
        } catch (e) {
          this.session.onLog(`stage hotspot ${hit.name}: ${(e as Error).message}`);
        }
      }
      return false;
    }
    // The region HAS its own script — but a visible prop with its own mousedown
    // script is a foreground sprite drawn ON TOP of the flat art, so when one
    // covers this point it owns the click and the region beneath it must not
    // steal it. The matryoshka (TAOOT's patty.stg): the doll prop overlaps the doll1/dial
    // hotspots that revealed it, so every "open a layer" click on the doll's left
    // half was being swallowed by those regions (the doll only ever closed).
    // Defer to the prop path (return false → the viewer's propAt dispatch runs).
    // Only applies to scripted regions: scriptless fusebox fuses (handled above)
    // cooperate with their prop and must not be diverted.
    const over = this.session.propRuntime.propAt(x, y, null, false);
    if (over && this.session.propScripts.get(over.group.name.toLowerCase())?.script.codes.has("mousedown")) {
      return false;
    }
    // resolve unqualified calls through the current FLAT script first (TAOOT's
    // map flat defines jumpbaby for its red areas), which chains to the stage main
    const flat = this.session.flatScripts.get(this.session.currentFlat.toLowerCase());
    region.parent = flat ?? this.session.stageScript;
    this.session.setPointer(x, y);
    this.session.interp.eventConsumed = false;
    // region → flat → stage main, with target = the region name: a button
    // region may only set the cursor and leave the mousedown to the stage main,
    // keyed by target (TAOOT: trunk's gramdrawerbut -> sendtoprop(gramdrawer, open())).
    const chain: ScriptInstance[] = [];
    for (const link of [region, flat, this.session.stageScript]) {
      if (link && !chain.includes(link)) chain.push(link);
    }
    try {
      await this.session.runHandlerChain(chain, "mousedown", [hit.name], (link) => ({
        me: link.name,
        target: hit.name,
      }));
    } catch (e) {
      // an error stops the walk, exactly as the per-link break did
      this.session.onLog(`stage region ${hit.name}: ${(e as Error).message}`);
    }
    return true;
  }

  /** the script that should receive a keyboard event on an overlay stage:
   *  the current flat if it defines keydown (TAOOT: wireless TX lives in the flat),
   *  else the stage main (the deck map's keydown lives there). */
  keydownTarget(): ScriptInstance | null {
    const flat = this.session.flatScripts.get(this.session.currentFlat.toLowerCase());
    if (flat?.script.codes.has("keydown")) return flat;
    if (this.session.stageScript?.script.codes.has("keydown")) return this.session.stageScript;
    return null;
  }

  /**
   * A flat's own lifecycle event — `openflat` / `closeflat` — sent along the
   * CHAIN rather than straight at the flat's script.
   *
   * It used to go straight there, so a flat with no handler of its own was the
   * end of it. That is right for the first two games and wrong for the third,
   * because a boot library may hold the DEFAULT: Timelapse's does, and its
   * defaults are what keep the game's own idea of where it is up to date —
   *
   *     code openflat ()
   *         if intransition & currentflat () = transnameopen
   *             baseflat = currentflat ()
   *             PatchEnterFrame ()
   *
   * with `closeflat` clearing `baseflat` and calling `PatchLeaveFrame` on the way
   * out. Those two patches are what fire a flat's `enterframe`/`leaveframe`, and
   * `baseflat` is what `flatstartanim` animates.
   *
   * So without this, a move WITHIN a stage left `baseflat` pointing at whichever
   * flat the stage was entered on, and no frame ever got its enterframe. The sea
   * off the opening cliffs shows it: frame 196 walks the cels of frame 192's
   * water — the animation the last `enterframe` armed — while navigation keeps
   * putting frame 196 back, so the water jumps between two views. It also means
   * `leaveframe` never stopped an animation, which is what `flatstopanim` is for.
   *
   * Titanic and Dust cannot be affected: neither BOOTFILE defines `openflat` or
   * `closeflat` at all, and the boot is only consulted for a handler it has.
   */
  private async fireFlat(name: string, handler: string): Promise<void> {
    if (!name || name === "none") return;
    await this.session.sendEvent("sendtoflat", name, handler, [], name);
  }

  /**
   * A flat's decoded art, by name — the CURRENT flat unless one is asked for.
   *
   * The parameter is Timelapse's `plugin("xray", …)`, which reveals a second flat
   * through a moving aperture (engine/src/runtime/plugins.ts). That flat is never
   * the one on screen and is never switched to, so it cannot come through
   * `gotoFlat`; and it is always in the OPEN stage file, which is what lets it
   * come through here rather than through a second stage load.
   *
   * Resolved through {@link resolveFlat} so the caller may pass an index, and
   * cached per stage-and-flat like the current one — the reveal asks for the same
   * hidden flat on every frame of a drag.
   */
  /**
   * What a VARIANT flat's delta is authored against: the variant before it.
   *
   * Timelapse names a flat `i{region}.{frame}` and a variant of one
   * `i{region}.{frame}.{n}` — three components, not two — and those variants are
   * a CHAIN: `.1` is a delta over the base picture, `.2` over `.1`, and an
   * animation run walks `.2 … .54` the same way. Seeding from the flat that was
   * on screen (see below) is right for a run, because a run is walked in order
   * and the previous cel IS what you arrived from. It is wrong the moment a
   * script JUMPS into the middle of a chain, and Timelapse does that on purpose.
   *
   * The lantern's instruction sheet is the worked example, and it was reported:
   * the table flat `i0001.605` carries a `LanternInst` region whose mousedown is
   *
   *     if gHasMatches = 0 & gLanternLit = 0
   *         gotoflat ("i0001.605.1")     ← the sheet, matchbox still on it
   *     else
   *         gotoflat ("i0001.605.2")     ← the sheet, matchbox gone
   *
   * so once the player has taken the matches the game jumps straight from the
   * TABLE to `.2`. Decoded over the table, `.2` changes 4,771 pixels of it and
   * leaves the other 302,429 — the player clicks the instructions and gets the
   * table back, which is exactly what the screenshot showed. Decoded over `.1`
   * (itself decoded over the base) it is the sheet, and matches the shipped art
   * to the pixel.
   *
   * Recursive, and the cache is what makes that cheap: walking an animation
   * forward finds its predecessor already decoded, and a cold jump into `.28`
   * builds the 28 it needs once. Returns null for anything that is not a variant,
   * or whose predecessor is not in this stage, so a two-component flat keeps the
   * behaviour below.
   */
  private deltaBase(
    name: string,
  ): { pixels: Uint8Array; width: number; height: number } | null {
    // three components: `A.B.n`. Two would match the frame number itself
    // (`i0001.605` -> "i0001" and 605), which would chain every flat in the file
    // backwards through its neighbours.
    const m = /^(.+\..+)\.(\d+)$/.exec(name);
    if (!m) return null;
    const n = Number(m[2]);
    const previous = n > 1 ? `${m[1]}.${n - 1}` : m[1];
    if (!this.stageFile?.flats.some((f) => f.name === previous)) return null;
    return this.flatImage(previous);
  }

  flatImage(
    name = this.session.currentFlat,
  ): { pixels: Uint8Array; width: number; height: number; palette: Uint8ClampedArray } | null {
    const stg = this.stageFile;
    if (!stg || name === "none") return null;
    const target = name === this.session.currentFlat ? name : this.resolveFlat(name);
    const key = `${this.session.stageName}:${target}`;
    let img = this.flatImageCache.get(key);
    if (!img) {
      const flat = stg.flats.find((f) => f.name === target);
      if (!flat) return null;
      try {
        /**
         * Decode into a buffer holding the flat that is ON SCREEN, not a blank
         * one — because a flat's art may be a DELTA against it.
         *
         * `engine/src/df/image.ts` says so at the top: "several row modes / run
         * modes copy pixels from the previous image, i.e. whatever the target
         * buffer already contains. Callers must therefore decode frame sequences
         * in order into the same persistent FrameBuffer." This one decoded every
         * flat into a fresh `new FrameBuffer()`, which is exactly the mistake that
         * warning describes.
         *
         * It never showed on the first two games because neither animates a
         * stage: their flats are all whole pictures, and a whole picture writes
         * every pixel, so what the buffer held first cannot matter. Timelapse
         * animates 156 stages this way — its BOOTFILE calls them "flat delta
         * animation handlers" in a comment — and `flatstartanim(2, 54, …)` walks
         * `i0001.100.2 … .54` as deltas over the shot they belong to. Decoded
         * cold, only the pixels that CHANGED had a value and the rest came out
         * index 0: the birds took off over a black rectangle.
         *
         * Seeding from the OUTGOING flat rather than tracking runs explicitly is
         * what keeps this safe for the other two: a keyframe overwrites the seed
         * completely, so it renders identically whatever was underneath, and only
         * art that deliberately leaves pixels alone can tell the difference.
         */
        const fb = new FrameBuffer();
        const under = this.deltaBase(target) ?? this.outgoing;
        if (under) {
          // `ensure` FIRST: a fresh FrameBuffer's `pixels` is zero-length until it
          // is sized, so seeding before this writes nothing at all and the delta
          // still lands on an empty screen.
          fb.ensure(under.width, under.height);
          fb.pixels.set(under.pixels.subarray(0, Math.min(under.pixels.length, fb.pixels.length)));
        }
        const d = decodeFrame(stg.file.containers[flat.locationFrame].data, fb);
        img = {
          pixels: fb.pixels.slice(0, d.width * d.height),
          width: d.width,
          height: d.height,
          palette: paletteToRGBA(stg.paletteRaw, 256),
        };
        this.flatImageCache.set(key, img);
      } catch (e) {
        this.session.onLog(`flat image ${key}: ${(e as Error).message}`);
        return null;
      }
    }
    return img;
  }
}
