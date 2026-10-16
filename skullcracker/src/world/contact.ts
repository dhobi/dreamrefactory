/**
 * Who hits whom: the player's blows landing ({@link landHits}), the creatures
 * striking each other, the player being hit ({@link takeHits}), and the bolts
 * and flares landing.
 */
import { SbkCel } from "@dreamfactory/engine/df/sbk";
import { FOES } from "../foes";
import { TICK_SCALE, type CastKit } from "../brains/kit";
import { OWN } from "../sound";
import { Crow, crowCel, ibeamCel, crushCel, BUSH, HAND, SURGE, CLAW, FITTING, BOGGS, Head, ROLLER } from "../props";
import { BOLT, FLARE } from "../guns";
import { random } from "../random";
import { level, player, p, foesHurt, damageOn, sound, HURT, levelIndex } from "./state";
import { hanging, roomHolds, setKnockedOff } from "./motion";
import { celRec, celOf, foeAnchor } from "./cels";
import { spawnedHere, hereOf, roomSpan } from "./rooms";
import { inv, dropGun, bolts, boltCel, flares, setBolts } from "./arsenal";
import { strikeBox, struck, takesBlows, hurtBox, strikeOf, bleed } from "./blows";
import { struckBy, SPARES, playerBody, takeCode, takeHealth, gripAt } from "./hurt";
import { handCel, surgeCel, crushesHere, axeCel } from "./fixtures";
import { strikeCrow, crowsHere, ibeamsHere, drips, dripStrike } from "./scenery";
import { heads, headCel, kickHead, BURN_CODE, casts, castBlow, castCel, burstCast, rollers, rollerBlow, rollerCel, castHurtBox, strikeCast } from "./casts";
import { machineBox, strikeMachine, boggsCel, boggsStruck, clawCel, boggsWormCel, fittingCel } from "./machines";
import { strikeFoe } from "./foehit";
import { bushCel } from "./shots";

