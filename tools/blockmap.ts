/**
 * Map a real DF file's bytes into the JSON that <ByteMap> renders — the block
 * view on the format pages.
 *
 *   npx tsx tools/blockmap.ts taoot/public/lang.stg
 *   npx tsx tools/blockmap.ts gamefiles/en/titanic1/data/lnghall.set
 *
 * The committed maps, and the files they were made from (a rip is needed to
 * regenerate them, which is exactly why they are committed):
 *
 *   lang.stg     taoot/public/lang.stg                            (in this repo)
 *   lnghall.set  taoot/gamefiles/en/titanic1/data/lnghall.set
 *   tour4.mov    taoot/gamefiles/en/titanic1/data/tour4.mov
 *   sink1.trk    taoot/gamefiles/en/titanic1/data/sink1.trk
 *   cuff.shp     taoot/gamefiles/en/titanic2/CUFF/CUFF.SHP
 *   blkjack1.pup taoot/gamefiles/en/titanic2/PUPPETS1/BLKJACK1.PUP
 *   extra.cst    taoot/gamefiles/en/titanic1/data/extra.cst
 *   bootfile     taoot/gamefiles/en/titanic1/data/bootfile
 *   lounge.ti    "taoot/gamefiles/en/save/ENDGAME1/04 - First Class Lounge.ti"  --as lounge.ti
 *   undertak.set dust/gamefiles/dustcd/DATA/UNDERTAK.SET
 *   new.flt      dust/gamefiles/dustcd/DATA/NEW.FLT
 *   cactus.mov   dust/gamefiles/dustcd/DRUGS/CACTUS.MOV
 *   unilib.snd   dust/gamefiles/dustcd/DATA/UNILIB.SND
 *   d1e_001.rtd  dust/gamefiles/save/D1E_001.RTD
 *
 * Writes docs/.vitepress/theme/bytemap/maps/<name>.json, which is COMMITTED:
 * the game data is not in this repository and the docs site has to build
 * without it, so what ships is the derived map — offsets, sizes and roles, no
 * game content — the same arrangement the flow map already uses.
 *
 * Every byte of the file lands in exactly one region: the 1024-byte header, the
 * position table, then one region per container covering its 8-byte {id, size}
 * prefix and its payload. Anything left over the component fills in as
 * unmapped, which is the honest answer and occasionally an interesting one.
 *
 * WHAT a container is for cannot be read off the container format — that is
 * convention per format (docs/engine/formats/README.md). So each format gets an
 * annotator that opens the file with the real reader and walks its structure,
 * claiming containers as it goes: this is the scene register, that is the script
 * of scene "lobby", those 60 are its turn ring. Whatever no annotator claims
 * falls to `classify`, which sniffs the payload — an audio chunk and a picture
 * announce themselves — and otherwise says so.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  HEADER_SIZE,
  RECORD_HEADER_SIZE,
  readContainerFile,
  type DFContainerFile,
} from "@dreamfactory/engine/df/container";
import { readSetFile } from "@dreamfactory/engine/df/set";
import { readAnySetFile } from "@dreamfactory/engine/df/set-any";
import type { SetFileV1 } from "@dreamfactory/engine/df/set-v1";
import { readShpFile } from "@dreamfactory/engine/df/shp";
import { readPupFile, PUP_LAYERS } from "@dreamfactory/engine/df/pup";
import { readCstFile } from "@dreamfactory/engine/df/cst";
import { readSndFile } from "@dreamfactory/engine/df/snd";
import { readSaveFile } from "@dreamfactory/engine/df/savegame";
import { v1Index } from "@dreamfactory/engine/df/savegame-v1";
import { readMovFileV1, movFileFromV1 } from "@dreamfactory/engine/df/mov-v1";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";
import { readAudioHeader } from "@dreamfactory/engine/df/audio";
import { readBankTables } from "@dreamfactory/engine/df/banks";
import { readMovFile, type MovFile } from "@dreamfactory/engine/df/mov";
import { sniffScript } from "@dreamfactory/engine/df/script";
import { FrameBuffer, decodeFrame } from "@dreamfactory/engine/df/image";
import {
  humanBytes,
  type ByteKind,
  type ByteMapData,
  type ByteRegion,
} from "../docs/.vitepress/theme/bytemap/schema";

const MAPS_DIR = "docs/.vitepress/theme/bytemap/maps";

/** what one container is for, as an annotator reports it */
interface Role {
  kind: ByteKind;
  label: string;
  detail?: string;
  texture?: "hatch";
  /** the container whose table or field points at this one — the file's graph */
  via?: number;
}
type Roles = Map<number, Role>;

