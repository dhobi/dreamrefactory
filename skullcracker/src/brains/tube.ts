/**
 * The test-tube boy — `inittube`, think function `0x4192c0`, jump table
 * `0x419804`, and LAB's own monster.
 *
 * ## Its eleven scripts, and therefore its eleven states
 *
 * `0x45d090` copies a script's own kind into `obj+0x18`, so the class's script
 * list IS the alphabet of its machine. The eleven sit end to end from
 * `0x46d780` to `0x46da30`, each one `{i16 count, i16 ticksPerFrame, i16 kind}`
 * and then `count` eight-byte frames; the band list `0x46da68` and the class
 * pointer `[0x46da70]` follow the last of them.
 *
 * ```
 *   0  0x46d780  one cel, and NO tick rate: the tank, and the whole patrol
 *   1  0x46d878  the walk — ten cels at 65, and it calls out on 3 and 7
 *   2  0x46d830  tag 0 the flip that breathes, tag 1 the wind-down
 *   3  0x46d790  one standing cel — and the state that DECIDES
 *   4  0x46d7a0  the charge: four cels at 65, 185, 215, 245
 *   5  0x46d8d0  the same ten cels as the walk, run at 130
 *   6  0x46d7c8  twelve cels of writhing, going nowhere
 *   7  0x46d928  tag 0 the overhead, tag 1 the swipe
 *   8  0x46d9b8  tag 0 the rear-back, tag 1 the throw — and tags 2 and 3 orphans
 *   9  0x46da20  the flinch: cel 5350 again, three frames of it
 *  10  0x46da30  the death, cels 5440…5445
 * ```
 *
 * The guard in front of the dispatch is `cmp eax, 0xa; ja 0x4197f2` at
 * `0x41932a`, so the table at `0x419804` is eleven entries wide and every one
 * of the eleven kinds above has a state. It is read as
 * `movsx eax, word ptr [esi+0x18]`, so a negative `obj+0x18` would fall through
 * the unsigned compare — nothing writes one.
 *
 * ## What this module owns, and what it does not
 *
 * Nine of the eleven — 0 through 8 — are the ones a tube boy is in while it is
 * on its feet, and those are here. 9 and 10 are the hit reactions, which the
 * page already drives through {@link Foe.flinch} and {@link Foe.death}; a brain
 * is never called while a thing is flinching or dying, so wiring them here
 * would give one animation two owners. What they and their handler do that the
 * page's own path does not is written out at {@link NOT_HERE}.
 *
 * ## The AI struct, which is NOT the punk's
 *
 * `0x411ba0` allocates **0x30 bytes** (`0x433f20(0x30)`) and fills four things
 * into them, and only one of the four is where the punk keeps it:
 *
 * | slot        | what `0x411ba0` puts there                                   |
 * |-------------|--------------------------------------------------------------|
 * | `AI+0`      | `0x40e300(0x4b0)` — **twelve hundred health**, `0x411be4`     |
 * | `AI+2`      | zero — the beat, `0x411c19`                                   |
 * | `AI+4`…`+b` | the record's rect, two dwords out of args 2 and 3, `0x411c04` |
 * | `AI+0xc`    | the tracker input `0x45ef70` is handed, `0x411c14`            |
 * | `AI+0x2e`   | zero — the corpse counter, `0x411c22`                         |
 *
 * So `AI+0` is **health, not nerve**: the only thing that reads it is
 * `0x419314`, the bar claim, and the only thing that writes it is `0x419a43` in
 * the hit handler. No state in the machine looks at it. `AI+4` is the rect the
 * punk keeps at `AI+8`, and the page already has that test as
 * {@link Enemy.fighting}. There is no side, no decision budget, no home point:
 * nothing ever sends a tube boy back where it started.
 *
 * `AI+0x2e` sits exactly one word past a full band array — `0x45ef70` writes
 * the count at `AI+0x14` and up to twelve bands from `AI+0x16` — which is why
 * the struct is 0x30 and not smaller.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x4192c0` does `sub esp, 0xc` — twelve bytes, which is exactly what
 * `0x45efd0` fills, `out+0` through `out+0xb` — takes the buffer with
 * `lea eax, [esp]` **before** it pushes `esi` and `edi`, and then drops eight
 * bytes of arguments at `0x4192d7`. Net: in the body the block sits at
 * `esp+8`, so **`esp+0xc` is `out+4`, the BAND**, and **`esp+0x12` is
 * `out+0xa`, the forward distance**.
 *
 * What pins it is the two argument slots. At `0x4192ca`, three pushes deep,
 * `mov edi, [esp+0x20]` is `E+8` — the second argument, the AI struct — and
 * after the `add esp, 8` both `mov esi, [esp+0x18]` at `0x4192e8` and
 * `0x419322` are `E+4`, the first argument, the object. Those two are the only
 * fixed points in the frame, and they put the buffer where it is. Read four
 * bytes low and `[esp+0xc]` would be `out+0`, the side — a three-way flag that
 * still passes `cmp eax, 3; ja`, still compiles, and turns the whole band
 * dispatch at `0x41948c` into nonsense.
 *
 * And `obj+6` is the **Y**, `obj+8` the X: `0x419955` adds a signed x offset to
 * `obj+8` and subtracts 0x8c from `obj+6` to put a spawn 140 pixels up.
 *
 * ## The preamble, which is not a state
 *
 * `0x4192da`…`0x419320` is the on-screen enemy bar's claim and nothing else:
 * with the player at band 1 or better (`[esp+0xc] >= 1`) and in front
 * (`[esp+0x12] > 0`), and the tube neither dormant (state 0) nor a corpse
 * (state 10), `0x40d1c0` is handed `AI+0` against `0x40e300(0x4b0)` and plate
 * **`0x33f9`**. That is {@link Foe.panel}'s business, not behaviour, and it is
 * named here only so the next reader does not go looking for a sound at
 * `0x40d1c0`.
 *
 * The other thing outside the states is the common exit `0x4197f6`:
 * `mov word ptr [esi+0x1a], 0x64` on **every** path. `obj+0x1a` is the strength
 * percent this thing would land a blow at; nothing hits the player back in this
 * port, so it is carried as read and spends nothing.
 *
 * ## And the return value
 *
 * Every path out of `0x4192c0` reaches `0x4197f2`, `xor ax, ax` — the waiting
 * paths included. The single `mov ax, 1` is `0x4197df`, the frame the corpse is
 * removed, and that is state 10 and not here. **So every path of this brain
 * returns `false`**, because waiting is exactly when the script now playing
 * needs to keep playing; returning `true` would freeze the thing mid-swing with
 * its frame unspent.
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
 * The corpse lies lower: state 10 writes `obj+0x10 = -12` on every frame its
 * count lasts (`0x4197ec`), the only write to the floor offset in the class.
 */