export function landHits(): void {
  if (!level || !player || !p.act) return;
  const i = level.rooms.indexOf(p.room!);
  if (i < 0) return;
  const mine = strikeBox();
  if (!mine) return; // this frame of the animation is not an impact frame
  // the crows first, because their own handler is the shortest in the game: no
  // health test at all, so any blow that reaches one takes it
  for (const c of level.crows[i]) {
    if (struckCrows.has(c)) continue;
    // the BODY box of the cel it shows, as `0x430350` takes every victim's —
    // the tumble's cels have none, which is what makes a dead crow unhittable
    const body = celRec(level.sbk, crowCel(c))?.body;
    if (!body) continue;
    const box = {
      left: c.x + body.x0,
      right: c.x + body.x1,
      top: c.y + body.y0,
      bottom: c.y + body.y1,
    };
    if (!(
      mine.right > box.left &&
      mine.left < box.right &&
      mine.bottom > box.top &&
      mine.top < box.bottom
    ))
      continue;
    struckCrows.add(c);
    strikeCrow(c, mine.damage);
  }
  // the heads, whose handler `0x420090` answers the player's own object and
  // nobody else's — see {@link HEAD}
  for (const h of heads) {
    if (struckHeads.has(h)) continue;
    const body = celRec(level.sbk, headCel(h))?.body;
    if (!body) continue;
    const [x0, x1] = h.west ? [-body.x1, -body.x0] : [body.x0, body.x1];
    if (!(
      mine.right > h.x + x0 &&
      mine.left < h.x + x1 &&
      mine.bottom > h.y + body.y0 &&
      mine.top < h.y + body.y1
    ))
      continue;
    struckHeads.add(h);
    kickHead(h, mine.blow);
  }
  const pool = level.spawned[i];
  const struckAt = pool.slice();
  for (const e of struckAt) {
    // and once it has toppled it is out of the fight, the way `0x44fe80` opens
    // with `if (obj+0x18 != 2)`; the water is not a thing at all — its cels carry
    // no collision box, which is how the format says so
    if (struck.has(e) || !takesBlows(e)) continue;
    /**
     * ...and neither is a creature whose CURRENT cel carries no box.
     *
     * The same rule as the water, one line up, and `initrat` is what showed it
     * applies to creatures too. Its creator installs `0x476f48` tag 0 — the rat
     * still down its hole — and cels 3010 and 3011 carry no body rect at all,
     * where 3000, 3003 and 3004, the ones it comes out on, all do. Falling back
     * to the drawn extent makes a hole-bound rat 54 by 102 and a standing punch
     * kills it through the pavement. The fallback stays everywhere else, because
     * plenty of art has no rect and still has to stand on a floor; it is landing
     * a BLOW that needs the authored one.
     */
    if (!celRec(level.sbk, celOf(e))?.body) continue;
    if (e.state === "flinch" && e.anim.terminal) continue;
    const c = celRec(level.sbk, celOf(e));
    if (!c) continue;
    const box = hurtBox(e, c, level);
    if (!(
      mine.right > box.left &&
      mine.left < box.right &&
      mine.bottom > box.top &&
      mine.top < box.bottom
    ))
      continue;
    struck.add(e);
    strikeFoe(
      e,
      mine.damage,
      mine.blow,
      p.facing,
      (mine.top + mine.bottom) / 2,
      box,
      0,
      {
        x: (Math.max(mine.left, box.left) + Math.min(mine.right, box.right)) / 2,
        y: (Math.max(mine.top, box.top) + Math.min(mine.bottom, box.bottom)) / 2,
      },
    );
  }
  // and BOGGS, which is four objects: `0x41aad0` turns a blow away only when the
  // striker is one of Boggs' own parts, so a fist is none of those and lands on
  // all of them — except the arm and the jaws, whose handler `0x41bb10` is
  // `xor ax, ax; ret` and turns everything away.
  for (const b of level.boggs[i]) {
    if (b.dying) continue;
    for (let k = 0; k < b.machines.length; k++) {
      const mb = machineBox(b, k);
      if (!mb) continue;
      if (!(
        mine.right > mb.left &&
        mine.left < mb.right &&
        mine.bottom > mb.top &&
        mine.top < mb.bottom
      ))
        continue;
      if (struckBoggs.has(String(k))) continue;
      struckBoggs.add(String(k));
      strikeMachine(b, k, mine.damage);
    }
    const art = celRec(level.sbk, boggsCel(b));
    if (!art) continue;
    const bb = {
      left: b.x - art.posX,
      right: b.x - art.posX + art.width,
      top: b.y - art.posY,
      bottom: b.y - art.posY + art.height,
    };
    if (!(
      mine.right > bb.left &&
      mine.left < bb.right &&
      mine.bottom > bb.top &&
      mine.top < bb.bottom
    ))
      continue;
    if (struckBoggs.has("body")) continue;
    struckBoggs.add("body");
    b.hp = Math.max(0, b.hp - mine.damage);
    // a fist is not a bolt, so it is the plain take
    boggsStruck(b, false);
  }
}
export function foesStrikeFoes(): void {
  const lvl = level;
  if (!lvl || !foesHurt) return;
  const bodies = spawnedHere().filter(takesBlows);
  const land = (
    who: object,
    kind: string | null,
    anim: unknown,
    cel: SbkCel,
    x: number,
    y: number,
    facing: number,
    vx: number,
    vy: number,
    code: number,
    mass: number,
    recoil: (vx: number, vy: number) => void,
    kit: CastKit | null = null,
  ): boolean => {
    if (code === 0 || (code < 0 && code !== BURN_CODE)) return false;
    const box = strikeOf(cel, x, y, facing);
    if (!box) return false;
    let mem = struckBy.get(who);
    if (!mem || mem.anim !== anim) {
      mem = { anim, hit: new Set() };
      struckBy.set(who, mem);
    }
    let landed = false;
    for (const v of bodies) {
      if (v === who || mem.hit.has(v)) continue;
      // most handlers turn their own class away; {@link Foe.hitsOwn} are the ones that do not
      if (v.kind === kind && !FOES[v.kind].hitsOwn) continue;
      const spares = SPARES[v.kind];
      if (spares && ((kind && spares.kinds.includes(kind)) || (kit && spares.kits.includes(kit)))) continue;
      if (v.state === "flinch" && v.anim.terminal) continue;
      const vc = celRec(lvl.sbk, celOf(v));
      // `0x4303b3` — a body whose cel has no box takes nothing
      if (!vc?.body) continue;
      const hb = hurtBox(v, vc, lvl);
      if (!(box.right > hb.left && box.left < hb.right && box.bottom > hb.top && box.top < hb.bottom))
        continue;
      let damage = 0;
      if (code > 0) {
        const pair = cel.blow ?? { dx: 0, dy: 0 };
        const whole = code === 100 || code === 0x65;
        const moving = code === 0x65 ? 0 : 1;
        const bx =
          (whole ? pair.dx : Math.trunc((pair.dx * code) / 100)) * (facing < 0 ? -1 : 1) +
          vx * moving;
        const by = (whole ? pair.dy : Math.trunc((pair.dy * code) / 100)) + vy * moving;
        damage = Math.floor(Math.sqrt(bx * bx + by * by));
        if (damage === 0) continue;
      }
      mem.hit.add(v);
      landed = true;
      strikeFoe(
        v,
        damage,
        cel.blow ?? { dx: 0, dy: 0 },
        facing,
        (box.top + box.bottom) / 2,
        hb,
        Math.min(code, 0),
        {
          x: (Math.max(box.left, hb.left) + Math.min(box.right, hb.right)) / 2,
          y: (Math.max(box.top, hb.top) + Math.min(box.bottom, hb.bottom)) / 2,
        },
        { mass, vx, vy, recoil, by: { kind, kit } },
      );
    }
    return landed;
  };
  for (const e of spawnedHere()) {
    if (e.state === "dead" && e.strength !== 0x65) continue;
    if (e.state === "burst") continue;
    const c = celRec(lvl.sbk, celOf(e));
    if (!c?.strike) continue;
    const a = foeAnchor(e, lvl) ?? { x: e.x, y: e.y };
    const vx = e.vx / TICK_SCALE + (e.vx === 0 ? (e.speed ?? 0) * e.facing : 0);
    const foe = FOES[e.kind];
    land(e, e.kind, e.anim, c, a.x, a.y, e.facing, vx, e.vy / TICK_SCALE, e.strength ?? 100,
      e.divisor ?? foe.divisor, (hvx, hvy) => {
        if (foe.rooted) return;
        e.vx = hvx * TICK_SCALE;
        e.vy = hvy * TICK_SCALE;
        if (!foe.floats) e.speed = 0;
      });
  }
  for (const c of casts) {
    if (c.spent || c.landed !== undefined) continue;
    const code = castBlow(c);
    const cel = celRec(lvl.sbk, castCel(c));
    if (!cel?.strike) continue;
    // a cast is a class of its own, so it turns away nobody — though two
    // handlers turn IT away ({@link SPARES})
    const hit = land(c, null, c, cel, c.x, c.y, c.facing, c.vx, c.vy, code, c.kit.divisor ?? 1,
      (hvx, hvy) => {
        c.vx = hvx;
        c.vy = hvy;
      }, c.kit);
    if (hit && code !== 0x65) {
      if (c.kit.flyOn) c.struck = true;
      else c.spent = true;
    }
  }
}

