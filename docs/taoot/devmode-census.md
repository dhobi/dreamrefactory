# Developer mode: the census

*Every use of `debugging` and of the three modifier probes, in the English tree.*

**GENERATED — do not edit.** `npx tsx taoot/tools/devcensus.ts`.
[Developer mode](devmode.md) is the guide; this is the full list.

Scope: `.SET`, `.STG`, `.FLT`, `.PUP`, `.SHP`, `.PRP`, `.CST`, `.MOV`, `BOOTFILE`, read through the game's own file index, which
resolves each basename once across the two discs.

| | |
|---|---|
| script-bearing files read | 382 |
| containers carrying a script | 12237 |
| lines reading `debugging` | 355, in 29 files |
| modifier-probe **calls** | 324, on 320 lines in 211 containers |
| …`shiftkey()` | 213 calls on 213 lines, of which 199 also test `debugging` |
| …`optionkey()` | 109 calls on 109 lines, of which 92 also test `debugging` |
| …`commandkey()` | 2 calls on 2 lines, of which 1 also test `debugging` |

## The one assignment

`debugging` is written in one place in the corpus, BOOTFILE's `boot()`, and the
menu's `debug on/off` lowers it again. A saved game writes it too: the flag is
among the numeric globals every `.ti` restores, stored as 0 in all of them.

## What the flag is for

Every occurrence classified by the call its branch makes, from the effect line
itself (`taoot/tools/devcensus.ts`).

| What it does | Occurrences | Files |
|---|---:|---|
| opens the script editor | 212 | `blkjack.shp`, `boil.shp`, `bomb.shp`, `bootfile`, `bridge.shp`, `bridge.stg` … |
| drags or places a prop | 94 | `blkjack.shp`, `boil.shp`, `bomb.shp`, `bridge.shp`, `cargo.shp`, `cigs.shp` … |
| gates content behind the flag | 17 | `bootfile`, `map.stg` |
| other | 16 | `bootfile`, `gang.cst`, `house.shp`, `smstack.shp`, `tour.shp` |
| forces a scene or actor | 10 | `bootfile` |
| prints a readout | 8 | `bootfile`, `gang.cst`, `house.shp`, `inven.shp` |
| sweeps every item or script | 8 | `bootfile`, `inven.shp` |
| places a prop or actor by hand | 7 | `bootfile` |
| hands over items | 3 | `bedsit1.set`, `house.shp` |
| opens the debugger | 3 | `house.shp`, `main.stg`, `photo.shp` |
| skips a puzzle | 2 | `bomb.stg`, `patty.stg` |
| switches the menu bar on | 2 | `bootfile` |
| answers a guard differently | 1 | `smstack2.set` |

## What you can actually do

What each branch lets you do, and how to reach it, for every kind the game does
in only a handful of places. The script behind each is under a disclosure.

### The deck map's 15 developer areas

Press a red area on a deck plan and it jumps you straight there. With the flag down 15 of the 32 refuse; with it up, **14 of them work** and take you into a *room* rather than a stairwell, which is all the shipped 17 ever reach: the **gymnasium** and four spots along the boat-deck promenades, the **1st Class Smoke Room** and four along A deck's, the **Café Parisian** and the **poop** and **forecastle** decks on B, and one F-deck hallway. The map goes from 8 sets to 16.

The fifteenth is the **1st Class Lounge**, whose region returns at a bare `exitcode` above its jump. The lounge is reached on foot, from the lounge hallway.

To use them Frank needs the bag *and* the watch (`mapdisabled()` checks both); the map also refuses in mission 4 and from the smokestacks, boiler room, cargo hold and bunkers. **Press them plain** — shift opens the button's script editor. `/devmode/` outlines all 32 while the plan is open.

<small>`map.stg` · `mousedown` · container 14<br>`map.stg` · `mousedown` · container 15<br>`map.stg` · `mousedown` · container 16<br>`map.stg` · `mousedown` · container 17<br>`map.stg` · `mousedown` · container 18<br>`map.stg` · `mousedown` · container 24<br>`map.stg` · `mousedown` · container 25<br>`map.stg` · `mousedown` · container 26<br>`map.stg` · `mousedown` · container 27<br>`map.stg` · `mousedown` · container 30<br>`map.stg` · `mousedown` · container 32<br>`map.stg` · `mousedown` · container 45<br>`map.stg` · `mousedown` · container 47<br>`map.stg` · `mousedown` · container 50<br>`map.stg` · `mousedown` · container 108</small>

<details><summary>the script</summary>

```
  if not debugging
    exitcode
  endif
  jumpbaby ("deckbd", "scene44", "view211")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("deckbd", "scene48", "view203")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("deckbd", "scene35", "view105")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("deckbd", "scene34", "view86")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("gym", "scene12", "view47")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("decka", "scene356", "view392")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("decka", "scene355", "view434")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("decka", "scene354", "view426")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("decka", "scene357", "view400")
```

```
  if not debugging
    exitcode
  endif
  exitcode
  jumpbaby ("lounge1c", "scene60", "view63")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("smoke", "scene13", "view77")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("poop", "scene483", "view546")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("cafe", "scene36", "view52")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("fore", "scene483", "view501")
```

```
  if not debugging
    exitcode
  endif
  jumpbaby ("hallf3c", "scene13", "view23")
```

</details>

### The guided tour's ten narrators, whether or not their films shipped

Each tour guide is normally placed only if their film is on the disc (`fileexists ("tour1.mov")`); the flag puts them there regardless. Ten rooms, one narrator each: **Penny** on the poop deck, **Burns** in the smoking room, **Willie** in the gym, **Cash** on the grand staircase, **Morrow** on the bridge and again in the wireless room, **Stokes** in the boiler room, **Trask** in the Turkish bath, **Smethells** in cabin C73 and **Shay** in scot3.

<small>`bootfile` · `setuptour` · container 2<br>`bootfile` · `setuptour` · container 2<br>`bootfile` · `setuptour` · container 2<br>`bootfile` · `setuptour` · container 2<br>`bootfile` · `setuptour` · container 2<br>`bootfile` · `setuptour` · container 2<br>`bootfile` · `setuptour` · container 2<br>`bootfile` · `setuptour` · container 2<br>`bootfile` · `setuptour` · container 2<br>`bootfile` · `setuptour` · container 2</small>

<details><summary>the script</summary>

```
    if fileexists ("tour1.mov") | debugging
      sendtoactor ("penny", setupactor ("tour"))
    endif
```

```
    if fileexists ("tour2.mov") | debugging
      sendtoactor ("burns", setupactor ("tour"))
    endif
```

```
    if fileexists ("tour3.mov") | debugging
      sendtoactor ("willie", setupactor ("tour"))
    endif
```

```
    if fileexists ("tour4.mov") | debugging
      sendtoactor ("cash", setupactor ("tour"))
    endif
```

```
    if fileexists ("tour5.mov") | debugging
      sendtoactor ("morrow", setupactor ("tour5"))
    endif
```

```
    if fileexists ("tour6.mov") | debugging
      sendtoactor ("morrow", setupactor ("tour6"))
    endif
```

```
    if fileexists ("tour7.mov") | debugging
      sendtoactor ("stok1", setupactor ("tour"))
    endif
```

```
    if fileexists ("tour8.mov") | debugging
      sendtoactor ("trask", setupactor ("tour"))
    endif
```

```
    if fileexists ("tour9.mov") | debugging
      sendtoactor ("smeth", setupactor ("tour"))
    endif
```