export const tubeCorpse: Reaction = (e) => {
  if (e.state === "dead") e.floor = -12;
};

/**
 * The hit reactions, states 9 and 10, and the handler that picks between them.
 * Read, not done — the page owns those animations.
 *
 * - **the handler**, `0x419990`, is what `0x419249` hangs on `obj+0x12`. It
 *   sets `obj+0x1a` back to 100 when it finds it at −1, answers 0 outright when
 *   it is exactly **−6** (`0x4199aa`) or below 1, and refuses the blow when its
 *   owner belongs to its own thrown-glass class `[0x46bfb4]` or to the two at
 *   `[0x46cc60]` and `[0x46d1b0]` — `0x430ee0` three times over,
 *   `0x4199c3`…`0x419a05`. The blow's strength comes from `0x42f910` and comes
 *   off `AI+0` at `0x419a43`, and `0x434540(2) + 0x1a` says one of **0x1b,
 *   0x1c** — `lab.snd`'s `#0204`/`#0205 tt boy ge[ts hit]`.
 * - **9**, the flinch: `0x419ad9` installs `0x46da20`, one cel held three
 *   frames, and answers 1. State 9 at `0x4197a3` waits for it and hands back to
 *   the decider — no turn, no retreat, so the page's own flinch path, which
 *   hands back to whatever was playing, loses nothing here.
 * - **10**, the death: `0x419a87` clears the bar, `0x42f870(obj, 0)` takes it
 *   out of whatever list it was in, `0x40f090` says **0x18** (`#0200 test
 *   tube`), `0x46da30` goes on, `[0x46b204]` is written into **`AI+0x2e`** and
 *   `[0x46bfbc]` is raised. State 10 at `0x4197bc` then clears `obj+0x26` so
 *   the corpse stops shoving, drops `obj+0x10` to −12 while the count lasts,
 *   and on the frame it runs out removes the object through
 *   `0x40cba0(self, -0xd, 0)`.
 */