export function takeHits(): void {
  if (!level || !player) return;
  // already staggering, already down, already dead: no body box, nothing to hit
  if (p.act === "dying") return;
  // ...and with the switch off and nothing in the room that carries a code,
  // there is nothing this function can do, so it does not look for the body box.
  // The wraith counts: it is the one CREATURE whose strength is a code.
  if (
    !damageOn &&
    !hereOf((l) => l.claws).length &&
    !hereOf((l) => l.hands).length &&
    !hereOf((l) => l.surges).length &&
    !hereOf((l) => l.bushes).length &&
    !hereOf((l) => l.boggs).some((b) => b.zap.armed)
  )
    return;
  const mine = playerBody();
  if (!mine) return;
  const hit = (
    cel: SbkCel,
    x: number,
    y: number,
    facing: number,
    vx: number,
    vy: number,
    /** the hitter's own `obj+0x1a`; negative is a CODE and never damage */
    code = 100,
    /** where this hitter would hold you, re-read every frame — see {@link gripOf} */
    grip?: () => { x: number; y: number } | null,
    /** the hitter itself, so it can ask later whether it still has you */
    what?: object,
  ): boolean => {
    const box = strikeOf(cel, x, y, facing);
    if (!box) return false;
    if (!(
      box.right > mine.left &&
      box.left < mine.right &&
      box.bottom > mine.top &&
      box.top < mine.bottom
    ))
      return false;
    // `0x448c72` reads the SIGN first: a code is dispatched and the arithmetic
    // below never runs. A grab cel proves the order matters — 1556 and 2456
    // carry a strike box and no blow pair at all, so a damage-first reading
    // would throw the hold away before it got here.
    // ...and a CODE comes through whatever the damage switch says, because it is
    // not damage: no reaction in the table takes a point of health off anybody.
    // The switch is this port's, to keep the page walkable; the grab is the
    // game's, and turning one off has never had anything to do with the other.
    if (code < 0) return takeCode(code, grip, what, { blow: cel.blow, facing, vx, vy });
    // `0x430367`: a hitter whose strength is nothing hits nothing
    if (code === 0) return false;
    /**
     * `0x42f910`: the cel's own pair, scaled by the hitter's strength, plus
     * whatever the hitter was doing, rooted.
     *
     * A cel with a strike box and NO pair is still a blow: its pair reads as
     * zero and the hitter's own velocity is the whole of it. The rat's pounce
     * (3002..3005), the dog's bite (4824, 4825, 4831) and wbooly's walk are
     * all that shape, and all three hurt by how fast they arrive. The one
     * exception is 0x65, the blast, which takes the pair as it stands and
     * nothing of the hitter's (`0x42f9b8`).
     */
    const pair = cel.blow ?? { dx: 0, dy: 0 };
    const whole = code === 100 || code === 0x65;
    const moving = code === 0x65 ? 0 : 1;
    const bx =
      (whole ? pair.dx : Math.trunc((pair.dx * code) / 100)) *
        (facing < 0 ? -1 : 1) +
      vx * moving;
    const by = (whole ? pair.dy : Math.trunc((pair.dy * code) / 100)) + vy * moving;
    // `0x434630` is an integer square root: the magnitude is whole, rounded down
    const damage = Math.floor(Math.sqrt(bx * bx + by * by));
    if (damage === 0) return false;
    // `0x42ebda` / `0x42ed21` — hanging or not, the blow's own drops go first,
    // from where it landed, before the cry and before the health they are
    // coloured by comes off
    bleed(
      damage,
      {
        x: (Math.max(box.left, mine.left) + Math.min(box.right, mine.right)) / 2,
        y: (Math.max(box.top, mine.top) + Math.min(box.bottom, mine.bottom)) / 2,
      },
      { blow: cel.blow, facing, vx, vy },
    );
    // `0x42ebb1` — on a ladder or a bar there is no reaction and no disarm: the
    // cry (`0x42ed34`, 0xe + roll(7)) and the health (`0x42ed4f`), and he is
    // knocked off if a room holds him (`0x42ed84`), which is also the answer
    if (hanging()) {
      const cry = OWN.hurt[Math.floor(random() * OWN.hurt.length)];
      sound?.own(cry, p.x, p.y);
      takeHealth(damage);
      if (!roomHolds()) return false;
      setKnockedOff(true);
      return true;
    }
    // `0x44915c` / `0x44919e`: which side it came from decides the take
    const front = x > p.x === p.facing > 0;
    const knocked = damage > HURT.knockdown;
    if (knocked) p.act = front ? "downFront" : "downBack";
    else p.act = front ? "hurtFront" : "hurtBack";
    p.actClock = 0;
    const hurt = OWN.hurt[Math.floor(random() * OWN.hurt.length)];
    sound?.own(hurt, p.x, p.y);
    // ...and a knockdown takes the gun out of your hands. The same `cmp di, 0x3c`
    // that chose the animation is the disarm's test too: `0x44911b` asks
    // `0x448bf0` whether `player+0x18` is one of the five armed kinds (0x12..0x16)
    // and, if it is, `0x45b060` throws the weapon on the floor exactly the way
    // reaching for another one does, clears `[0x479438]` and redraws the panel
    // (`0x40d4f0`). The other player class carries its own copy of the same six
    // instructions at `0x42ec07`, so it is both of them, not one.
    //
    // A CODE never gets here — `0x448c72` dispatched it before the arithmetic —
    // so a claw's grab and a wraith's hold leave you armed.
    if (knocked && inv.drawn) dropGun();
    // ...and asks it of `player+0x18`, not `0x479438`: with your fists out the
    // gun stays yours. Either way the knockdown `0x476890` is kind 24, unarmed
    if (knocked) inv.drawn = false;
    takeHealth(damage);
    return true;
  };
  const lvl = level;
  /**
   * The three that carry a CODE go first, and they are the only three this
   * function runs at all with the damage switch off.
   *
   * Order is not the reason — a code is not damage, so the switch has nothing
   * to do with it, and the reactions have to land either way. Cost is: letting
   * the whole loop below run with the switch off adds a linear scan of the
   * level's cel table per hitter per frame, and ARCADE, which judges a boss
   * fight by the wall clock, fails two runs in three with it. Three short loops
   * always; the long one only when it can do anything.
   */
  // `0x417208` — the claw's first blow is a hundred, and its second is the code
  for (const c of hereOf((l) => l.claws)) {
    const cel = celRec(lvl.sbk, clawCel(c));
    if (!cel?.strike) continue;
    /**
     * `obj+0x2a` is set by the COLLISION, not by the damage — the exchange
     * `0x43043b` runs once the victim's handler takes the blow, and it marks the
     * hitter (`0x430663`) whatever the blow pair says. The claw's
     * jaw cels carry a strike box and no pair at all, so asking `hit` to report
     * contact would never mark one: the dive would touch you and go back up.
     */
    const reach = strikeOf(cel, c.x, c.y, 1);
    if (
      c.state === "dive" &&
      reach &&
      reach.right > mine.left &&
      reach.left < mine.right &&
      reach.bottom > mine.top &&
      reach.top < mine.bottom
    )
      c.caught = true;
    // `0x417208` gives it a hundred at the top of every think and only the
    // CLAMP (`0x417485`) writes the code, so a dive is a real blow and the grab
    // is what the blow leads to — see {@link Claw.caught}
    const code = c.state === "clamp" ? CLAW.grab : CLAW.blow;
    if (
      hit(cel, c.x, c.y, 1, 0, 0, code, () => gripAt(clawCel(c), c.x, c.y), c)
    )
      return;
  }
  /**
   * ...and the HANDS, whose whole point is the code.
   *
   * `0x420da6` sets -3 as the hand under your feet closes and `0x420e3b` sets
   * -7 for the one that comes up anywhere, and of the thirteen cels its scripts
   * name only the two closed ones — 1556 and 1562 — carry a strike box at all. So a hand can only
   * take hold on the frame it is shut, and the box it takes hold BY is the fist
   * the artist drew.
   */
  for (const q of hereOf((l) => l.hands)) {
    const cel = celRec(lvl.sbk, handCel(q));
    if (!cel?.strike) continue;
    const kind = q.underfoot ? HAND.underfoot : HAND.anywhere;
    if (
      hit(
        cel,
        q.atX,
        q.atY,
        1,
        0,
        0,
        kind.blow,
        () => gripAt(handCel(q), q.atX, q.atY),
        q,
      )
    )
      return;
  }
  // ...and SEWER's bush, whose last seven cels are a grip and whose blow is -3
  for (const q of hereOf((l) => l.bushes)) {
    const cel = celRec(lvl.sbk, bushCel(q));
    if (!cel?.strike) continue;
    // `0x43ee9d` against `0x43eedb`: the grab while it is still reaching, and the
    // half-gravity slump from the frame it has you — see {@link BUSH.grab}. A
    // partner's lash is the grab on every frame (`0x43f111`)
    const code =
      q.state === "lash" || q.phase === 0 ? BUSH.grab : BUSH.slump;
    // mirrored about its anchor with the object, as `0x4026d0` builds the rect
    const facing = q.mirror ? -1 : 1;
    if (
      hit(cel, q.x, q.y, facing, 0, 0, code, () => gripAt(bushCel(q), q.x, q.y, facing), q)
    )
      return;
  }
  // ...and TOWER's current, which carries -4 on every cel of its arc — while it
  // is on (`0x426a90`; `0x426b78` zeroes it as it goes off)
  for (const g of hereOf((l) => l.surges)) {
    if (!g.on) continue;
    const cel = celRec(lvl.sbk, surgeCel(g));
    if (!cel?.strike) continue;
    if (hit(cel, g.x, g.y, 1, 0, 0, SURGE.blow)) return;
  }
  // `0x41b022` — Boggs' first machine, armed with −1 while it sweeps, seen or
  // not ({@link BOGGS.zap}); its `obj+0x28` is 0 (`0x41b28b`). A blow the
  // player's handler takes disarms it (`0x43045d`, `obj+0x1a = 0`), and only
  // the next frame of the sweep puts the −1 back
  for (const b of hereOf((l) => l.boggs)) {
    if (!b.zap.armed) continue;
    const cel = celRec(lvl.sbk, BOGGS.zap.cel);
    const m = b.machines[0];
    if (!cel?.strike || !m) continue;
    if (hit(cel, m.x, m.y, 1, 0, 0, BOGGS.zap.code, undefined, b.zap)) {
      b.zap.armed = false;
      return;
    }
  }
  if (!damageOn) return;
  for (const e of foesHurt ? spawnedHere() : []) {
    /**
     * A corpse does not: `dead` has no box worth reading and never had —
     * unless its own death arms it, as the CHOPPER's sink does with a blast
     * (`0x454716`, `obj+0x1a = 0x65`), which a class says with
     * {@link Enemy.strength}.
     *
     * The hydrant's WATER comes through here and lands nothing. It is a second
     * object of the hydrant's own class (`0x44fb81`), kept as an enemy in the
     * `burst` state, and 9802..9807 carry a strike box and 9803..9807 a blow
     * pair — but its strength is the allocator's zero, which `0x430367` turns
     * away before the pair is read.
     */
    if (e.state === "dead" && e.strength !== 0x65) continue;
    const c = celRec(lvl.sbk, celOf(e));
    if (!c?.strike) continue;
    // ...and the hitter's velocity is ALL of it: `obj+0xc` is the walk as
    // well as a flight, and this page keeps a walker's in {@link Enemy.speed}
    const vx = e.vx / TICK_SCALE + (e.vx === 0 ? (e.speed ?? 0) * e.facing : 0);
    // the water is the exception: `0x44fb81` makes it with the allocator's
    // strength of nothing (`0x42f550`) and nothing gives it one, so it pushes
    // no one about — see {@link Enemy.strength} for the rest
    const strength = e.state === "burst" ? 0 : (e.strength ?? 100);
    // the box hangs off `obj+6`, the anchor, not the feet ({@link strikeOf})
    const a = foeAnchor(e, lvl) ?? { x: e.x, y: e.y };
    if (hit(c, a.x, a.y, e.facing, vx, e.vy / TICK_SCALE, strength)) {
      // `0x430663` — the exchange marks the hitter's `obj+0x2a`, for a blow
      // with a strength (`0x430430`)
      if (strength > 0) e.connected = true;
      return;
    }
  }
  /**
   * ...and the crows, whose dive cels (1875, 1877, 1884..1887) carry a strike
   * box and no pair — so the blow is the crow's own velocity at strength 100
   * (`0x45206f` rewrites it every frame). Touching is what sets `obj+0x2a`
   * (the exchange, `0x430663`), and that is what ends a dive's run ({@link stepCrows}).
   */
  for (const c of foesHurt ? crowsHere() : []) {
    const cel = celRec(lvl.sbk, crowCel(c));
    if (!cel?.strike) continue;
    const reach = strikeOf(cel, c.x, c.y, 1);
    if (
      reach &&
      reach.right > mine.left &&
      reach.left < mine.right &&
      reach.bottom > mine.top &&
      reach.top < mine.bottom
    )
      c.hit = true;
    if (hit(cel, c.x, c.y, 1, c.vx, c.vy)) return;
  }
  /**
   * ...and what the creatures have THROWN, which is a creature's blow at a
   * distance and so sits under the same switch as its fists.
   *
   * Spent on contact, and spent whether or not it landed a reaction: the
   * executable's own test is `obj+0x2a` — the collision word — going non-zero,
   * and touching the player is what sets it. A gob that has hit you is gone
   * even if you were already on your back.
   */
  /**
   * ...and what the creatures have THROWN, all of it under the creature switch.
   *
   * Codes included, and that is a decision rather than an oversight. This
   * function lets a CODE through whatever the switches say — the claw, the hand
   * underfoot, the bush and the wraith all reach the player with `?damage` off
   * — on the reasoning that a code is not damage and turning damage off was
   * never meant to turn the grab off.
   *
   * A thrown one is different, and SEWER is where it showed. Two of the four
   * casts built so far carry −2, the jolt; nine eyes spit it; and with the
   * jolts arriving whatever the switch said, `tests/machine/sewer.ts` could no
   * longer walk its own big shaft — the player was knocked off it and out of
   * the level, twice in two runs. The claw and the bush are LEVEL FURNITURE,
   * fixed things you walk into, and a route that meets one meets it by standing
   * there. A glob is a creature's attack, which is exactly what `foehit` was
   * added to hold back while the shared AI was being wired, and the sign of the
   * number it carries does not change what it is.
   *
   * So: a cast waits for the creature switch, code or blow. The suites keep
   * measuring routes, and `?foehit=1` — which is what the front door plays with
   * — gets the whole of it.
   */
  for (const c of foesHurt ? casts : []) {
    /**
     * ...and the one class whose flight is a DUD stays in this loop after it
     * has met something, because for that one the burst is the attack.
     *
     * `0x452e00` installs the burst on the collision words and `0x452ec0`
     * writes the hundred and one as its state comes up, so the frame it
     * touches you is the first frame it can hurt you and the flash goes on
     * hurting for as long as its own cels carry a pair. See
     * {@link CastKit.onImpact}.
     */
    const dud = c.kit.onImpact === true;
    if (c.landed !== undefined && !dud) continue; // already met something
    if (!dud && castBlow(c) === 0) continue; // still flying harmless — `0x413e43`
    const cel = celRec(lvl.sbk, castCel(c));
    if (!cel?.strike) continue;
    const box = strikeOf(cel, c.x, c.y, c.facing);
    if (!box) continue;
    if (!(box.right > mine.left && box.left < mine.right && box.bottom > mine.top && box.top < mine.bottom))
      continue;
    if (dud) {
      // meeting you IS the landing. The flight's own cels carry a strike box
      // and no blow pair (6004..6006), so `hit` resolves them to nothing of
      // its own accord and the first cel that can take health is 7000's.
      if (c.landed === undefined) burstCast(c);
      if (hit(cel, c.x, c.y, c.facing, 0, 0, c.kit.blow)) return;
      continue;
    }
    // ...or, for one that flies on, it is only worth nothing from now on
    // ({@link CastKit.flyOn}) — its blow is read before that is written
    const blow = castBlow(c);
    if (c.kit.flyOn) c.struck = true;
    else c.spent = true;
    // `0x42f910` adds what the HITTER was doing to the cel's own pair, and a
    // cast's velocity is already in the executable's units — a frame's worth
    if (hit(cel, c.x, c.y, c.facing, c.vx, 0, blow)) return;
  }
  /**
   * ...and Boggs' WORMS, which are the same argument as a cast.
   *
   * One is dropped by a creature's own machine and carries `0x41adf9`'s hundred
   * from the frame it lands, so it waits for `?foehit` exactly as a thrown thing
   * does. It does not move, so there is no velocity to hand the reaction.
   */
  for (const b of foesHurt ? hereOf((l) => l.boggs) : []) {
    for (const m of b.worms) {
      const cel = celRec(lvl.sbk, boggsWormCel(m));
      if (!cel?.strike) continue;
      const box = strikeOf(cel, m.x, m.y, 1);
      if (!box) continue;
      if (!(box.right > mine.left && box.left < mine.right && box.bottom > mine.top && box.top < mine.bottom))
        continue;
      if (hit(cel, m.x, m.y, 1, 0, 0, BOGGS.worms.strength)) return;
    }
  }
  /**
   * ...and the ROLLER, which is the same argument again and one number apart.
   *
   * `0x43a993` writes its strength every frame it is quick enough and
   * `0x43aa34` writes a zero every frame it is not, so what arms it is its own
   * speed rather than anything it has met — {@link rollerBlow}. It hands the
   * reaction its velocity the way a cast does, because it has a real one.
   */
  for (const r of foesHurt ? rollers : []) {
    const blow = rollerBlow(r);
    if (blow === 0) continue;
    const cel = celRec(lvl.sbk, rollerCel(r));
    if (!cel?.strike) continue;
    const face = r.vx < 0 ? -1 : 1;
    const box = strikeOf(cel, r.x, r.y, face);
    if (!box) continue;
    if (!(box.right > mine.left && box.left < mine.right && box.bottom > mine.top && box.top < mine.bottom))
      continue;
    if (hit(cel, r.x, r.y, face, Math.trunc(r.vx / ROLLER.divisor), 0, blow)) return;
  }
  // `0x454a38` arms a press only while its stroke runs, and only two of its cels
  // carry a box; `0x4537d0` arms a girder on every frame it has
  for (const c of crushesHere()) {
    if (c.state !== "slam") continue;
    const cel = celRec(lvl.sbk, crushCel(c));
    if (!cel?.strike) continue;
    if (hit(cel, c.x, c.y, 1, 0, 0)) return;
  }
  for (const b of ibeamsHere()) {
    if (b.delay > 0) continue;
    const cel = celRec(lvl.sbk, ibeamCel(b));
    if (!cel?.strike) continue;
    if (hit(cel, b.x, b.y, 1, 0, 0)) return;
  }
  // the big gun's shot, a hundred (`0x413bed`), tested where it stood as the
  // frame began on the record the step shows ({@link GUNBOLT}); a blow taken
  // is the exchange that sets its `obj+0x2a`, and its think lets it go
  for (const b of bolts) {
    if (b.code !== 100 || b.spent || !b.was) continue;
    const cel = celRec(lvl.sbk, boltCel(b));
    if (!cel?.strike) continue;
    if (hit(cel, b.was.x, b.was.y, b.facing, b.vx, 0)) {
      b.spent = true;
      return;
    }
  }
  // `0x423d29` and the four writes after it — the blade carries a blow of a
  // hundred at every tag it has, and it has nothing else
  for (const a of hereOf((l) => l.axes)) {
    const cel = celRec(lvl.sbk, axeCel(a));
    if (!cel?.strike) continue;
    if (hit(cel, a.x, a.y, 1, 0, 0)) return;
  }
  // ...and VAT's wrecking balls: `0x41a89e` writes a hundred every frame, and
  // every cel of the swing carries a box. It is pinned to its point with both
  // velocities zeroed (`0x41a7de`), so what it hits with is the cel's own pair
  for (const f of hereOf((l) => l.fittings)) {
    if (f.kind !== "ball") continue;
    const cel = celRec(lvl.sbk, fittingCel(f));
    if (!cel?.strike) continue;
    if (hit(cel, f.x, f.y, 1, 0, 0, FITTING.ball.blow)) return;
  }
  // ...and the goop, which carries `obj+0x1a = 0x64` and therefore its cel's own
  // pair unscaled — see {@link dripStrike} for why that is one cel of nine
  for (const d of drips) {
    const cel = dripStrike(d);
    if (!cel || d.hit) continue;
    // touching is what sets `obj+0x2a` (the exchange, `0x430663`), and a gob that has touched
    // bursts on its next think (`0x43746a`) whatever the blow came to
    const reach = strikeOf(cel, d.x, d.y, 1);
    if (
      reach &&
      reach.right > mine.left &&
      reach.left < mine.right &&
      reach.bottom > mine.top &&
      reach.top < mine.bottom
    )
      d.hit = true;
    // a drip keeps its velocity in pixels a FRAME already (see {@link stepGoop})
    if (hit(cel, d.x, d.y, 1, d.vx, d.vy)) return;
  }
  // ...and level eight's water is not in this list: it never hurts the player.
  // The column is born out of `0x42f550` with `obj+0x1a = 0` (`0x42f5af`), and
  // neither its creation (`0x44088a`..`0x440919`) nor its think (`0x4409a0`)
  // arms it, so the hit pass passes it over at `0x430367`; its cels 150..158
  // carry no strike box either (`0x430379`), and its own handler `0x440a80`
  // answers 0 to anything that lands on it. The scald is kragg's alone (`0x440bb0`)
}

