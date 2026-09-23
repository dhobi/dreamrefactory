/**
 * The graveyard's big one — `initghengis`, `0x422680`, ten states.
 *
 * ## Which chapter this is, and why that matters before reading a single cel
 *
 * `initghengis` is registered at `0x41e4fc`, in the same block as `initskel`,
 * `initvpriest`, `initigor`, `initbat` and `initswingaxe`, and the chapter that
 * block belongs to loads **`grave.sbk`** at `0x41f950`. The street punk is a
 * different book altogether (`streets.sbk`, `0x44dc10`), so the cel numbers
 * below — 400 to 478 — are grave.sbk's and mean nothing anywhere else. Its
 * sounds come out of `[0x4a5870]`, the bank that whole run of chapters shares.
 *
 * ## Its ten scripts, and therefore its ten states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so this table
 * IS the alphabet. The bank is one contiguous run, `0x46ed70`…`0x46efe0`, and
 * every entry below was walked out of it header by header:
 *
 * ```
 *   0  0x46ed70   1 frame,  hold 1  — cel 400, standing: the patrol
 *   1  0x46ed80   1 frame,  hold 2  — cel 420, the stance, and the state that DECIDES
 *   2  0x46ee38   4 frames, hold 2  — the short dash at a turned back
 *   3  0x46ee60  12 frames, hold 2  — tag 0 walks in, tag 1 runs in
 *   4  0x46eee0   9 frames, hold 1  — the roar, on its own
 *   5  0x46ef30  21 frames, hold 1  — tag 0 wind-up, tags 1 and 2 the bull rush
 *   6  0x46ed90   9 frames, hold 2  — nine one-frame tags: the nine pieces it bursts into
 *   7  0x46ede0  10 frames, hold 1  — the blast that goes up where it stood
 *   8  0x46eec8   2 frames, hold 2  — the flinch
 *   9  0x46efe0  11 frames, hold 1  — the death
 * ```
 *
 * ## What this module owns, and what it does not
 *
 * Six of the ten — 0 through 5 — are the ones it is in while it is on its feet,
 * and those are here. 6 to 9 are the hit reactions and what death spawns; the
 * page drives those through {@link Foe.flinch}, {@link Foe.pick} and
 * {@link Foe.death} and a brain is never called during them. They are named at
 * {@link NOT_HERE} with the three things they do that the page's own path does
 * not.
 *
 * ## The AI struct — read the creator, never the punk's
 *
 * `0x41ea20` allocates **0x30 bytes** and fills them:
 *
 * | slot        | what `0x41ea20` puts there                                     |
 * |-------------|----------------------------------------------------------------|
 * | `AI+0`      | `0x40e300(0xc8)` — **HEALTH**, not the punk's nerve             |
 * | `AI+2`      | `0x16` = 22 — the beat, {@link Enemy.beat}                      |
 * | `AI+4..0xb` | the record's rect, copied out of args 2 and 3 (`0x41ea97`)      |
 * | `AI+0xc..`  | the tracker state `0x45ef70` builds: self, player, band list    |
 *
 * That is the whole struct. **This class has no side slot, no decision budget
 * and no home point** — the punk's `AI+6`, `AI+4` and `AI+0x10` are simply not
 * here, and neither is a nerve. `AI+0` being health is settled twice over: the
 * hit handler's `0x430eb0` looks this object's AI struct up and `0x422b98`
 * subtracts the blow from `[AI+0]`, and the think function's only read of it is
 * `0x4226d4`, which hands it to `0x40d1c0` against `0x40e300(0xc8)` as the
 * on-screen bar's fraction. That bar claim is **not behaviour** and is not
 * ported: it fires at the top of every frame while the band is 1 or better, the
 * player is in front, and the state is neither 0 nor 9. `0x3393` is the name id
 * it passes with it.
 *
 * And `obj+0x1a` — the strength this thing commits — is set to **100**
 * (`0x4226ea`) at the top of every frame in every state — the page's default
 * {@link Enemy.strength}.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type CastKit,
  type Enemy,
  type Reaction,
} from "./kit";

/**
 * States 6 to 9. The page plays the flinch and the death; the flinch's tail
 * is the brain's case 8 and the burst is {@link ghengisReacts}.
 *
 * - **8**, the flinch (`0x422a25`): `0x422c30` installs it whenever a blow
 *   leaves health, with sound `0x2c + 0x434540(2)` — 0x2d or 0x2e. What state 8
 *   then does: when the two cels end it
 *   rolls `0x434540(2)` and goes **straight back on the offensive** — a 1 walks
 *   it in on kind 3 tag 0, anything else drops it into the bull rush, kind 5 tag
 *   0. It never returns to the stance off a flinch.
 * - **9**, the death (`0x422a6f`): sound `0x2f`, `0x40d1c0(0,0,0,y)` drops the
 *   bar, `0x40d450(0x190)` is the award, and `obj+0x2e` is seeded from
 *   `[0x46b204]`, the corpse linger. When the eleven cels end it calls
 *   `0x422c60` and answers **1** — the one frame in the whole class that
 *   suppresses anything, and it does it because the object is being removed.
 * - **6 and 7**, and they are not states Ghengis is ever in. `0x422c60` is the
 *   burst: it spawns **nine fresh objects of this class**, one per tag of kind
 *   6, cels 446 to 454, laid out across ±24 pixels (`si` walks 0x18 down by 6)
 *   and thrown up to 19 pixels up (`0x434540(0x14) - 0x14`), each given a 0.4
 *   bounce by `0x42f7f0`. State 6 (`0x4229d2`) zeroes their strength while
 *   `obj+0x2a` is set, flips their mirror flag on `obj+0x2c`, and removes each
 *   one once `obj+0x30` and `obj+0x2e` agree it has landed. Then `0x422d2b`
 *   spawns a tenth object with `obj+0x16 = -1` and sound `0x30`, playing kind 7
 *   — the blast, cels 460 to 469 — and state 7 (`0x422a0a`) holds `obj+0x1a` at
 *   **101** for its whole run before removing it. So Ghengis does not leave a
 *   corpse: it comes apart into nine pieces over a blast.
 * - The hit handler itself, `0x422ad0`, is the class's `obj+0x12`
 *   (`0x422619`). It throws a blow away outright when the striker is in its own
 *   class list `[0x46f048]` or in `[0x46ecd0]` or `[0x46ecc8]`, when the
 *   striker's `obj+0x1a` is 0, and while this one is already in state 6 or state
 *   7 — so nothing interrupts the burst, and nothing of its own kind can hurt
 *   it. A striker whose `obj+0x1a` is **-4** is absorbed whole.
 */