const NOT_HERE = "0x419990, 0x4197a3, 0x4197bc" as const;

/**
 * The two things a tube boy puts into the world.
 *
 * Both build an object of the class at `[0x46bfb4]` — registered by `0x418ee0`
 * one call after the tube's own `0x419200`, sharing its cel bank `0x4a5178` —
 * copy the tube's mirror flag and point into it, offset it forward and **140
 * pixels up** (`sub word ptr [esi+6], 0x8c`), and install one of that class's
 * scripts. The class's create (`0x418f17`) gives it a divisor of **13** and
 * `0x42f850(obj, 0.6)` — a pull of 6 — and its think (`0x418fd0`) holds
 * `obj+0x1a` at `0x64` in flight.
 *
 * - **`0x419860`**, from state 8 tag 0 — the throw. It puts the thing **70**
 *   pixels in front (`0x41989f`: `and eax, 0x8c; sub eax, 0x46`, so +0x46 east
 *   and −0x46 west) and then rolls `0x434540(2)`: 1 installs `0x46d658` tag 0,
 *   cel 5520 at **dx 400, dy −100**, and 2 installs tag 2, the same cel at
 *   **dx 200, dy −100**. Tags 1 and 3 are the ten cels it spins through in the
 *   air, and they hold their last. The caller at `0x41973e` spawns them in a
 *   loop — one, then another for as long as a fresh `0x434540(5)` still beats
 *   the count — so a throw is one to four of them. `0x41902c`: on the floor,
 *   against anything, or a thousand from the player in X, it floods the window
 *   with palette 5 (`0x40e4c0`), says 0x2e and breaks on `0x46d740`, whose end
 *   (`0x419169`) removes it.
 * - **`0x419910`**, from state 2 tag 0 on frame index 2 — the flip's breath. It
 *   puts the thing **40** pixels in front (`0x41994f`: `and eax, 0x50; sub eax,
 *   0x28`) and installs `0x46d710` tag 0, cel 5527 lifting **dy −30**, whose
 *   end hands to tag 1's four-cel fade (`0x41913d`) and whose end removes it
 *   (`0x419163`).
 */
const SPAWNS = "0x419860, 0x419910" as const;

/** `0x46d740` — the glass breaking, one frame a cel, and gone at its end */
const SHATTER = { cels: [5530, 5531, 5532, 5534, 5536, 5538, 5539], hold: 1 };

/**
 * `0x46d658` tag 0 or 2 then 1 or 3 — the spin, whose last cel holds. The launch
 * frame's `dx` and `dy` go in once through the class's 13 (`0x42f8b0`, away from
 * zero): 400 is 31 and 200 is 16, and −100 is a rise of 8.
 */
const shard = (dx: number, tag: number): CastKit => ({
  cels: [5520, 5521, 5522, 5523, 5524, 5525, 5526, 5527, 5528, 5529, 5520],
  hold: 1,
  speed: Math.ceil(dx / 13),
  rise: Math.ceil(100 / 13),
  // `0x418f41` — 0.6 through `0x42f850`
  pull: 6,
  ahead: 0x46,
  lift: 0x8c,
  blow: 0x64,
  // `0x41904f`
  reach: 0x3e8,
  impact: SHATTER,
  // `0x419056`..`0x419064` — the flash is unconditional, so no band limits it
  bang: { sound: 0x2e, flash: 5, near: { x: Infinity, y: Infinity } },
  from: `0x419860, script 0x46d658 tag ${tag}`,
});

/** `0x4198e0` and `0x4198f5` — the roll's two throws */
export const TUBE_SHARDS: readonly CastKit[] = [shard(400, 0), shard(200, 2)];

/**
 * `0x419910` — the breath: `0x46d710`, one frame of 5527 with `dy −30` (a rise
 * of 3 through the 13) and four of fade, five frames and gone.
 */
export const TUBE_BREATH: CastKit = {
  cels: [5527, 5526, 5525, 5524, 5523],
  hold: 1,
  speed: 0,
  rise: Math.ceil(30 / 13),
  pull: 6,
  ahead: 0x28,
  lift: 0x8c,
  // `0x419150`
  blow: 0x64,
  life: 5,
  from: "0x419910, script 0x46d710",
};