```
    if fileexists ("tour10.mov") | debugging
      sendtoactor ("shay", setupactor ("tour"))
    endif
```

</details>

### The placement mode — drag actors and props around the room

BOOTFILE's global mousedown hands a click on an actor to `move3dactor` and on a prop to `move3dprop` or `move2dprop`, and then you have hold of it: **option-drag** slides it across the floor, **option+shift-drag** raises and lowers it, **shift-drag** turns it, and the log prints its x, y, z, facing, clip and scale every frame. Props get the same through `move3dprop` and `move2dprop`.

It wants a **second** global: `setloc`, assigned `false` in `boot()` one line above `debugging` and nowhere else. The page leaves it down — dragging artwork out of position is a different kind of power from reading a flag, and it was a separate switch on the disc too — the **place** latch raises it. The three handlers are BOOTFILE script, and every builtin they call is implemented.

<small>`bootfile` · `mousedown` · container 1<br>`bootfile` · `mousedown` · container 1<br>`bootfile` · `move3dprop` · container 1<br>`bootfile` · `move3dprop` · container 1<br>`bootfile` · `move3dprop` · container 1<br>`bootfile` · `move3dactor` · container 1<br>`bootfile` · `move3dactor` · container 1<br>`bootfile` · `move3dactor` · container 1<br>`bootfile` · `move3dactor` · container 1</small>

<details><summary>the script</summary>

```
    if setloc & debugging
      move3dactor (thename)
    else
      sendtoactor (thename, mousedown (thepoint))
    endif
```

```
    if setloc & debugging
      if propis3d (thename)
        move3dprop (thename)
      else
        move2dprop (thename)
      endif
    else
      sendtoprop (thename, mousedown (thepoint))
    endif
```

```
    if optionkey ()
      if shiftkey ()
        propxyz (name, propxyz (name, 1), propxyz (name, 2), propxyz (name, 3) + (y1 -y2) * 2)
        x1 = x2
        y1 = y2
        forceupdate ()
      else
        propxyz (name, propxyz (name, 1) + calcvectx (currentdeg () + 64, (x2 -x1) * 2) -calcvecty (currentdeg () + 64, (y2 -y1) * 2), propxyz (name, 2) + calcvectx (currentdeg () + 64, (y2 -y1) * 2) + calcvecty (currentdeg () + 64, (x2 -x1) * 2), propxyz (name, 3))
        x1 = x2
        y1 = y2
        forceupdate ()
      endif
    else
      if shiftkey ()
        propdeg (name, propdeg (name) + x1 -x2)
        x1 = x2
        y1 = y2
        forceupdate ()
      endif
    endif
```

```
      if shiftkey ()
        propxyz (name, propxyz (name, 1), propxyz (name, 2), propxyz (name, 3) + (y1 -y2) * 2)
        x1 = x2
        y1 = y2
        forceupdate ()
      else
        propxyz (name, propxyz (name, 1) + calcvectx (currentdeg () + 64, (x2 -x1) * 2) -calcvecty (currentdeg () + 64, (y2 -y1) * 2), propxyz (name, 2) + calcvectx (currentdeg () + 64, (y2 -y1) * 2) + calcvecty (currentdeg () + 64, (x2 -x1) * 2), propxyz (name, 3))
        x1 = x2
        y1 = y2
        forceupdate ()
      endif
```

```
      if shiftkey ()
        propdeg (name, propdeg (name) + x1 -x2)
        x1 = x2
        y1 = y2
        forceupdate ()
      endif
```

```
  if not optionkey () & not shiftkey ()
    actorscript (name)
    exitcode
  endif
  x1 = pointx (mouse ())
  y1 = pointy (mouse ())
  while stilldown ()
    x2 = pointx (mouse ())
```

```
    if optionkey ()
      if shiftkey ()
        actorxyz (name, actorxyz (name, 1), actorxyz (name, 2), actorxyz (name, 3) + y1 -y2)
        x1 = x2
        y1 = y2
        forceupdate ()
      else
        actorxyz (name, actorxyz (name, 1) + calcvectx (currentdeg () + 64, 2 * (x2 -x1)) -calcvecty (currentdeg () + 64, 2 * (y2 -y1)), actorxyz (name, 2) + calcvectx (currentdeg () + 64, 2 * (y2 -y1)) + calcvecty (currentdeg () + 64, 2 * (x2 -x1)), actorxyz (name, 3))
        x1 = x2
        y1 = y2
        forceupdate ()
      endif
    else
      if shiftkey ()
        actordeg (name, actordeg (name) + x1 -x2)
        x1 = x2
        y1 = y2
        forceupdate ()
      endif
    endif
```

```
      if shiftkey ()
        actorxyz (name, actorxyz (name, 1), actorxyz (name, 2), actorxyz (name, 3) + y1 -y2)
        x1 = x2
        y1 = y2
        forceupdate ()
      else
        actorxyz (name, actorxyz (name, 1) + calcvectx (currentdeg () + 64, 2 * (x2 -x1)) -calcvecty (currentdeg () + 64, 2 * (y2 -y1)), actorxyz (name, 2) + calcvectx (currentdeg () + 64, 2 * (y2 -y1)) + calcvecty (currentdeg () + 64, 2 * (x2 -x1)), actorxyz (name, 3))
        x1 = x2
        y1 = y2
        forceupdate ()
      endif
```

```
      if shiftkey ()
        actordeg (name, actordeg (name) + x1 -x2)
        x1 = x2
        y1 = y2
        forceupdate ()
      endif
```

</details>

### The Scripts menu — nine commands that open an editor

`painting scripts`, `scene script`, `set script`, `button scripts`, `flat script` and the rest each sweep the current view, set or flat and call the matching `*script` builtin, with **option** held widening the sweep to every scene in the set. They need the authoring tool: TI.EXE tests an "editor available" flag that is clear in shipping builds, so `/devmode/` greys them out and says so.

<small>`bootfile` · `menuselect` · container 1<br>`bootfile` · `menuselect` · container 1<br>`bootfile` · `menuselect` · container 1<br>`bootfile` · `menuselect` · container 1<br>`bootfile` · `menuselect` · container 1<br>`bootfile` · `menuselect` · container 1<br>`bootfile` · `menuselect` · container 1<br>`bootfile` · `menuselect` · container 1<br>`bootfile` · `menuselect` · container 1</small>

<details><summary>the script</summary>

```
    if debugging
      if optionkey ()
        for count1 = 1 to countscenes ()
          thescene = indextoscene (count1)
          for count2 = 1 to countviews (thescene)
            theview = indextoview (thescene, count2)
            for count3 = 1 to countpaintings (thescene, theview)
              paintingscript (thescene, theview, indextopainting (thescene, theview, count3))
            endfor
          endfor
        endfor
      else
        for count1 = 1 to countpaintings (currentscene (), currentview ())
          paintingscript (currentscene (), currentview (), indextopainting (currentscene (), currentview (), count1))
        endfor
      endif
    endif
```

```
      if optionkey ()
        for count1 = 1 to countscenes ()
          thescene = indextoscene (count1)
          for count2 = 1 to countviews (thescene)
            theview = indextoview (thescene, count2)
            for count3 = 1 to countpaintings (thescene, theview)
              paintingscript (thescene, theview, indextopainting (thescene, theview, count3))
            endfor
          endfor
        endfor
      else
        for count1 = 1 to countpaintings (currentscene (), currentview ())
          paintingscript (currentscene (), currentview (), indextopainting (currentscene (), currentview (), count1))
        endfor
      endif
```