const NOT_HERE = "0x422a25, 0x422a6f, 0x4229d2, 0x422a0a, 0x422ad0" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x46ed70`…`0x46efe0`.
 *
 * Every cel, hold and stride below is the script's own. Nothing in this class
 * lifts — there is no `dy` anywhere in the bank, and no leap to need one.
 */
export const GHENGIS = {
  /** kind 0 — one cel, going nowhere: what it stands in until you walk in */
  idle: { cels: [400], hold: 1, kind: 0, tag: 0, from: "0x46ed70 tag 0" },
  /** kind 1 — one cel, and the state that decides. `0x41eab3` is not it: this is */
  stance: { cels: [420], hold: 2, kind: 1, tag: 0, from: "0x46ed80 tag 0" },
  /** kind 2 — four cels that accelerate, 85 then 170: the dash at a turned back */
  dash: {
    cels: [410, 411, 412, 413],
    hold: 2,
    dx: [85, 85, 170, 170],
    kind: 2,
    tag: 0,
    from: "0x46ee38 tag 0",
  },
  /** kind 3 tag 0 — the walk in, six cels at a flat 85, and the one that thuds */
  stride: {
    cels: [400, 401, 402, 403, 404, 405],
    hold: 2,
    dx: [85, 85, 85, 85, 85, 85],
    kind: 3,
    tag: 0,
    from: "0x46ee60 tag 0",
  },
  /** kind 3 tag 1 — the same six cels, opening at double stride: the run in */
  run: {
    cels: [400, 401, 402, 403, 404, 405],
    hold: 2,
    dx: [170, 170, 170, 85, 85, 85],
    kind: 3,
    tag: 1,
    from: "0x46ee60 tag 1",
  },
  /** kind 4 — nine cels standing still. The same nine the rush winds up on */
  roar: {
    cels: [470, 471, 472, 473, 474, 475, 476, 477, 478],
    hold: 1,
    kind: 4,
    tag: 0,
    from: "0x46eee0 tag 0",
  },
  /** kind 5 tag 0 — the wind-up, and it is a bluff: cel for cel it is the roar */
  windUp: {
    cels: [470, 471, 472, 473, 474, 475, 476, 477, 478],
    hold: 1,
    kind: 5,
    tag: 0,
    from: "0x46ef30 tag 0",
  },
  /** kind 5 tag 1 — six frames at 170 apiece, the last three on cel 413 */
  rush: {
    cels: [410, 411, 412, 413, 413, 413],
    hold: 1,
    dx: [170, 170, 170, 170, 170, 170],
    kind: 5,
    tag: 1,
    from: "0x46ef30 tag 1",
  },
  /** kind 5 tag 2 — three more, and then it is spent and stands */
  rushEnd: {
    cels: [411, 412, 413],
    hold: 1,
    dx: [85, 170, 170],
    kind: 5,
    tag: 2,
    from: "0x46ef30 tag 2",
  },
  /**
   * `0x46f040` — the descending list, and it is **three** long, not four.
   *
   * `0x45ef70` copies words out of it until one is not greater than zero
   * (`0x45ef9f`), and the words there are `015e 00b4 0046 0000`. So the list is
   * 350, 180, 70 and the band it hands back runs −1…3 — which is exactly the
   * four entries in the band jump table at `0x422ab8`, with −1 falling through
   * the unsigned `cmp eax, 3; ja` at `0x4227b4`.
   */
  bands: [350, 180, 70],
  /**
   * `[0x4a5870]`, this chapter's bank. `0x2a` is the roar it lets out every time
   * it commits to anything; `0x2f` and `0x30` belong to the death
   * ({@link NOT_HERE}).
   */
  roarSnd: 0x2a,
  /** `0x4228f8` — the footfall, on frames 0 and 4 of the walk */
  footSnd: 0x2b,
  /** `0x42297b` — the one that goes with the charge coming out of the wind-up */
  chargeSnd: 0x2c,
  /** `0x422d7e` — the blast it comes apart in */
  blastSnd: 0x30,
  from: "0x422680",
} as const;

/** `0x41ea6e` — what the creator seeds `AI+2`, the beat, with */
const BEAT = 0x16;

/**
 * `initghengis`'s own machine, states 0 to 5.
 *
 * ## The stack frame, and how it was pinned
 *
 * `0x422680` opens `sub esp, 0xc` — **twelve** bytes, not sixteen, which is all
 * `0x45efd0` actually writes (`out+0` through `out+0xb`) — takes the buffer
 * address with `lea eax, [esp]` at `0x422683` and only THEN pushes `esi` and
 * `edi`. So from `0x422697` onwards, with `esp` eight bytes below where the
 * `lea` was taken, the sixteen bytes sit at **`esp+8`**:
 *
 * ```
 *   esp+0x08  out+0     side        esp+0x10  out+8    player.y - self.y
 *   esp+0x0c  out+4     band        esp+0x12  out+0xa  forward distance
 *   esp+0x0e  out+6     his cel carries a strike box
 * ```
 *
 * The argument slots pin it: `0x42268a` reads the AI struct from `[esp+0x20]`
 * while three things are pushed on top, and `0x4226a8` reads the object from
 * `[esp+0x18]` with none — both resolve to the same two dwords, and that fixes
 * `esp` exactly. Read four low and `0x4227af`'s `movsx eax, [esp+0xc]` would be
 * the SIDE rather than the band, and the whole fight would dispatch on one of
 * three values instead of five and still compile.
 *
 * ## Every path returns false
 *
 * A think function never suppresses the animation. Every path in `0x422680`
 * ends `xor ax, ax` except three, and all three are removal frames that belong
 * to states this module does not own: `0x422a00` and `0x422a1b` (the burst's
 * pieces and its blast) and `0x422a83` (the corpse). States 0 to 5 answer zero
 * from everywhere, the "my script has not finished" returns included, so this
 * brain returns `false` from everywhere.
 */
export const ghengis: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, GHENGIS.bands);
  e.beat ??= BEAT;
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x4226fc`: the patrol, and it is not a patrol at all.
     *
     * Kind 0 is one cel with no stride. The state does exactly one thing:
     * `0x434200(player.point, AI+4)` — the player's own point inside the four
     * words the creator copied out of this `init` record — and on a hit it
     * installs the stance. There is no walk, no bound test and no territory
     * width rule; this thing stands where the level put it until you come to it.
     */
    case 0:
      return e.fighting ? install(e, GHENGIS.stance) : false;
    // ---- 1, `0x42272f`: the stance, and the only state that thinks every frame
    case 1:
      return decide(e, k, t, done);
    /**
     * ---- 2 and 4, `0x4228c1`: the dash and the roar both just end.
     *
     * One handler, two entries in the table at `0x422a90` — index 2 and index 4
     * are the same address. When the script is done, back to the stance.
     */
    case 2:
    case 4:
      return done ? install(e, GHENGIS.stance) : false;
    /**
     * ---- 3, `0x4228e5`: the walk in, and what it is watching for at the end.
     *
     * The head of the state is a sound: `obj+0x42` is the ABSOLUTE frame index
     * `0x45d090` rewinds and `0x45d0c4` advances, and on **0 or 4** it lets out
     * `0x2b`, the footfall. Kind 3 is twelve frames — tag 0 is 0…5 and tag 1 is
     * 6…11 — so those two thuds land on the walk only and never on the run.
     * The brain is called once an engine frame, so the frame index is the
     * clock over the hold, and each thud is said on the first call that shows
     * its frame.
     *
     * And the tail, `0x42291e`, is the whole point of walking in: it compares
     * the player's `obj+0x28` against its own, and **equal mirror flags mean his
     * back is turned** — it is facing him and he is facing the same way. That
     * launches the bull rush with a roar. Anything else and it just stands.
     */
    case 3: {
      // `0x4228e5` — frames 0 and 4, which only tag 0 has
      if ((e.tag ?? 0) === 0) {
        const at = Math.floor(e.clock);
        if (at === 1 || at === 4 * e.anim.hold) k.say(e, GHENGIS.footSnd);
      }
      if (!done) return false;
      // `0x422912` — turn first, exactly as the fight does
      if (t.forward < 0) e.facing = -e.facing;
      if (k.player.facing === e.facing) {
        k.say(e, GHENGIS.roarSnd); // `0x422943`
        return install(e, GHENGIS.windUp, true);
      }
      return install(e, GHENGIS.stance);
    }
    /**
     * ---- 5, `0x422970`: the bull rush, and it is a chain of three tags.
     *
     * `0x422995` reads `obj+0x44`, the tag now playing, and while it is under 2
     * reinstalls the SAME script one tag on: the nine-cel wind-up hands to six
     * frames at 170, which hand to three more, which hand back to the stance.
     * Nothing can shorten it — every link waits on `obj+0x46`.
     *
     * `0x422970` also watches `obj+0x42` for **8**, the last frame of the
     * wind-up, and says `0x2c` there. That frame is the tick before this state
     * first sees `done`, so the port says it as tag 1 goes on instead — one tick
     * late, and the nearest a page with no frame-index word can put it.
     */
    case 5: {
      if (!done) return false;
      const tag = e.tag ?? 0;
      if (tag >= 2) return install(e, GHENGIS.stance);
      // frame 8 is inside tag 0 and nowhere else, so tag 1 handing to tag 2 is
      // silent — `0x422975` misses on every frame of tags 1 and 2
      if (tag === 0) k.say(e, GHENGIS.chargeSnd);
      return install(e, tag === 0 ? GHENGIS.rush : GHENGIS.rushEnd, true);
    }
    /**
     * ---- 8, `0x422a25`: the end of the flinch, and it goes straight back on
     * the offensive.
     *
     * The flinch itself is the page's reaction; its {@link FoeAnim.resume} is a
     * one-frame script of this kind, and when that is done `0x422a30` rolls
     * `0x434540(2)`: a 1 walks in on `0x46ee60` tag 0, anything else is the
     * bull rush's wind-up, `0x46ef30` tag 0 — with no roar in front of it.
     */
    case 8:
      if (!done) return false;
      return k.roll(2) === 1
        ? install(e, GHENGIS.stride)
        : install(e, GHENGIS.windUp, true);
    default:
      return false;
  }
};