/**
 * First claim wins, and a second claim is recorded rather than dropped: sharing
 * is expressed by identity in these formats (a door's `openclosed` and
 * `closeclosed` are the same three pictures, a turn ring's standpoint frame IS
 * the view it depicts), so a container two structures point at is a fact about
 * the file worth showing.
 */
function claim(roles: Roles, loc: number, role: Role): void {
  if (!loc || loc < 0) return;
  const had = roles.get(loc);
  if (!had) {
    roles.set(loc, role);
    return;
  }
  if (had.label === role.label) return;
  had.detail = `${had.detail ?? ""} · shared, also ${role.label}`.replace(/^ · /, "");
}

// ---------------------------------------------------------------------------
// annotators
// ---------------------------------------------------------------------------

/**
 * A Dust set, read as what it IS — a grid of cells joined by a flat table in
 * which turning and walking are the same record. Not translated into the v4
 * shapes first: the translation exists so the VIEWER sees one model, and a map
 * of the bytes should show the file the disc actually holds.
 */
function annotateSetV1(set: SetFileV1): { roles: Roles; note: string } {
  const roles: Roles = new Map();

  roles.set(0, {
    kind: "data",
    label: "header container",
    detail: `the set's record: name "${set.setName}", a ${set.gridWidth}×${set.gridHeight} grid of cells, ${set.cluts.length} palettes, and the scene table the header does not point at (it is found by shape)`,
  });
  claim(roles, set.mainScript, {
    kind: "script",
    via: 0,
    label: "the set's main script",
    detail: "the set-level handlers",
  });

  for (const scene of set.scenes) {
    claim(roles, scene.scriptLocation, {
      kind: "script",
      via: 0,
      label: `script of cell "${scene.name}"`,
      detail: `what standing on cell (${scene.x}, ${scene.z}) runs`,
    });
  }
  for (const path of set.starPaths) {
    claim(roles, path.container, {
      kind: "data",
      via: 0,
      label: `route "${path.a}" → "${path.b}"`,
      detail: "an authored polyline between two stars — the same structure v4 stores, read by the same code",
    });
  }
  for (const t of set.transitions) {
    const way = t.kind === "turn" ? "turning" : "walking";
    t.frames.forEach((frame, i) => {
      claim(roles, frame, {
        kind: "media",
        via: 0,
        label: `${way} (${t.from.x},${t.from.z}) → (${t.to.x},${t.to.z})`,
        detail:
          i === t.frames.length - 1
            ? "the last frame of the move, which is the arrival's own picture"
            : `frame ${i + 1} of ${t.frames.length} of the move`,
      });
    });
    claim(roles, t.departureStill, {
      kind: "media",
      via: 0,
      label: `standing at (${t.from.x},${t.from.z})`,
      detail: "the hi-res still of the standpoint this move departs from — exactly one departure from each cell carries it",
    });
  }

  return {
    roles,
    note: `Dust set "${set.setName}" · ${set.gridWidth}×${set.gridHeight} grid, ${set.transitions.length} moves, ${set.cluts.length} palettes`,
  };
}