/**
 * Its repertoire, by kind and tag, straight out of `0x46d780`…`0x46da30`.
 *
 * Every cel, hold, stride and lift below is the script's own; `hold` is the
 * script header's `ticksPerFrame`. The cels are absolute — `0x419243` writes
 * `0x14e6`, 5350, into `obj+0`, which is the plate the scripts are already
 * counted from.
 *
 * **The class walks.** Three of the eleven carry a stride — the walk at a flat
 * 65, the run at 130, the charge escalating to 245 — and two of `lab.snd`'s
 * names are `#0207 TT WALK1` and `#0208 TT walk2`, which `0x419392` and
 * `0x4193ac` fire on frames 3 and 7 of that walk. The page's {@link Foe.gait}
 * for `inittube` is `0x46d790`, the one standing cel of the decider, and
 * `travels()` therefore answers false and spends none of it; that is the page's
 * call and not this file's, and it is written up in this module's report.
 */
export const TUBE = {
  /**
   * kind 0 — `0x46d780`. One cel and **`ticksPerFrame` 0**: the tank it is
   * still standing in. `0x411c35` is the only thing in the binary that installs
   * it, so the machine can never get back here and this brain never puts it on
   * — state 0 below holds whatever the page is already showing, which is the
   * same cel.
   */
  dormant: { cels: [5350], hold: 0, kind: 0, tag: 0, from: "0x46d780 tag 0" },
  /** kind 3 — `0x46d790`. One standing cel, and the whole fight is decided over it */
  stand: { cels: [5350], hold: 1, kind: 3, tag: 0, from: "0x46d790 tag 0" },
  /** kind 1 — `0x46d878`. Ten cels at 65, and the only thing it walks in on */
  walk: {
    cels: [5350, 5351, 5352, 5353, 5354, 5355, 5356, 5357, 5358, 5359],
    hold: 2,
    dx: [65, 65, 65, 65, 65, 65, 65, 65, 65, 65],
    kind: 1,
    tag: 0,
    from: "0x46d878 tag 0",
  },
  /** kind 5 — `0x46d8d0`. The same ten cels, twice the stride: the run */
  dash: {
    cels: [5350, 5351, 5352, 5353, 5354, 5355, 5356, 5357, 5358, 5359],
    hold: 2,
    dx: [130, 130, 65, 130, 130, 65, 130, 65, 130, 65],
    kind: 5,
    tag: 0,
    from: "0x46d8d0 tag 0",
  },
  /** kind 4 — `0x46d7a0`. Four cels of its own, and the stride climbs to 245 */
  charge: {
    cels: [5410, 5411, 5412, 5413],
    hold: 1,
    dx: [65, 185, 215, 245],
    kind: 4,
    tag: 0,
    from: "0x46d7a0 tag 0",
  },
  /** kind 2 tag 0 — the flip, and `0x419425` breathes out of frame index 2 */
  flip: {
    cels: [5500, 5501, 5503, 5503, 5503],
    hold: 1,
    kind: 2,
    tag: 0,
    from: "0x46d830 tag 0",
  },
  /** kind 2 tag 1 — the same three cels backwards: the wind-down */
  unflip: {
    cels: [5503, 5501, 5500],
    hold: 1,
    kind: 2,
    tag: 1,
    from: "0x46d830 tag 1",
  },
  /** kind 6 — `0x46d7c8`. Twelve cels going nowhere, and what it does over a downed player */
  writhe: {
    cels: [
      5424, 5425, 5460, 5461, 5462, 5462, 5461, 5462, 5462, 5460, 5425, 5424,
    ],
    hold: 1,
    kind: 6,
    tag: 0,
    from: "0x46d7c8 tag 0",
  },
  /** kind 7 tag 0 — nine cels, the attack the innermost band and the charge both end in */
  overhead: {
    cels: [5400, 5401, 5402, 5403, 5404, 5405, 5406, 5407, 5408],
    hold: 1,
    kind: 7,
    tag: 0,
    from: "0x46d928 tag 0",
  },
  /** kind 7 tag 1 — eight cels of its own, and the one it reaches with at range */
  swipe: {
    cels: [5480, 5481, 5482, 5483, 5484, 5485, 5486, 5487],
    hold: 1,
    kind: 7,
    tag: 1,
    from: "0x46d928 tag 1",
  },
  /** kind 8 tag 0 — the rear back, and its END is what throws ({@link SPAWNS}) */
  rear: {
    cels: [5460, 5461, 5462, 5463],
    hold: 2,
    kind: 8,
    tag: 0,
    from: "0x46d9b8 tag 0",
  },
  /** kind 8 tag 1 — two cels, installed as `obj+0x44 + 1` at `0x41972a` */
  hurl: {
    cels: [5464, 5465],
    hold: 2,
    kind: 8,
    tag: 1,
    from: "0x46d9b8 tag 1",
  },
  /**
   * kind 8 tags 2 and 3 — in the data and unreachable.
   *
   * `0x46d9b8` is pushed exactly twice in the whole binary, at `0x419556` with
   * tag 0 and at `0x419730` with tag 0 + 1, so nothing ever installs either of
   * these; their six cels are the flip's, 5500…5505. State 8's sub-dispatch at
   * `0x4196fa` nevertheless has a case for tag **3** (and none for tag 2), so
   * `0x41978a` is dead code. Carried for the record, never put on.
   */
  spare: [
    {
      cels: [5500, 5501, 5502],
      hold: 2,
      kind: 8,
      tag: 2,
      from: "0x46d9b8 tag 2",
    },
    {
      cels: [5503, 5504, 5505],
      hold: 2,
      kind: 8,
      tag: 3,
      from: "0x46d9b8 tag 3",
    },
  ] as const,
  /** kind 9 — the flinch. {@link NOT_HERE}: the page plays it */
  flinch: { cels: [5350], hold: 3, kind: 9, tag: 0, from: "0x46da20 tag 0" },
  /** kind 10 — the death. {@link NOT_HERE}: the page plays it */
  death: {
    cels: [5440, 5441, 5442, 5443, 5444, 5445],
    hold: 3,
    kind: 10,
    tag: 0,
    from: "0x46da30 tag 0",
  },
  /**
   * `0x46da68` — the descending list `0x45ef70` is handed at `0x411bff`, and it
   * is zero-terminated, so there are **three** of them and `0x45f070` can only
   * answer 0…3. That is what makes the band dispatch's `cmp eax, 3; ja` at
   * `0x419483` cover every case it can see, −1 (behind) falling straight
   * through it.
   */
  bands: [260, 140, 100],
  /**
   * `lab.snd`'s own names, and they are what this class is actually CALLED.
   *
   * 0x17 is `#0120 mace swis[h]`, 0x19 `#0201 test tube`, 0x1a
   * `#0202 test tube`, 0x1d `#0206 tt flip`, 0x1e/0x1f `#0207 TT WALK1` and
   * `#0208 TT walk2`, and 0x20 `#0209 ttcall`. 0x18 is the death's and
   * 0x1b/0x1c the flinch's — both {@link NOT_HERE}.
   */
  call: 0x20,
  notice: 0x19,
  hiss: 0x1a,
  mace: 0x17,
  flipSay: 0x1d,
  /** `0x419392` and `0x4193ac` — frames 3 and 7 of the walk, and see {@link FOOTSTEPS} */
  step: [0x1e, 0x1f],
  from: "0x4192c0",
} as const;