/**
 * `0x422c60`, called from state 9 (`0x422a7e`) the frame the death's cels end.
 *
 * Nine pieces of this class, one per tag of `0x46ed90` — cels 446 to 454 —
 * each put down at the body's point with `x += si` for `si` = 24 down to −24
 * in sixes (`0x422cb8`, `0x422cc8`) and `y += 0x434540(0x14) - 0x14`
 * (`0x422ca3`), divisor 10 (`0x422cbf`) and a bounce of 0.4 (`0x422d13`). They
 * are given no velocity at all: they drop where they are put, and state 6
 * (`0x4229d2`) removes each once it has come to rest. Then a tenth,
 * `0x46ede0`, the blast — cels 460 to 469, no gravity (`0x422d5d`), sound 0x30
 * (`0x422d7e`) — which state 7 (`0x422a0a`) holds at strength **0x65** for
 * its whole run and removes as it ends.
 *
 * The pieces are harmless in practice: their cels carry a strike box and no
 * pair, so what they would hit with is their own velocity, and a cast hands
 * the page only its sideways one.
 */
function burst(e: Enemy, k: BrainCtx): void {
  for (let i = 0; i < 9; i += 1) {
    k.cast(e, {
      cels: [446 + i],
      hold: 2,
      speed: 0,
      ahead: 0,
      offX: 24 - 6 * i,
      lift: 0x14 - k.roll(0x14),
      blow: 100,
      // the class's own weight — nothing in `0x422c60` calls `0x42f850`
      pull: 10,
      bounce: 0.4,
      rest: 2,
      from: `0x422c60 -> 0x46ed90 tag ${i}`,
    });
  }
  k.say(e, GHENGIS.blastSnd);
  k.cast(e, GHENGIS_BLAST);
}