function annotateSet(data: Uint8Array): { roles: Roles; note: string } {
  const any = readAnySetFile(data);
  if (any.version === 1) return annotateSetV1(any.set);
  const set = any.set;
  const roles: Roles = new Map();

  roles.set(0, {
    kind: "data",
    label: "header container",
    detail: `the set's own record: name "${set.setName}", a ${set.viewPortWidth}×${set.viewPortHeight} viewport, the 2048-byte palette at 0xf2, and the refs to the three registers below`,
  });
  claim(roles, set.mainScript, {
    kind: "script",
    via: 0,
    label: "the set's main script",
    detail: "container 1 by convention, and the set-level handlers the scenes' own scripts sit under",
  });
  claim(roles, set.mapLight, {
    kind: "media",
    via: 0,
    label: "map overview, lit",
    detail: `the ${set.mapWidth}×${set.mapHeight} plan of the room the map screen draws`,
  });
  claim(roles, set.mapDark, {
    kind: "media",
    via: 0,
    label: "map overview, unlit",
    detail: "the same plan for a room you have not been in yet",
  });
  claim(roles, set.mainSceneRegister, {
    kind: "data",
    via: 0,
    label: "scene register",
    detail: `${set.scenes.length} scenes, 42 bytes each — the table every "where am I" answer starts from`,
  });
  claim(roles, set.transitionRegister, {
    kind: "data",
    via: 0,
    label: "transition register",
    detail: `${set.transitions.length} transitions — the walks between scenes`,
  });
  claim(roles, set.actorRegister, {
    kind: "data",
    via: 0,
    label: "actor register",
    detail: `${set.actors.length} actor slots: ${set.actors.map((a) => a.identifier).join(", ") || "none"}`,
  });

  for (const scene of set.scenes) {
    claim(roles, scene.locationViews, {
      kind: "data",
      via: set.mainSceneRegister,
      label: `views of "${scene.sceneName}"`,
      detail: `the scene's camera position and its ${scene.views.length} named views (${scene.views.map((v) => v.viewName).join(", ")})`,
    });
    claim(roles, scene.locationScript, {
      kind: "script",
      via: set.mainSceneRegister,
      label: `script of "${scene.sceneName}"`,
      detail: "the scene's own handlers — openset, mousedown, timers",
    });
    for (const view of scene.views) {
      claim(roles, view.locationObjects, {
        kind: "data",
        via: scene.locationViews,
        label: `hotspots in "${scene.sceneName}.${view.viewName}"`,
        detail: `${view.objects.length} clickable regions, 36 bytes each`,
      });
      for (const obj of view.objects) {
        claim(roles, obj.locationScript, {
          kind: "script",
          via: view.locationObjects,
          label: `script of "${obj.identifier}"`,
          detail: `what clicking "${obj.identifier}" in ${scene.sceneName}.${view.viewName} runs`,
        });
      }
    }
    for (const [dir, ring] of scene.turns.entries()) {
      const way = dir === 0 ? "right" : "left";
      for (const frame of ring.frames) {
        claim(roles, frame.frameContainerLoc, {
          kind: "media",
          via: scene.locationViews,
          label:
            frame.motionInfo === 0
              ? `turning ${way} in "${scene.sceneName}"`
              : `standpoint in "${scene.sceneName}"`,
          detail:
            frame.motionInfo === 0
              ? `one frame of the ${way} turn ring — the animation played while the camera swings`
              : `a standpoint frame (${frame.motionInfo === 2 ? "high" : "low"} resolution), where the camera comes to rest`,
        });
      }
    }
  }

  for (const path of set.starPaths) {
    claim(roles, path.container, {
      kind: "data",
      via: set.actorRegister,
      label: `route "${path.a}" → "${path.b}"`,
      detail: "an authored polyline an actor walks between a pair of stars, with each leg's length as measured by the engine's own integer square root",
    });
  }

  for (const t of set.transitions) {
    claim(roles, t.locationTransitionInfo, {
      kind: "data",
      via: set.transitionRegister,
      label: `path of "${t.transitionName}"`,
      detail: `the walk's endpoints and ${t.waypoints.length} waypoints`,
    });
    for (const [dir, reg] of t.frameRegisters.entries()) {
      for (const frame of reg.frames) {
        claim(roles, frame.frameContainerLoc, {
          kind: "media",
          via: t.locationTransitionInfo,
          label: `walking "${t.transitionName}"`,
          detail: `one frame of the walk${dir === 1 ? ", played in the return direction" : ""}`,
        });
      }
    }
  }

  return {
    roles,
    note: `set "${set.setName}" · ${set.scenes.length} scenes, ${set.transitions.length} transitions, DreamFactory ${set.version}`,
  };
}

function annotateStg(data: Uint8Array): { roles: Roles; note: string } {
  const stg = readStgFile(data);
  const roles: Roles = new Map();

  roles.set(0, {
    kind: "data",
    label: "header container",
    detail: `the stage record: the 2048-byte palette and the table of ${stg.flats.length} flats, 46 bytes each`,
  });
  claim(roles, stg.mainScriptLocation, {
    kind: "script",
    via: 0,
    label: "stage main script",
    detail: "the stage's own script — MAIN.STG's is where gotospecial lives",
  });

  for (const flat of stg.flats) {
    claim(roles, flat.locationFrame, {
      kind: "media",
      via: 0,
      label: `picture of flat "${flat.name}"`,
      detail: `the ${flat.width}×${flat.height} image this UI layer draws`,
    });
    claim(roles, flat.locationScript, {
      kind: "script",
      via: 0,
      label: `script of flat "${flat.name}"`,
      detail: "this layer's handlers",
    });
    let count = -1;
    try {
      count = readStgRegions(stg.file.containers[flat.locationClickLogic].data, stg.version).length;
    } catch {
      /* an unreadable click-logic container is still worth naming */
    }
    claim(roles, flat.locationClickLogic, {
      kind: "data",
      via: 0,
      label: `click regions of "${flat.name}"`,
      detail:
        count >= 0
          ? `${count} clickable rectangles, each with the script it runs`
          : "the flat's clickable rectangles",
    });
  }

  return {
    roles,
    note: `stage · ${stg.flats.length} flats (${stg.flats.map((f) => f.name).join(", ")}), DreamFactory ${stg.version}`,
  };
}