```
    if debugging
      if optionkey ()
        for count = 1 to countscenes ()
          scenescript (indextoscene (count))
        endfor
      else
        scenescript (currentscene ())
      endif
    endif
```

```
      if optionkey ()
        for count = 1 to countscenes ()
          scenescript (indextoscene (count))
        endfor
      else
        scenescript (currentscene ())
      endif
```

```
    if debugging
      for count = 1 to countbuttons (currentflat ())
        buttonscript (currentflat (), indextobutton (currentflat (), count))
      endfor
    endif
```

```
    if debugging
      debugging = false
      message ("Debugging Off")
      menuvisible (debugging)
      keyaborts (debugging)
    endif
```

```
      debugging = false
      message ("Debugging Off")
      menuvisible (debugging)
```

```
      menuvisible (debugging)
      keyaborts (debugging)
    endif
```

```
      keyaborts (debugging)
    endif
  case "quit"
```

</details>

### Conversations: who you are talking to, and how far off they are

As a conversation starts, the flag adds three shortcuts. **shift+option** prints the target's distance and stops. **option** prints the target's name and asks for its actor script. **shift** opens every puppet script in the `.pup` file. The two that print land in the log; the script editors need the authoring tool.

<small>`gang.cst` · `runpuppet` · container 1<br>`gang.cst` · `runpuppet` · container 1<br>`gang.cst` · `runpuppet` · container 1<br>`gang.cst` · `runpuppet` · container 1</small>

<details><summary>the script</summary>

```
  if debugging
    if shiftkey () & optionkey ()
      message (numtostring (realdist (target)))
      delay (30)
      exitcode
    endif
    if optionkey ()
      message (target)
      actorscript (target)
      exitcode
    endif
    if shiftkey ()
      openpuppetfile (pupname)
      for count = 1 to countpuppets ()
        puppetscript (indextopuppet (count))
      endfor
      closepuppetfile ()
      exitcode
    endif
  endif
```

```
    if shiftkey () & optionkey ()
      message (numtostring (realdist (target)))
      delay (30)
      exitcode
    endif
```

```
    if optionkey ()
      message (target)
      actorscript (target)
      exitcode
    endif
```

```
    if shiftkey ()
      openpuppetfile (pupname)
      for count = 1 to countpuppets ()
        puppetscript (indextopuppet (count))
      endfor
      closepuppetfile ()
      exitcode
    endif
```

</details>

### The bedsit door — a chapter skip, and a kit

Stand in the bedsit facing the door (Scene3/View21) and click it:

- **plain click** — runs `advanceday()`, the game's own day machine, which skips you forward a chapter.
- **option-click** — hands you the bag, the map and the watch, randomises who holds the notebook, the painting, the real and fake necklaces and the Rubaiyat, sets the clock to `startdisk2` and *then* advances: a jump straight to disc 2 with a playable inventory.

It is the nearest thing the game has to a level select.

<small>`bedsit1.set` · `mousedown` · container 171<br>`bedsit1.set` · `mousedown` · container 171</small>

<details><summary>the script</summary>

```
  if debugging
    if optionkey ()
      sendtoprop ("bag", addbag ())
      sendtoprop ("map", addmap ())
      sendtoprop ("watch", addwatch ())
      if random (2) = 1
        propowner ("notebook", "zeit")
      else
        propowner ("notebook", "vlad")
      endif
      if random (2) = 1
        propowner ("painting", "frank")
      else
        propowner ("painting", "hack")
      endif
      if random (2) = 1
        propowner ("realneck", "frank")
        propowner ("fakeneck", "vlad")
      else
        propowner ("realneck", "vlad")
        propowner ("fakeneck", "frank")
      endif
      if random (2) = 1
        propowner ("rubaiyat", "frank")
      else
        propowner ("rubaiyat", "vlad")
      endif
      clock = "startdisk2"
        …
```

```
    if optionkey ()
      sendtoprop ("bag", addbag ())
      sendtoprop ("map", addmap ())
      sendtoprop ("watch", addwatch ())
      if random (2) = 1
        propowner ("notebook", "zeit")
      else
        propowner ("notebook", "vlad")
      endif
      if random (2) = 1
        propowner ("painting", "frank")
      else
        propowner ("painting", "hack")
      endif
      if random (2) = 1
        propowner ("realneck", "frank")
        propowner ("fakeneck", "vlad")
      else
        propowner ("realneck", "vlad")
        propowner ("fakeneck", "frank")
      endif
      if random (2) = 1
        propowner ("rubaiyat", "frank")
      else
        propowner ("rubaiyat", "vlad")
      endif
      clock = "startdisk2"
    endif
        …
```

</details>

### The menu bar and the keyboard abort

`menuvisible (debugging)` is what put the menu bar on the screen, and `keyaborts (debugging)` is what let a keypress abandon whatever the game was doing — TI.EXE's "Programmer keyboard abort.". Both take the flag directly, so a debug build got both. `/devmode/` rebuilds the bar in HTML from the executable's own resource.

<small>`bootfile` · `boot` · container 1<br>`bootfile` · `boot` · container 1</small>

<details><summary>the script</summary>

```
  menuvisible (debugging)
  keyaborts (debugging)
  lockevents = false
```

```
  keyaborts (debugging)
  lockevents = false
  puppetgrab (true)
```

</details>

### Hold option: where you are, every tick

The log prints the current **set, scene and view** plus how far away Vlad is, refreshed on every idle tick. The way to read a room's own name while standing in it. On `/devmode/` the log is the Details column under the picture.

<small>`bootfile` · `idle` · container 1<br>`bootfile` · `idle` · container 1</small>

<details><summary>the script</summary>

```
  if debugging
    if optionkey ()
      message (currentset () @ "     " @ currentscene () @ "    " @ currentview () @ "     " @ numtostring (actordist ("vlad")))
    endif
    if shiftkey ()
      thename = hittest (mouse ())
      if result () = "actor"
        message (numtostring (sendtocastfx ("gang.cst", realdist (thename))))
      endif
    endif
  endif
```

```
    if optionkey ()
      message (currentset () @ "     " @ currentscene () @ "    " @ currentview () @ "     " @ numtostring (actordist ("vlad")))
    endif
```

</details>

### Options ▸ Quit stops asking

A player gets "are you sure?" and an offer to save first. With the flag up the whole confirmation block is skipped and Quit quits.

<small>`bootfile` · `menuselect` · container 1<br>`bootfile` · `menuselect` · container 1</small>

<details><summary>the script</summary>

```
    if not debugging
      if tour
        if optionquit
          if not (shiftkey () & optionkey ())
            exitcode
          endif
        endif
        if questiondialog ("Are you sure you want to quit? You can't save your game during the tour.") = false
          if currentstage () = "ctl.stg"
            makeloop ("flat", currentflat (), "update", 10)
          endif
          exitcode
        endif
      else
        if questiondialog ("Are you sure you want to quit?") = false
          if currentstage () = "ctl.stg"
            makeloop ("flat", currentflat (), "update", 10)
          endif
          exitcode
        endif
        if playerdeath = ""
          if questiondialog ("Save game before quitting?")
            if currentstage () = "ctl.stg"
              sendtobutton (currentflat (), "save", saveme ())
            else
              savegame ("Titanic 1.0")
            endif
          endif
        …
```

```
          if not (shiftkey () & optionkey ())
            exitcode
          endif
        endif
        if questiondialog ("Are you sure you want to quit? You can't save your game during the tour.") = false
          if currentstage () = "ctl.stg"
            makeloop ("flat", currentflat (), "update", 10)
```

