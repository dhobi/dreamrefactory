# Playing Lunicus: a walkthrough from the machine suites

*Prerequisite: nothing. This page is for playing the game. What the port is and
how far it gets is the [Lunicus overview](README.md).*

No save or walkthrough written with the original is available here. So this
page comes from the headless playthrough. The day routes,
[`days/day1.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tests/machine/days/day1.ts),
[`days/city-day.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tests/machine/days/city-day.ts)
(days two to four),
[`days/day5.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tests/machine/days/day5.ts)
and
[`days/day6.ts`](https://github.com/dhobi/dreamrefactory/blob/master/lunicus/tests/machine/days/day6.ts),
play the whole game from the intro to the queen. Every step below is one they
take, in their order, and each is checked against the game's state. **This is
the route the machine suites play and check, one route, not the only one.**

Places are given as the maze's cells, `(x, y)`, with `x` growing east and `y`
growing south. The floor map in the side panel shows the same grid.

## Before you start

The play page is at `/lunicus/` on your own machine with `npm run dev -w lunicus`
(port 5180). Press Enter, let the intro run, and click the title for a new game.

- **Walking.** The up arrow or `W` steps forward, and left and right (`A`, `D`)
  turn. A click on the view walks toward it, turns at its sides, or uses what
  is ahead when you face something.
- **The floor map.** On the station, the side panel shows the floor, with you
  in red and the crew in green. A click on it puts you there at once.
- **The panel's buttons.** Along the bottom: help, save, navigation, and the
  gun, the grenades and the rockets. `H`, `J`, `K` and `L` press the last four,
  and space fires a rocket. A weapon with no ammo is greyed out.
- **Talking.** Click a crew member, and they walk up. Choose a question from the
  menu under the face. `.` ends a talk, and skips a film.
- **Dying** plays the intro again and waits at the title. Save before a
  fight: the floppy button saves, and the page's Load button opens a save.

## Day one: the station

You wake in bed at (4,6) on the lower floor. The bed says INAPPROPRIATE
BEDTIME until you are briefed.

1. Look round the lower floor if you like. The desk at (6,6) is empty; the
   screens at (5,15) and (13,15) and the control panel at (5,5) play their
   films.
2. Talk to the crew on this floor. Sasha stands at (12,5) or (14,5), Molotov
   near (9,9), and the guard at one of four posts. Before the briefing they
   talk from their `.1` files.
3. **The briefing** is at the transporter end, (9,18). It plays `brief.mov`,
   and after it the crew talk from their `.3` files. A second visit says
   BRIEFING OVER.
4. The elevator is at (3,11), facing west. Up is the upper floor.
5. On the upper floor: the reactor, the transformer, the scope, the
   greenhouse and the power status, and Raife, McCallum, Heisenstein and a
   second guard. The suit's locker is at (8,17) and the gun's at (8,15).
   Taking both is allowed. The transporter says nothing to you today but the
   guard's line, and armed, the guard keeps you out of the floor's north half.
6. Put the suit and the gun back, take the elevator down, and go to bed at
   (4,6). `sleep.mov` plays, and day two starts on the lower floor.

## Days two to four: the cities

Days two, three and four are the same route: Los Angeles, then Tokyo, then
Moscow. Tokyo adds a drone, Moscow two, and on day four the gun becomes the
pulse gun, whose shots bounce off the walls.

1. **The briefing** at (9,18) on the lower floor. This day it sends you down,
   and the crew talk from their `.2` files.
2. Up the elevator, and take the suit and the gun from their lockers.
3. **The transporter** at the south end of the upper floor. `citydrop.mov`
   plays, and the HUD fills: energy, shields, the ENEMIES bar and all three
   ammo. You arrive on the **fifth floor of a building**, not in the street.
4. **Down the building.** Each floor has cabinets and the elevator.
   - A cabinet gives one thing: grenades, rockets, bullets, shields, energy or
     an alien artifact for the score. The likelier a thing is, the more of it
     are left, and an empty one says CABINET EMPTY.
   - The elevator's top button goes up and its bottom button down, a floor at
     a time. Below the first floor you are in the street.
   - Everything you kill takes its worth off the ENEMIES bar.
5. **The street.** Its doors take you back into a building. A door marked
   NO ENTRANCE does not.
6. **The node.** Once the ENEMIES bar is empty, the next wasp comes back as the
   node. It is too high for a bullet except from a distance: throw grenades at
   it from close, or rockets as it comes straight at you. Destroyed, it ends
   the city, and `cityrise.move` takes you back up to the station.
7. On the upper floor: put the suit and the gun back. Armed, the guard will
   not let you north to the elevator. Then down, and to bed.

## Day five: the engine rooms

1. The briefing on the lower floor.
2. Up for the suit and the gun, and down again. Today the guard lets you by
   armed.
3. **The lower floor's elevator** at (3,11): its **bottom button** goes down to
   the first engine room, with the HUD filled. Three drones fly here.
4. **Clear the ENEMIES bar.** Each room's elevator goes nowhere up (ELEVATOR
   DOOR JAMMED). Its bottom button takes you to the other room while the bar
   has anything left, and there are cabinets in both.
5. With the bar empty, the elevator's bottom button goes down to the hive
   (`tohive.move`), with the HUD filled again.

## Day six: the hive and the queen

1. **The hive.** Four drones. Its cabinets hold two of each thing but the alien
   artifact. While the ENEMIES bar has anything left, a ride in its elevator
   brings you back with every cabinet full again. The ride is also a way to
   get the enemies off your back, since they come in again away from you.
2. **Go down full.** With the bar empty, the elevator goes down to the final
   chamber, and the bar fills again. Nothing there gives back what the hive
   took but its cabinets. Top up before the hive's bar runs out: with a little
   of it left, the ride still refills the cabinets.
3. **The final chamber.** Empty its bar too. Its switches fill its cabinets
   again (CABINET SUPPLIES REPLENISHED).
4. **The queen** is at the chamber's middle. Face her from (5,7), (7,5), (7,9)
   or (9,7) and use her. While the bar has anything left she answers
   TRANSPORTER CURRENTLY IN RECEIVE MODE. With it empty: `finalin.mov`,
   `trans.mov`, her talk, and `final.move`. Her talk ends only down one of its
   ways; the suite asks everything in each menu before taking the way out.
5. The credits end on a page that loops until you click, and the game goes
   back to its title.

## How the suites fight

A player's best advice, from what the bot does that works:

- **Shoot what lines up with you.** A vehicle or a wasp in the same row or
  column is one you can turn to.
- **A bullet rises only so steeply.** The wasp, the node and a drone close up
  are above it: throw grenades at them from close.
- **Rockets are guided.** They follow the corridor to a tank, a jeep or a
  wasp. On day six the gun and the grenades do half their damage and the
  rockets do not, and one rocket ends a tank.
- **A vehicle standing next to you is still there** even when it is too close
  to be drawn, and still firing. Fire straight ahead at it.
- **The shields keep your energy**, and only a cabinet gives energy back.
  Restock before the shields are gone.

Back to [the Lunicus overview](README.md).