/**
 * A movie is a CHAIN of segments, each with its own header container that every
 * location in that segment is stored relative to — so the map is the one place
 * a reader can see that a six-segment film is six little films end to end.
 */
function annotateMov(data: Uint8Array): { roles: Roles; note: string } {
  // A Dust film is the same idea in a different envelope, and mov-v1 reshapes it
  // into the v4 record — so one walk maps both, and the labels stay true.
  let mov: MovFile;
  try {
    mov = readMovFile(data);
  } catch {
    mov = movFileFromV1(readMovFileV1(data));
  }
  const roles: Roles = new Map();

  mov.segments.forEach((seg, s) => {
    const which = mov.segments.length > 1 ? ` of segment ${s}` : "";
    claim(roles, seg.bias || -1, {
      kind: "data",
      label: `header container${which}`,
      detail: `the segment's own record: ${seg.width}×${seg.height} at (${seg.originX},${seg.originY}), its palette, and the table of its ${seg.frames.length} frames. Every container location in the segment is stored relative to this index.`,
    });
    if (s === 0) {
      roles.set(0, {
        kind: "data",
        label: "header container",
        detail: `the film's first segment: ${seg.width}×${seg.height}, ${seg.frames.length} frames, floor ${seg.minHoldTicks} ticks a frame${mov.segments.length > 1 ? `, chained to ${mov.segments.length - 1} more segment(s)` : ""}`,
      });
    }
    for (const frame of seg.frames) {
      claim(roles, frame.locationClickRegion, {
        kind: "data",
        via: seg.bias,
        label: `logic of frame "${frame.name}"${which}`,
        detail: `how long the frame is held, what it fires on entry, and its ${frame.regions.length} clickable region(s) — a plain animation frame has no such container`,
      });
      claim(roles, frame.locationFrame, {
        kind: "media",
        via: seg.bias,
        label: `frame "${frame.name}"${which}`,
        detail: `one picture of the film${frame.regions.length ? `, waiting on ${frame.regions.length} clickable region(s)` : ""}${frame.holdTicks ? `, held ${frame.holdTicks} ticks` : ""}`,
      });
    }
    seg.audioChunks.forEach((loc, i) => {
      claim(roles, loc, {
        kind: "media",
        via: seg.bias,
        label: `music, part ${i + 1}${which}`,
        detail: "a chunk of the segment's scored bed, played in this order",
        texture: "hatch",
      });
    });
    for (const [name, loc] of seg.sounds) {
      claim(roles, loc, {
        kind: "media",
        via: seg.bias,
        label: `sound "${name}"${which}`,
        detail: "a one-shot, fired by a frame or a region click and from nowhere else",
        texture: "hatch",
      });
    }
  });

  const frames = mov.segments.reduce((n, s) => n + s.frames.length, 0);
  return {
    roles,
    note: `movie · ${mov.segments.length} segment(s), ${frames} frames, ${mov.width}×${mov.height}`,
  };
}