/**
 * The two footstep calls.
 *
 * State 1 opens `cmp word ptr [esi+0x42], 3` and `cmp word ptr [esi+0x42], 7`
 * (`0x419385` and `0x41939f`) and says {@link TUBE.step} on each — `obj+0x42`
 * being the frame index `0x45d090` rewinds at `0x45d0ab`. The think runs once
 * an engine frame and the walk holds each cel for two, so each call is made on
 * both of the frames its cel shows, as the executable makes it.
 */
const FOOTSTEPS = "0x419385, 0x41939f" as const;

/**
 * `obj+0x42` as the think reads it: the animator (`0x45d0f0`) has already run
 * once for every frame since the install, advancing after `ticksPerFrame` of
 * them.
 */
const frameIndex = (e: Enemy): number =>
  Math.min(e.anim.cels.length - 1, Math.floor(e.clock / e.anim.hold));

/**
 * `inittube`'s own machine, states 0 to 8.
 *
 * The shape is the punk's — a jump table over `obj+0x18` with one state that
 * thinks every frame and eight that wait for `obj+0x46` — but the judgement is
 * much smaller: no side to want, no decision budget, no crowding test, no wall
 * test, and only one counter in the whole class.
 */
export const tube: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, TUBE.bands);
  // `0x411c19` — the creator seeds the beat at zero
  e.beat ??= 0;
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x41933a`: in the tank, and the one thing that ends it.
     *
     * `0x434200(player.point, AI+4)` — the player's own point inside the four
     * words `0x411c04` copied out of this record — and nothing else. No script
     * test, no sight line, no radius. The page keeps the same rect as
     * {@link Enemy.fighting}.
     *
     * Nothing installs `0x46d780` but the creator, so this returns `false`
     * without putting a script on rather than re-installing a script with no
     * tick rate: the page is already holding cel 5350, which is the only cel
     * that script has.
     */
    case 0:
      if (!e.fighting) return false;
      // `0x419363` — and it calls out as it steps down, through `0x40f090`:
      // the mixer's channel 0. The engine positions this one at the PLAYER's
      // point, not its own
      k.say(e, TUBE.call, "lead");
      return install(e, TUBE.stand);
    /**
     * ---- 1, `0x419385`: the walk, which ends facing him.
     *
     * The two footstep calls it makes on the way are {@link FOOTSTEPS}.
     */
    case 1:
      if (frameIndex(e) === 3) k.say(e, TUBE.step[0]);
      if (frameIndex(e) === 7) k.say(e, TUBE.step[1]);
      if (!done) return false;
      // `0x4193c4` — forward distance negative means he got behind it
      if (t.forward < 0) e.facing = -e.facing;
      return install(e, TUBE.stand);
    /**
     * ---- 2, `0x4193e5`: the flip, and it tracks him through the whole of it.
     *
     * The turn is not gated on anything: `0x4193e5` flips the mirror flag on
     * any frame the forward distance is negative, so the flip follows him
     * round. Then it sub-dispatches on `obj+0x44` — tag 0 hands to tag 1 when
     * its five cels run out and breathes out of frame index 2 on the way
     * ({@link SPAWNS}), tag 1 hands back to the decider, and any other tag
     * falls straight out at `0x4193fe`.
     */
    case 2: {
      if (t.forward < 0) e.facing = -e.facing;
      const tag = e.tag ?? 0;
      // `0x419403` — and `0x41941a` breathes on frame index 2, asked after the
      // hand-over, so never on the frame tag 1 goes on
      if (tag === 0) {
        if (done) return install(e, TUBE.unflip, true);
        if (frameIndex(e) === 2) k.cast(e, TUBE_BREATH);
        return false;
      }
      // `0x419433`
      if (tag === 1) return done ? install(e, TUBE.stand) : false;
      return false;
    }
    // ---- 3, `0x419453`: the decider, and the only state that thinks every frame
    case 3:
      return decide(e, k, t);
    /**
     * ---- 4, `0x41964a`: the charge, and what it is FOR is ending up behind him.
     *
     * `0x419655` is `xor byte ptr [esi+0x28], 1` with no test in front of it —
     * the charge always turns round when it stops, whichever side of him it
     * came out on — and then it swings at whatever is now in front.
     */
    case 4:
      if (!done) return false;
      e.facing = -e.facing;
      k.say(e, TUBE.flipSay);
      return install(e, TUBE.overhead, true);
    // ---- 5, `0x419681`: the run, which ends facing him, like the walk
    case 5:
      if (!done) return false;
      if (t.forward < 0) e.facing = -e.facing;
      return install(e, TUBE.stand);
    /**
     * ---- 6 and 7, `0x4196ad` and `0x4196cd`: play out, hand back.
     *
     * Two states with the same three instructions in them. State 7 is BOTH of
     * the attack tags — `0x4196cd` has no sub-dispatch, so the overhead and the
     * swipe end the same way — and state 6 is the writhing, which is what it
     * does over a player who is down and one of the four things band 1 can roll.
     */
    case 6:
    case 7:
      return done ? install(e, TUBE.stand) : false;
    /**
     * ---- 8, `0x4196ed`: the throw, in two halves.
     *
     * The only state with a tag dispatch. Tag 0's end says `0x1d` and installs
     * the same script again at **`obj+0x44` + 1** (`0x41972a`) — the one place
     * in the class a tag is arithmetic rather than a constant — and then throws
     * ({@link SPAWNS}). Tag 1 hands back to the decider. `0x4196fa` also has a
     * case for tag 3, which nothing can reach ({@link TUBE.spare}), and none
     * for tag 2, which would fall out at `0x419703`.
     */
    case 8: {
      if (!done) return false;
      const tag = e.tag ?? 0;
      // `0x419708`
      if (tag === 0) {
        k.say(e, TUBE.flipSay);
        install(e, TUBE.hurl, true);
        // `0x41973e` — one, then another while a fresh `0x434540(5)` beats the
        // count, each one `0x419860`'s own `0x434540(2)` between the two throws
        let thrown = 0;
        do {
          thrown += 1;
          k.cast(e, TUBE_SHARDS[k.roll(2) - 1]);
        } while (k.roll(5) > thrown);
        return false;
      }
      // `0x419771` and `0x41978a`
      if (tag === 1 || tag === 3) return install(e, TUBE.stand);
      return false;
    }
    default:
      return false;
  }
};

/**
 * State 3, `0x419453` — the whole of the fight, decided fresh every tick.
 *
 * There is no `obj+0x46` test anywhere in it: `0x46d790` is one cel, and the
 * state exists to be re-entered. Face him, answer the one thing that overrides
 * the band — he is off his feet — and then act on the band.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
): boolean {
  // `0x419453` — and this one does NOT return: it turns and carries on deciding
  if (t.forward < 0) e.facing = -e.facing;
  // `0x41945f` — `0x402f60`, the player upright. He is not, so it writhes at him
  if (k.player.down) return install(e, TUBE.writhe);
  // `0x41947e` — `movsx` of the BAND against `cmp eax, 3; ja`, so −1 falls out
  switch (t.band) {
    // `0x419493` — beyond 260 it runs, and that is all it does out there
    case 0:
      return install(e, TUBE.dash);
    // `0x4194a8` — 140…260, and the only band with any patience in it
    case 1:
      return waver(e, k);
    /**
     * `0x4195b9` — 100…140. A coin, and both sides say `#0120 mace swish`
     * first: heads it reaches with the swipe where it stands, tails it charges,
     * which ends turned round and swinging (state 4).
     */
    case 2: {
      const coin = k.roll(2);
      k.say(e, TUBE.mace);
      return coin === 1
        ? install(e, TUBE.swipe, true)
        : install(e, TUBE.charge);
    }
    // `0x419622` — inside 100, and it brings the overhead down with no coin at all
    default:
      k.say(e, TUBE.flipSay);
      return install(e, TUBE.overhead, true);
  }
}