</details>

### Solve the bomb

Opens the bomb's door, sets the key's position, kills its power and puts the **bomb key** in your inventory. Reached through the console.

<small>`bomb.stg` · `solvebomb` · container 1</small>

<details><summary>the script</summary>

```
  if debugging
    unibomdoor = 0
    propdeg ("key", 5)
    unibompower = -1
    sendtoshop ("inven.shp", addinven ("bombkey"))
  endif
```

</details>

### Holding option+shift at launch arms a quit guard

Launch with both held and `optionquit` is set, which makes **Options ▸ Quit during a guided tour** require the same two keys held again. A guard against somebody ending a museum kiosk's tour by accident. Not behind the flag — it is read at boot, before anything is decided.

<small>`bootfile` · `boot` · container 1</small>

<details><summary>the script</summary>

```
  if optionkey () & shiftkey ()
    optionquit = true
  else
    optionquit = false
  endif
```

</details>

### The one assignment

`debugging = false`, the fourteenth line of `boot()`, and the only write to this global in the game data. Options ▸ Debug On/Off lowers it again — the case is `if debugging → debugging = false`, so the command only ever turned developer mode off and the way back was to relaunch. `/devmode/` makes all three of its switches toggle.

<small>`bootfile` · `boot` · container 1</small>

<details><summary>the script</summary>

```
  debugging = false
  puppetparam (9, 1)
  puppetparam (10, 25)
```

</details>

### Hold shift and point at someone: how far away they are

Point the cursor at a character with shift held and the log prints that actor's real distance from Frank.

<small>`bootfile` · `idle` · container 1</small>

<details><summary>the script</summary>

```
    if shiftkey ()
      thename = hittest (mouse ())
      if result () = "actor"
        message (numtostring (sendtocastfx ("gang.cst", realdist (thename))))
      endif
    endif
```

</details>

### The menu works while the game is busy

Menu commands are normally dropped whenever `lockevents` is set — during a film, a walk, a scripted beat. The flag lets a developer pick one anyway.

<small>`bootfile` · `menuselect` · container 1</small>

<details><summary>the script</summary>

```
  if not debugging & lockevents
    exitcode
  endif
  switch arg
  case "painting scripts"
    if debugging
      if optionkey ()
```

</details>

### Options ▸ Close Puppet — open any conversation by name

With a conversation open it shuts it. With none open it asks you to type a name and opens `<name>.pup` cold — the quickest way to look at a conversation you would otherwise have to earn.

<small>`bootfile` · `menuselect` · container 1</small>

<details><summary>the script</summary>

```
    if debugging
      if currentpuppet () != "none"
        closepuppetfile ()
        puppetgrab (true)
        clut ("set")
      else
        pup = textdialog ("Open puppet:", "")
        if pup = ""
          exitcode
        endif
        openpuppetfile (pup @ ".pup")
        visualeffect (plain, 0)
        clut ("puppet")
      endif
    endif
```

</details>

### A leak check on the way out of a room

Leaving a set, the flag makes the game walk every actor and raise a dialog naming any that is **still visible** — a check for a character left on screen who should have been put away.

<small>`bootfile` · `closeset` · container 2</small>

<details><summary>the script</summary>

```
  if debugging
    for count = 1 to countactors ()
      if actorvisible (indextoactor (count))
        notedialog (indextoactor (count) @ " is still visible")
      endif
    endfor
  endif
```

</details>

### Shift-click HELP: the game's own state readout

The interface band's **HELP** button answers a shift-click with a dialog reading `Mission=…, Phase=…, Letter=…, Necklace=…` — and inside the three smokestack sets it adds `Maze=` and `Level=`, which is how you read which of the four crate mazes you are in. It is one of the four ungated modifier branches, so it answers on the play page as well.

<small>`house.shp` · `mousedown` · container 128</small>

<details><summary>the script</summary>

```
  if shiftkey ()
    if currentset () = "smstack1" | currentset () = "smstack2" | currentset () = "smstack3"
      notedialog ("Mission=" @ numtostring (mission) @ ", Phase=" @ numtostring (phase) @ ", Letter=" @ numtostring (letterphase) @ ", Necklace=" @ numtostring (neckphase) @ ", Maze=" @ numtostring (mazenumber) @ ", Level=" @ numtostring (stacklevel))
      exitcode
    else
      notedialog ("Mission=" @ numtostring (mission) @ ", Phase=" @ numtostring (phase) @ ", Letter=" @ numtostring (letterphase) @ ", Necklace=" @ numtostring (neckphase))
      exitcode
    endif
  endif
```

</details>

### Picking up the bag also gives you the map and the watch

Taking the small bag normally gives you just the bag. With the flag up it hands over the map and the watch with it — which between them are what `mapdisabled()` checks, so this is the other way to make the deck map live.

<small>`house.shp` · `mousedown` · container 533</small>

<details><summary>the script</summary>

```
    if debugging
      sendtoprop ("map", addmap ())
      sendtoprop ("watch", addwatch ())
    endif
```

</details>

### Option-drag a cricket to move it in Z — not behind the flag

A *cricket* is a sound emitter parked in the room, and this drags it: without a modifier across the floor, with **option** held up and down, printing its position, distance and volume as it goes. Ungated, so it answers whenever the ⌥ latch is on.

<small>`house.shp` · `move` · container 932</small>

<details><summary>the script</summary>

```
    if optionkey ()
      propxyz (me, propxyz (me, 1), propxyz (me, 2), propxyz (me, 3) + (y1 -y2) * 2)
      x1 = x2
      y1 = y2
      visualeffect (plain, 0)
    else
      propxyz (me, propxyz (me, 1) + calcvectx (currentdeg () + 64, (x2 -x1) * 2) -calcvecty (currentdeg () + 64, (y2 -y1) * 2), propxyz (me, 2) + calcvectx (currentdeg () + 64, (y2 -y1) * 2) + calcvecty (currentdeg () + 64, (x2 -x1) * 2), propxyz (me, 3))
      x1 = x2
      y1 = y2
      visualeffect (plain, 0)
    endif
```

</details>

### Option-click a band prop to step it round

Option-clicking this interface prop advances its `propdeg` by one — a way to walk a dial or hand through its frames by hand.

<small>`house.shp` · `mousedown` · container 967</small>

<details><summary>the script</summary>

```
    if optionkey ()
      propdeg (me, propdeg (me) + 1)
      exitcode
    endif
    if commandkey ()
      setupsigns ()
      exitcode
    endif
```

</details>

### Command-click the signs prop to rebuild it

The interface band's signs prop answers three modifiers behind the flag: **shift** asks for its script, **option** steps its `propdeg` on by one, and **command** re-runs `setupsigns ()`, which rebuilds the sign faces from the current state.

<small>`house.shp` · `mousedown` · container 967</small>

<details><summary>the script</summary>

```
    if commandkey ()
      setupsigns ()
      exitcode
    endif
  endif
  propvisible (me, false)
```

</details>

### Command-click opens the debugger

Held while this prop is being shown, **command** calls `debugger()`, which opens the in-engine debugger on the disc and is a no-op here.

<small>`house.shp` · `visdeg` · container 967</small>

<details><summary>the script</summary>

```
  if debugging & commandkey ()
    debugger ()
  endif
```

</details>

### Option-click an item to name it

Option-clicking an item in the inventory panel prints its name to the log and asks for its script.

<small>`inven.shp` · `stdmouse` · container 1</small>

