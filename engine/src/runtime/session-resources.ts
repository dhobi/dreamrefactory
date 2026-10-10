import { SetFile, readSetFile, readStarPath } from "../df/set";
import { detectVersion } from "../df/version";
import { readSetFileAsV4 } from "../df/set-v1-to-v4";
import { readShpFile } from "../df/shp";
import { readCstFile } from "../df/cst";
import { ScriptInstance, toStr } from "./interp";
import type { GameSession } from "./session";

/**
 * The files a game opens session-wide and the scripts they carry: the set file
 * by name, sound tracks, casts (with their characters' scripts and
 * `actorinstance` copies) and shops (with their prop scripts), plus the lookups
 * that find a script among them. Owned by GameSession, which forwards the
 * public methods and tables here.
 */

/**
 * The loaded title's boot-level UI shops — the ones whose screen props belong on
 * top of the room view rather than only over their own overlay
 * ({@link LoadedShop.persistent}). One of the few pieces of game knowledge the
 * engine still carries, so each title it is asked to run has to be listed: the
 * interface band and the inventory, whatever that title calls them.
 *
 * TAOOT's are `.shp`; **Dust's are the same two names with `.prp`**, and its
 * BOOTFILE opens exactly those (`openshopfile("house.prp")`,
 * `openshopfile("inven.prp")`) — so listing only the Titanic pair left Dust with
 * an interface band and an inventory that were correctly placed, correctly
 * visible, and neither drawn over the room nor clickable in it. Which is what a
 * picked-up object looked like: `addinven` puts the held item on the panel at
 * (316, 320) beside the avatar, and it sat there unreachable, so the bone could
 * never be dragged back out to give to anyone.
 *
 * Which shops these are is a fact about the shops, so it is applied wherever one
 * of them is opened ({@link GameSession.openShop}) and not by whoever does the
 * opening. Setting it only in {@link GameSession.loadBootResources} — the port's
 * stand-in for the full game's `boot()` — would hold only while the port is the
 * only thing that ever opens them. TAOOT's 1996 demo opens them itself, from its
 * menu's `dodemo()`, and its interface band would come up empty: every prop
 * visible and correctly placed, none of them drawn, because the shop they live
 * in was opened by the game rather than on its behalf.
 */
const BOOT_UI_SHOPS = new Set(["inven.shp", "house.shp", "inven.prp", "house.prp"]);

export class SessionResources {
  constructor(private readonly session: GameSession) {}


  /**
   * Canonical name of the set being opened = the FILE basename. The
   * internal setName field can differ (TAOOT's DECKBD.SET says "decka"), but
   * scripts bind actors/props/crickets to the name they opened.
   */
  currentSetFile = "";

  /**
   * The file a DreamFactory 5 script means by a bare name. RedJack.exe's typed
   * open (0x43c840, behind opencastfile, openstagefile, openshopfile,
   * openpuppetfile, opensetfile and opentrackfile) appends the type's extension
   * when the name has no `.` before a four- or three-letter extension
   * (0x43c88e, which counts in the Pascal string past its length byte), so `runpuppet ("lyle1", "savednick")` — liznite's Node54 —
   * opens `lyle1.pupp`. The older engines are handed their names unchanged.
   */
  typedName(fileName: string, ext: "cast" | "stag" | "shop" | "pupp" | "sett" | "trak"): string {
    const name = toStr(fileName);
    if (!this.session.isV5) return name;
    const n = name.length;
    if (n >= 5 && (name[n - 5] === "." || name[n - 4] === ".")) return name;
    return `${name}.${ext}`;
  }

