/**
 * A player for the whole game, with no shortcuts: every gesture goes through
 * the page's own door (src/game/input.ts), as a click or a key.
 *
 *   - films and briefings: Esc
 *   - the Mart (before a day, after a lost craft, and the weapons ship in
 *     flight): what is empty bought at the best tier the cash covers, then
 *     upgrades, then what has run low, a reserve kept for the repair bay
 *   - the repair bay: the shields and the engines mended
 *   - COPILOT SELECTION: the best copilot of those who are in (see COPILOTS)
 *   - the other screens: CONTINUE
 *   - a flight: the three COPILOT buttons pressed (a lost craft's new one comes
 *     with them off, 0x415f51), and the copilot flies it — and the guns: with
 *     ARMS CONTROL on the player's own clicks in the view fire nothing. With one
 *     pod to go and the shields down, NAVIGATION is let go of until the repair
 *     bay has been (holdsLastPod). At the boss the copilot waits a cell short
 *     of the beacon (0x406361), diagonal to the boss where neither sees the
 *     other; after a while at rest there the player steps on into its street.
 *
 * Why the day is long: an enemy carries a pod one time in eight (0x40cc37,
 * while fewer than two lie about), and PODS empties at 29 of them on
 * Intermediate (0x4380 / `[0x43cf62]`), so a day is some 230 kills.
 */
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { JumpRaven } from "./game/game";
import type { Input } from "./game/input";
import type { World } from "./game/combat/world";
import { UP } from "./game/flight";
import { cell, PRICES, worth } from "./game/mart";
import { portrait } from "./game/pilots";
import { SCORE_BUTTONS } from "./game/data";
import { AMMO_FULL, KINDS } from "./game/records";

/** where each screen's CONTINUE is, for the screens with nothing to choose */
const CONTINUE = { x: 8 + 50, y: 329 + 16 };
/**
 * Cash kept back at the Mart: none for a weapon that is empty — the guns are
 * worth more than the fuel (the fuel man fills the tank for a point each 0x56,
 * fuel.ts) and the repairs they might have paid for, over twenty games a side —
 * and two of the repair bay's shields (0x9b) before an upgrade
 */
const KEEP = 0;
const RESERVE = 0x9b * 2;
/** what the bay mends, in order — the radar and the video are the player's eyes, not the copilot's */
const MEND = ["shields", "engines"];
/**
 * The copilots by how they fight for this player, best first: Cheese, Nikki
 * and Chablis won day one on Intermediate where the others did not
 */
const COPILOTS = [1, 4, 2, 0, 3, 5];
/** the order the upgrades are bought in: the Mart's own (missiles and rockets first, or the defensive, won no more) */
const UPGRADES = [0, 1, 2, 3, 4, 5];
/** a gesture every this many ticks: a screen's press, then the next */
const PACE = 30;

const mid = (r: Rect): { x: number; y: number } => ({ x: (r[1] + r[3]) >> 1, y: (r[0] + r[2]) >> 1 });

export interface PlayerLog {
  bought: string[];
  mended: string[];
  copilots: number[];
}

export class Player {
  readonly log: PlayerLog = { bought: [], mended: [], copilots: [] };
  private waited = "";
  /** the presses a screen still wants, one per {@link PACE} ticks */
  private presses: { x: number; y: number }[] = [];
  private planned: unknown = null;

  constructor(
    private readonly game: JumpRaven,
    private readonly input: Input,
    /** the Mart's reserves, for trying other ways to shop */
    private readonly cash: { keep: number; reserve: number } = { keep: KEEP, reserve: RESERVE },
  ) {}

  /** PLAY pressed once on the high scores screen, for the page's autoplay (the machine tests press it themselves) */
  playsOnce = false;

  /** one tick's worth of hands, before the tick */
  step(): void {
    const g = this.game;
    const m = g.m;
    const w = g.world;
    if (this.playsOnce && g.phase === "scores" && g.titleUp && !g.asking && m.ticks % PACE === 0) {
      this.playsOnce = false;
      const r = SCORE_BUTTONS.find((b) => b.what === "play")!.rect;
      return this.click({ x: (r[1] + r[3]) >> 1, y: (r[0] + r[2]) >> 1 });
    }
    if (w && !g.screen) this.fly(w);
    if (m.ticks % PACE !== 0) return;
    if (g.screen) return this.screen();
    this.planned = null;
    if (!w && (m.film || g.talkState.talk)) this.key("Escape");
  }

  private key(k: string): void {
    this.input.keyDown(k);
    this.input.keyUp(k);
  }

  private click(p: { x: number; y: number }): void {
    this.input.click(p.x, p.y);
  }

  // ---- a flight ---------------------------------------------------------------

  private fly(w: World): void {
    const g = this.game;
    const m = g.m;
    if (m.ticks % PACE === 0) {
      const s = g.hudState;
      const hud = w.hud as unknown as { copilotButton(k: number): { x: number; y: number } };
      const want = [this.holdsLastPod(w) ? 0 : 1, 1, 1];
      const wrong = [s.nav, s.hover, s.arms].findIndex((on, k) => on !== want[k]);
      if (wrong >= 0) this.click(hud.copilotButton(wrong));
    }
    if (m.ticks % 600 === 0) this.stepToBoss(w);
  }

