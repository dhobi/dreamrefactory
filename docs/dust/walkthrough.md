# Playing Dust: a walkthrough from the disc's own saves

*Prerequisite: nothing. This page is for playing the game. Where it came from and
how far it can be trusted is [the golden thread](thread.md).*

This is not a walkthrough somebody wrote from memory. `gamefiles/save/` holds
**a continuous session saved about sixty times** — CyberFlix's own playthrough,
written by the shipped `DF.EXE`, running from the first night in Diamondback to
the closing scene on day 5. Most steps below are a change those saves record, in
the order they record it. The rest are read out of the game's own scripts, which
is the stronger source where it exists.

So read it with its grain in mind:

- **What the saves know is the *what*, not always the *how*.** They record that
  `fearphase` went 0 → 2 and that a Cigar arrived in your hand. They do not
  record which line of dialogue you picked. Where the how is not in the data,
  this page says so rather than inventing it.
- **Most steps end with a save name in brackets.** `[D2A_003]` means the file
  `D2A_003.RTD`, in the play page's **From the disc** folder, *is* the game
  immediately after that step. Stuck, curious, or in a hurry — load it and carry
  on from there. That is the one thing this walkthrough has that no other does.
  The opening minutes have no save of their own — the collection begins at
  `D1E_001`, a few minutes in — so those steps are taken from the scripts.

  To open the game already at one of them, in a real window:

  ```
  npm run dev:dust                 # in one terminal
  npm run watch:dust -- D2A_006    # in another
  npm run watch:dust -- --list     # every rung, in the order they were made
  ```

  It boots (about three minutes), loads that save, and leaves the window open —
  and prints the room and view to the terminal as you walk, which is how you
  check a step on this page against the game.
- **It is one route, not the only one.** Dust is a town you wander, and much of
  what the original player did was optional. Treat the order as a thread to
  follow, not a combination to enter.
- **Puzzle answers are not from the saves at all** — they are read out of the
  game's own scripts, and they are exact. They are collected at the bottom, so
  you can avoid them until you want them.

## Before you start

From the disc's own release notes, which are worth taking literally:

> As the stranger who wanders in from the desert, you enter the gates of
> Diamondback possessing little more than your wits. … **On the first day you'll
> need to find and procure a gun, bullets, and a new pair of boots.** Survive that
> first day and things should begin to fall into place.

- **Arrow keys walk**, up is forward, left and right turn. The mouse is your hand.
- **Click people to talk**, click them again to hear it again. Click objects to
  look; some can be taken.
- **The cowboy at the lower right is your inventory.** The cow skull is the
  control panel — save, load, sound, help.
- **`Esc` skips** an animation or ends a conversation.
- Read *The Diamondback Rattler* every day. Buy the town history at the
  Curiosity Shop.