/**
 * The bolts' part of the frame's hit pass ({@link hitPass}) — `0x430350` with
 * each bolt as the hitter, at the point it stood as the frame began.
 *
 * Its strike box is its cel's own, 4000's `x −4..2, y −4..2` about the anchor
 * and mirrored with it (`0x40e6a2`), tested once a frame where it is. The bolt
 * crosses a hundred pixels an engine frame, so the six-pixel box samples the
 * world every hundred and goes clean through anything it does not happen to
 * land in: a body whose box is narrower than the gap, standing in the gap, is
 * never struck. That is the engine's, and it is what the blaster is — where
 * you stand to shoot decides what it reaches.
 */
export function boltHits(): void {
  const lvl = level;
  if (!lvl) return;
  const i = lvl.rooms.indexOf(p.room!);
  const pool = i >= 0 ? lvl.spawned[i] : [];
  const span = p.room ? roomSpan(p.room) : null;
  for (const b of bolts) {
    if (b.spent || !b.was) continue;
    const art = celRec(lvl.sbk, boltCel(b));
    const sb = art?.strike ?? { y0: -4, x0: -4, y1: 2, x1: 2 };
    const at = b.was;
    const [x0, x1] = b.facing < 0 ? [-sb.x1, -sb.x0] : [sb.x0, sb.x1];
    const box = { left: at.x + x0, right: at.x + x1, top: at.y + sb.y0, bottom: at.y + sb.y1 };
    const was = at.x;
    /**
     * What it meets first. Boggs' body and a machine can both stand over the
     * point it is tested at; both take the same hundred — `0x41bc71` on the
     * body and `0x41b510` in the machinery's handler translate the `-1`
     * identically — and the nearer along the way it flies is taken.
     */
    const met: { edge: number; take: () => void }[] = [];
    for (const g of hereOf((l) => l.boggs)) {
      const cel = celRec(lvl.sbk, boggsCel(g));
      if (cel?.body) {
        // the cel's BODY box off the anchor, which is what the collision pass
        // tests a victim by (`0x4303b3` reads `cel+0xc`, `0x40e680` translates
        // it) — 5988's is x −151..31, y −36..127, so a bolt at a standing
        // player's knee height passes under the body and meets the machine
        // behind it
        const gb = {
          left: g.x + cel.body.x0,
          right: g.x + cel.body.x1,
          top: g.y + cel.body.y0,
          bottom: g.y + cel.body.y1,
        };
        if (
          box.right > gb.left &&
          box.left < gb.right &&
          box.bottom > gb.top &&
          box.top < gb.bottom
        ) {
          met.push({
            edge: b.vx >= 0 ? Math.max(gb.left, was) : Math.min(gb.right, was),
            take: () => {
              // `0x41bc71` -> 100, then `0x42f910` the usual way
              g.hp = Math.max(0, g.hp - BOGGS.translatesTo);
              sound?.effect(BOLT.sound, g.x, g.y);
              boggsStruck(g, true);
            },
          });
        }
      }
      for (let k = 0; k < g.machines.length; k++) {
        const mb = machineBox(g, k);
        if (!mb) continue;
        if (!(
          box.right > mb.left &&
          box.left < mb.right &&
          box.bottom > mb.top &&
          box.top < mb.bottom
        ))
          continue;
        met.push({
          // clamped to where the bolt STARTED this step: it materialises 120px
          // ahead of the muzzle and can be inside several boxes already, and a
          // leading edge behind it is not the thing it met first
          edge: b.vx >= 0 ? Math.max(mb.left, was) : Math.min(mb.right, was),
          take: () => {
            strikeMachine(g, k, BOGGS.translatesTo, true);
            sound?.effect(BOLT.sound, g.machines[k].x, g.machines[k].y);
          },
        });
      }
    }
    let hit = false;
    if (met.length) {
      met.sort((l, r) => (b.vx >= 0 ? l.edge - r.edge : r.edge - l.edge));
      met[0].take();
      hit = true;
    }
    if (hit) {
      b.spent = true;
      continue;
    }
    // ...and only now the room's own end — the page's, not the disc's — and
    // on the point it was tested at, because culling first would throw that
    // test away: the machine at x6694 stands past the end of chamber2's floor
    if (span && (was < span.lo || was > span.hi)) {
      b.spent = true;
      continue;
    }
    /**
     * ...and the creatures, which a bolt does NOT simply stop on.
     *
     * The hit pass `0x430350` hands the bolt to each body's handler in turn,
     * and what happens next is the handler's ANSWER and the bolt's strength
     * AFTER it:
     *
     * - an answer of 0 (`0x43042b`) moves on to the next body — nothing is
     *   exchanged, nothing marks the bolt, and it flies on. Every handler that
     *   turns a negative strength away answers 0 to the blaster's −1, and so
     *   does puke's, after its sound (`0x418278`): the bolt goes THROUGH them;
     * - an answer of 1 with a strength over 0 runs `0x430470`, which sets the
     *   bolt's `obj+0x2a` (`0x430663`), and the bolt's think lets it go on its
     *   next frame (`0x413b56`). A handler of {@link Foe.minusOne} `as` writes
     *   the 100 onto the BOLT before it answers (`0x4147e0`, `0x418b4e`,
     *   `0x4199a0`), which is what lets its 1 stop it;
     * - and a handler that rewrites and then answers 0 — an arm that has hold
     *   of you (`0x418b58`) — leaves a hundred-strength bolt going on to the
     *   next body in the same pass. The think puts the −1 back next frame
     *   (`0x413bf9`, from the variant, every frame).
     *
     * A cel with no body box is not there to a bolt either (`0x4303b3`): a
     * flinching TCop, the tube on its stand.
     */
    let str: number = b.code;
    for (const e of pool) {
      if (!takesBlows(e)) continue;
      const c = celRec(lvl.sbk, celOf(e));
      if (!c?.body) continue;
      const hurt = hurtBox(e, c, lvl);
      if (!(
        box.right > hurt.left &&
        box.left < hurt.right &&
        box.bottom > hurt.top &&
        box.top < hurt.bottom
      ))
        continue;
      const foe = FOES[e.kind];
      if (str === -1) {
        const minus = foe.minusOne;
        if (!minus) continue;
        if ("sound" in minus) {
          // puke's `0x41825e` answers it through `0x40f090` (`0x418273`)
          sound?.effect(minus.sound, b.x, b.y, "lead");
          continue;
        }
        str = minus.as;
      } else if (b.code === 100 && e.kind === "initcop") {
        // the big gun's bolt is the bolt class `[0x46c600]` below tag 2,
        // which the TCop turns away (`0x41482a`) — an answer of 0
        continue;
      } else if (b.code === 100 && !foesHurt) {
        // ...and to anything else it is a blow of a hundred, which lands
        // under the creature switch like every other blow a machine throws;
        // without it the bolt stops there and takes nothing
        b.spent = true;
        break;
      }
      // `0x42f910` at the strength it now has: 4000's own pair, scaled and
      // mirrored, plus `obj+0xc` — the bolt's hundred a frame, which is what
      // {@link Bolt.vx} already holds, a step being one engine frame — and the
      // integer root of the sum of squares (`0x434630`)
      const pair = art?.blow ?? { dx: 0, dy: 0 };
      const facing = b.vx < 0 ? -1 : 1;
      const vx = b.vx;
      const dx = Math.trunc((pair.dx * str) / 100) * facing + vx;
      const dy = Math.trunc((pair.dy * str) / 100);
      // a taken blow is a counted one; a gate that turned it away left the
      // count where it was — the handler's 1 or 0
      const dents = e.dents;
      strikeFoe(
        e,
        Math.floor(Math.hypot(dx, dy)),
        pair,
        facing,
        at.y,
        hurt,
        0,
        { x: at.x, y: at.y },
        { mass: BOLT.divisor, vx, vy: 0, by: {} },
      );
      if (e.dents !== dents) {
        b.spent = true;
        break;
      }
    }
  }
  setBolts(bolts.filter((b) => !b.spent));
}