<details><summary>the script</summary>

```
  if optionkey () & debugging
    message (what)
    propscript (what)
    exitcode
  endif
```

</details>

### Every item in the game, at once

Loops `countitems()` and adds all of them. Invoked from the script editor on the disc; type `sendtoshop ("inven.shp", addallinven ())` into the console.

<small>`inven.shp` · `addallinven` · container 1</small>

<details><summary>the script</summary>

```
  if debugging
    for count = 1 to countitems ()
      addinven (indextoitem (count))
      sendtoprop (handitem, infoyoself ())
    endfor
  endif
```

</details>

### Play every item's own film

Sends `infoyoself()` to each item in turn, which plays its info movie. Reached through the console the same way.

<small>`inven.shp` · `movies` · container 1</small>

<details><summary>the script</summary>

```
  if debugging
    for count = 1 to countitems ()
      sendtoprop (indextoitem (count), infoyoself ())
    endfor
  endif
```

</details>

### Option-click the room itself opens the debugger

The main stage's own mousedown calls `debugger()` on an option-click.

<small>`main.stg` · `mousedown` · container 2</small>

<details><summary>the script</summary>

```
  if optionkey () & debugging
    debugger ()
  endif
```

</details>

### Solve the doll

Sets the four dials of the Russian doll puzzle to their answer. Reached through the console.

<small>`patty.stg` · `solvedoll` · container 1</small>

<details><summary>the script</summary>

```
  if debugging
    propdeg ("dial1", 6)
    propdeg ("dial2", 0)
    propdeg ("dial3", 0)
    propdeg ("dial4", 0)
  endif
```

</details>

### The photo album's debugger — and it is not behind the flag

Option-clicking in the photo album calls `debugger()`. One of the four ungated modifier branches, so it answers whenever option is held.

<small>`photo.shp` · `mousedown` · container 1</small>

<details><summary>the script</summary>

```
  if optionkey ()
    debugger ()
  endif
```

</details>

### Option-drag rescales a smokestack prop — also ungated

Dragging on the false smokestack's props with **option** held changes their `propscale` and without it their `propzclip`, printing the value as it goes. Ungated, so it answers whenever option is held — which is why the play page leaves `optionkey()` at 0: it is artwork, and a drag reshapes it.

<small>`smstack.shp` · `mousedown` · container 1</small>

<details><summary>the script</summary>

```
    if optionkey ()
      if pointx (mouse ()) > x
        propscale (target, propscale (target) + 100)
      endif
      if pointx (mouse ()) < x
        propscale (target, propscale (target) -100)
      endif
      message ("SCALE: " @ numtostring (propscale (target)))
      x = pointx (mouse ())
    else
      if pointx (mouse ()) > x
        propzclip (target, propzclip (target) + 10)
      endif
      if pointx (mouse ()) < x
        propzclip (target, propzclip (target) -10)
      endif
      message ("ZCLIP: " @ numtostring (propzclip (target)))
      x = pointx (mouse ())
    endif
```

</details>

### The false smokestack loses its walls

`pathblocked` answers `false`, so the crate maze inside the dummy funnel stops blocking anything and you can walk straight through it. It is the game's one `pathblocked` handler.

<small>`smstack2.set` · `pathblocked` · container 1</small>

<details><summary>the script</summary>

```
  if tour | debugging
    return false
  endif
```

</details>

### All ten guided-tour props, film or no film

The tour's own shop normally shows a tour prop only when its film is on the disc. With the flag up all ten are made visible and parked at the centre of the screen — the companion to `setuptour` above, which places the narrators themselves.

<small>`tour.shp` · `openshop` · container 1</small>

<details><summary>the script</summary>

```
    if fileexists ("tour" @ numtostring (count) @ ".mov") | debugging
      propvisible ("tour" @ numtostring (count), true)
      propxy ("tour" @ numtostring (count), 256, 192)
    endif
```

</details>

### The kinds that are not written up

One shape each, copied onto every clickable prop and region in the game: a
developer shift-clicking a prop wanted that prop's script, so the same few lines
sit on all of them. The widest copy of each:

**opens the script editor** — 212 occurrences across 22 files. The widest copy is
`enigma.shp` · `mousedown` (32 containers):

```
  if debugging & shiftkey ()
    propscript (me)
    exitcode
  endif
```

**drags or places a prop** — 94 occurrences across 18 files. The widest copy is
`enigma.shp` · `mousedown` (32 containers):

```
  if debugging & optionkey ()
    while stilldown ()
      propxy (me, pointx (mouse ()), pointy (mouse ()))
      forceupdate ()
    endwhile
    message (me @ "," @ numtostring (pointx (mouse ())) @ "," @ numtostring (pointy (mouse ())))
    exitcode
  endif
```

## Every occurrence

Identical branches in one file collapse into a row carrying its container count;
the totals above are over occurrences. `Effect` is the first call the branch
makes, quoted from the script.

