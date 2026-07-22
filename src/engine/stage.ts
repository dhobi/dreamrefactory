import { FrameBuffer, decodeFrame, paletteToRGBA } from "../df/image";
import { StgFile, StgRegion, readStgFile, readStgRegions } from "../df/stg";
import { ScriptInstance, Value, toStr } from "./interp";
import type { GameSession } from "./session";

/**
 * Stages whose entry handler lives on the FLAT (not the stage main), mirroring
 * the per-stage switch in the boot's transtoflat(): opening the stage file must
 * then call this handler on the current flat. blkjack deals the first hand;
 * fight starts the brawl. (Stage-main setup uses the open<basename> convention
 * handled separately in openStageFile.)
 */
const STAGE_FLAT_ENTRY: Record<string, string> = {
  "blkjack.stg": "initgame",
  "fight.stg": "openfight",
};

/**
 * Canonical basename for a stage's entry/exit handlers + its shop. Usually just
 * the filename stem (wireless.stg → "wireless" → openwireless/closewireless,
 * wireless.shp/hidewireless). The exception is the darkroom: BOTH photo.stg and
 * redphoto.stg (white-light and red-light views of the same room) reuse
 * photo.shp and the openphoto/closephoto/hidephoto/showphoto handlers — the
 * boot's transtoflat/transfromflat switch routes both there — so redphoto maps
 * to "photo".
 */
function stageBase(stageName: string): string {
  const base = stageName.replace(/\.stg$/, "");
  return base === "redphoto" ? "photo" : base;
}

