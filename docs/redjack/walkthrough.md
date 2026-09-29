# Playing RedJack: a walkthrough from the machine suites

*Prerequisite: nothing. This page is for playing the game. What the port is and
how far it gets is the [RedJack overview](README.md).*

RedJack has no disc saves to learn from: no save written by the original is
available. So this page comes from the headless playthrough instead. The day suites,
[`days/day1.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/days/day1.ts)
to
[`days/day7.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/days/day7.ts),
play the whole game from a cold boot to the end credits, and every step below is
one they take, in their order. **This is the route the machine suites play and
check, one route, not the only one.** The mini-games have their own suites, and
the advice for each comes from what those suites do. The
[machine suites section](README.md#machine-suites) says how they run, and
[the seven days](README.md#the-seven-days) is the same game as a table.

How to read it:

- **Every step is checked.** After each step the suite checks the flag the
  game's own script sets for it (`bonephase`, `didcannon`, `wenttop`…), so a
  step here is one the game accepts, not a guess. The flag is named in brackets
  where it helps.
- **Dialogue is exact.** A line in quotes is the text on the plaque the suite
  clicks, taken whole from the game's puppet scripts. Where a talk goes on with
  no question, the page says so.
- **The suites move the way a player does.** They walk with the arrows, click
  what is under the pointer, drag things out of the inventory and pick a line
  of dialogue by its text. Where they find a thing by a name the scripts use and
  a player never sees (a node such as `Node48`, a prop such as `rock 3`), this
  page says what it is on screen as far as the suites and the scripts tell,
  and gives the name in code for anyone following along in a debugger.
- **Puzzle answers are collected at the bottom**, so you can avoid them until
  you want them. They come from the suites and the scripts, and they are exact.

## Before you start

The play page is at `/redjack/` on the site, or on your own machine with
`npm run dev -w redjack` (port 5179). What is still missing is under
[What does not work yet](README.md#what-does-not-work-yet).

- **The arrow keys walk.** Left and right turn to the next way out of where you
  stand, and up walks along the one ahead. Some doors are not a way out but a
  jump you make by facing a direction and pressing up (the lava, the beach's
  way into the rocks). The steps below say so where it matters.
- **The pointer turns the view.** Rest it on the left or right edge of the
  screen to look round, and on the top or bottom edge to look up or down. A
  click while the view is still turning scrolls instead of reaching what you
  clicked.
- **Click people to talk**, and click a line on a plaque to answer. Some talks
  and films stop on a frame and wait for a click (Anne's letter on day 2, the
  dream on day 4).
- **The inventory is the chest at the bottom left.** It fades out unless the
  pointer is on its corner. Put the pointer there, click the chest to open it,
  and drag a thing out of it with the button held onto whatever you want to use
  it on. Click the open chest to close it.
- **People who pace are only in reach when they are near.** The bartender walks
  between two spots; wait for him to come close before you click him. A click on
  someone out of reach is a click on the room, which walks.
- **Dying ends at the menu.** The BOOTFILE's `nickdeath` plays `death.move` and
  opens the game's menu (`control.stag`). Save from the menu as you go. Its
  OPEN also lists a save for the start of each day, made by this port (see
  [Saved games](README.md#saved-games)).

---

## Day 1: Hangman's Reef, at night

You start in the town (`liznite`). Bone guards the crates on the dock, and the
crates marked with an X are going aboard Captain Justice's ship. The day ends
with you hidden in one of them.

1. **Talk to Bone, by the crates.** Answer "Who are you?", "My pockets are
   empty.", "No sir.", "I don't know her." (`bonephase` 1)
2. **Walk down to the beach.** Lyle jumps you the first time you arrive. Answer
   "Who are you?", "All right then.", "Nick.", "Were you left behind by a
   pirate ship?", "Goodbye." (`metlyle`)
3. **Walk into the woods.** Jan attacks, and Lyle saves you (`jansave.move`).
   Answer "Who was that?", "I could have taken care of myself.", "Can you teach
   me how to fight?", "Tell me what else you know.", "Can you tell me where to
   get a sword?", "I'll bring you some ale." Lyle puts the fire out on the
   beach as part of this, which matters later (`alephase` 1).
4. **Knock at the bar's door**, and answer the bartender "I want to come
   inside."
5. **The bartender, and Captain Justice.** Wait for the bartender to come near
   you, click him, and answer "Where's all the action?", "Could I have a mug of
   ale? There's a pirate on the beach who wants a drink.", "Thanks for letting
   me in.", "Have you seen anyone strange around tonight?", "Introduce me." He
   introduces Justice. Answer Justice "Yes, I came to get an ale for him.",
   "I'm an aspiring pirate.", "Do you need men on your pirate ship?", "What
   does a person have to do to become a pirate?", "I want to join your crew.",
   "A sword and experience. What else?", "How long will you be here?" You leave
   with the **mug** of ale.
6. **Out of the bar, and the ale to Lyle**, who is waiting in the woods where he
   saved you. He takes it and goes to the dock (`alephase` 2). There is no
   question in this talk.
7. **The sword.** Into the lighthouse, and through its inner door down to the
   cave (`downcave.move`). Click the trunk, take the **sword** (the **pistol**
   comes with it), and click the lid to close it. Patch is in the cave: answer
   "Who are you?", "You look like some kind of sailor.", "What happened to the
   treasure?", "When is the reunion?", "Who was the traitor?", "How many
   Brethren are left?", "Hasn't anyone tried to get the treasure?", "Where is
   this island?", "What should I do?" Then up the ladder and out of the
   lighthouse.
8. **Lyle's school, on the dock.** Click Lyle and take his three lessons, one
   after another. Each is a small game of its own; how to pass them is
   [in the fights section](#lyle-s-lessons-and-the-fight).
   - "I want to learn defense.", "I'm ready."
   - "I want to learn dodging.", "I'm ready."
   - "I want to learn striking.", "Let's fight."
9. **Fight Lyle.** "I want to fight !" (the space is the game's). Beat him with
   the sword and then dodge his bottles (`lylephase` 1). He has a last word
   about it.
10. **Bone again, twice.** Click him and answer "This is your ship?"
    (`bonephase` 2), then click him again and answer "What are you doing?" He
    and Cross go out to the ship, and the crates are no longer guarded.
11. **The charcoal.** On the beach, click the fire pit Lyle put out, click the
    stick in it to take the **charcoal**, and close the pit with its button.
12. **Mark a crate and climb in.** Click the crate on the dock. Open the chest,
    drag the charcoal onto the crate's side to draw an X, click the marked
    crate, and click to get in (`incrate.move`, `loadship.move`). You wake at sea
    and are found out (`nickdisc.move`). Day 2 starts with Justice asking.

## Day 2: the Marauder

1. **The oath.** Justice finds the stowaway. Answer "I really want to join your
   crew.", "Two men in black robes with scimitars.", "I do." (`justphase` 1).
   The crew is on deck: Lyle, Bone, Cross and Sullivan.
2. **Lyle, by the cannons, and Sullivan.** Click Lyle and answer "I feel
   fine.", "No, introduce me." He calls Sullivan over. Answer her "Hello.", "So
   far.", "Why did you join up?", "What do you mean?", "Snuck on in a crate.",
   "Why do you ask?", "No.", "OK, you go first.", "Really?", "Why did you have
   to get on the ship?", "Is he a pirate?", "Tell me more.", "That letter was
   written to your mother?", "How did she die?", "Is her husband still
   alive?", "I don't have one." Her father's letter is shown in the middle of
   it; click it to go on. Sullivan is Anne (`metanne`, `annephase` 2).
3. **The cannons.** Click the cannons. Lyle has a word about them, with no
   question, and you are at the gun. Sink the four dinghies circling the ship;
   see [the cannons](#the-cannons). The cabin door opens once you have met
   Sullivan and opened the cannon room at all (`didcannon` is set as it
   opens), but the suite plays them out.
4. **Justice's cabin.** Go down through the cabin door, walk across to Justice at
   his desk, click him, and answer "Tell me about the Brethren.", "Some old
   man.", "What's different?", "How many Brethren are left?", "Do you protect
   it?" The ship sails for Port Royal (`montage.move`).

## Day 3: Port Royal

1. **Justice on the docks.** Answer "When should we be back?" He gives you his
   **watch**.
2. **Erzulie.** Go in at her door. Answer "How do you know my name?", "Yes.",
   "Tell me about the Brethren.", "Yes.", "Was that a vision of the future or
   the past?", "What about the Brethren?", "Where is the condemned man?", "What
   can I do about this curse?", "What about the treasure?", "What about
   RedJack?", "You know Blackbeard?" She vanishes (`erzulphase` 1).
3. **The alley.** Leave by her door out. Answer Justice "Who are you
   meeting?", and he is ambushed (`juskill.move`). Fight Jan, then his second
   (`jswitch.move`); see [the sword fights](#the-sword-fights).
4. **The constable.** Answer "I just found this dead body.", "He gave it to
   me." You are arrested for Justice's murder and put in the cell.
5. **Anne's rum.** Click the tray. Hold the button on the cup and scrape it to
   and fro along the window's bars; the rattle calls Anne. Answer "What are you
   doing here?", "Rum?" The **rum** is on the tray. Close the tray's lid.
6. **The constable drinks it.** Click the constable and answer "Let me out.",
   "I'm hungry.", "I'm thirsty." He goes to his desk and drinks himself asleep
   (`drunk.move`).
7. **A rock from the wall.** Open the tray again. Drag the spoon onto a rock in
   the wall to rake it loose (the suite uses the one the scripts call `rock 3`;
   the spoon's working point is below and to the left of the pointer), then
   drag the loose rock off the tray to take it into your hand. Close the lid,
   and throw the rock at the rifle on the wall by carrying it there with the
   button held. The rifle falls (`riflefall.move`).
8. **The keys.** Look down, click the keys on the floor, and carry them onto the
   cell's lock (`nickesc.move`).
9. **Out.** Click the trunk to get the sword and pistol back, walk to the door,
   and answer the soldier "All right."
10. **The street fight.** Three waves of Jan's men; see
    [the street fight](#the-street-fight). After the last, `endfight.move`
    plays, and then the trial at sea (`trialset.move`, `endtrial.move`). You are
    marooned on RedJack's island.

## Day 4: RedJack's island

The day is one long climb through RedJack's skull and back, for three things:
the **scepter** that opens the way to the horn caves, the **horn** that opens
the squid door, and the **torch** behind it that lights the fire on the beach.

1. **The totems.** On the path to the skull, click the totem. Click its top head
   to put it to sleep, and click OK. Both heads must be asleep (`totem1`,
   `totem2`), or the darts further up the path kill you. See
   [the totems](#the-totems).
2. **The skull's teeth: the gem lifts.** Click the gem panel. Have one try
   alone and end it with the panel's button; Anne then offers to help
   (`annehelp`) and the lifts open again. The answer is
   [in the puzzles section](#the-gem-lifts). Solved, the mouth opens
   (`gemmouth.move`) and you are in the lava caves.
3. **The lava.** Cross from pillar to pillar to the far side. See
   [the lava](#the-lava). At the far side, face 241° and press up to jump to
   the hub.
4. **The flame corridor.** Where you land in the hub, face 270° and press up.
   Step forward between the bursts of flame to the switch at the end, click it
   (door 2 drops), and walk back.
5. **The chain and the skeleton.** Swing across on the chain (see
   [the chain](#the-chain)). Click the scepter; its skeleton guard wakes. The
   sword is no use against it: lean right and click the vine above it
   (`swin1.move`). The **scepter** is yours. Swing back over the chain.
6. **The top.** Go through the door up to the top (it takes the scepter, and
   sets `wenttop`). Anne is there: "I got in a fight.", "I don't want to talk
   about it."
7. **The dream.** Click RedJack's skeleton. The dream stops twice for a click
   (`dream1.move`, `dream2.move`); RedJack speaks, and you wake with his
   **key**. Answer Anne "I think I fell asleep.", "I have something to tell you
   about your father.", "I saw RedJack. He was your father."
8. **The lockbox.** Open the inventory and drag the key onto the lockbox. Click
   the book inside to take the **journal**, and close the lockbox. Answer Anne
   "A book."
9. **Out of the skull.** Through the top's door back to the hub (it wants the
   key and the journal), face 0° at the hub's jump point and press up, back
   into the lava, and at the lava's mouth face 88° and press up. You come out
   on the beach.
10. **The crate on the beach.** Click it, take the **crowbar** it shows you,
    and drag the crowbar onto the crate's lock. Take the **horn** from inside and click OK.
    Answer Anne "I found this thing in the crate."
11. **The scepter lock.** From the beach, face 280° at the way into the rocks
    and press up (`link1`). Drag the scepter onto the lock (`oscepter.move`).
12. **The horn caves.** Face 196° and press up into the caves. Go through to the
    horn's place (face 354° and press up), and drag the horn onto it. The squid
    door opens (`squiddoor`). Go back, and on through the other way (face 97°
    and press up); the **torch** is there. Take it.
13. **The fire.** Back out to the rocks and the beach (from the rocks, face
    150° and press up), and drag the torch onto the fire pit. Rockfish answers
    the fire (`rockfish.move`). Answer "We got marooned.", "No.", "To some.",
    "Murder.", "Yes.", "He's dead.", "You've got to help me.", "What do you
    think of this tattoo." He takes you to Blackbeard (`rjbb.move`).

## Day 5: Blackbeard's island

1. **Rockfish at the dock.** Answer "When can I see Blackbeard?", "Are you
   afraid of him?"
2. **Up the lift.** Walk to the lift and face into it (266°) and press up. Drag
   its handle; see [the lift's handle](#the-lift-s-handle). Upstairs, Rockfish
   asks you to mix Blackbeard a drink: "What kind of drink?" (`rockphase` 1).
3. **Lyle's sulphur.** Walk up to Lyle at his sulphur pot. Click him and answer
   "What are you doing?", "I don't want to know.", then click him again and
   answer "Can I have some of your sulphur?" You have the **sulphur**.
4. **A coal.** Down the lift again (face 271°). On the dock, click the charcoal
   bin, click into the open bin to take a **coal**, carry the coal to the chest
   in the bottom left, and click the bin again to close it. Back up the lift.
5. **The drink.** Behind the bar, click the drinks. Mix it; the recipe is
   [in the puzzles section](#blackbeard-s-drink). Carry the full mug to the
   chest, and click OK.
6. **Rockfish tastes it.** Walk back through the lounge with the mug. Rockfish
   stops you, tastes it, and takes it up. Mixed wrong, he says "No. You'll have
   to do better than that. Try again." Denton rants and Blackbeard comes down.
   Answer "I hope so, I really need to see him.", "Yes, I made it.", "I'm Nick
   Dove.", "It's true.", "He told me to look for you.", "They carry
   scimitars.", "It's not your fault.", "Do you think RedJack will really come
   back?" He tells his story and passes out on the table (`endstory.move`).
   Jan's men attack (`jansignal.move`), and Rockfish sends you to the mine
   carts.
7. **The mine carts.** Three sets of Jan's men, shot with the harpoon gun; see
   [the mine carts](#the-mine-carts). The cart crashes (`nikcrash.move`) and
   Bone is there.
8. **Bone.** Answer "I'm going to kill you.", and beat him with the sword (see
   [the sword fights](#the-sword-fights)). Blackbeard comes: "Who are they?",
   "What now?" He sends you to Cartagena (`arrive.move`).

## Day 6: Cartagena

You start in the lock with Anne and Rockfish. The way out is down through it,
and the order matters: see [the lock](#the-lock).

1. **Anne.** Walk up to her and answer "Rockfish.", "What should we do?"
2. **Into the drain.** Walk to the valves, click Anne, and answer "Turn the
   valve on the left." You go down the drain (`ndrain.move`) to the bottom of the
   lock, alone.
3. **The lock door.** Click the door to open it, go through, and click it again
   to shut it behind you.
4. **The pipe.** Click the pipe and answer "Turn the fill valve.", then click it
   again and answer "Get on the raft." (`onraft`)
5. **The bottom valves.** Click the valves and click drain (`ardrain.move`). The
   lock drains and the raft comes down with Anne and Rockfish.
6. **Rockfish on the raft.** He comes over to talk. Answer "How long before we
   get there?", "Thank you.", "Go around and help Anne open the gate." He and
   Anne go to the chains.
7. **The chains and the rope.** Click Anne and answer "Pull the chain.", click
   Rockfish and answer "Pull the chain." With both held, drag the sword onto the
   raft's rope. The raft runs out to the dock (`exitlock.move`) without
   Rockfish, and Anne speaks for him.
8. **The hold, and the torture chamber.** Into the hold, down the stairs, and
   through the torture chamber's door. Fight the torturer; see
   [the torturer](#the-torturer).
9. **The study key and the hat.** Pick both up off the chamber's floor.
10. **The study.** Back into the hold, up the far stairs, and drag the study key
    onto the study's door. In the study, open each of the four shields, take its
    symbol, and close it. See [the gearboxes](#the-gearboxes).
11. **The gearboxes.** Back down into the hold. At each of the four gearboxes,
    one at each corner of the floor, open its door, drag in the symbol that
    fits, throw its lever, and close it.
12. **The cage.** Pull the switch that lowers the cage (`lowercage.move`); Jake
    and Elizabeth climb out. Pull it only after all four levers are down.
13. **Elizabeth.** Up the stairs, walk up to her, and answer "This is Anne."
    (`elizphase` 2) She points you at the study's inner door.
14. **Marquez.** Back into the study, and through the inner door
    (`armrm.move`, `marqintro.move`). Answer "You're the one who hired the
    Janizaries?", "What do you want to talk about?", "Do you believe in
    ghosts?", "You don't seem so sure.", "How did you know about me?", "What do
    you mean?", "Why are you doing this?", "Why?", "I'll take you to the
    island." The day ends on the voyage to RedJack's island.

## Day 7: RedJack's island again

1. **The standoff.** Blackbeard and Marquez face each other on the beach. Answer
   "He's the traitor!" The Spaniards come out of the trees, and you fight one;
   see [the sword fights](#the-sword-fights). Marquez takes Anne up the hill
   (`annemarq.move`).
2. **Marquez in the horn caves.** The scepter lock stands open today. Through the
   rocks into the caves, and click the squid door. Marquez is behind it with
   Anne, and you fight him; see [Marquez](#marquez). Beaten, he is chained
   (`didmarq`).
3. **The horn.** Go on to the horn's place and click the horn. The squid takes
   Marquez (`marqsquid.move`, `blewhorn`).
4. **The totem, and the ballista.** Back out to the beach and the totem. Click
   its top head: today it wakes, and with the Spaniards on the beach it saves
   Blackbeard (`savebb.move`). Answer him "What are we going to do about those
   Spanish galleons?", "Yes, the ballistas." Do not answer "This is your
   problem."; that is the death. At the ballista, sink two galleons; see
   [the ballista](#the-ballista).
5. **The end.** Back on the beach, Patch and RedJack (`morph.move`,
   `rjfade.move`), and each of the crew has a last word (`finishtheend`, in the
   order Lyle, Blackbeard, Jake, Elizabeth, Cross, Anne). Click through the
   films that wait, and answer Blackbeard "The pirate life.", Jake "Why do you
   ask?", "Then what will you do?", Elizabeth "Thank you.", "I will.", "I'm
   sure.", and Cross "Got my own ship, want to be my weatherman?" After
   `swimin.move` the game is back at its menu.

---

## Off the route

The suites take one route, and some of the game lies off it. These are day
one's, and this page has no steps for them:

- **the bar's darts**;
- **the shark in the bay**. Killing it is the other way onto the ship, and that
  way leads to the Justice ending.

---

## The fights

The fights are played by
[`fight.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/fight.ts).
The advice is what it does, and the numbers are the scripts'.

### Lyle's lessons and the fight

- **Defense.** Lyle strikes and you guard with the pointer. The guard is where
  the pointer is: high and just right of the middle blocks his overhead strike,
  low and left of the middle his left strike, low and right of the middle his
  right strike.
  Watch his wind-up and move to the guard it calls for, and back to the middle
  between strikes. You pass on better than 70 blocks in 100 (sdenemy1.shop
  `calcrating`).
- **Dodging.** Lyle moves to one of three places and throws a bottle down that
  lane. Hold left or right to lean that way; let go to come back to the
  middle. Stay out of every lane a bottle is falling down and the one he is
  moving to. You pass if fewer than seven break on you (`endclass`).
- **Striking.** Lyle stands and takes it. A click strikes: a click high on the
  screen (above y 200) is an overhead strike, and one lower down a strike to
  the left or right, by which side of the middle it is on. Strike only when Nick has the strength for it and Lyle is not
  blocking, and go round the three strikes in turn: he blocks a repeated strike
  more often (`samestrike`). You pass if he is down in time (ssenemy1.shop
  `calcrating`).
- **The fight.** Both at once: guard while he winds up, strike while he is
  open. When he is beaten with the sword he backs off and throws bottles, and
  you dodge as in the lesson.

### The sword fights

Jan and his second in the alley, Bone in the mine, and the Spaniard on day 7
are the same fight as Lyle's: guard where the wind-up says, and strike in turn
while the opponent is open. Jan's men step back out of reach; press up to close
in. Put the pointer on a strike's point a moment before you press: a strike
read at the wrong point is always the same one, and the Spaniard always blocks
that (spancombat.shop `samestrike`).

### The street fight

Jan's men drop from the roofs, run at you, or shoot from the windows. Each dies
to one click on him. Click the nearest one you see, and turn with the arrows
toward the rest. There are three waves, of 9, 9 and 5 (bfight.cast `deadgoal`),
with a walk to the next street between them.

### The torturer

- **The whip.** He lashes from one side. Hold the arrow toward the side the
  lash comes from, all the way, and let go when it has passed. Each two lashes
  dodged step you a pace closer. At the fourth pace his dropped sword lies in
  reach: click it.
- **The cauldron.** No sword stroke hurts him (tcombat.shop `Edamage` stops on
  its first line). Guard as in the other fights and strike your way closer
  (each stroke steps you in; down steps you back). Once you are at the sixth or
  seventh pace, click the cauldron beside him. It tips its coals at his feet and
  he dances; strike while he dances, and he is beaten (`twin.move`).

### Marquez

No sword stroke hurts him either (mcombat.shop `Edamage`). He is beaten by the
caves:

- **The door.** Where the fight opens, a switch in the wall drops a door a
  moment after you click it, and the door squashes him if he is striking when
  it lands (`squash.move`). Click the switch just as a strike begins that has
  another swing to come. Do it early: his kicks cannot be guarded, each costs
  you health and knocks you back a pace, and back at the switch you have to
  walk up to it again.
- **The stairs.** Then press up, and strike, to drive him back up the stairs
  (`mstairs.move`). At the top Anne hangs; click her (`mwin.move`,
  `anneescape.move`).

Guard where his wind-up says all the while.

---

## The shooting games

### The cannons

From [`cannons.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/cannons.ts).
The arrows turn the gun and tilt it, a degree a press, from 5° down to 40° up. A
click fires, and tilts the gun one degree further up as it does. The ball drops
as it flies, so aim where the dinghy will be when the ball gets there, not where
it is. Two hits sink a dinghy, and the fourth dinghy sunk ends the game
(cannon.cast `endcannon`).

### The mine carts

From [`mine.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/mine.ts).
The harpoon fires where the view looks, not where the pointer is: a click
anywhere throws it from the middle of the screen. The pointer turns the view:
only a strip in the middle stands still, and further out it turns faster. Lay
the view on the nearest man and click. A harpoon also stops a dagger or bomb on
its way to you. Each man dies to one harpoon, and the last of a set sends the
cart on; there are three sets.

### The ballista

From [`ballista.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/ballista.ts).
Aimed like the mine carts: the pointer turns the view, and a click fires. The
stone falls as it flies, so lead the galleon. Four hits sink one (the third sets
it burning), and two sunk win. A galleon that reaches the beach fires on it and
ends the game (ballista.cast `endwalk`).

---

## The puzzles, solved

### The totems

totem.shop: clicking the top head sends it to sleep or wakes it. Clicking the
bottom head turns that head *and* the top one. On day 4 both must be asleep
(`totem1`, `totem2` = "sleep"); the suite clicks the top head once and both
are. On day 7 the suite clicks the top head once more: waking it with the
Spaniards on the beach is what starts the ballista (totem.shop `backtoidle` →
`doballista`).

### The gem lifts

From [`gems.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/gems.ts),
which solves them from gem.shop's rules. Nick's lift faces five sockets and
Anne's five more, and each lift runs up to its fifth level and back down.

- **A click on Nick** takes the gem in the socket his lift faces, and **a click
  on a gem he holds** puts it into the socket, if it is empty. Either moves
  **Anne's** lift, by the gem's colour: green 1 level, red 2, blue 3.
- **A click on Anne**, or on a gem she holds, does the same the other way round,
  and moves **Nick's** lift.
- Nothing moves while a lift or a hand is moving; wait between clicks.

After the first try the lifts open again with both at their first level, and
the suite's clicks are (it checks both lifts' levels after every one):

1. Nick (takes the blue)
2. Nick's blue (puts it back)
3. Anne (takes a green)
4. Nick (takes a red)
5. Anne (takes a red)
6. Nick (takes a green)
7. Nick's green
8. Nick (takes the green again)
9. Nick's green
10. Anne (takes a blue)
11. Anne's red
12. Nick (takes a blue)
13. Anne's green
14. Nick's blue
15. Anne's blue
16. Nick's red

The last gem opens the mouth. Some clicks put a gem down and take it straight
back; they are there to move the other lift.

### The lava

From [`lava.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/lava.ts).
Every place to stand in the lava has a pillar except a few that are rock. A
pillar that is down kills you (`flamedeath.move`), and one that is up starts to
sink under you, so do not stay. Some pillars start down, and the first time you
stand on certain rocks others rise and fall (lava.sett `openscene`). The far
side, where you jump to the hub, sets every pillar solid. The suite finds its
path through the lava from those rules, by node names a player does not see, so
this page cannot give it as on-screen directions.

### The chain

From `lava.ts`, on rjbeach.shop's `chain`. A click on the chain swings you
across, but only near the start of a swing: clicked more than 48 ticks and
less than 224 ticks into it (about 0.8 to 3.7 seconds, at the game's 60 ticks a
second) you fall. The swing starts again at each end of its animation, so wait
for a fresh one and click at once.

### The lift's handle

From
[`days/day5.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/days/day5.ts),
on elevator.shop's `handle`. Hold the button on the handle and drag it along its
slot; let go at the end and the lift goes. To go **up**, drag left, then up,
then right. To go **down**, drag left, then down, then right. Once the lift
stops and the rope stands still, click to get off.

### Blackbeard's drink

inven.shop `checkmix` counts what went into the mug against `001211112`, one
digit per ingredient, and the order does not matter:

| ingredient | how many |
|---|---:|
| bottle 1 | 0 |
| bottle 2 | 0 |
| bottle 3 | 1 |
| bottle 4 (the salt) | 2 |
| bottle 5 | 1 |
| bottle 6 | 1 |
| Lyle's sulphur | 1 |
| the coal | 1 |
| ale from the keg | 2 |

A bottle goes in by carrying it from the bar and letting go over the mug while
the mug stands on the bar. The sulphur and the coal come out of the chest the
same way. For the ale, drag the mug under the keg and click the spigot, twice.
Then carry the full mug to the chest.

The scripts number the six bottles 1 to 6; this page cannot say which is which
on screen.

### The lock

From
[`days/day6.ts`](https://github.com/dhobi/dreamrefactory/blob/master/redjack/tests/machine/days/day6.ts),
on cartegena.cast's `valves`. The lock door at the bottom opens only while the
lock above is drained, and filling the lock with that door open drowns you. So:
through the door, shut it behind you, then ask through the pipe for the fill
valve and for them to get on the raft, then drain it yourself at the bottom
valves.

### The gearboxes

switch.stag `replace`: each shield in the study holds a numbered symbol, and a
gearbox takes only the symbol with its own number; the wrong one is not taken.
The suite puts shield 1's symbol in gearbox 1, and so on. With all four levers
down the cage switch lowers the cage (cartegena.cast `lowercage`); pulled any
sooner it kills you (`holddeath.move`).

---

## Where this walkthrough is thin

- **The suites find things by name.** A node, a prop or a quad has a name in the
  scripts, and the suites walk and click by it. This page turns those into
  places and things on screen as far as the suites' own comments and the
  scripts say, but it has not been checked against the screen.
- **The lava's path** is worked out from rules over node names, and is not
  given here.
- **The bar's six bottles** are known by number, not by where they stand.
- **The fights and shooting games** are the suites' tactics, which read the
  opponent's state straight off the game. A player reads the same thing off the
  screen.
- **Anything off the suites' route** (the darts, the shark, the Justice
  ending, other answers in any talk) is not on this page.

A step that is wrong or missing is worth reporting; the fix is usually one grep
away in the scripts.

Back to [RedJack](README.md).