  /**
   * DreamFactory 5's `endanim`: an animation has played through, and the thing
   * playing it hears so. RedJack's casts and shops chain their animations on it
   * — Lyle's `butt pick` → `sit down` → `crouch`, Bone's `idle` back to `stand`,
   * and liznite.shop's `mark crate`, whose `endanim` is what draws the X on the
   * crate the day ends in. RedJack.exe names it in its event table (0x4b9990,
   * the fifteenth). A prop hears it at the last frame of a view that plays once
   * (PropState.playsOnce), where it holds, and only while shown — a prop put away
   * is not animating. An actor hears it from Acto.c's service (0x408481): once,
   * at the last step of a pose that plays once (CastPose.playsOnce), shown or
   * not. The cannon's dinghies are what a pose going round would get wrong: an
   * explosion's `endanim` hides the dinghy and counts it sunk (cannon.cast), and
   * a second telling counted the same wreck again. The older engines have no
   * such event, and their scripts never answer it.
   */
  endAnim(cmd: "sendtoactor" | "sendtoprop", names: string[]): void {
    if (!this.session.isV5) return;
    for (const name of names) {
      const key = name.toLowerCase();
      // an actor hears it hidden or not (RedJack.exe 0x408481 asks only the flag)
      if (cmd === "sendtoprop" && !this.session.propRuntime.get(key)?.visible) continue;
      const inst = cmd === "sendtoactor" ? this.castScripts.get(key) : this.propScripts.get(key);
      if (!inst?.script.codes.has("endanim")) continue;
      void this.session.track(this.session.sendEvent(cmd, key, "endanim", [], "anim"), `endanim ${key}`);
    }
  }

  /** engine primitive behind boot's changeset(): switch to another set */
  async openSetFile(fileName: string, sceneName = "", viewName = ""): Promise<void> {
    fileName = this.session.typedName(fileName, "sett");
    const key = fileName.toLowerCase();
    this.session.onLog(`opensetfile("${key}", "${sceneName}", "${viewName}")`);
    this.session.lastRotation = this.session.currentRotation ? this.session.currentRotation() : null;
    this.currentSetFile = key.replace(/\.set$/, "");
    // DreamFactory 5 opens every set visible: the loader RedJack.exe calls for
    // `opensetfile` (0x43f6e0) writes 1 to the set's open flag and to its
    // visible flag beside it (0x43f8e8, 0x43f8ed), whatever the last set was.
    // advanceday closes liznite before the crate's stage, so the stage's
    // `setvisible (true)` has no set to act on — and without this the ship
    // opened hidden, and no key reached it.
    if (this.session.isV5) this.session.setVisible = true;
    await this.session.onSetChange(key, sceneName.toLowerCase(), viewName.toLowerCase());
  }