/**
 * Band 1, `0x4194a8` — the middle distance, where the class has its one counter.
 *
 * Two things happen here and the first one wins. `0x4194ac` compares the
 * player's `obj+0x28` with its own: the decider has already turned to face him,
 * so the two mirror flags AGREEING means he is looking the same way it is —
 * his back is turned — and it says `#0201 test tube` and walks in. Otherwise
 * `AI+2` counts down a tick at a time and the tube simply stands there until it
 * goes negative.
 */
function waver(e: Enemy, k: BrainCtx): boolean {
  // `0x4194b1` — his mirror flag against its own
  if (k.player.facing === e.facing) {
    k.say(e, TUBE.notice);
    return install(e, TUBE.walk);
  }
  /**
   * `0x4194df` — read, store one less, and return while the value READ was
   * still at or above zero. The creator seeds it 0, so the first two visits are
   * spent and the third rolls.
   */
  const beat = e.beat ?? 0;
  e.beat = beat - 1;
  if (beat >= 0) return false;
  /**
   * `0x4194f3` — `0x434540(7)` then `inc ax`, so **2 to 8**, and the same
   * number is both the new counter (`0x4194ff`) and the pick: `0x419506`
   * subtracts 2 and jumps through the seven-wide table at `0x419840`. A high
   * roll therefore both acts AND buys the longest pause before the next one.
   */
  const roll = k.roll(7) + 1;
  e.beat = roll;
  switch (roll) {
    // `0x419519` — four of the seven, the swipe from where it stands
    case 2:
    case 3:
    case 4:
    case 5:
      k.say(e, TUBE.mace);
      return install(e, TUBE.swipe, true);
    // `0x419541` — the rear-back, whose end is the throw
    case 6:
      k.say(e, TUBE.flipSay);
      return install(e, TUBE.rear, true);
    // `0x419569` — and one in seven it just writhes at him
    case 7:
      k.say(e, TUBE.hiss);
      return install(e, TUBE.writhe);
    // `0x419591` — the flip, which breathes something out on its third frame
    case 8:
      k.say(e, TUBE.flipSay);
      return install(e, TUBE.flip, true);
    default:
      return false;
  }
}

export {
  NOT_HERE as TUBE_NOT_HERE,
  SPAWNS as TUBE_SPAWNS,
  FOOTSTEPS as TUBE_FOOTSTEPS,
};