/**
 * The flares' part of the frame's hit pass ({@link hitPass}) — `0x430350`
 * with each flare as the hitter, at the point it stood as the frame began and
 * on the cel it shows this frame, and only while it still carries its strength
 * (`0x43ac19` zeroes it once it has hit or landed).
 */
export function flareHits(): void {
  const lvl = level;
  if (!lvl) return;
  const i = lvl.rooms.indexOf(p.room!);
  const pool = i >= 0 ? lvl.spawned[i] : [];
  for (const f of flares) {
    const at = f.was;
    if (f.spent || !at || !at.armed || (f.burn !== null && f.burn >= 0)) continue;
    const art = celRec(lvl.sbk, at.cel);
    // ...and anything it reaches: the flight cel's own STRIKE box, about its
    // anchor and mirrored with it (`0x4026d0`), against the body it meets
    const sb = art?.strike ?? { y0: -12, x0: -12, y1: 12, x1: 12 };
    const box = {
      left: at.x + (f.facing < 0 ? -sb.x1 : sb.x0),
      right: at.x + (f.facing < 0 ? -sb.x0 : sb.x1),
      top: at.y + sb.y0,
      bottom: at.y + sb.y1,
    };
    let struck = false;
    for (const e of pool) {
      if (!takesBlows(e)) continue;
      const c = celRec(lvl.sbk, celOf(e));
      if (!c) continue;
      const hurt = hurtBox(e, c, lvl);
      if (!(
        box.right > hurt.left &&
        box.left < hurt.right &&
        box.bottom > hurt.top &&
        box.top < hurt.bottom
      ))
        continue;
      /**
       * ...and on a STAGE 5 a flare is not a hundred at all — it is a −9.
       *
       * `0x43abfa` is the whole rule and it is two instructions: the flare's
       * own think writes `obj+0x1a = 0xfff7` while `[0x4abdfc]` is 5 and
       * `0x64` otherwise. `[0x4abdfc]` is the stage within a chapter — see
       * `SkullSave.stage`, which reads it as 2..5 — so 5 is the FOURTH level
       * of one, and that is levels 4, 8, 12 and 16.
       *
       * ARCADE is level 8. So the one level in the game with sprinklers in it
       * is also one of the four where a flare is a code rather than damage,
       * and that is not a coincidence: `0x441b60`'s only caller is inside
       * kragg's state 9, and the only way into state 9 is `0x441d30`'s −9.
       *
       * It matters for the rest of the level too. A flare on a stage 5 cannot
       * hurt anything that has no −9 handler, and sets alight everything that
       * has: see {@link Foe.burns}.
       */
      if (levelIndex % 4 === 3) {
        strikeFoe(e, 0, { dx: 0, dy: 0 }, f.facing, (box.top + box.bottom) / 2, hurt, BURN_CODE, undefined, { mass: FLARE.divisor, vx: 0, vy: 0, by: {} });
      } else {
        // `0x42f910` at strength 100: the cel's own pair, mirrored by facing,
        // plus the flare's own velocity, and the damage is the length of that —
        // 7207's `dx 8` and forty a frame of flight is about fifty, not a
        // flat hundred
        const pair = art?.blow ?? { dx: 0, dy: 0 };
        const dx = pair.dx + at.vx * f.facing;
        const dy = pair.dy + at.vy;
        strikeFoe(
          e,
          Math.round(Math.hypot(dx, dy)),
          { dx, dy },
          f.facing,
          (box.top + box.bottom) / 2,
          hurt,
          0,
          undefined,
          // the flare's own mass, its divisor of 5 (`0x43ab50`)
          { mass: FLARE.divisor, vx: at.vx * f.facing, vy: at.vy, by: {} },
        );
      }
      f.burn = -1;
      struck = true;
      break;
    }
    /**
     * ...and a cast, on the levels where a flare is a code.
     *
     * The same argument as the stream's own cast pass, and on PLAYGR it is the
     * likelier of the two: level 4 is a fourth level, so `0x43abfa` makes
     * every flare on it a −9, and the boss's fireball is the one thing in the
     * air that reads one. A flare that meets it is spent either way —
     * `0x43acae` installs the burn-out on anything it touches, whatever the
     * thing it touched made of the blow.
     *
     * There is deliberately no crow pass here, unlike the stream's. A crow is
     * CITY's and CITY is level 2, so `levelIndex % 4 === 3` is never true where
     * one stands and a flare there is `0x64`, not a code; and no `statflare` is
     * placed in CITY at all — the chapter's weapon is the flamer (see
     * `CHAPTER_WEAPON` in {@link file://../guns.ts}). The two can never meet.
     */
    if ((f.burn === null || f.burn < 0) && !struck && levelIndex % 4 === 3)
      for (const c of casts) {
        if (c.spent || !c.kit.onCode) continue;
        const art = celRec(lvl.sbk, castCel(c));
        if (!art) continue;
        const hurt = castHurtBox(c, art);
        if (!(
          box.right > hurt.left &&
          box.left < hurt.right &&
          box.bottom > hurt.top &&
          box.top < hurt.bottom
        ))
          continue;
        strikeCast(c, BURN_CODE);
        f.burn = -1;
        break;
      }
  }
}

/** the crows this swing has already taken, so one blow is one crow */
export const struckCrows = new Set<Crow>();

/** and the Boggs parts this swing has already landed on — `"body"` or a machine index */
export const struckBoggs = new Set<string>();

/** ...and the heads it has already kicked — {@link HEAD} */
export const struckHeads = new Set<Head>();
