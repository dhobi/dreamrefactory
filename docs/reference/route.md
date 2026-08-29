# The route

*Prerequisite: [Tests](tests.md), and
[How we know it's right](../taoot/verification.md) for what the playthrough is for.*

This page is the route itself: what the twenty-seven segments cross, how much of
it to run while you work, what driving each of the game's minigames costs, and
the conventions a new segment will trip on. The suites that run it are
**[the test reference](tests.md)**.

**The game is won.** The route plays from the cold boot to the credits in one
continuous session and the closing narration comes out `mission = "good"` — all
four artifacts the ending is scored on in Frank's hands, `onehappens`,
`twohappens` and `revhappens` all false. Both hosts agree: `npm run
test:playthrough` **30/30** headless, and the browser gate **91 beats over 27
segments with no divergence at all** — every one of them carried, zero checkpoint
loads, 23.7 min, ending on `credits.mov`.

## The twenty-seven segments

Each row is one test in
[`playthrough.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/playthrough/playthrough.ts),
one function in
[`segments.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/playthrough/segments.ts),
and one `.ti` in `out/checkpoints/` named for the state it *starts* from.

| segment | from | crosses | ends |
|---------|------|---------|------|
| 1 | the boot | mission 0 → mission 1 phase 0 | the London flat, the bomb, the crossing |
| 2 | m1p0 | m1.0 → m1.1 | boarding, the gym, Penny's briefing |
| 3 | m1p1 | m1.1 → m1.2 | the wireless room, the trunk, the Enigma |
| 4 | m1p2 | m1.2 → m1.3 | the turbine plant, and the engineer's thanks |
| 5 | m1p3 | m1.3 → m1.4 | the Rubaiyat hidden in a coal bunker, then taken back |
| 6 | m1p4 | m1.4 → **m2.0** | **the necklace sub-plot**, then Penny's debrief; mission 1 is complete |
| 7 | m2p0 | m2.0 | the Purser's errand, and into the wireless room |
| 8 | m2gram | m2.0 | the set switched to transmit, Thayer's telegram sent |
| 9 | m2sent | m2.0 | the report, the passenger manifest read, `purs` at "none2" |
| 10 | m2man | m2.0 | the cufflink errand, and Straus's cufflink out of a reception chair |
| 11 | m2link | m2.0 | the cufflink handed over, the car keys off the office wall |
| 12 | m2keys | m2.0 → **m2.1** | the hold, the car's headlight, the crate, the painting |
| 13 | m2p1 | m2.1 | Max, Smethells, the squash court, and the first fencing bout won 5-0 |
| 14 | m2fence | m2.1 → **m2.2** | Smethells hands over Willy's ring for one win |
| 15 | m2p2 | m2.2 → **m2.3** | Clariss Limehouse identifies the ring, and keeps it |
| 16 | m2p3 | m2.3 → **m3.0** | Penny's debrief; mission 2 is complete |
| 17 | m3p0 | m3.0 | Willy's body in the Turkish bath, and the Rubaiyat clue |
| 18 | m3clue | m3.0 | the rope on Scotland Road, and the Hacker's phrase for the clue |
| 19 | m3phrase | m3.0 | the Old Reds off Willy and Zeitel's table in the cafe |
| 20 | m3cigs | m3.0 → **m3.1** | the cigarettes to Max in the smoking room |
| 21 | m3p1 | m3.1 | the Chief Engineer's second favour: the turbine plant again, and the engine-room door |
| 22 | m3thanks | m3.1 → **m3.2** | the fight with Vlad, won 512-0 |
| 23 | m3p2 | m3.2 | nine floors of the false smokestack, solved, to the notebook's platform |
| 24 | m3top | m3.2 → m3.3 → **mission 4** | the notebook taken, and given to Zeitel; mission 3 is complete |
| 25 | m4p0 | m4.0 | Penny recaps the case — then Zeitel's cabin, the bomb, and the notebook back |
| 26 | m4penny | m4.0 | Clariss's shawl; Zeitel's deal for the painting **refused** |
| 27 | m4anti | m4.0 → **the end** | the boat deck, a place in a lifeboat, and the closing narration |

Some of those checkpoint names are historical and no longer describe what happens
at them — segment 27 still resumes from `m4anti` although the antidote errand it
was named for is retired. The name is the file on disk; the row says what the
segment does.

Two segments are missing from that history and both are worth knowing about,
because each was deleted rather than fixed:

- There used to be a twenty-eighth that went six decks down to trade Clariss's
  shawl for the real necklace in the turbine room. It could only ever *load* — the
  trip crosses the boat deck and answers away the Gorse-Joneses' one-shot lifeboat
  offer, leaving the ending segment with nobody at the rail. The necklace sub-plot
  gets that necklace in mission 1 instead, so the trade had nothing left to buy.
- Segment 26 used to hand the painting to Zeitel for Lady Georgia's antidote and
  buy it back with a boat pass won at blackjack. `savegeorgia()`'s **102 — "No.
  You're bluffing."** is the one answer that never enters `givepaint()`, so the
  painting is simply never let go of. That retired two segments' worth of work and
  with them the only part of the run whose outcome was a property of the RNG stream
  rather than of the play. **Lady Georgia dies of the poison for it**; the closing
  narration does not score her, and `segments.ts` says so where it makes the choice.

## How much to run

The headless suite is the commit gate and is cheap enough to run every time. The
browser suite only ever says something new about the segment just written — every
divergence found so far came from the new segment, never from an old one — and a
full run spends most of its time replaying segments untouched for days.

| while | run | cost |
|-------|-----|------|
| writing a segment | `npm test && npm run test:playthrough` | ~2 min |
| that segment's cross-host check | `SEGMENTS=13 npm run test:browser:seg -w taoot` | 20 s – 5 min |
| a mission is finished | `npm run test:browser:m0 -w taoot` / `:m1` / `:m2` | 1 – 8 min |
| before a long break, or after touching nav/aim/drivers | `npm run test:browser -w taoot` | ~24 min |

The last row is the one that matters: a change to the shared navigation, aiming or
driver code is exactly what CAN break an old segment, and that is when the whole
thing earns its twenty-four minutes. It was 36.5, and what the three parts of that
difference were is TODO §4a — the accost sweep's dud clicks, one wait in the ending,
and the deck plan the map lands you on; none of them the game's own pace.

```
npm test                        # the gate
npm run test:playthrough        # 27 segments + 3 property tests — writes out/checkpoints/*.ti
TAOOT_RECORD=1 npx vitest run --config vitest.playthrough.config.ts   # re-record goldens
TAOOT_RECHECKPOINT=1 …          # …and rebuild the .ti checkpoints (after a save change)
npm run watch:m2p0 -w taoot              # watch segment 7 in a real window
SEGMENTS=9 npx tsx taoot/tests/browser/playthrough.ts    # one segment alone, ~35 s
```

## The minigames, and what driving one costs

Six of the game's mechanics are on the route. Each needed something the one before
it did not, and the shapes recur.

**The turbine plant** (segments 4 and 21) is a simulation with a fixed point, and
the route waits for it rather than for a number of ticks: `PLANT_STEADY` holds all
four flows stationary, because `iterateone` computes the flows from the levels
*before* moving them and whether one more iteration fits before a beat depends on
frames drawn. It has to be re-dialled in segment 21, and that is the save's fault,
not the plant's — the twelve plant globals have no record in the shipped template
and only three free node slots exist to make records in, so a checkpoint cannot
carry them. The dial loop is idempotent, so a carried session sets the same numbers
and waits on a fixed point it is already at.

**Fencing** (segment 13). One click does two jobs: `FENCE.STG mousedown` reads the
ATTACK quadrant out of the click point, while `playeridle` re-reads `mouse()` every
tick and sets the BLOCK from the X alone — so the route clicks in the column that
guards the side Haderlitz has chosen, and leaves the cursor there. `willieidle`
fills its four defence slots from where the cursor *is*, weakest at the cursor's own
quadrant, so attacking where you hover is attacking what he guards least. The route
wins **5-0**, and that is not showing off: `pointgoesto` moves `fencelevel` by four
per point, so a point conceded would leave the two hosts running different
difficulties and diverging on every random draw after it.

**The fight with Vlad** (segment 22) is arithmetic once the combo is right — right
cross, left cross, uppercut, repeat. `vladdamage` reads the combo rather than
`random()`, so it is **121 blows and `vladpower = -52` in both hosts**, with
`playerpower` still its opening 512. Only Vlad's blows roll dice, and cycling three
different blows on alternating sides trips none of the four repetitions that would
hand him a turn. The trap is the ending: the end-of-fight test lives in Vlad's own
idle handler, his idle only runs when the loop `vladdamage` arms comes round, and
every click cancels that loop so a blow can interrupt him. A driver clicking as fast
as it can pump starves its own win condition — 400 blows, `vladpower` −520, the flat
still open. The route stops at `vladpower < -50` and waits, which is what a player
does.

**The smokestack maze** (segment 23) is `smstack2`, one floor of an eight-scene ring
replayed eleven times. Climbing is four views and is never blocked; walking round the
ring is sixteen views the maze shuts by setting `blocks` to a comma-list of closed
gaps per (maze, level). **`mazenumber = random(4)` is drawn live at the door**, so the
two hosts need not be dealt the same maze and the golden's value is masked. That costs
nothing, because [nav/smokestack.ts](https://github.com/dhobi/dreamrefactory/blob/master/taoot/tests/playthrough/nav/smokestack.ts)
*solves* whichever maze it draws — a breadth-first over (level, position) against the
eight `blocks` strings — and asserts every move against that solution, which is a
stricter test than a fixed value. It has to solve: **one of the sixteen (maze, entry)
pairs is a dead end**, maze 4 into scene39, both gaps closed. Maze 4 is the hard one
and it climbs in 18 moves.

**The necklace sub-plot** (segment 6) is what clears `onehappens`, and it is the
longest chain on the route: `neckphase` 0 → 1 → 2 → 5 → 6 → 7 → 8 → 9, through
Georgia on three decks, Charles in the smoking room, the A-deck fusebox twice (cut
the power to draw Sasha out of his cabin, restore it so the bag can be seen into),
and `patty.stg` — a four-dial combination lock whose combination is written down in
the game's own debug cheat (`solvedoll()`: 6, 0, 0, 0). **Getting it wrong is
fatal.** `a14.Set` c54 checks that the fake necklace is Vlad's when Sasha comes back;
taking the real one without leaving the fake in its place is `playerdeath = "by
sasha"`. So the swap has to be an EXCHANGE, and `inven1.stg doneck()` enforces it
from the other side — the bag can never hold both.

**The bomb** (in segment 25) is three numbers, and `bomb.stg`'s own debug cheat
`solvebomb()` names them: `unibomdoor = 0`, `propdeg("key") = 5`, `unibompower = -1`.
The last one comes from one place — `hammershake()`, which only runs with
`unibomflag = 0`, which is only true while `switch1 = 0`, which needs the key
unturned. So the order is forced: `switch1` down, power on, solenoid up, **wait 58
iterations (~42 s) for the timer to run out harmlessly**, `switch1` back up, then the
key. `changedone()` runs after every control change and five of its nine branches are
`boomer()`. It was defused first time and costs three minutes of the endgame clock.

**Blackjack** is measured but off the route: the deck is 52 draws off a stream
every earlier gesture has been moving, so winning is a property of the world rather
than of the play, and the route stopped needing the boat pass. The same hand has
been measured winning and busting with nothing about the play changed, so a future
route must not assume the first one wins.

## Conventions a new route will trip on

Learned the hard way, all verified:

- **In mission 4, a conversation costs two minutes.** `gang.cst prepuppet()` does
  `min = min + 2` at `mission = 4`, and the sinking's phase is a clock
  ([the endgame is a countdown](../taoot/mission-flow.md#the-endgame-is-a-countdown)).
  "Ask everyone everything" is not free the way it is in missions 1–3.
- **Walking IS pressing up, and some standpoints are wired to that press.** The
  planner's walk within a room is a series of `pressUp`s, so a route crossing the
  2nd-class staircase changes deck by accident (`nav/stair2c.ts`). `faceStandpoint`
  avoids pressing up at any standpoint the ship graph knows is an exit — which is why
  a transition the graph does NOT know about is worse than a missing edge.
- **A parked movie is a question.** `nav.rush` refuses one deliberately. Use
  `clickMovie(r => …)` and name the region by what it *does* (`type === 2` pages,
  `target === "openit"` opens the Purser's window).
- **A poll loop must not be awaited.** `INVEN1.STG dobook()` parks in
  `while not button()` waiting for the player's next press — `startClick` fires the
  gesture that starts it, and the press that follows is `holdUntil`, because
  `viewer.click` moves the cursor without pressing.
- **A minigame can end on a timer your own clicks postpone.** Look for this wherever
  the thing that ENDS a minigame is a `makeloop` rather than a script the gesture
  itself runs; the fight is the worked example above.
- **Some buttons need pressing until they take.** A flat refuses input while a script
  is still running, and `clickThing` answers "it landed on the button" either way.
  `closeBunker` in segment 5 presses up to four times: headless the loop it waits on
  is already over, in a browser it is not.
- **A `trackbut` must be clicked inside the button's REGION**, not where the dark
  prop's pixels are. The shipped `trackbut` (BOOTFILE 0002) answers
  `pointinbutton(currentflat(), target, mouse())` — the flat's named click region,
  where `target` is the region the click arrived on — and the bevel it is NAMED with
  is only the highlight it shows while you hold. In practice the two coincide, which
  is why the aim points here did not move when the engine stopped transcribing this
  helper: measured, `cuff.stg` and `wireless.stg`'s `ok` regions are 429..485,
  338..362, and `fuse.stg`'s `fuseoklit` prop is 428,338 57×25. What still fails is
  aiming at the DARK prop: `fuseokdark` is 419,330 76×42 and overhangs on every side,
  so a click on its edge samples outside the region and `trackbut` answers 0,
  silently, with the flat left open. `cuffok` is the same geometry.
- **Props can be behind other props.** The Rubaiyat and the boiler switch have no
  clickable footprint until the bunker door is opened: `boildoor`'s frame is 82×120
  with all 9840 pixels opaque, at `propdist -3`, in front of both.
- **An actor outranks a hotspot in the hit order, and dismissing one takes frames,
  not an answer.** The seaman in front of the A-deck fusebox ends his own lines with
  `putdownactor()`; until that lands the second click cannot even be aimed. Waiting
  ~40 ticks after his last line is the whole fix.
- **An instrument's state can live in `propvalue`, not `propdeg`.** The wireless
  needle's frequency is its value (14..200, `tuned()` wants 34..40 to transmit); its
  deg is only which of ten pictures the small view draws. `NavDriver.propValue` exists
  for that, and both drivers mirror it.
- **Set a puzzle up BEFORE opening the flat that uses it.** `WIRELESS.STG`'s
  `openflat()` calls `setuptx()` only if the sender, the breaker and the tuner are
  already right; switch them afterwards and the morse key silently does nothing. The
  same shape will turn up wherever a flat's `openflat` reads prop owners.
- **A ratchet dial's direction is arithmetic, not a guess.** `fixdeg256` buckets the
  cursor's bearing and `limiter` takes the sign of the bucket change, so a rising
  `atan2` bearing raises the value; the swing per move has to clear a bucket (256/6 ≈ 43
  for the tuner, hence `ARC = 48`) without tripping the dial's own seam test. Tuning the
  wireless from 200 to the transmit band is ~80 swings and 12 s in a browser — there is
  no acceleration in `adjustneedle`.
- **Owner is not presence.** `actorOwner("ga")` reads `"none"` while Georgia is
  standing right there. The runtime record (`visible`, `worldX/Y/Z`, `starName`) is
  what to read, and reading the owner that way once cost a session an hour.
- **Name the standpoint in a big room; do not sweep.** `nav.accost` caps at
  `MAX_GESTURES_PER_ROOM = 60` and the boat deck has 27 scenes, so a blind sweep never
  reaches the far end of it.
- **A click that lands is not a click that worked.** `inven.shp`'s `stdmouse` gates
  every object lying in a room on `realdist(what) < hotdist()`, so a click from
  across the room reaches the thing and is then thrown away. `nav.hunt` judges a
  standpoint on what the click **moved** — the screen-level four, `handitem`, the
  thing's own owner/view/visibility/deg/value, the globals minus the self-moving
  ones — and otherwise keeps sweeping, ending with `clicked X from N standpoint(s)
  and nothing moved` instead of a false `ok` that surfaces three assertions later.
  Segment 23's notebook is the case with numbers on it: View53 is inside a 4100
  `hotdist` by 58 units and loses anyway. (`accost` is the same shape for people,
  and stays its own thing — there the effect worth waiting for is somebody
  *answering*, not the first thing that moved.)
- **A click nobody answers is worth 1.5 s, not 8.** The sweep still clicks from every
  standpoint — that is how a walking character gets time to arrive — but it stops
  waiting once the person it clicked has held still for `ACCOST_WATCH_MS`. Measured:
  every dud wait in the route (Zeitel 15×, Georgia 4×, Charles 3×) is somebody whose
  position never changes by a unit, and the wait was 8.1 s of browser time each.
  Movement, never distance: every answered click came from beyond `hotdist()` as the
  route computes it (nav/reach.ts).
- **Find a hotspot's script by container id.** `ObjectEntry.locationScript` in
  [`engine/src/df/set.ts`](https://github.com/dhobi/dreamrefactory/blob/master/engine/src/df/set.ts) maps a
  view's object to the container that handles it — that is how Sasha's door turned out
  to be the `"door"` of Scene51/View57 and not the `"knock"` beside it.
- **Bevel ids, never positions.** `PENNY1.PUP`'s `zeitelgram()` calls
  `puppetscramble()`, which shuffles its plaques.
- **`out/scripts/` is the first place to look** for any of this
  (`npx tsx tools/dumpscripts.ts`) — but it is not complete for
  BOOTFILE: five codes are dumped where boot1 and boot2 carry 78 between them, so
  `progress` looks undefined when it is not. `session.bootScripts[n].script.codes` is
  the honest list. `npx tsx taoot/tools/disasmcmd.mts <name|0xVA>` disassembles TI.EXE when
  the scripts are not enough.

Back to the [reference index](README.md).