/** TRK / SFX / 11K — an audio bank: two tables and a lot of sound */
function annotateTrk(data: Uint8Array): { roles: Roles; note: string } {
  const file = readContainerFile(data);
  const tables = readBankTables(file);
  const roles: Roles = new Map();

  roles.set(0, {
    kind: "data",
    label: "header container",
    detail: `the bank's record — its stored name "${tables.trackName}" and the ref to the one-shot table`,
  });
  if (tables.loopTable) {
    claim(roles, tables.loopTable, {
      kind: "data",
      via: 0,
      label: "loop table",
      detail: `${tables.loopRecords.length} looping chunks and the ${tables.loopOrder.length}-step order they play in`,
    });
  }
  claim(roles, tables.oneShotTable, {
    kind: "data",
    via: 0,
    label: "one-shot table",
    detail: `${tables.singles.length} named sounds a script can ask for`,
  });
  tables.loopOrder.forEach((o, i) => {
    const chunk = tables.loopRecords[o - 1];
    if (chunk) {
      claim(roles, chunk.containerLoc, {
        kind: "media",
        via: tables.loopTable,
        label: `music, step ${i + 1}`,
        detail: `a chunk of the loop bed — step ${i + 1} of ${tables.loopOrder.length} in playback order`,
        texture: "hatch",
      });
    }
  });
  for (const single of tables.singles) {
    claim(roles, single.containerLoc, {
      kind: "media",
      via: tables.oneShotTable,
      label: `sound "${single.identifier}"`,
      detail: "a one-shot the scripts play by this name",
      texture: "hatch",
    });
  }

  return {
    roles,
    note: `audio bank "${tables.trackName}" · ${tables.loopOrder.length} loop steps, ${tables.singles.length} one-shots`,
  };
}


/** SHP — a shop file: props, each with states, each with animation frames */
function annotateShp(data: Uint8Array): { roles: Roles; note: string } {
  const shp = readShpFile(data);
  const roles: Roles = new Map();

  roles.set(0, {
    kind: "data",
    label: "header container",
    detail: `the shop's record: its ref name "${shp.refName}", the 2048-byte palette and the table of its ${shp.groups.length} props`,
  });
  claim(roles, shp.mainScriptLocation, {
    kind: "script",
    via: 0,
    label: "the shop's main script",
    detail: "the file-level handlers, under which each prop's own script sits",
  });

  let frames = 0;
  for (const group of shp.groups) {
    claim(roles, group.location, {
      kind: "data",
      via: 0,
      label: `prop "${group.name}"`,
      detail: `the prop's record: its script and its ${group.states.length} states`,
    });
    claim(roles, group.scriptContainerLocation, {
      kind: "script",
      via: group.location,
      label: `script of "${group.name}"`,
      detail: "what this prop does when it is clicked, opened, or told to change state",
    });
    for (const state of group.states) {
      claim(roles, state.location, {
        kind: "data",
        via: group.location,
        label: `state "${state.identifier}" of "${group.name}"`,
        detail: `${state.frames.length} picture(s)${state.playOrder ? `, played in a ${state.playOrder.length}-step order` : ", picked by stored degree rather than animated"}`,
      });
      for (const frame of state.frames) {
        frames++;
        claim(roles, frame, {
          kind: "media",
          via: state.location,
          label: `"${group.name}" · ${state.identifier}`,
          detail: "one picture of the prop, in the transparent codec",
        });
      }
    }
  }

  return {
    roles,
    note: `shop "${shp.refName}" · ${shp.groups.length} props, ${frames} frames`,
  };
}

/** PUP — one talking character: stances of layered art, dialogue, scripts */
function annotatePup(data: Uint8Array): { roles: Roles; note: string } {
  const pup = readPupFile(data);
  const roles: Roles = new Map();

  roles.set(0, {
    kind: "data",
    label: "header container",
    detail: `the puppet's record: palette, idle timers, the ${pup.dialogue.size} dialogue lines with their subtitles, and the stance table. The name it answers currentpuppet() with is "${pup.pupName}"`,
  });
  claim(roles, pup.bandLocation, {
    kind: "media",
    via: 0,
    label: "the answer band",
    detail: "the 512×120 plate of five riveted plaques the choice bevels are lettered onto — every puppet carries its own copy, re-encoded against its palette",
  });

  for (const script of pup.scripts) {
    claim(roles, script.location, {
      kind: "script",
      via: 0,
      label: `script "${script.name}"`,
      detail: "a conversation handler — what saying this does to the game",
    });
  }

  pup.stances.forEach((stance, i) => {
    claim(roles, stance.location, {
      kind: "data",
      via: 0,
      label: `stance ${i}`,
      detail: `the eleven layer tables of one pose — ${stance.layers.filter((l) => l.frames.length).length} of them carry art`,
    });
    stance.layers.forEach((layer, li) => {
      for (const frame of layer.frames) {
        claim(roles, frame, {
          kind: "media",
          via: stance.location,
          label: `${PUP_LAYERS[li] ?? `layer ${li}`}, stance ${i}`,
          detail: `one frame of the "${PUP_LAYERS[li] ?? li}" layer — the face is drawn by stacking these`,
        });
      }
    });
  });

  for (const line of pup.dialogue.values()) {
    claim(roles, line.audioLocation, {
      kind: "media",
      via: 0,
      label: `voice "${line.ident}"`,
      detail: `the spoken line: “${line.text.slice(0, 70)}${line.text.length > 70 ? "…" : ""}”`,
      texture: "hatch",
    });
    claim(roles, line.animLogicLocation, {
      kind: "data",
      via: 0,
      label: `lip-sync of "${line.ident}"`,
      detail: "one record per tick: which frame each of the eleven layers shows, and where it sits",
    });
  }

  return {
    roles,
    note: `puppet "${pup.pupName}" · ${pup.stances.length} stances, ${pup.dialogue.size} lines`,
  };
}