Your money starts at **$5**, peaks at **$800** on the afternoon of day 2, and
finishes the game at **$167** — with **$587** left in the bank. The saloon is
where all of it comes from; see [Money](#money) below.

---

## Day 1 — night

You arrive after dark. The whole first day is one long night, and it is the
tightest, most scripted stretch in the game.

The opening is the one part of this page that comes from `HELP1.PUP` rather than
from a save, because the collection starts a few minutes after it. It is
therefore the *exact* sequence rather than an inferred one.

1. **Walk up the street from the gate.** The dog at the edge of town growls twice
   before it does anything else.
2. **Talk to the help character.** He is the disc's own hand on your shoulder,
   and he is rude about it. Three replies are offered; the one that matters is
   **"Who you calling stupid?"** — it is the only branch that runs
   `sendtoprop("bone", setupprop("street"))`, which is to say **it is what puts
   the bone in the street.** Pick the other two and there is no bone.
3. **Pick up the Bone, and give it to the dog.** The dog goes away.
4. **Talk to the help character again.** His script opens with
   `if actorvisible("dog") = false` → `givesring()`: with the dog gone he hands
   you the **Ring** (`addinven("ring")`), takes his leave, and **puts Jones at
   the bar** (`sendtoactor("jones", setupactor("bar"))`). `helpphase` reaches 3
   and the game proper starts.

   The two replies he offers here — *I want to learn how to play* / *I already
   know how to play* — both end at `ringer()`, so the Ring is not at risk.

   **A safety net worth knowing:** the first thing his script checks is
   `if playercash <= 0`, and if you are broke he gives you $5. You cannot be
   stranded penniless.

5. **Into town, and talk to Jones and Leroy.** Pick up the **Cards** and the
   **Jug**. This is where the disc's own saves begin. [`D1E_001`]
6. **Into the Hard Drive Saloon, ground floor, and play.** Seven minutes of cards
   turn **$5 into $400**. Trotter is behind the bar; the bouncer is now watching
   you. [`D1E_002`]
7. **Keep playing** — a second hand takes you to **$791** — and talk to Trotter
   and Gus. The Jug fills up. [`D1E_003`]
8. **Upstairs in the saloon**, talk to Oona. Something costs $10. Trotter's thread
   moves again. [`D1E_004`]
9. **Give the Ring to Ruby** in the saloon's back room — this is what her whole
   thread hangs off. Then over to the **hotel**, where you meet Fear and come away
   with a **Cigar** and the **HHKey**. [`D1E_005`]
10. **Give the Cigar to Laurel.** You get a **BKnife**. Buick's thread opens and
    Laurel is now on your side (`laurelgood`). [`D1E_006`]
11. **To the Mayor's house** — the hall and the study. His wife talks to you.
    [`D1E_007`]
12. **Take the Postcards**, and talk to Marie. [`D1E_008`]
13. **Take the HRKey** — your hotel room key. `phase` 6 → 8, which is the game
    saying day 1's business is done. [`D1E_008B`]
14. **Back out into the night.** There is a fight — the original player came out
    of it with `playerpower` at 24 and `fightover` set — and a conversation with
    Jenix. It costs $15. [`D1E_009`]
15. **Sleep.** Every character's thread resets to 0 and the clock rolls to
    morning. [`D2M_001`]

> **What the saves don't say:** which answers you give anybody. The opening above
> is the exception, because it was read out of the script instead — and it is
> worth noticing that the two sources disagreed. The saves showed the Bone
> leaving and the Ring arriving across one gap, which reads as *the dog traded
> you up*; the script says the dog only has to be **gone**, and the Ring is the
> help character's parting gift. That is the difference between what changed and
> what caused it.

---

## Day 2 — morning

You wake in the hotel room with **$760**. This is the day the release notes are
talking about: gun, bullets, boots.

1. **Shopping.** Six minutes and **$750** buys you **Sugarcubes, Flowers, a Pie,
   Biscuits and Boots**. Give Laurel the Cigar. You end the run at the courthouse
   with $10. Along the way Jones, Fear, Buick, Laurel and Quist all open, the
   robber appears (`dayrobber`), and you learn Oona's story about the kid
   (`oonakidstory`). [`D2M_002`]
2. **The general store.** Bolivar. Something costs $3 and you play the slots.
   You are holding the HHKey. [`D2M_003`]
3. **Take the Mask.** The Apple goes into the birdcage. The Mayor's wife is
   annoyed with you (`mwifelike` 0 → −3), which is worth avoiding. [`D2M_004`]
4. **Take the Bullets**, and let the Postcards go. The clock rolls to afternoon.
   [`D2A_001`]

## Day 2 — afternoon

5. **Talk to the Mayor's wife again** and mend it — `mwifelike` goes −3 → **+3**.
   [`D2A_002`]
6. **The undertaker's.** Give the **Pie** to Side. You are wearing the **Boots**.
   Flippo opens. [`D2A_003`]
7. **The shooting range at the edge of town.** Nine minutes: you fire five of
   your six bullets, hit three cans, three bottles and four targets, and score
   **"good"**. You come away with the **Harmonica**. [`D2A_004`]
8. **Take the Apple back out of the birdcage.** [`D2A_005`]
9. **Give the Flowers away**, then back to the saloon: talk to Jones, the Mayor,
   Oona, Sophie and Trotter, open an **account at the bank** ($22), and play
   again — **$7 → $800**. [`D2A_006`]
10. **Give the Sugarcubes to Trotter.** Then the Curiosity Shop (`chin`): buy the
    town **History** for $35. Ruby and the help thread both move. [`D2A_007`]
11. **Get the Gun** — from Ruby, and it is a story beat of its own
    (`rubygunstory`). [`D2ARUBY`]
12. **Talk to Cobb** in the saloon. [`D2A_008`]
13. **The bank.** Your account goes to **$587** and your cash to **$200**;
    Jones's thread jumps to 999, which is the game marking that strand finished
    for the day. [`D2A_009`]

## Day 2 — night

14. **The jail. Take the Badge.** You are carrying five bullets again and the
    Mayor is talking to you. [`D2E_001`]
15. **The saloon, upstairs.** Buick, Dell, the help character, Jones, Marie,
    Oona and Sonoma all open — this is an "ask everyone everything" evening.
    [`D2E_002`]
16. **Take the Hairpin** in Ruby's room; talk to Sophie. [`D2E_003`]
17. **Take the Yunnibook** — this is the one that matters four days later. Then
    the hotel; $50 goes somewhere. [`D2E_004`]
18. **Sleep.** [`D3M_001`]

---

## Day 3 — morning

You wake with **$150**, and this is the longest single gap on the whole thread:
**twenty-two minutes** of play between waking and the next save. Whatever the
original player did that morning, they did a lot of it.

1. **Get the Sugarcubes back from Trotter**, and learn the story of the Ring
   (`jonesringstory`) — Jones, Buick, Fear and the Mayor's wife are all part of
   that morning. [`D3M_002`]
2. **Take the Matchbox.** Another trip to the range (three shots, three cans,
   three bottles, three targets — this time you only score **"fair"**), and the
   Curiosity Shop again. [`D3M_003`]
3. **The schoolhouse.** Laurel and Sonoma. [`D3M_CLAS`]
4. **Give the Matchbox to the scorpion.** [`D3M_004`]
5. **Take the Pages** — and the Matchbox back. Meanwhile the **Ring passes from
   Ruby to Jones**, which is the payoff of the story you learned this morning.
   [`D3M_005`]

## Day 3 — afternoon

6. **Take the RX** — the prescription — and go to the doctor's. [`D3A_002`]
7. **The bottle puzzle**, in the doctor's dispensary. The answer is
   [in the puzzles section](#the-eight-bottles). [`D3A_003`]
8. **Hand over the RX and take the Flute.** Half the town's threads move on this
   one step. [`D3A_004`]

## Day 3 — night

9. **The saloon.** [`D3E_001`, `D3E_002`]
10. **Win the Tbird stone at poker.** This is a real hand: three rounds, the bet
    order was *mez, zeb, pete*, and `winner` came out **"player"**. You end $18 up.
    [`D3E_003`]
11. **Crack the safe.** The combination is
    [in the puzzles section](#the-safe) — the save is the moment it opens, and
    what comes out is the **Tstone** and the five **bounty** numbers.
    [`D3E_004`]
12. **Blood's thread opens** (`bloodphase`), and `phase` reaches 4. [`D3E_005`]
13. **Sleep.** [`D4M_001`]

---

## Day 4 — the day it all happens

Day 4 is short above ground and enormous below it.

1. **The saloon, with the HHKey.** Jones and Trotter both jump straight to phase
   2. [`D4M_002`]
2. **The fight.** `fighton`, `fightphase` 4, `wincount` 3, five `cutdowns`, and
   your hit count doubles from 14 to 28. You take the **Blade**, and your bullets
   are back to six. It is night by the time it ends. [`D4E_001`]
3. **The Santa Marta Mission.** Sonoma. You are carrying the Blade. [`D4M_MISS`]
4. **Put the Tstone in the box.** The lights go out (`blackout`) and you are in
   the **hub** — the underground. [`D4MINES`]

### Underground: the sundial hub

The hub is a room with **three dials**, and the dials are a destination selector,
not a lock: you set them, you leave, and you arrive somewhere else. All four
combinations are [in the puzzles section](#the-sundial), and the order the
original player used was **flute → snake → mine → thunderbird**.

5. **Dial the flute room, and go.** [`FLUTEPZL`]
6. **Give the Flute to the temple.** The flute puzzle is done. Dial the snake
   room. [`DAGRPZL`]
7. **Give the Blade to the snake.** [`MSKPZL`]
8. **Give the Mask to the skeleton** — that is the mine. Dial the thunderbird
   room. [`MESAPZL`]
9. **Give the Tbird stone to the temple.** Four for four. [`ENDPZL`]
10. **Take the Tbird back, and give up the Gun.** [`BLDSTPZ`]
11. **Set the dials to 12 / 4 / 12 and leave.** With all four puzzles done, this
    is the ending: the shaman puts something down, the **chest** appears, and
    `chestapp.mov` plays. [`ENDING`]

---

## Day 5 — the end

You are back in town in the morning holding the **chest**, and the game plays
out. That is where the disc's own saves stop.

---

## The puzzles, solved

These come from the game's scripts, not the saves, so they are exact.

### The safe

`CRACK.FLT` compares your dial against one hard-coded string:

    if combo != "08,23,41,"

**8, then 23, then 41.** The save `D3E_004` is the state with it open.

### The eight bottles

`DRUG.FLT` checks the eight bottles against one pattern:

    if bottles = "1,1,0,0,1,0,1,1,"

**Take the 1st, 2nd, 5th, 7th and 8th; leave the 3rd, 4th and 6th.**

### The sundial

`SUNDIAL.FLT`'s `exitsundial()` reads the three dials as you leave the hub and
sends you where they point. It is large / medium / small:

| large | medium | small | goes to |
|---:|---:|---:|---|
| 4 | 8 | 12 | the **mine** — give the Mask to the skeleton |
| 8 | 12 | 4 | the **snake** — give it the Blade |
| 12 | 4 | 8 | the **thunderbird** — give the temple the Tbird stone |
| 0 | 0 | 8 | the **flute** room — give the temple the Flute |
| **12** | **4** | **12** | **the ending** — but only once the other four are done |

A combination whose puzzle is already `done` is skipped, so you cannot go back
round in circles.

### The flute

`FLUTE.FLT` builds a five-note string as you play (`flutestr`), one note at a
time, and resets it to `0,0,0,0,0,` after the fifth. The save that has the room
solved carries exactly that reset string — so the puzzle is played, not
remembered, and the saves cannot hand you the tune.

---

## Money

Worth knowing before you spend anything, because the thread's own player was
broke twice:

| | cash | in the bank |
|---|---:|---:|
| you arrive | $5 | — |
| after the saloon, night 1 | $791 | — |
| after day 2's shopping | $7 | — |
| after the saloon, day 2 | $800 | $22 |
| after the bank, day 2 | $200 | $587 |
| the rest of the game | $150 – $168 | $587 |

The saloon is where the money comes from, both times. The bank is where it
survives the night.

---

## Where this walkthrough is thin

Said plainly, because a walkthrough that hides its gaps is worse than one that
doesn't have them:

- **The 22-minute morning of day 3** (`D3M_001` → `D3M_002`) is one rung with
  seven changes in it. Something happened in there that the saves compress to
  nothing.
- **Conversation choices are nowhere in the data.** Every "talk to X" step is
  real — the save proves the conversation ran — but which reply advanced it is
  not recorded.
- **The fight on day 1 and the fight on day 4** are recorded as outcomes, not as
  tactics.
- **Day 5** is one save long.

If you play it and a step is wrong or missing, that is exactly the feedback that
fixes this page — and the fix is usually one grep away in the scripts.

Back to [Dust](README.md), or on to [the golden thread](thread.md) for how this
was derived.