/**
 * The STG "stage" layer: full-screen 2D UI layers (flats) with their own
 * scripts — the in-game band (main.stg), the inventory screens, the deck map,
 * and the mini-game overlays — plus the transtoflat/transfromflat overlay
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
    // a fresh stage starts un-dimmed: clear any leftover stage CLUT dim so the
    // darkroom's mixclut("stage") (re-applied right after this in transtoflat)
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
    this.session.stage = this.session.instanceFrom(stg.file.containers[1]?.data, key);
    this.session.refreshFallbacks();
    for (const f of stg.flats) {
      const inst = this.session.instanceFrom(stg.file.containers[f.locationScript]?.data, f.name);
      if (inst) this.session.flatScripts.set(f.name.toLowerCase(), inst);
      this.session.flatNames.push(f.name);
    }
    this.session.onLog(`stage loaded: ${key} (${stg.flats.length} flat(s))`);
    this.session.currentFlat = "none";
    // the stage's openstage handler runs first (the map pages to the player's
    // current deck via gotopage(currentpage()) there); if it didn't pick a
    // flat, fall back to the first one
    if (this.session.stage?.script.codes.has("openstage")) {
      try {
        await this.session.interp.runHandler(this.session.stage, "openstage", [], { me: key, target: "" });
      } catch (e) {
        this.session.onLog(`${key}.openstage: ${(e as Error).message}`);
      }
    }
    if (this.session.currentFlat === "none" && stg.flats.length) await this.gotoFlat(stg.flats[0].name);
    // The boot's transtoflat() dispatches a per-stage entry handler after
    // opening the file: sendtostage(open<basename>()) — e.g. openwireless()
    // opens the stage's shop + track and sets up its props. We mirror that
    // dispatch generically (the map uses openstage instead, so this only
    // fires when a matching handler exists).
    const entry = `open${stageBase(key)}`;
    if (entry !== "openstage" && this.session.stage?.script.codes.has(entry)) {
      try {
        await this.session.interp.runHandler(this.session.stage, entry, [], { me: key, target: "" });
      } catch (e) {
        this.session.onLog(`${key}.${entry}: ${(e as Error).message}`);
      }
    }
    // The boot's transtoflat() ALSO runs a per-stage FLAT entry handler for a
    // few stages (BOOTFILE transtoflat switch): blkjack deals the opening hand
    // via sendtoflat(currentflat(), initgame()), fight starts via openfight().
    // Unlike the open<basename> setup above these live on the FLAT, not the
    // stage main — without mirroring them, entering blkjack.stg from the Buick
    // conversation opened the table but never dealt a hand.
    const flatEntry = STAGE_FLAT_ENTRY[key];
    if (flatEntry) await this.fireFlat(this.session.currentFlat, flatEntry);
    // The boot's transtoflat() also darkens the darkroom on entry
    // (`case "redphoto.stg": mixclut("stage","black",0,255,245)`): with the
    // white light off it's black until you switch on the red safelight (the
    // switch toggles the stage CLUT itself). Handling photos is gated on the
    // safelight being on, so this darkness is the cue to find the switch. Mirror
    // that one entry effect (openphoto has already set whitelight + props).
    if (
      key === "redphoto.stg" &&
      toStr(this.session.interp.globals.get("whitelight") ?? 0) === "off" &&
      !this.session.propRuntime.get("redlamp")?.visible
    ) {
      this.session.onClut("stage", { lo: 0, hi: 255, amt: 245 });
    }
    return true;
  }

  /** engine primitive: close the current stage (closestagefile) */
  async closeStageFile(): Promise<void> {
    // mirror the per-stage entry dispatch: close<basename>() tears down the
    // stage's shop + track (e.g. closewireless -> closeshopfile/closetrackfile)
    const exit = `close${stageBase(this.session.stageName)}`;
    if (exit !== "closestage" && this.session.stage?.script.codes.has(exit)) {
      try {
        await this.session.interp.runHandler(this.session.stage, exit, [], { me: this.session.stageName, target: "" });
      } catch (e) {
        this.session.onLog(`${this.session.stageName}.${exit}: ${(e as Error).message}`);
      }
    }
    if (this.session.stage?.script.codes.has("closestage")) {
      try {
        await this.session.interp.runHandler(this.session.stage, "closestage", [], {
          me: this.session.stageName,
          target: "",
        });
      } catch (e) {
        this.session.onLog(`${this.session.stageName}.closestage: ${(e as Error).message}`);
      }
    }
    await this.fireFlat(this.session.currentFlat, "closeflat");
    this.session.currentFlat = "none";
    this.stageFile = null;
    this.session.stageName = "none";
    this.session.stage = null;
    this.session.flatScripts.clear();
    this.session.flatNames = [];
    this.flatImageCache.clear();
    this.regionCache.clear();
    this.session.refreshFallbacks();
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

  /**
   * Stack of stages an overlay was opened OVER (transtoflat), restored in
   * reverse by transfromflat — mirrors the boot's savestage1..3/saveflat1..3.
   * Each frame remembers the stage, its active flat, and the ambient theme so a
   * nested overlay — the inventory bag (inven1.stg) opened MID-puzzle to swap an
   * item — returns to the exact prior screen (the opened matryoshka on "patty 3")
   * instead of re-initialising the puzzle to its first flat. A single string
   * couldn't express the patty.stg → inven1.stg → patty.stg nesting.
   */
  private stageStack: { name: string; flat: string; theme: string }[] = [];

  /**
   * Save + hide the underlying stage's props before an overlay covers it (the
   * boot's transtoflat calls sendtoshop(hide<stage>()) here). Each puzzle shop
   * stashes its prop visibility (patty.shp hidepatty -> saveprops1) so the
   * matching show<stage> can restore it after the overlay closes. main.stg is
   * special: its band lives on house.shp via hide/showinterface.
   */
  private async saveStageProps(stageName: string): Promise<void> {
    if (!stageName || stageName === "none") return;
    if (stageName === "main.stg") {
      await this.session.sendEvent("sendtoshop", "house.shp", "hideinterface", [], "transtoflat");
      return;
    }
    const base = stageBase(stageName);
    if (this.session.shopMain(`${base}.shp`)?.script.codes.has(`hide${base}`)) {
      await this.session.sendEvent("sendtoshop", `${base}.shp`, `hide${base}`, [], "transtoflat");
    }
  }

  /** restore what saveStageProps hid, once the previous stage is re-open */
  private async restoreStageProps(stageName: string): Promise<void> {
    if (!stageName || stageName === "none") return;
    if (stageName === "main.stg") {
      await this.session.sendEvent("sendtoshop", "house.shp", "showinterface", [], "transfromflat");
      return;
    }
    const base = stageBase(stageName);
    if (this.session.shopMain(`${base}.shp`)?.script.codes.has(`show${base}`)) {
      await this.session.sendEvent("sendtoshop", `${base}.shp`, `show${base}`, [], "transfromflat");
    }
  }

  /**
   * transtoflat: open a stage full-screen (e.g. the deck map) over the game,
   * remembering the stage it replaced so transfromflat can restore it.
   */
  async transToFlat(fileName: string): Promise<void> {
    // Save + hide the underlying stage's props (the boot's transtoflat does
    // sendtoshop(hide<stage>()) before closing), then push it — with its active
    // flat and ambient theme — so transfromflat returns to the exact prior
    // screen. Overlay stages don't go through changeset, so setupsound never
    // runs for them; fencing's openstage does playnewtheme("fence.trk"), and the
    // remembered theme lets transfromflat restore the room's ambient after.
    await this.saveStageProps(this.session.stageName);
    this.stageStack.push({
      name: this.session.stageName,
      flat: this.session.currentFlat,
      theme: this.session.currentThemeName,
    });
    // Entering an overlay presents fresh content, so lift any leftover
    // transition-black from the previous screen. HOUSE fades the blackjack
    // dealer puppet out — screentoblack("puppet") — and THEN transtoflat()s to
    // the game; the reveal is a wipe visualeffect we render as instant, so
    // without this the game table stayed black. The flat's own openstage may
    // re-establish a fade (bomb: blackscreen + intro movie), which still runs
    // after this because openStageFile fires the openstage lifecycle.
    this.session.fade.level = 0;
    this.session.fade.queue.length = 0;
    this.session.fade.snapshot = null;
    if (await this.openStageFile(fileName)) {
      this.session.setVisible = false;
      // Mirror the boot's transtoflat (BOOTFILE 0002:1418): a flat opened while a
      // conversation is live hides the puppet close-up, so the flat shows and its
      // own input loop takes the clicks (the purser "check in" hand-select runs
      // inven.shp's handleselect() over inven1.stg; blackjack reveals the table).
      // transFromFlat restores it. Without this the puppet stayed drawn on top and
      // ate every click — you could open the inventory but never hand an item over.
      const pup = this.session.puppet;
      if (pup) pup.visible = false;
    }
  }

  /**
   * transfromflat: leave the overlay stage and restore the in-game stage. The
   * boot's full version does this via restorescreen(); we mirror its essential
   * step — completing a pending map jump by changeset()-ing to the destination
   * the red-area click stashed in jumpset/jumpscene/jumpview.
   */
  async transFromFlat(): Promise<void> {
    const frame = this.stageStack.pop();
    const prev = frame?.name ?? "none";
    // The set shows through only under main.stg's in-game band or when no stage
    // remains; every other stage is a full-screen overlay that must keep the set
    // hidden. Returning from the inventory bag to the matryoshka (patty.stg) is
    // an overlay-over-overlay, so setVisible stays false — otherwise the A14 room
    // rendered behind the doll-tray flat (the overlap the swap showed).
    this.session.setVisible = prev === "none" || prev === "" || prev === "main.stg";
    if (prev && prev !== "none") {
      // Re-open the underlying stage (the boot re-runs openstagefile too), then
      // restore its saved flat and prop visibility so a mid-puzzle overlay comes
      // back to the exact screen it left — the opened matryoshka, not "patty 1".
      if (prev !== this.session.stageName) {
        await this.openStageFile(prev);
        if (frame && frame.flat && frame.flat !== "none") await this.gotoFlat(frame.flat);
      }
      await this.restoreStageProps(prev);
    } else {
      await this.closeStageFile();
    }
    // Mirror restorescreen (BOOTFILE 0002:1650): returning to the in-game main
    // stage with a conversation still loaded brings the puppet back — the purser
    // resumes after the inventory hand-select so you can pick the "check <item>"
    // bevel that actually gifts it. Only for main.stg (the boot gates on the same
    // condition), so an overlay-over-overlay return doesn't flash the puppet.
    const pup = this.session.puppet;
    if (pup && this.session.setVisible && this.session.stageName === "main.stg") {
      pup.visible = true;
    }
    // restore the ambient theme if the overlay stage replaced it with its own
    // (fence.trk). Only when it actually changed, so closing a themeless overlay
    // (the deck map) doesn't restart the room's music. If the prior bank is gone
    // just stop the overlay theme — better silence than the wrong track leaking.
    const savedTheme = frame?.theme ?? "none";
    if (this.session.currentThemeName !== savedTheme) {
      const theme = savedTheme !== "none" && savedTheme !== "" ? this.session.audioLib.theme(savedTheme) : null;
      if (theme) {
        this.session.audio.play("theme", theme, { loop: true });
        this.session.currentThemeName = savedTheme;
      } else {
        this.session.audio.halt("theme");
        this.session.currentThemeName = "none";
      }
    }
    const jumpset = toStr(this.session.interp.globals.get("jumpset") ?? "");
    if (jumpset) {
      const jumpscene = toStr(this.session.interp.globals.get("jumpscene") ?? "");
      const jumpview = toStr(this.session.interp.globals.get("jumpview") ?? "");
      this.session.interp.globals.set("jumpset", "");
      await this.session.runGlobal("changeset", [jumpset, jumpscene, jumpview]);
    }
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
  ): Promise<Value> {
    const stg = this.stageFile;
    if (!stg) return 0;
    const region = this.flatRegion(flatName, regionName);
    if (!region) {
      this.session.onLog(`sendtobutton: no region "${regionName}" in flat ${flatName}`);
      return 0;
    }
    const inst = this.session.instanceFrom(stg.file.containers[region.script]?.data, region.name || "region");
    if (!inst || !inst.script.codes.has(handler)) return 0;
    inst.parent = this.session.flatScripts.get(this.session.currentFlat.toLowerCase()) ?? this.session.stage;
    const res = await this.session.interp.runHandler(inst, handler, args, {
      me: region.name,
      target: callerName,
    });
    return res.value;
  }

  /**
   * Route a click on a full-screen overlay stage (the deck map) to the region
   * it lands in: hit-test the current flat's click-logic rects (Y-first) and
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
    // want the click: the flat/stage main can DISPATCH it by target (the
    // fusebox's fuse regions carry no script of their own — the FUSE.STG main
    // switches that fuse light->off keyed on `target`), and the prop beneath
    // handles the rest (its shop main does the off->on half). Run the stage-main
    // dispatch here, then fall through (return false) so propAt runs too. The
    // handlers switch on target, so a stage whose main doesn't know this hotspot
    // (the gramophone's horn/wax drop-zones) no-ops and the drag prop still gets it.
    if (!region) {
      const flat0 = this.session.flatScripts.get(this.session.currentFlat.toLowerCase());
      this.session.setPointer(x, y);
      for (const link of [flat0, this.session.stage]) {
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
    // steal it. The matryoshka (patty.stg): the doll prop overlaps the doll1/dial
    // hotspots that revealed it, so every "open a layer" click on the doll's left
    // half was being swallowed by those regions (the doll only ever closed).
    // Defer to the prop path (return false → the viewer's propAt dispatch runs).
    // Only applies to scripted regions: scriptless fusebox fuses (handled above)
    // cooperate with their prop and must not be diverted.
    const over = this.session.propRuntime.propAt(x, y, null, false);
    if (over && this.session.propScripts.get(over.group.name.toLowerCase())?.script.codes.has("mousedown")) {
      return false;
    }
    // resolve unqualified calls through the current FLAT script first (it
    // defines jumpbaby for the map's red areas), which chains to the stage main
    const flat = this.session.flatScripts.get(this.session.currentFlat.toLowerCase());
    region.parent = flat ?? this.session.stage;
    this.session.setPointer(x, y);
    this.session.interp.eventConsumed = false;
    // region → flat → stage main, with target = the region name: a button
    // region may only set the cursor and leave the mousedown to the stage main,
    // keyed by target (trunk's gramdrawerbut -> sendtoprop(gramdrawer, open())).
    const chain: ScriptInstance[] = [];
    for (const link of [region, flat, this.session.stage]) {
      if (link && !chain.includes(link)) chain.push(link);
    }
    for (const link of chain) {
      if (!link.script.codes.has("mousedown")) continue;
      try {
        const res = await this.session.interp.runHandler(link, "mousedown", [hit.name], {
          me: link.name,
          target: hit.name,
        });
        if (this.session.interp.eventConsumed || (res.handled && !res.passed)) break;
      } catch (e) {
        this.session.onLog(`stage region ${hit.name}: ${(e as Error).message}`);
        break;
      }
    }
    return true;
  }

  /** the script that should receive a keyboard event on an overlay stage:
   *  the current flat if it defines keydown (wireless TX lives in the flat),
   *  else the stage main (the deck map's keydown lives there). */
  keydownTarget(): ScriptInstance | null {
    const flat = this.session.flatScripts.get(this.session.currentFlat.toLowerCase());
    if (flat?.script.codes.has("keydown")) return flat;
    if (this.session.stage?.script.codes.has("keydown")) return this.session.stage;
    return null;
  }

  private async fireFlat(name: string, handler: string): Promise<void> {
    const inst = this.session.flatScripts.get(name.toLowerCase());
    if (!inst || !inst.script.codes.has(handler)) return;
    try {
      await this.session.interp.runHandler(inst, handler, [], { me: inst.name, target: "" });
    } catch (e) {
      this.session.onLog(`${name}.${handler}: ${(e as Error).message}`);
    }
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
        const d = decodeFrame(stg.file.containers[flat.locationFrame], fb);
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