/** CST — a cast file: the walking, standing, gesturing crowd */
function annotateCst(data: Uint8Array): { roles: Roles; note: string } {
  const cst = readCstFile(data);
  const roles: Roles = new Map();

  roles.set(0, {
    kind: "data",
    label: "header container",
    detail: `the cast's record: the palette and the directory of its ${cst.members.length} members`,
  });

  let frames = 0;
  for (const member of cst.members) {
    claim(roles, member.logicLocation, {
      kind: "data",
      via: 0,
      label: `"${member.name}"`,
      detail: `the member's record: their script and their ${member.poses.length} poses`,
    });
    claim(roles, member.scriptLocation, {
      kind: "script",
      via: member.logicLocation,
      label: `script of "${member.name}"`,
      detail: "what this character does when spoken to or sent somewhere",
    });
    for (const pose of member.poses) {
      claim(roles, pose.location, {
        kind: "data",
        via: member.logicLocation,
        label: `"${member.name}" · ${pose.name}`,
        detail: `${pose.frameCount} pictures over ${pose.steps.length} animation step(s), played in a ${pose.play.length}-step order`,
      });
      for (const step of pose.steps) {
        for (const frame of step) {
          frames++;
          claim(roles, frame.location, {
            kind: "media",
            via: pose.location,
            label: `${member.name} · ${pose.name}`,
            detail: "one picture of the pose, at one of the facings it was drawn from",
          });
        }
      }
    }
  }

  return { roles, note: `cast · ${cst.members.length} members, ${frames} frames` };
}

/** SND — a Dust audio bank: no order table, the order is in the names */
function annotateSnd(data: Uint8Array): { roles: Roles; note: string } {
  const snd = readSndFile(data);
  const roles: Roles = new Map();

  roles.set(0, {
    kind: "data",
    label: "header container",
    detail: `the bank's record: its name "${snd.refName}" and the table of its ${snd.chunks.length} sounds. A v1 bank has no play-ORDER table — a loop bed's order is spelled in the names`,
  });
  for (const chunk of snd.chunks) {
    claim(roles, chunk.containerLoc, {
      kind: "media",
      via: 0,
      label: `sound "${chunk.identifier}"`,
      detail: "one sound, asked for by this name",
      texture: "hatch",
    });
  }

  return { roles, note: `Dust bank "${snd.refName}" · ${snd.chunks.length} sounds` };
}

/** BOOTFILE — no room, no picture: a container file full of scripts */
function annotateBoot(data: Uint8Array): { roles: Roles; note: string } {
  const file = readContainerFile(data);
  const roles: Roles = new Map();

  roles.set(1, {
    kind: "script",
    label: "the library, and keydown → the scene",
    detail: "the standard library — some 76 globally-callable handlers — plus the keydown that hands the key to the current scene first",
  });
  roles.set(2, {
    kind: "script",
    label: "keydown: the default movement",
    detail: "walking and turning, reached only if nothing earlier in the event chain consumed the key",
  });

  return {
    roles,
    note: `boot · ${file.header.containerCount} containers, nearly all of them scripts reached BY NAME rather than by pointer`,
  };
}

/**
 * A save game — a memory dump with a container per step of the writer's own
 * walk, in a FIXED order, so every index is computed rather than searched for.
 * Both engines write the same shape and differ only in strides; the roles below
 * are the ones docs/engine/formats/savegame.md recovered from `0x413910` and
 * checked positionally against all 109 shipped saves.
 *
 * Routed by extension, not sniffed: both write the same fourCC and the same
 * "ODTRTRFD" signature, so nothing inside the envelope says which engine it was.
 */
