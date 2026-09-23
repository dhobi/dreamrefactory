/**
 * Titanic's free-roam page — the guided tour, with every door answering.
 *
 * The ship already has a free-roam mode and it is not a mod: `playmode.mov` is a
 * two-button menu, `boot()` reads which half was clicked with `actionframe(1)`,
 * and the second one sets `tour = true`. What that opens is the whole point of
 * this page:
 *
 *   - `advancetour()` puts the story to `mission = -1` and resets every actor
 *     and every prop, so no scene is half-played and nobody is standing where a
 *     mission left them;
 *   - `mapdisabled()` opens with `if tour → return false`, so the deck map works
 *     in every room with no bag and no watch;
 *   - `house.shp`'s `initinterface` hands over the map and the ship outright;
 *   - and eighteen door hotspots take a `tour` branch, most of which simply
 *     open — the boatswain, Morrow and Smethurst are all stepped around.
 *
 * This page is that mode, entered directly (`<meta name="start-mode"
 * content="tour">` — see `startsInTour` in main.ts) rather than by hitting the
 * right half of a movie.
 *
 * ## The eight rooms the tour keeps shut
 *
 * Walking the graph of the ship's 271 set-to-set trips with `mission = -1`
 * reaches 48 of the 56 rooms. The other eight are not an oversight; six of them
 * are a deliberate `if tour` arm in a door's own script that knocks and stops:
 * Sasha's cabin (A-14), Conk's (B-59), Charlotte's (B-70), the two C-deck cabins
 * and the 1st Class Lounge. (The last two are different in kind and no door
 * reaches them: `deckbd2` is the flooded boat deck the `mission >= 4` arm picks,
 * and `bedsit1` is the London prologue, which has no door in the entire corpus.)
 *
 * So this page adds exactly one thing to the shipped tour: when you click a door
 * and the game refuses, it opens it. Not a teleport and not a room list — the
 * door swings, and the ↑ that walks you through is the game's own, landing in
 * the scene and view the game chose. See `taoot/src/freeroam/doors.ts` for how
 * the refusal is detected and which doorway is picked.
 *
 * ## It listens to the engine, not to the pointer
 *
 * The one input this page takes is `session.onHotspotClick`, which the engine
 * fires from the bottom of the hotspot dispatch chain once every handler in it
 * has run. Listening for `pointerdown` instead was wrong twice over, and both
 * showed up on a phone first: a finger is ambiguous until it moves, so
 * TouchGestures holds the press back for 220 ms, and a page that judged on
 * pointerdown ran BEFORE the game — opening the door, and then watching the
 * game's own `setupprop` arrive and restart the animation from shut. The same
 * listener could not tell a tap on a door from a swipe that merely started on
 * one, so walking away from a door opened it.
 */
import {
  doorSpot,
  isDoorHotspot,
  openIfRefused,
  pickDoorway,
  stepIfRefused,
  type DoorSession,
  type HotspotClick,
} from "./freeroam/doors";

/** the handle `taoot/src/main.ts` publishes once the game is up */
interface Dbg {
  /** the live SetViewer, or null until the boot has activated a set */
  viewer: unknown;
  session: DoorSession & {
    currentSetName: string;
    currentSceneName(): string;
    currentViewName(): string;
    /** the CD the boot mounted, by its own label — `setpath`'s `currentcd()` */
    mountedCd: string;
    /** the engine's own "a hotspot was pressed, and it is finished" */
    onHotspotClick: ((hit: HotspotClick & { consumed: boolean }) => void) | null;
    /** ...and the same for a key the open set has answered */
    onSetKey:
      | ((press: { key: string; set: string; scene: string; view: string; consumed: boolean }) => void)
      | null;
  };
}

type Roam = Dbg["session"];

/**
 * Wait for the game.
 *
 * A viewer is the signal, as it is on the developer page: `window.dbg` is
 * published from main.ts's first lines, so the handle exists long before there
 * is a room to click a door in. The fallback after the wait is to install
 * anyway — an edition that activates no set has no doors either, and a listener
 * on an empty ship costs nothing.
 */
async function booted(): Promise<Dbg | null> {
  let dbg: Dbg | undefined;
  for (let i = 0; i < 1200; i++) {
    dbg = (window as unknown as { dbg?: Dbg }).dbg;
    if (dbg?.session && dbg.viewer) return dbg;
    await new Promise((r) => setTimeout(r, 50));
  }
  return dbg ?? null;
}