| File | Handler | × | Condition | Effect |
|---|---|---:|---|---|
| `enigma.shp` | `mousedown` | 32 | `if debugging & optionkey ()` | `while stilldown ()` |
| `enigma.shp` | `mousedown` | 32 | `if debugging & shiftkey ()` | `propscript (me)` |
| `turbine.shp` | `mousedown` | 16 | `if debugging & optionkey ()` | `while stilldown ()` |
| `bomb.shp` | `mousedown` | 10 | `if debugging & optionkey ()` | `while stilldown ()` |
| `turbine.shp` | `mousedown` | 10 | `if debugging & shiftkey ()` | `propscript (me)` |
| `map.stg` | `mousedown` | 8 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 8 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 8 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 8 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 8 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 8 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 8 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 8 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 8 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `fight.shp` | `mousedown` | 7 | `if debugging & optionkey ()` | `while stilldown ()` |
| `fight.shp` | `mousedown` | 7 | `if debugging & shiftkey ()` | `propscript (me)` |
| `bomb.shp` | `mousedown` | 6 | `if debugging & shiftkey ()` | `propscript (me)` |
| `bridge.shp` | `mousedown` | 5 | `if debugging & optionkey ()` | `while stilldown ()` |
| `house.shp` | `mousedown` | 5 | `if debugging & optionkey ()` | `while stilldown ()` |
| `house.shp` | `mousedown` | 5 | `if debugging & shiftkey ()` | `propscript (me)` |
| `map.stg` | `mousedown` | 5 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `bridge.shp` | `mousedown` | 4 | `if debugging & shiftkey ()` | `propscript (me)` |
| `blkjack.shp` | `mousedown` | 2 | `if debugging & optionkey ()` | `while stilldown ()` |
| `blkjack.shp` | `mousedown` | 2 | `if debugging & shiftkey ()` | `propscript (me)` |
| `fence.shp` | `mousedown` | 2 | `if debugging & shiftkey ()` | `propscript (me)` |
| `fence.shp` | `mousedown` | 2 | `if debugging & optionkey ()` | `while stilldown ()` |
| `fence.shp` | `mousedown` | 2 | `if debugging & shiftkey ()` | `propscript (me)` |
| `fight.shp` | `mousedown` | 2 | `if debugging` | `while stilldown ()` |
| `fight.shp` | `mousedown` | 2 | `if optionkey ()` | `while stilldown ()` |
| `bedsit1.set` | `mousedown` | 1 | `if debugging` | `sendtoprop ("bag", addbag ())` |
| `bedsit1.set` | `mousedown` | 1 | `if optionkey ()` | `sendtoprop ("bag", addbag ())` |
| `boil.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `boil.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `bomb.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `bomb.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `bomb.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `bomb.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `bomb.stg` | `solvebomb` | 1 | `if debugging` | `unibomdoor = 0` |
| `bootfile` | `boot` | 1 | `if optionkey () & shiftkey ()` | `optionquit = true` |
| `bootfile` | `boot` | 1 | `debugging = false` | `puppetparam (9, 1)` |
| `bootfile` | `boot` | 1 | `menuvisible (debugging)` | `keyaborts (debugging)` |
| `bootfile` | `boot` | 1 | `keyaborts (debugging)` | `lockevents = false` |
| `bootfile` | `mousedown` | 1 | `if setloc & debugging` | `move3dactor (thename)` |
| `bootfile` | `mousedown` | 1 | `if setloc & debugging` | `move3dprop (thename)` |
| `bootfile` | `idle` | 1 | `if debugging` | `message (currentset () @ "     " @ currentscene () @ "    " @ currentview () @ "     " @ numtostring (actordist ("vlad")))` |
| `bootfile` | `idle` | 1 | `if optionkey ()` | `message (currentset () @ "     " @ currentscene () @ "    " @ currentview () @ "     " @ numtostring (actordist ("vlad")))` |
| `bootfile` | `idle` | 1 | `if shiftkey ()` | `thename = hittest (mouse ())` |
| `bootfile` | `menuselect` | 1 | `if not debugging & lockevents` | `exitcode` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `for count1 = 1 to countscenes ()` |
| `bootfile` | `menuselect` | 1 | `if optionkey ()` | `for count1 = 1 to countscenes ()` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `for count = 1 to countscenes ()` |
| `bootfile` | `menuselect` | 1 | `if optionkey ()` | `for count = 1 to countscenes ()` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `setscript ()` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `for count = 1 to countbuttons (currentflat ())` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `flatscript (currentflat ())` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `stagescript ()` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `bootscript ()` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `postscript ()` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `debugging = false` |
| `bootfile` | `menuselect` | 1 | `debugging = false` | `message ("Debugging Off")` |
| `bootfile` | `menuselect` | 1 | `menuvisible (debugging)` | `keyaborts (debugging)` |
| `bootfile` | `menuselect` | 1 | `keyaborts (debugging)` | `exitcode` |
| `bootfile` | `menuselect` | 1 | `if not debugging` | `exitcode` |
| `bootfile` | `menuselect` | 1 | `if not (shiftkey () & optionkey ())` | `exitcode` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `closepuppetfile ()` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `castscript ("gang.cst")` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `puppetscript ("boot script")` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `puppetscript ("before")` |
| `bootfile` | `menuselect` | 1 | `if debugging` | `puppetscript ("after")` |
| `bootfile` | `move3dprop` | 1 | `if optionkey ()` | `propxyz (name, propxyz (name, 1), propxyz (name, 2), propxyz (name, 3) + (y1 -y2) * 2)` |
| `bootfile` | `move3dprop` | 1 | `if shiftkey ()` | `propxyz (name, propxyz (name, 1), propxyz (name, 2), propxyz (name, 3) + (y1 -y2) * 2)` |
| `bootfile` | `move3dprop` | 1 | `if shiftkey ()` | `propdeg (name, propdeg (name) + x1 -x2)` |
| `bootfile` | `move3dactor` | 1 | `if not optionkey () & not shiftkey ()` | `actorscript (name)` |
| `bootfile` | `move3dactor` | 1 | `if optionkey ()` | `actorxyz (name, actorxyz (name, 1), actorxyz (name, 2), actorxyz (name, 3) + y1 -y2)` |
| `bootfile` | `move3dactor` | 1 | `if shiftkey ()` | `actorxyz (name, actorxyz (name, 1), actorxyz (name, 2), actorxyz (name, 3) + y1 -y2)` |
| `bootfile` | `move3dactor` | 1 | `if shiftkey ()` | `actordeg (name, actordeg (name) + x1 -x2)` |
| `bootfile` | `setuptour` | 1 | `if fileexists ("tour1.mov") \| debugging` | `sendtoactor ("penny", setupactor ("tour"))` |
| `bootfile` | `setuptour` | 1 | `if fileexists ("tour2.mov") \| debugging` | `sendtoactor ("burns", setupactor ("tour"))` |
| `bootfile` | `setuptour` | 1 | `if fileexists ("tour3.mov") \| debugging` | `sendtoactor ("willie", setupactor ("tour"))` |
| `bootfile` | `setuptour` | 1 | `if fileexists ("tour4.mov") \| debugging` | `sendtoactor ("cash", setupactor ("tour"))` |
| `bootfile` | `setuptour` | 1 | `if fileexists ("tour5.mov") \| debugging` | `sendtoactor ("morrow", setupactor ("tour5"))` |
| `bootfile` | `setuptour` | 1 | `if fileexists ("tour6.mov") \| debugging` | `sendtoactor ("morrow", setupactor ("tour6"))` |
| `bootfile` | `setuptour` | 1 | `if fileexists ("tour7.mov") \| debugging` | `sendtoactor ("stok1", setupactor ("tour"))` |
| `bootfile` | `setuptour` | 1 | `if fileexists ("tour8.mov") \| debugging` | `sendtoactor ("trask", setupactor ("tour"))` |
| `bootfile` | `setuptour` | 1 | `if fileexists ("tour9.mov") \| debugging` | `sendtoactor ("smeth", setupactor ("tour"))` |
| `bootfile` | `setuptour` | 1 | `if fileexists ("tour10.mov") \| debugging` | `sendtoactor ("shay", setupactor ("tour"))` |
| `bootfile` | `closeset` | 1 | `if debugging` | `for count = 1 to countactors ()` |
| `bridge.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `bridge.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `cargo.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `cargo.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `cigs.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `cigs.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `cuff.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `cuff.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `fence.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `fight.shp` | `mousedown` | 1 | `if shiftkey ()` | `propscript (me)` |
| `fight.shp` | `mousedown` | 1 | `if shiftkey ()` | `propscript (me)` |
| `gang.cst` | `runpuppet` | 1 | `if debugging` | `message (numtostring (realdist (target)))` |
| `gang.cst` | `runpuppet` | 1 | `if shiftkey () & optionkey ()` | `message (numtostring (realdist (target)))` |
| `gang.cst` | `runpuppet` | 1 | `if optionkey ()` | `message (target)` |
| `gang.cst` | `runpuppet` | 1 | `if shiftkey ()` | `openpuppetfile (pupname)` |
| `house.shp` | `mousedown` | 1 | `if shiftkey ()` | `notedialog ("Mission=" @ numtostring (mission) @ ", Phase=" @ numtostring (phase) @ ", Letter=" @ numtostring (letterphase) @ ", Necklace=" @ numtostring (neckphase) @ ", Maze=" @ numtostring (mazenumber) @ ", Level=" @ numtostring (stacklevel))` |
| `house.shp` | `mousedown` | 1 | `if debugging` | `sendtoprop ("map", addmap ())` |
| `house.shp` | `move` | 1 | `if optionkey ()` | `propxyz (me, propxyz (me, 1), propxyz (me, 2), propxyz (me, 3) + (y1 -y2) * 2)` |
| `house.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `house.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `house.shp` | `mousedown` | 1 | `if debugging` | `propscript (me)` |
| `house.shp` | `mousedown` | 1 | `if shiftkey ()` | `propscript (me)` |
| `house.shp` | `mousedown` | 1 | `if optionkey ()` | `propdeg (me, propdeg (me) + 1)` |
| `house.shp` | `mousedown` | 1 | `if commandkey ()` | `setupsigns ()` |
| `house.shp` | `visdeg` | 1 | `if debugging & commandkey ()` | `debugger ()` |
| `inven.shp` | `stdmouse` | 1 | `if optionkey () & debugging` | `message (what)` |
| `inven.shp` | `addallinven` | 1 | `if debugging` | `for count = 1 to countitems ()` |
| `inven.shp` | `movies` | 1 | `if debugging` | `for count = 1 to countitems ()` |
| `main.stg` | `mousedown` | 1 | `if optionkey () & debugging` | `debugger ()` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `map.stg` | `mousedown` | 1 | `if not debugging` | `exitcode` |
| `patty.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `patty.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `patty.stg` | `solvedoll` | 1 | `if debugging` | `propdeg ("dial1", 6)` |
| `photo.shp` | `mousedown` | 1 | `if optionkey ()` | `debugger ()` |
| `punchbag.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `punchbag.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `punchbag.stg` | `mousedown` | 1 | `if debugging & shiftkey ()` | `buttonscript (currentflat (), me)` |
| `rubclue.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `rubclue.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `smstack.shp` | `mousedown` | 1 | `if optionkey ()` | `propscale (target, propscale (target) + 100)` |
| `smstack2.set` | `pathblocked` | 1 | `if tour \| debugging` | `return false` |
| `tour.shp` | `openshop` | 1 | `if fileexists ("tour" @ numtostring (count) @ ".mov") \| debugging` | `propvisible ("tour" @ numtostring (count), true)` |
| `tour.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `tour.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `trunk.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `trunk.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `turbine.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `turbine.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `turbine.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `turbine.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `turbine.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `turbine.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |
| `turk.shp` | `mousedown` | 1 | `if debugging & optionkey ()` | `while stilldown ()` |
| `turk.shp` | `mousedown` | 1 | `if debugging & shiftkey ()` | `propscript (me)` |

## Which containers

Every container behind each row above, for finding a line in the file it came
from.

| File | Handler | Condition | Containers |
|---|---|---|---|
| `enigma.shp` | `mousedown` | `if debugging & optionkey ()` | 55, 79, 119, 130, 174, 194, 198, 227, 231, 235, 261, 265, 269, 292, 296, 317, 337, 341, 345, 349, 353, 357, 361, 365 … (+8) |
| `enigma.shp` | `mousedown` | `if debugging & shiftkey ()` | 55, 79, 119, 130, 174, 194, 198, 227, 231, 235, 261, 265, 269, 292, 296, 317, 337, 341, 345, 349, 353, 357, 361, 365 … (+8) |
| `turbine.shp` | `mousedown` | `if debugging & optionkey ()` | 3, 26, 49, 72, 95, 118, 141, 164, 187, 210, 233, 256, 281, 285, 308, 331 |
| `bomb.shp` | `mousedown` | `if debugging & optionkey ()` | 3, 8, 14, 30, 46, 108, 117, 123, 129, 135 |
| `turbine.shp` | `mousedown` | `if debugging & shiftkey ()` | 49, 72, 95, 118, 141, 256, 281, 285, 308, 331 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 5, 33, 51, 66, 80, 94, 109, 121 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 6, 34, 52, 67, 81, 95, 110, 122 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 7, 35, 53, 68, 82, 96, 111, 123 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 8, 36, 54, 69, 83, 97, 112, 124 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 9, 37, 55, 70, 84, 98, 113, 125 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 10, 38, 56, 71, 85, 99, 114, 126 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 11, 39, 57, 72, 86, 100, 115, 127 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 12, 40, 58, 73, 87, 101, 116, 128 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 13, 41, 59, 74, 88, 102, 117, 129 |
| `fight.shp` | `mousedown` | `if debugging & optionkey ()` | 130, 138, 142, 146, 152, 158, 162 |
| `fight.shp` | `mousedown` | `if debugging & shiftkey ()` | 130, 138, 142, 146, 152, 158, 162 |
| `bomb.shp` | `mousedown` | `if debugging & shiftkey ()` | 3, 8, 14, 30, 46, 135 |
| `bridge.shp` | `mousedown` | `if debugging & optionkey ()` | 3, 7, 15, 19, 23 |
| `house.shp` | `mousedown` | `if debugging & optionkey ()` | 333, 946, 963, 1183, 1192 |
| `house.shp` | `mousedown` | `if debugging & shiftkey ()` | 333, 946, 963, 1183, 1192 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 28, 48, 63, 78, 92 |
| `bridge.shp` | `mousedown` | `if debugging & shiftkey ()` | 3, 15, 19, 23 |
| `blkjack.shp` | `mousedown` | `if debugging & optionkey ()` | 403, 441 |
| `blkjack.shp` | `mousedown` | `if debugging & shiftkey ()` | 403, 441 |
| `fence.shp` | `mousedown` | `if debugging & shiftkey ()` | 3, 93 |
| `fence.shp` | `mousedown` | `if debugging & optionkey ()` | 89, 159 |
| `fence.shp` | `mousedown` | `if debugging & shiftkey ()` | 89, 159 |
| `fight.shp` | `mousedown` | `if debugging` | 3, 76 |
| `fight.shp` | `mousedown` | `if optionkey ()` | 3, 76 |
| `bedsit1.set` | `mousedown` | `if debugging` | 171 |
| `bedsit1.set` | `mousedown` | `if optionkey ()` | 171 |
| `boil.shp` | `mousedown` | `if debugging & optionkey ()` | 3 |
| `boil.shp` | `mousedown` | `if debugging & shiftkey ()` | 3 |
| `bomb.shp` | `mousedown` | `if debugging & shiftkey ()` | 108 |
| `bomb.shp` | `mousedown` | `if debugging & shiftkey ()` | 117 |
| `bomb.shp` | `mousedown` | `if debugging & shiftkey ()` | 123 |
| `bomb.shp` | `mousedown` | `if debugging & shiftkey ()` | 129 |
| `bomb.stg` | `solvebomb` | `if debugging` | 1 |
| `bootfile` | `boot` | `if optionkey () & shiftkey ()` | 1 |
| `bootfile` | `boot` | `debugging = false` | 1 |
| `bootfile` | `boot` | `menuvisible (debugging)` | 1 |
| `bootfile` | `boot` | `keyaborts (debugging)` | 1 |
| `bootfile` | `mousedown` | `if setloc & debugging` | 1 |
| `bootfile` | `mousedown` | `if setloc & debugging` | 1 |
| `bootfile` | `idle` | `if debugging` | 1 |
| `bootfile` | `idle` | `if optionkey ()` | 1 |
| `bootfile` | `idle` | `if shiftkey ()` | 1 |
| `bootfile` | `menuselect` | `if not debugging & lockevents` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if optionkey ()` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if optionkey ()` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `debugging = false` | 1 |
| `bootfile` | `menuselect` | `menuvisible (debugging)` | 1 |
| `bootfile` | `menuselect` | `keyaborts (debugging)` | 1 |
| `bootfile` | `menuselect` | `if not debugging` | 1 |
| `bootfile` | `menuselect` | `if not (shiftkey () & optionkey ())` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `menuselect` | `if debugging` | 1 |
| `bootfile` | `move3dprop` | `if optionkey ()` | 1 |
| `bootfile` | `move3dprop` | `if shiftkey ()` | 1 |
| `bootfile` | `move3dprop` | `if shiftkey ()` | 1 |
| `bootfile` | `move3dactor` | `if not optionkey () & not shiftkey ()` | 1 |
| `bootfile` | `move3dactor` | `if optionkey ()` | 1 |
| `bootfile` | `move3dactor` | `if shiftkey ()` | 1 |
| `bootfile` | `move3dactor` | `if shiftkey ()` | 1 |
| `bootfile` | `setuptour` | `if fileexists ("tour1.mov") \| debugging` | 2 |
| `bootfile` | `setuptour` | `if fileexists ("tour2.mov") \| debugging` | 2 |
| `bootfile` | `setuptour` | `if fileexists ("tour3.mov") \| debugging` | 2 |
| `bootfile` | `setuptour` | `if fileexists ("tour4.mov") \| debugging` | 2 |
| `bootfile` | `setuptour` | `if fileexists ("tour5.mov") \| debugging` | 2 |
| `bootfile` | `setuptour` | `if fileexists ("tour6.mov") \| debugging` | 2 |
| `bootfile` | `setuptour` | `if fileexists ("tour7.mov") \| debugging` | 2 |
| `bootfile` | `setuptour` | `if fileexists ("tour8.mov") \| debugging` | 2 |
| `bootfile` | `setuptour` | `if fileexists ("tour9.mov") \| debugging` | 2 |
| `bootfile` | `setuptour` | `if fileexists ("tour10.mov") \| debugging` | 2 |
| `bootfile` | `closeset` | `if debugging` | 2 |
| `bridge.shp` | `mousedown` | `if debugging & shiftkey ()` | 7 |
| `bridge.stg` | `mousedown` | `if debugging & shiftkey ()` | 5 |
| `cargo.shp` | `mousedown` | `if debugging & optionkey ()` | 27 |
| `cargo.shp` | `mousedown` | `if debugging & shiftkey ()` | 27 |
| `cigs.shp` | `mousedown` | `if debugging & optionkey ()` | 29 |
| `cigs.shp` | `mousedown` | `if debugging & shiftkey ()` | 29 |
| `cuff.shp` | `mousedown` | `if debugging & optionkey ()` | 59 |
| `cuff.shp` | `mousedown` | `if debugging & shiftkey ()` | 59 |
| `fence.shp` | `mousedown` | `if debugging & shiftkey ()` | 85 |
| `fight.shp` | `mousedown` | `if shiftkey ()` | 3 |
| `fight.shp` | `mousedown` | `if shiftkey ()` | 76 |
| `gang.cst` | `runpuppet` | `if debugging` | 1 |
| `gang.cst` | `runpuppet` | `if shiftkey () & optionkey ()` | 1 |
| `gang.cst` | `runpuppet` | `if optionkey ()` | 1 |
| `gang.cst` | `runpuppet` | `if shiftkey ()` | 1 |
| `house.shp` | `mousedown` | `if shiftkey ()` | 128 |
| `house.shp` | `mousedown` | `if debugging` | 533 |
| `house.shp` | `move` | `if optionkey ()` | 932 |
| `house.shp` | `mousedown` | `if debugging & optionkey ()` | 958 |
| `house.shp` | `mousedown` | `if debugging & shiftkey ()` | 958 |
| `house.shp` | `mousedown` | `if debugging` | 967 |
| `house.shp` | `mousedown` | `if shiftkey ()` | 967 |
| `house.shp` | `mousedown` | `if optionkey ()` | 967 |
| `house.shp` | `mousedown` | `if commandkey ()` | 967 |
| `house.shp` | `visdeg` | `if debugging & commandkey ()` | 967 |
| `inven.shp` | `stdmouse` | `if optionkey () & debugging` | 1 |
| `inven.shp` | `addallinven` | `if debugging` | 1 |
| `inven.shp` | `movies` | `if debugging` | 1 |
| `main.stg` | `mousedown` | `if optionkey () & debugging` | 2 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 14 |
| `map.stg` | `mousedown` | `if not debugging` | 14 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 15 |
| `map.stg` | `mousedown` | `if not debugging` | 15 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 16 |
| `map.stg` | `mousedown` | `if not debugging` | 16 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 17 |
| `map.stg` | `mousedown` | `if not debugging` | 17 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 18 |
| `map.stg` | `mousedown` | `if not debugging` | 18 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 19 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 20 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 24 |
| `map.stg` | `mousedown` | `if not debugging` | 24 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 25 |
| `map.stg` | `mousedown` | `if not debugging` | 25 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 26 |
| `map.stg` | `mousedown` | `if not debugging` | 26 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 27 |
| `map.stg` | `mousedown` | `if not debugging` | 27 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 29 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 30 |
| `map.stg` | `mousedown` | `if not debugging` | 30 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 31 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 32 |
| `map.stg` | `mousedown` | `if not debugging` | 32 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 45 |
| `map.stg` | `mousedown` | `if not debugging` | 45 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 46 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 47 |
| `map.stg` | `mousedown` | `if not debugging` | 47 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 49 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 50 |
| `map.stg` | `mousedown` | `if not debugging` | 50 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 64 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 65 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 79 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 93 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 106 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 107 |
| `map.stg` | `mousedown` | `if debugging & shiftkey ()` | 108 |
| `map.stg` | `mousedown` | `if not debugging` | 108 |
| `patty.shp` | `mousedown` | `if debugging & optionkey ()` | 149 |
| `patty.shp` | `mousedown` | `if debugging & shiftkey ()` | 149 |
| `patty.stg` | `solvedoll` | `if debugging` | 1 |
| `photo.shp` | `mousedown` | `if optionkey ()` | 1 |
| `punchbag.shp` | `mousedown` | `if debugging & optionkey ()` | 31 |
| `punchbag.shp` | `mousedown` | `if debugging & shiftkey ()` | 31 |
| `punchbag.stg` | `mousedown` | `if debugging & shiftkey ()` | 5 |
| `rubclue.shp` | `mousedown` | `if debugging & optionkey ()` | 29 |
| `rubclue.shp` | `mousedown` | `if debugging & shiftkey ()` | 29 |
| `smstack.shp` | `mousedown` | `if optionkey ()` | 1 |
| `smstack2.set` | `pathblocked` | `if tour \| debugging` | 1 |
| `tour.shp` | `openshop` | `if fileexists ("tour" @ numtostring (count) @ ".mov") \| debugging` | 1 |
| `tour.shp` | `mousedown` | `if debugging & optionkey ()` | 43 |
| `tour.shp` | `mousedown` | `if debugging & shiftkey ()` | 43 |
| `trunk.shp` | `mousedown` | `if debugging & optionkey ()` | 55 |
| `trunk.shp` | `mousedown` | `if debugging & shiftkey ()` | 55 |
| `turbine.shp` | `mousedown` | `if debugging & shiftkey ()` | 3 |
| `turbine.shp` | `mousedown` | `if debugging & shiftkey ()` | 26 |
| `turbine.shp` | `mousedown` | `if debugging & shiftkey ()` | 164 |
| `turbine.shp` | `mousedown` | `if debugging & shiftkey ()` | 187 |
| `turbine.shp` | `mousedown` | `if debugging & shiftkey ()` | 210 |
| `turbine.shp` | `mousedown` | `if debugging & shiftkey ()` | 233 |
| `turk.shp` | `mousedown` | `if debugging & optionkey ()` | 29 |
| `turk.shp` | `mousedown` | `if debugging & shiftkey ()` | 29 |

Back to [Developer mode](devmode.md).