function annotateSave(data: Uint8Array, version: 1 | 4): { roles: Roles; note: string } {
  const raw = readSaveFile(data);
  const roles: Roles = new Map();
  const head: [number, string, string][] = [
    [0, "the manifest", "the version string, the resource paths, the live CLUT, and one 260-byte record per open FILE — the handle every other container's file references resolve through"],
    [1, "where you were", version === 1
      ? "the standpoint: a verbatim 542-byte dump of the engine's own block"
      : "the current stage, set, scene and view, plus the set's register refs — a fixed 786 bytes"],
    [2, "the cast", "one record per actor in the world, at the stride this engine uses"],
    [3, "open cast files", "which .cst files were open — a load has to reopen them, because no openset runs to do it"],
    [4, "the props", "every loaded prop, inventory first"],
    [5, "open prop files", "which .shp files were open"],
    [6, version === 1 ? "open sound banks" : "open tracks", "the descriptors — and how many of them there are is what makes the rest of this map computable"],
  ];
  for (const [i, label, detail] of head) roles.set(i, { kind: "data", label, detail });

  // three containers per open track/bank, then the five tail tables. v1Index
  // derives the count from the container count and cross-checks it against
  // container 6's size; for v4 the descriptor stride (40) gives the same number.
  const banks =
    version === 1
      ? v1Index(raw).banks
      : Math.floor((raw.containers[6]?.data.length ?? 0) / 40);
  const PARTS = ["registered", "playing", "looping"];
  for (let b = 0; b < banks; b++) {
    for (let k = 0; k < 3; k++) {
      roles.set(7 + b * 3 + k, {
        kind: "data",
        via: 6,
        label: `${version === 1 ? "bank" : "track"} ${b + 1}: ${PARTS[k]}`,
        detail: `one of the three sound lists this ${version === 1 ? "bank" : "track"} writes`,
      });
    }
  }

  const globals = 7 + 3 * banks;
  const tail: [number, string, string][] = [
    [globals, "the globals", "every script variable — the whole of the story's progress, 32 bytes a node"],
    [globals + 1, "the string pool", "the text the string-valued globals point into; the loader reads the pair together"],
    [globals + 2, "loops", "the repeating timers the scheduler was running"],
    [globals + 3, "crickets", "the one-shot timers still pending"],
    [globals + 4, "walks", "who was walking where, and how far along"],
  ];
  for (const [i, label, detail] of tail) {
    roles.set(i, { kind: "data", via: i === globals + 1 ? globals : undefined, label, detail });
  }
  for (let i = globals + 5; i < raw.containers.length; i++) {
    roles.set(i, { kind: "data", via: globals + 4, label: `waypoints of an active walk`, detail: "the route an in-progress walk still has to cover — one payload per active slot that has one" });
  }

  return {
    roles,
    note: `${version === 1 ? "Dust" : "Titanic"} save · ${raw.containers.length} containers, ${banks} open ${version === 1 ? "sound bank" : "track"}${banks === 1 ? "" : "s"} — every index computed from the count, none searched for`,
  };
}

const ANNOTATORS: Record<string, (d: Uint8Array) => { roles: Roles; note: string }> = {
  set: annotateSet,
  stg: annotateStg,
  flt: annotateStg,
  mov: annotateMov,
  trk: annotateTrk,
  sfx: annotateTrk,
  "11k": annotateTrk,
  shp: annotateShp,
  pup: annotatePup,
  cst: annotateCst,
  snd: annotateSnd,
  bootfile: annotateBoot,
  ti: (d) => annotateSave(d, 4),
  rtd: (d) => annotateSave(d, 1),
};

/**
 * What an unclaimed container looks like from the outside. Three payloads say
 * what they are without any format knowledge — an audio chunk has a readable
 * header, a script's token stream validates, a picture decodes — and saying
 * "1470 containers, unnamed" would waste all three.
 */