/** what the line under the screen says when nothing has just happened */
const TOUR_LINE = "guided tour — every door opens";

/**
 * Is this press "walk forward"?
 *
 * Three gestures mean it and they arrive under two names. The arrow key and a
 * swipe up both come through as `uparrow`; the movement LETTER comes through as
 * itself, and which letter that is belongs to the game rather than to the page —
 * `boot()` sets `keynorth = "w"` beside `keyeast` and `keywest`, and a script
 * may move it. So it is read rather than written down here, with the shipped
 * value as the fallback for a boot that has not got that far.
 */
const isForward = (s: Roam, key: string): boolean => {
  if (key === "uparrow") return true;
  const north = s.interp.globals.get("keynorth");
  return key.toLowerCase() === String(north || "w").toLowerCase();
};

/** which CD is mounted, from the label `setpath` wrote */
const disc = (s: Roam): 1 | 2 => (/2\s*$/.test(s.mountedCd) ? 2 : 1);

void (async () => {
  const dbg = await booted();
  if (!dbg?.session) throw new Error("freeroam: the game never came up");
  const session = dbg.session;

  // ---- the line under the screen ----
  const note = document.getElementById("roamnote");
  const say = (text: string): void => {
    if (note) note.textContent = text;
  };
  say(TOUR_LINE);

  /**
   * A door press, once the game has finished answering it.
   *
   * Nothing is queued and nothing is guarded against re-entry, because the hook
   * fires from the END of the dispatch: a second press cannot arrive while the
   * first is still being answered, and by the time this runs the handler's own
   * `setupprop` and `initprop` have both already happened.
   *
   * SPACE comes through here too, without a listener of its own — BOOTFILE's
   * `keydown` finds the view's `door`/`locked`/`knock` painting and sends it a
   * `mousedown` through `sendtopainting`, which is the same chain a click takes.
   */
  /**
   * ...and the step behind a door the corridor refuses.
   *
   * One room in the ship needs this and it is the 1st Class Lounge, whose ↑ is
   * eaten by a guard above the door rather than by the door. The press has to be
   * the player's own — door open, then ↑ — so this waits for the engine to
   * report the key it has finished answering, and takes the step the script
   * below that guard would have taken.
   *
   * The hook rather than a `keydown` listener for the reason the door uses one:
   * a swipe up on a phone never produces a DOM key at all, and a listener would
   * be ahead of the dispatch even when it did.
   */
  session.onSetKey = (press): void => {
    if (!isForward(session, press.key)) return;
    // the view's door hotspot, which is what this is the other half of
    const spot =
      doorSpot(press.set, press.scene, press.view, "door", disc(session)) ??
      doorSpot(press.set, press.scene, press.view, "knock", disc(session));
    if (!spot) return;
    void stepIfRefused(session, {
      set: press.set,
      scene: press.scene,
      view: press.view,
      paint: spot.paint,
      disc: disc(session),
    })
      .then((out) => {
        if (out.stepped) say(`through to ${out.stepped}`);
      })
      .catch((e: Error) => say(`step: ${e.message}`));
  };

  session.onHotspotClick = (hit): void => {
    if (!isDoorHotspot(hit.paint)) return;
    void openIfRefused(session, { ...hit, disc: disc(session) })
      .then((out) => {
        if (out.opened) say(out.to ? `opened ${out.opened} — ${out.to}` : `opened ${out.opened}`);
        // both ways a door leads nowhere, said plainly rather than by opening it
        // onto a wall: D-19 has no room behind it, and the lounge's step is
        // refused above the door in a tour
        else if (out.skipped === "leads-nowhere" || out.skipped === "no-doorway") {
          say("there is no way through this one");
        } else say(TOUR_LINE);
      })
      .catch((e: Error) => say(`door: ${e.message}`));
  };

  // published for the browser suite, which drives the same two decisions this
  // page makes rather than a copy of them
  (window as unknown as { roam?: unknown }).roam = {
    spot: () =>
      doorSpot(
        session.currentSetName,
        session.currentSceneName(),
        session.currentViewName(),
        "door",
        disc(session),
      ),
    pick: () => {
      const s = doorSpot(
        session.currentSetName,
        session.currentSceneName(),
        session.currentViewName(),
        "door",
        disc(session),
      );
      return s ? pickDoorway(s, session.interp.globals) : null;
    },
  };
})();
