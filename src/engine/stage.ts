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
    this.session.stageScript = this.session.instanceFrom(stg.file.containers[1]?.data, key);
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

  /** engine primitive: switch the active flat (gotoflat) — by name or index */
  async gotoFlat(name: string): Promise<void> {
    const target = this.resolveFlat(toStr(name));
    await this.fireFlat(this.session.currentFlat, "closeflat");
    this.session.currentFlat = target;
    this.session.clearTextOverlay(); // a new flat starts with a blank text layer
    await this.fireFlat(target, "openflat");
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
      regs = data ? readStgRegions(data) : [];
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

  private fireFlat(name: string, handler: string): Promise<void> {
    const inst = this.session.flatScripts.get(name.toLowerCase());
    return this.session.fireHandler(inst, handler, inst?.name ?? name, `${name}.${handler}`);
  }

  /** decoded image of the active flat (background layer), cached */
  flatImage(): { pixels: Uint8Array; width: number; height: number; palette: Uint8ClampedArray } | null {
    const stg = this.stageFile;
    if (!stg || this.session.currentFlat === "none") return null;
    const key = `${this.session.stageName}:${this.session.currentFlat}`;
    let img = this.flatImageCache.get(key);
    if (!img) {
      const flat = stg.flats.find((f) => f.name === this.session.currentFlat);
      if (!flat) return null;
      try {
        const fb = new FrameBuffer();
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