function classify(payload: Uint8Array, index: number, fb: FrameBuffer): Role {
  const audio = readAudioHeader(payload);
  if (audio) {
    return {
      kind: "media",
      label: `sound, part ${index}`,
      detail: `an audio chunk — a single sound is split across many containers and concatenated on load`,
      texture: "hatch",
    };
  }
  const script = sniffScript(payload);
  if (script) {
    return {
      kind: "script",
      label: "compiled script",
      detail: `decodes as a compiled script (${script.length} tokens) that nothing in this map's walk pointed at — reached by name, or through a structure the annotator does not read yet`,
    };
  }
  try {
    const frame = decodeFrame(payload, fb);
    if (frame.width > 0 && frame.height > 0) {
      return {
        kind: "media",
        label: `picture (${frame.width}×${frame.height})`,
        detail: `an encoded frame${frame.hasZ ? ", carrying a Z layer for actor occlusion" : ""}`,
      };
    }
  } catch {
    /* not a frame, then */
  }
  return {
    kind: "data",
    label: `container ${index}`,
    detail: "a structure this map's annotator does not name yet",
  };
}

// ---------------------------------------------------------------------------
// the map
// ---------------------------------------------------------------------------

function buildMap(path: string, bytes: Uint8Array): ByteMapData {
  const name = basename(path);
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const file: DFContainerFile = readContainerFile(bytes);

  let roles: Roles = new Map();
  let note = "";
  const annotate = ANNOTATORS[ext];
  if (annotate) {
    try {
      ({ roles, note } = annotate(bytes));
    } catch (e) {
      console.warn(`  ${name}: the ${ext.toUpperCase()} reader could not open it (${e}); falling back to sniffing`);
    }
  }

  const regions: ByteRegion[] = [
    {
      at: 0,
      size: HEADER_SIZE,
      kind: "structure",
      label: "file header",
      detail: `1024 fixed bytes, six of whose fields the engine reads — here: ${file.header.containerCount} containers, type ${file.header.type}`,
    },
    {
      at: HEADER_SIZE,
      size: file.header.containerCount * 4,
      kind: "structure",
      label: "position table",
      detail: `${file.header.containerCount} file offsets, one per container — the index the engine jumps through instead of reading the file top to bottom`,
    },
  ];

  const fb = new FrameBuffer();
  let gaps = 0;
  file.containers.forEach((c, i) => {
    if (c.gap) {
      gaps++;
      return; // a gap occupies a container NUMBER, not any bytes
    }
    const role = roles.get(i) ?? classify(c.data, i, fb);
    const at = c.data.byteOffset - bytes.byteOffset - RECORD_HEADER_SIZE;
    // The label carries the container NUMBER because that is how every
    // cross-reference in these formats is spelled; the detail carries what it is
    // for and nothing that the size column or the page above already said. The
    // stored id is worth a word only when it is not the index, which is the
    // interesting case rather than the common one.
    regions.push({
      at,
      size: RECORD_HEADER_SIZE + c.data.length,
      kind: role.kind,
      label: `${i} · ${role.label}`,
      container: i,
      parent: role.via,
      texture: role.texture,
      detail: `${role.detail ?? ""}${c.id === i ? "" : ` (stored id ${c.id}, not ${i})`}`.trim(),
    });
  });

  const named = file.containers.filter((c, i) => !c.gap && roles.has(i)).length;
  const total = file.containers.filter((c) => !c.gap).length;
  const sniffed = total - named;
  return {
    title: name.toUpperCase(),
    subtitle: [
      `${humanBytes(bytes.length)}`,
      `${file.header.containerCount} containers${gaps ? ` (${gaps} gap)` : ""}`,
      note,
    ]
      .filter(Boolean)
      .join(" · "),
    total: bytes.length,
    regions,
    source: `${name} · tools/blockmap.ts · ${named} of ${total} containers named by walking the ${ext.toUpperCase()} reader${sniffed ? `, ${sniffed} by sniffing the payload` : ""}`,
  };
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error(
    "usage: npx tsx tools/blockmap.ts [--as <slug>] <file.SET|file.STG|…> [more…]\n" +
      "  --as   name the map something other than the file's own name (save games\n" +
      "         are called \"04 - First Class Lounge.ti\"; a page reference is not)",
  );
  process.exit(1);
}
mkdirSync(MAPS_DIR, { recursive: true });
let as: string | undefined;
for (const path of args) {
  if (path === "--as") continue;
  if (args[args.indexOf(path) - 1] === "--as") {
    as = path;
    continue;
  }
  const bytes = new Uint8Array(readFileSync(path));
  const map = buildMap(path, bytes);
  const out = join(MAPS_DIR, `${(as ?? basename(path)).toLowerCase()}.json`);
  as = undefined;
  writeFileSync(out, `${JSON.stringify(map, null, 1)}\n`);
  console.log(`${out}  ${map.regions.length} regions  ${map.subtitle}`);
}