/** `0x422d2b`..`0x422d95` — the blast, and the only one of the ten that hurts */
const GHENGIS_BLAST: CastKit = {
  cels: [460, 461, 462, 463, 464, 465, 466, 467, 468, 469],
  hold: 1,
  speed: 0,
  ahead: 0,
  lift: 0,
  // `0x422a0a` — `obj+0x1a = 0x65` on every frame of state 7: the pair alone
  blow: 0x65,
  // `0x422a10` — removed the frame its ten cels end
  life: 10,
  from: "0x422c60 -> 0x46ede0 tag 0",
};

/**
 * State 9, `0x422a6f`, while the page plays `0x46efe0`: on the frame its cels
 * end the body comes apart ({@link burst}) and {@link Foe.linger} 0 removes it.
 */
export const ghengisReacts: Reaction = (e, foe, run, k) => {
  if (e.state !== "dead" || e.anim !== foe.death) return;
  if (e.hatched || e.clock < run) return;
  e.hatched = true;
  burst(e, k);
};

/**
 * State 1, `0x42272f` — the stance, and the whole of the fight.
 *
 * Kind 1 is a single cel, so this runs fresh every frame: there is no
 * `obj+0x46` gate at the head of the state, only at its tail.
 *
 * The order is the executable's. Player down first, then face him, then a coin
 * that is nothing to do with the distance, and only then the band.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  /**
   * `0x42272f` — `0x402f60` is the player-upright test and this class answers it
   * by standing over him and roaring. Kind 4 is the roar alone; state 4 puts it
   * back in the stance, which asks again, which roars again. It does not walk
   * off, it does not go home — this class has no home point to go to.
   */
  if (k.player.down) {
    k.say(e, GHENGIS.roarSnd); // `0x42273d`
    return install(e, GHENGIS.roar);
  }
  // `0x422765` — and this one does NOT return: it turns and carries on deciding
  if (t.forward < 0) e.facing = -e.facing;
  /**
   * `0x422771` — `0x434540(0x93)` is 1..147 and anything under ten roars. Nine
   * frames in a hundred and forty-seven, asked EVERY frame of the stance, at any
   * distance: it is the thing standing there bellowing at you between advances.
   */
  if (k.roll(0x93) < 10) {
    k.say(e, GHENGIS.roarSnd); // `0x422787`
    return install(e, GHENGIS.roar);
  }
  switch (t.band) {
    // ---- band 0, `0x4227c4`: beyond 350, it walks. That is all it does out there
    case 0:
      return install(e, GHENGIS.stride);
    /**
     * ---- band 1, `0x4227cb`: 180 to 350, and the beat decides.
     *
     * `AI+2` counts down one a frame and the test at `0x4227cf` is on the value
     * BEFORE the decrement, so a beat of 22 is twenty-three frames of standing.
     * When it goes under, `0x434540(13) + 8` reseeds it 9..21, it roars, and it
     * commits to the bull rush from right out there. Otherwise: the stance, and
     * ask again next frame.
     */
    case 1: {
      const beat = e.beat ?? BEAT;
      e.beat = beat - 1;
      if (beat >= 0) return install(e, GHENGIS.stance);
      e.beat = k.roll(13) + 8; // `0x4227e2`
      k.say(e, GHENGIS.roarSnd); // `0x4227f1`
      return install(e, GHENGIS.windUp, true);
    }
    /**
     * ---- band 2, `0x422815`: 70 to 180, and two separate things happen here.
     *
     * First `0x42281e`: equal mirror flags mean his back is turned, and it roars
     * and dashes — kind 2, four cels, 85 then 170. Then, **without returning**,
     * it falls into the beat block at `0x422847`, which can overwrite the dash
     * it just installed with the bull rush in the same frame. That is not a
     * reading of the disassembly, it is the fall-through the disassembly has, so
     * it is written out here the same way: the second install wins and the roar
     * is said twice.
     *
     * The beat block itself is the band-1 one with a second trigger:
     * `0x422857` reads `out+6`, the flag for the player's cel carrying a strike
     * box, and **him swinging fires the rush whatever the beat says**. The
     * reseed here is `0x434540(2) + 4`, 5 or 6 — a far shorter fuse than band
     * 1's 9..21.
     */
    case 2: {
      let dashed = false;
      if (k.player.facing === e.facing) {
        k.say(e, GHENGIS.roarSnd); // `0x42282f`
        install(e, GHENGIS.dash, true); // `0x422837`
        dashed = true;
      }
      const beat = e.beat ?? BEAT;
      e.beat = beat - 1;
      if (beat < 0 || k.player.swinging) {
        e.beat = k.roll(2) + 4; // `0x422866`
        k.say(e, GHENGIS.roarSnd); // `0x422875`
        return install(e, GHENGIS.windUp, true);
      }
      /**
       * `0x45d090` clears `obj+0x46` as it installs, so the shared tail below —
       * which the dash path falls into — cannot fire on the frame the dash went
       * on. Returning here is that, said in the port's own terms.
       */
      if (dashed) return false;
      break;
    }
    // ---- band 3, `0x42288d`: inside 70 it runs at you, kind 3 tag 1, double stride
    case 3:
      return install(e, GHENGIS.run);
    /**
     * ---- and band −1, the player behind it.
     *
     * `0x4227b4` is an unsigned `cmp eax, 3; ja`, so −1 misses the table
     * altogether and lands on the tail. The turn at `0x422765` above has already
     * happened; next frame the tracker reads him in front.
     */
    default:
      break;
  }
  /**
   * `0x42289d` — the tail every band that did not commit falls into: when the
   * stance's own script ends, put the stance on again. In the port that is a
   * no-op on the same animation, and it is here because the executable's control
   * flow is here.
   */
  return done ? install(e, GHENGIS.stance) : false;
}

export { NOT_HERE as GHENGIS_NOT_HERE };