  /**
   * The last pod is the boss's call (PODS empty, 0x417d70), and a craft that
   * comes to the boss worn down from the day seldom beats it: with one pod to
   * go and the shields under this share, NAVIGATION is let go of — the copilot
   * would drive to the pod — until a beacon is up, which it drives to: the
   * repair bay is called once the shields are low enough (hud.ts), and mends them
   */
  holdShare = 0.8;
  private holdsLastPod(w: World): boolean {
    const r = this.game.records;
    const onePod = r.bars[1] > 0 && r.bars[1] <= w.params.x43cf62;
    return onePod && !w.boss.up() && !this.game.hudState.beaconOn && r.bars[0] < AMMO_FULL * this.holdShare;
  }

  /** the copilot's diagonal wait at the boss (0x406361), one step on into its street */
  private stepToBoss(w: World): void {
    const g = this.game;
    const c = w.cam;
    const b = g.hudState.beacon;
    const at = `${c.cellX},${c.cellY},${c.angle}`;
    const diagonal = Math.abs(c.cellX - b.cellX) === 1 && Math.abs(c.cellY - b.cellY) === 1;
    const [ax, ay] = [[1, 0], [0, 1], [-1, 0], [0, -1]][c.angle >> 6];
    const intoItsStreet = c.cellX + ax === b.cellX || c.cellY + ay === b.cellY;
    if (w.state === 2 && w.boss.up() && diagonal && at === this.waited && intoItsStreet && !w.solid(c.cellX + ax, c.cellY + ay)) g.flight!.queue = [UP];
    this.waited = at;
  }

  // ---- the screens ------------------------------------------------------------

  private screen(): void {
    const g = this.game;
    let screen: unknown = g.screen;
    if (g.screen === "mart") screen = g.martScreen;
    else if (g.screen === "rbay") screen = g.bay;
    if (screen !== this.planned) {
      this.planned = screen;
      this.presses = this.plan(g.screen);
    }
    const next = this.presses.shift();
    if (next) this.click(next);
    // a screen still up after its presses: CONTINUE again, in case one went unheard
    else if (g.screen === "mart") this.presses = [mid(g.martScreen!.targets().cont)];
    else if (g.screen === "rbay") this.presses = [mid(g.bay!.targets().cont)];
    else this.presses = [CONTINUE];
  }

  /** the presses a screen just up is planned with */
  private plan(screen: JumpRaven["screen"]): { x: number; y: number }[] {
    if (screen === "mart") return this.shop();
    if (screen === "rbay") return this.mend();
    if (screen === "pilots") return this.choose();
    return [CONTINUE];
  }

  /**
   * The Mart: what to buy, as presses — the weapon's cell, then BUY — and
   * CONTINUE. Worked out on the records as the Mart will change them: a buy
   * trades in the kind's own for its worth and comes full.
   */
  private shop(): { x: number; y: number }[] {
    const g = this.game;
    const mart = g.martScreen!;
    const stock = g.mart!.stock;
    const r = { ...g.records, tier: [...g.records.tier], ammo: [...g.records.ammo] };
    const out: { x: number; y: number }[] = [];
    const buy = (tier: number, kind: number, reserve: number): boolean => {
      const cost = PRICES[kind][tier] - (r.ammo[kind] > 0 ? worth(r, kind) : 0);
      if (r.score - cost < reserve) return false;
      r.score -= cost;
      r.tier[kind] = tier;
      r.ammo[kind] = AMMO_FULL;
      out.push(mid(cell(tier, kind)), mid(mart.targets().buy));
      this.log.bought.push(`${KINDS[kind]} ${tier + 1}`);
      return true;
    };
    // what is empty first, at the best tier the cash covers, the fuel and the shields kept
    for (let kind = 0; kind < KINDS.length; kind++) {
      for (let tier = 3; r.ammo[kind] === 0 && tier >= 0; tier--) if (stock[tier][kind] && buy(tier, kind, this.cash.keep)) break;
    }
    // then the best tier in stock above what is had, the shields' reserve kept — the
    // defensive first, which the copilot fires every day only at its fourth tier (0x4051a4)
    for (const kind of UPGRADES) {
      for (let tier = 3; tier > r.tier[kind]; tier--) if (stock[tier][kind] && buy(tier, kind, this.cash.reserve)) break;
    }
    // then what has run low, again at its own tier
    for (let kind = 0; kind < KINDS.length; kind++) {
      if (r.ammo[kind] < AMMO_FULL / 2 && stock[r.tier[kind]][kind]) buy(r.tier[kind], kind, this.cash.reserve);
    }
    out.push(mid(mart.targets().cont));
    return out;
  }

  /** COPILOT SELECTION: the best of those who are in, then CONTINUE */
  private choose(): { x: number; y: number }[] {
    const here = this.game.pilots!.here;
    const best = COPILOTS.find((k) => here[k]) ?? 0;
    this.log.copilots.push(best);
    return [mid(portrait(best)), CONTINUE];
  }

  /** the repair bay: each system that is out and the cash covers — its slot, then REPAIR — and CONTINUE */
  private mend(): { x: number; y: number }[] {
    const g = this.game;
    const t = g.bay!.targets();
    let cash = g.records.score;
    const out: { x: number; y: number }[] = [];
    for (const name of MEND) {
      const s = t.systems.find((x) => x.name === name)!;
      if (!s.out || cash < s.cost) continue;
      cash -= s.cost;
      out.push(mid(s.slot), mid(t.repair));
      this.log.mended.push(name);
    }
    out.push(mid(t.cont));
    return out;
  }
}