  /**
   * Try to parse a set through the provider (null if not available yet).
   *
   * A DreamFactory 1 set is translated into the v4 shape rather than read into
   * one of its own — see {@link file://../df/set-v1-to-v4.ts}. The viewer, the
   * props, the actors and the transition modes are all built on `SetFile`, and a
   * v1 set carries the same facts in a flatter arrangement; arranging them the
   * way the viewer reads them is one file, and a second viewer would be a second
   * copy of every one of those behaviours.
   */
  loadSet(fileName: string): SetFile | null {
    const data = this.session.files(fileName.toLowerCase());
    if (!data) return null;
    try {
      return detectVersion(data) === 1 ? readSetFileAsV4(data) : readSetFile(data);
    } catch (e) {
      this.session.onLog(`${fileName}: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Remember a set's authored routes, now that the set is in hand — the route
   * half of the `starRegistry` line in the viewer's bind, and called from
   * {@link SetScripts}'s constructor, which is the one place both the page and a
   * headless binding pass through.
   *
   * Cheap: the corpus's biggest table is twelve routes of a few points each, and
   * a set is bound once per visit. A route already known is replaced rather than
   * doubled — Dust's `town.set` and `nite.set` are the same streets by day and by
   * night and carry the same twelve pairs, so the one last walked in is the one
   * kept, which is also the one whose geometry is on screen.
   */
  rememberStarPaths(set: SetFile): void {
    for (const p of set.starPaths) {
      const a = p.a.toLowerCase();
      const b = p.b.toLowerCase();
      // an unpaired star is not a route, and neither engine's lookup treats one
      // as a match (see startPathWalk)
      if (!a || !b || !p.container) continue;
      const points = readStarPath(set.file.containers, p.container, set.version);
      if (points.length < 2) continue;
      this.session.starPathRegistry.set(`${a}|${b}`, { a, b, points });
    }
  }

  async openTrackFile(fileName: string): Promise<boolean> {
    fileName = this.session.typedName(fileName, "trak");
    const key = toStr(fileName).toLowerCase();
    // A title may name theme tracks by REGION rather than by set — TAOOT names
    // them by deck: recept1c's theme is deckd.trk, halla's is decka.trk (see
    // its BOOTFILE setupsound/themetype). The set-change prefetch only pulls
    // <setName>.trk, so the real theme bank is usually absent here. Fetch it on
    // demand (browser provider), exactly as opensetfile/puppets/casts do —
    // otherwise playnewtheme finds no theme and the room is silent (or the
    // wrong theme keeps playing).
    await this.session.ensureFile(key);
    const data = this.session.files(key);
    if (!data) {
      this.session.onLog(`opentrackfile: "${fileName}" not available`);
      return false;
    }
    const opened = this.session.audioLib.openBank(key, data);
    const source = this.session.captionSources.get(key);
    if (opened && source && "puppet" in source) {
      const lines = await this.session.puppetCtrl.spokenWords(source.puppet);
      for (const clip of this.session.audioLib.soundNames(key)) {
        const text = lines.get((source.line?.(clip) ?? clip).toLowerCase());
        if (text) this.session.soundWords.set(clip, { who: source.who, text });
      }
    }
    return opened;
  }

  /** prop-group script instances of loaded shops, by lowercase prop name */
  readonly propScripts = new Map<string, ScriptInstance>();
  readonly shopMains = new Map<string, ScriptInstance | null>();

  /** per-character script instances of loaded casts, by actor name */
  readonly castScripts = new Map<string, ScriptInstance>();
  readonly castMains = new Map<string, ScriptInstance | null>();

  /**
   * Give an `actorinstance(src, dst)` copy its own script, so events can reach
   * it — a copy shares the source's sprite AND its behaviour.
   *
   * `castScripts` is keyed by CAST MEMBER name and built once at cast load, so a
   * copy had no entry at all: `sendtoactor("stok3", setupactor("boil"))` found
   * no chain and was dropped as "target not loaded", and the copy was therefore
   * never placed, scaled or made visible. TAOOT's boiler rooms are one member
   * (`stok1`) plus up to nine copies of him, so eight of the nine stokers were
   * missing from the shovel line (user-reported). The lifeboat crowd on the boat
   * deck is built the same way.
   *
   * A copy gets its OWN instance rather than a second reference to the source's:
   * the two share the parsed script, but `me` comes from the instance's name, and
   * every line of the shared handler is written against it — `actorpose(me, …)`,
   * `makeloop("actor", me, "stokidle", …)`. Pointing the copy at the source's
   * instance would make all ten stokers drive `stok1`.
   */
  instanceCastScript(src: string, dst: string): void {
    const from = this.castScripts.get(src.toLowerCase());
    if (!from) return;
    const key = dst.toLowerCase();
    const inst = new ScriptInstance(key, from.script);
    inst.parent = from.parent; // the cast main: stdactor, endwalk, runpuppet
    this.castScripts.set(key, inst);
    this.instancedActors.add(key);
  }

  /**
   * Drop the script of an `actordelete`d copy.
   *
   * Only a COPY's: a cast member deleted from the world keeps its script, which
   * is what lets TAOOT's stokers put themselves back — `putdownactor` deletes
   * stok2…stok10 and the next `setupactor` re-instances them from `stok1`, who
   * was never a copy and must still answer.
   */
  dropInstancedScript(name: string): void {
    const key = name.toLowerCase();
    if (!this.instancedActors.delete(key)) return;
    this.castScripts.delete(key);
  }

  /** which castScripts entries came from actorinstance() rather than a cast */
  private readonly instancedActors = new Set<string>();

  /**
   * Load a CST cast file session-wide: register its characters (actors) and
   * their scripts. Idempotent — sets call opencastfile("extra.cst") freely.
   */
  async openCastFile(fileName: string): Promise<boolean> {
    fileName = this.session.typedName(fileName, "cast");
    const key = fileName.toLowerCase();
    if (this.castMains.has(key)) return true;
    await this.session.ensureFile(key);
    const data = this.session.files(key);
    if (!data) {
      this.session.onLog(`opencastfile: "${fileName}" not available`);
      return false;
    }
    let cst;
    try {
      cst = readCstFile(data);
    } catch (e) {
      this.session.onLog(`opencastfile: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    this.session.actorRuntime.addCast(key, cst);
    // the container the CAST names, not container 1 — see CstFile.mainScriptLocation
    const main = this.session.instanceFrom(cst.file.containers[cst.mainScriptLocation]?.data, key);
    this.castMains.set(key, main);
    for (const m of cst.members) {
      const inst = this.session.instanceFrom(cst.file.containers[m.scriptLocation]?.data, m.name);
      if (inst) {
        inst.parent = main; // stdactor/stdscale/endwalk live in the cast main
        this.castScripts.set(m.name, inst);
      }
    }
    await this.session.fireHandler(main, "opencast", key, `opencast ${key}`);
    /**
     * ...and `openactor` on each CHARACTER.
     *
     * Not a Dust special case: TI.EXE carries the dispatch strings for all four
     * of this lifecycle — `", opencast()"`, `", openactor()"`, `", closecast()"`,
     * `", closeactor()"`, one after the other in its literal pool — so the
     * DreamFactory 4 engine fires the per-character halves too. Titanic simply
     * never defines them (0 of its scripts, in any of the six editions; the only
     * files on those discs that contain the word are the engine binaries), which
     * is why the port could go this long having implemented one of the four.
     *
     * Dust defines it six times, and every one of them exists to make its own
     * copies — `extra.cst`'s horse is one cast member and three animals:
     *
     *     code openactor ()
     *         actorinstance ("horse1", "horse2")
     *         actorinstance ("horse1", "horse3")
     *
     * Without it `new.flt`'s `sendtocast("gang", initactors())` reaches
     * `sendtoactor("horse2", setupactor("street"))` and the port answers "target
     * not loaded". After `opencast`, which is the
     * order TI.EXE lists them in: the cast's own open first, then its characters.
     *
     * The two closing halves stay unimplemented on purpose — no script on either
     * disc defines them, so firing them would add a dispatch nothing can receive.
     * RedJack's casts do define `closecast`, and DreamFactory 5 fires it
     * (closeCastFile).
     */
    for (const m of cst.members) {
      await this.session.fireHandler(this.castScripts.get(m.name), "openactor", m.name);
    }
    this.session.onLog(`cast loaded: ${key} (${cst.members.length} characters)`);
    return true;
  }

  async closeCastFile(fileName: string): Promise<void> {
    /**
     * DreamFactory 5 closes a cast by the name it was opened by, less its
     * extension — `closecastfile ("cannon")`, `closecastfile ("bfight")` — as
     * it opens one (typedName), and tells it first: RedJack.exe's dispatch
     * strings include `", closecast()"`. The cannon's and the street fight's
     * `closecast` put the boot's scroll `margin` back to 100; without them it
     * stayed at the 310 they set, and on RedJack's beach every sprite right of
     * the middle sat in a margin a click scrolls instead of reaching. And the
     * casts themselves were never closed: the dinghies went on sailing, asking
     * for stars in whatever room was open.
     */
    const key = (this.session.isV5 ? this.session.typedName(fileName, "cast") : fileName).toLowerCase();
    const main = this.session.isV5 ? this.castMains.get(key) : undefined;
    if (main) await this.session.fireHandler(main, "closecast", key, `closecast ${key}`);
    const cast = this.session.actorRuntime.casts.get(key);
    if (cast) {
      for (const m of cast.cst.members) this.castScripts.delete(m.name);
      // ...and the actorinstance() copies, which are not members and so are not
      // on that list. removeCast below drops them from the world by cast; their
      // scripts have to go with them or the next cast to use those names
      // (stok2…stok10, life1…) inherits the old one.
      for (const [name, a] of this.session.actorRuntime.actors) {
        if (a.cast === cast) this.session.dropInstancedScript(name);
      }
    }
    this.castMains.delete(key);
    this.session.actorRuntime.removeCast(key);
  }

  /** main script of a loaded shop (sendtoshop target), by file name */
  shopMain(name: string): ScriptInstance | null {
    return this.shopMains.get(name.toLowerCase()) ?? null;
  }

  /** session-scoped sendto* targets (usable before any set is open) */
  /**
   * The script a PROP answers on — its GROUP's, whatever the instance is called.
   *
   * `propScripts` is keyed by group, because that is where a sprite's script
   * lives, and for an ordinary prop the two names are the same. They are not for
   * a `propinstance` copy: Timelapse's lantern is six props out of one group
   * ("GasKnob", "PumpHandle", …), all sharing the Lantern script and told apart
   * inside it by `me`. So `sendtoprop ("GasKnob", mousedown (…))` has to find the
   * group's script under a name the group does not have — otherwise the click
   * resolves nowhere and the lamp does nothing.
   *
   * See {@link PropInstance.name}.
   */
  propScriptFor(name: string): ScriptInstance | null {
    const own = this.propScripts.get(name);
    if (own) return own;
    const group = this.session.propRuntime.get(name)?.group.name.toLowerCase();
    return group && group !== name ? this.propScripts.get(group) ?? null : null;
  }

  /** an open cast by the name it was opened under, or that name without its extension */
  castMainFor(name: string): ScriptInstance | null {
    const lower = name.toLowerCase();
    const stem = (n: string): string => n.replace(/\.[a-z0-9]{1,4}$/, "");
    const exact = this.castMains.get(lower);
    if (exact) return exact;
    for (const [key, inst] of this.castMains) if (stem(key) === stem(lower)) return inst;
    return null;
  }

  findGlobalInstance(name: string): ScriptInstance | null {
    const lower = name.toLowerCase();
    const exact =
      this.session.puppet?.scripts.get(lower) ??
      this.propScriptFor(lower) ??
      this.castScripts.get(lower) ??
      this.shopMains.get(lower) ??
      this.castMains.get(lower) ??
      this.session.flatScripts.get(lower) ??
      (this.session.stageScript?.name.toLowerCase() === lower ? this.session.stageScript : null) ??
      (lower === "boot" ? this.session.boot : null);
    if (exact) return exact;
    /**
     * Then the same lookup ignoring the FILE EXTENSION, because a script may
     * address a shop or a cast either way and both are the same file.
     *
     * TAOOT writes `sendtoshop("inven.shp", initprops())` and Dust writes
     * `sendtoshop("inven", addinven("helpbut"))` — its boot's very last line —
     * against files opened as `inven.shp` and `inven.prp`. Keyed on the name it
     * was opened under, only the first of those resolves, and the other is
     * dropped as "target not loaded": measured, Dust's boot lost `initactors`,
     * `initprops` and `addinven` that way, which is its whole opening inventory.
     *
     * Extension-insensitive rather than extension-STRIPPING: the exact match
     * above still wins, so a file genuinely named for its stem is unaffected, and
     * this only answers the question the exact match could not.
     */
    const stem = (n: string): string => n.toLowerCase().replace(/\.[a-z0-9]{1,4}$/, "");
    const want = stem(lower);
    for (const table of [this.shopMains, this.castMains, this.session.flatScripts]) {
      for (const [key, inst] of table) if (stem(key) === want) return inst;
    }
    return null;
  }

  /**
   * The key an open shop is held under, for a name a script closes it by: the
   * name itself — and in DreamFactory 5 only, then the name without its
   * extension, as {@link sendEvent}'s lookup allows, and the name the shop
   * gives itself. RedJack's
   * fight lessons close their shops that way: `sdcombat.shop`, `sdocombat.shop`
   * and `sscombat.shop` all call themselves "combat" and their opponents "enemy1"
   * or "enemy2", and each stage's `closestage` says `closeshopfile ("combat")`.
   * Matched by file name only, none of them ever closed, and by the third lesson
   * three `nick`s and three `enemy`s were answering one click.
   *
   * Not DreamFactory 5 only: Timelapse opens `e024.shp` and closes it as
   * `closeshopfile ("e024")`, and closes each world's shop by its letter
   * (`closeshopfile (curworldchar)`, whose refName is "E"), and Dust says
   * `closeshopfile ("tumble")`. Matched exactly, none of those ever closed — the
   * snakes game's `snake4` stayed on the screen, invisible and in the way of the
   * pyramid door's fourth wheel, and every world left its props behind it.
   */
  openShopKey(name: string): string {
    const lower = name.toLowerCase();
    const shops = this.session.propRuntime.shops;
    if (shops.has(lower)) return lower;
    const stem = (n: string): string => n.replace(/\.[a-z0-9]{1,4}$/, "");
    for (const key of shops.keys()) if (stem(key) === stem(lower)) return key;
    for (const [key, shop] of shops) if (shop.shp.refName.toLowerCase() === lower) return key;
    return lower;
  }

  /**
   * Load a SHP file session-wide: register its props + prop scripts and fire
   * its openshop handler. Shops opened by the boot script (house.shp,
   * inven.shp) stay loaded across set changes.
   */
  async openShop(fileName: string): Promise<boolean> {
    fileName = this.session.typedName(fileName, "shop");
    const key = fileName.toLowerCase();
    // Already loaded: re-run its openshop handler without rebuilding the props
    // (which would drop their state). A stage opens its shop on entry via
    // open<basename>() — TAOOT: openwireless -> openshopfile("wireless.shp") —
    // and openshop() ends by pushing the per-entry view setup to the active
    // flat (setupsmallprops). Re-firing it here makes that run in the stage's
    // context even when the shop was first opened at set-load.
    if (this.shopMains.has(key)) {
      await this.session.fireHandler(this.shopMains.get(key), "openshop", key, `openshop ${key} (re-entry)`);
      return true;
    }
    await this.session.ensureFile(key); // lazy browser provider: fetch before first read
    const data = this.session.files(key);
    if (!data) {
      this.session.onLog(`openshopfile: "${fileName}" not available`);
      return false;
    }
    let shp;
    try {
      shp = readShpFile(data);
    } catch (e) {
      this.session.onLog(`openshopfile: ${fileName}: ${(e as Error).message}`);
      return false;
    }
    this.session.propRuntime.addShop(key, shp);
    // a boot-UI shop's screen props draw over the room view, however it was
    // opened — by the port's stand-in boot or by the game's own openshopfile
    const loaded = this.session.propRuntime.shops.get(key);
    if (loaded && BOOT_UI_SHOPS.has(key)) loaded.persistent = true;
    const main = this.session.instanceFrom(shp.file.containers[shp.mainScriptLocation]?.data, key);
    this.shopMains.set(key, main);
    for (const g of shp.groups) {
      const inst = this.session.instanceFrom(shp.file.containers[g.scriptContainerLocation]?.data, g.name);
      if (inst) {
        inst.parent = main; // unqualified calls resolve via the shop main
        this.propScripts.set(g.name.toLowerCase(), inst);
      }
    }
    /**
     * Each prop's own `openprop` — the shop-open lifecycle handler, and the prop
     * twin of `openstage`/`openflat`/`openshop`. Nothing in either corpus CALLS
     * it (unlike `initprop`, which the set scripts send themselves:
     * `sendtoprop ("door", initprop ())`), so unless the engine fires it, what it
     * sets up never happens.
     *
     * All six in Dust are structural, and they are the props that come in pairs:
     *
     *     code openprop ()                  / / HOUSE.PRP, the dung
     *         propinstance ("dung1", "dung2")
     *         propzclip (me, 16)
     *
     * plus powderkeg2/3, buildrand2/3, table2 and two more `propzclip`s. Unfired,
     * the second of each pair does not exist, and the engine says so out loud
     * (#290) — `sendtoprop("dung2", setupprop(..)) — target not loaded`, from
     * `initprops` addressing a prop whose maker never ran. Titanic
     * defines none, so this is Dust's alone until Timelapse says otherwise.
     *
     * Before the shop's own `openshop`: a group that makes an instance is making
     * something the shop may then address by name, and the order that cannot be
     * wrong is the one where it exists first. (Nothing in the corpora needs it
     * either way — Dust's `house.prp` has no `openshop` handler at all.)
     */
    for (const g of shp.groups) {
      const inst = this.propScripts.get(g.name.toLowerCase());
      if (inst?.script.codes.has("openprop")) {
        await this.session.fireHandler(inst, "openprop", g.name, `openprop ${g.name}`);
      }
    }
    await this.session.fireHandler(main, "openshop", key, `openshop ${key}`);
    this.session.onLog(`shop loaded: ${key} (${shp.groups.length} props)`);
    return true;
  }

  async closeShop(fileName: string): Promise<void> {
    const key = this.openShopKey(fileName);
    const main = this.shopMains.get(key);
    if (main) {
      try {
        await this.session.interp.runHandler(main, "closeshop", [], { me: key, target: "" });
      } catch {
        /* tolerated */
      }
    }
    this.shopMains.delete(key);
    const shop = this.session.propRuntime.shops.get(key);
    if (shop) {
      for (const g of shop.shp.groups) this.propScripts.delete(g.name.toLowerCase());
    }
    this.session.propRuntime.removeShop(key);
  }
}
