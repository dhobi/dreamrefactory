/**
 * What stands in the room: the first two pieces.
 *
 * The shell ({@link file://./bedsit-room.ts}) is measured out of the depth
 * images; the furniture is measured the same way, one piece at a time, by
 * back-projecting the pixels of it in the frames that see it through their own
 * depth level — a level is ±315 units along the ray, so read every number here
 * as ±300 — and by reading its shape off the frames. Both of these stand against
 * the door wall (`y1`), at the window end of it.
 *
 * - **The bed**: a brass bedstead, head towards the windows, foot post at
 *   `x ≈ 6800` (`Scene2/View15`), near side at `y ≈ 10800` and far side at the
 *   wall, mattress top at about 1000 (`Scene1/View36`, three picks agreeing). The
 *   head rails read as the WALL in the depth image — brass is thinner than a
 *   depth pixel — so the head's `x` is a bed's length back from the foot, not a
 *   measurement. A khaki blanket over a cream mattress, a pillow, a folded green
 *   one at the foot: what the frames show.
 * - **The dressing screen**: three tall panels of tan cloth in a near-black frame,
 *   hinged, standing in a zigzag hard against the bed's foot — something to
 *   change behind, not a cupboard. Its bed end is at `x ≈ 6900` and its top at
 *   `z ≈ 3000` from `Scene1/View36`; its door end at `x ≈ 8870` and the same
 *   top again from `Scene2/View15`, which sees all three panels. It stands a
 *   level in from the wall, which is the fold.
 * - **The cupboard**: a dark wall cabinet on the counter wall (`x1`), two doors
 *   with brass knobs low on them and a moulded cornice, over a counter with a
 *   cream top and a green curtain hung under it to the floor. `Scene1/View32`
 *   looks straight at it: the cabinet's face is a level in from the wall, its
 *   top and bottom on the rows 3,880 and 2,135 up, its ends on the columns
 *   7,350 and 10,650 along; the counter's top on the row 1,560 up, its front
 *   two levels out. `Scene2/View12`, from the other side, puts the ends within
 *   400 of the same place.
 * - **The side table and the wireless**: a small square table on slender legs
 *   with a stretcher frame low down, between the sofa and the counter against
 *   the counter wall; on it an upright 1930s set and a booklet. `Scene1/View32`
 *   again: the top on the row 1,050 up, its ends at 5,900 and 7,100, its front
 *   half a metre off the wall; the set's top on the row 1,970, its sides 450
 *   apart. The set has its own picture in the game — `RADIO.STG`, the close-up
 *   the player gets when they use it — and the cabinet is modelled from that: a
 *   walnut case with a round top, the tall arched dial slot sunk into it with
 *   the station scale and its red pointer, the tuning eye above the scale, the
 *   knob beside it, the round speaker cloth behind a ring, and three louvres
 *   low on each flank. Every feature is placed where the picture has it, as a
 *   fraction of the face.
 * - **The sofa**: a two-seater in olive moquette, rolled arms and a rolled
 *   back, set diagonally across the corner between the counter wall and the
 *   fireplace wall with its back to the corner, so it faces the fire. Its wall
 *   end is against the counter wall just short of the side table; its fireplace
 *   end is two metres off that wall (`Scene3/View20`: the arm's outer face on a
 *   ray whose depth puts it at `x ≈ 9,340`, a few hundred from the fireplace).
 *   The back's top on the rows 1,700 up (`Scene1/View32`, two picks, 1,704 and
 *   1,715), the arm's on 1,385, the seat's front edge on 700.
 * - **The fireplace**: a dark wooden chimneypiece on the fireplace wall — two
 *   pilasters, a frieze and a mantel shelf, dark tiles inside them, and the fire
 *   opening with an iron grate — on a stone hearth slab. `Scene3/View20` faces
 *   it: the shelf's ends on the columns 5,900 and 8,570 along, its top on the
 *   row 2,200 up; the opening is where the room's aperture map found a way
 *   through this wall, 6,840 to 7,840 along and 640 to 1,280 up. The wall is not
 *   cut for it — the opening is a black back a hand inside the surround, with
 *   the grate in front of it, which from the room is what an unlit fire is.
 * - **The standard lamp**: a brass pole on a round foot with a knop at knee
 *   height and a wide cream shade, standing against the fireplace wall between
 *   the chimneypiece and the armchair. Its pole is at `x ≈ 5,080` in both
 *   `Scene3/View20` and `Scene1/View33`; the shade's foot is on the row of the
 *   eye, its crown 450 above, its brim 47 pixels across at that depth. It is lit,
 *   and the page lights the corner from it.
 * - **The armchair**: a club chair in the sofa's moquette, low arms and a
 *   rounded back, standing free of the walls in front of the window-wall corner
 *   between the desk's end and the standard lamp, its back to the corner and its
 *   seat to the door. `Scene3/View25` looks straight at it; its seat and arm
 *   fall around (4,500, 4,600) in `View20`, and the cushion's row in `View25`
 *   puts its centre near (4,400, 4,450).
 * - **The desk**: a pedestal desk under the near window, a pedestal of three
 *   drawers at each end and a kneehole between, a brass lamp with a mushroom
 *   shade on its far end. `Scene3/View23` looks along it: its ends on the
 *   columns 6,000 and 8,500 along the window wall, its top on the row 1,400 up
 *   — higher than a desk usually is, but the frames put it there — and half a
 *   metre deep.
 */
import { Builder, Chart, CHIMNEY, EMIT, PAINT, Part, ROOM, V3 } from "./bedsit-room";
import { INDICES as ARMCHAIR_INDICES, POSITION as ARMCHAIR_POSITION } from "./bedsit-armchair-mesh";
import { INDICES as ARMCHAIRFEET_INDICES, POSITION as ARMCHAIRFEET_POSITION } from "./bedsit-armchairfeet-mesh";
import { INDICES as HALLSTAND_INDICES, POSITION as HALLSTAND_POSITION } from "./bedsit-hallstand-mesh";
import { INDICES as HALLSTANDPOLE_INDICES, POSITION as HALLSTANDPOLE_POSITION } from "./bedsit-hallstandpole-mesh";
import { INDICES as CURTAINL_INDICES, POSITION as CURTAINL_POSITION } from "./bedsit-countercurtainl-mesh";
import { INDICES as CURTAINR_INDICES, POSITION as CURTAINR_POSITION } from "./bedsit-countercurtainr-mesh";
import { INDICES as COUNTERPANE_INDICES, POSITION as COUNTERPANE_POSITION } from "./bedsit-counterpane-mesh";
import { INDICES as COUNTERSTRIPE_INDICES, POSITION as COUNTERSTRIPE_POSITION } from "./bedsit-counterstripe-mesh";
import { INDICES as PILLOW_INDICES, POSITION as PILLOW_POSITION } from "./bedsit-pillow-mesh";
import { INDICES as FIREPLACE_INDICES, POSITION as FIREPLACE_POSITION } from "./bedsit-fireplace-mesh";
import { INDICES as FIREGRATE_INDICES, POSITION as FIREGRATE_POSITION } from "./bedsit-fireplacegrate-mesh";
import { INDICES as FIRELOGS_INDICES, POSITION as FIRELOGS_POSITION } from "./bedsit-fireplacelogs-mesh";
import { INDICES as FIREHEARTH_INDICES, POSITION as FIREHEARTH_POSITION } from "./bedsit-fireplacehearth-mesh";
import { BOX as LAMPSHADE_BOX, INDICES as LAMPSHADE_INDICES, POSITION as LAMPSHADE_POSITION } from "./bedsit-lampshade-mesh";
import { INDICES as STANDLAMP_INDICES, POSITION as STANDLAMP_POSITION } from "./bedsit-standlamp-mesh";
import { INDICES as BOTTLECAP_INDICES, POSITION as BOTTLECAP_POSITION } from "./bedsit-bottlecap-mesh";
import { INDICES as BOTTLEGLASS_INDICES, POSITION as BOTTLEGLASS_POSITION } from "./bedsit-bottleglass-mesh";
import { INDICES as CUPBOARD_INDICES, POSITION as CUPBOARD_POSITION } from "./bedsit-cupboard-mesh";
import { INDICES as CUPKNOBS_INDICES, POSITION as CUPKNOBS_POSITION } from "./bedsit-cupboardknobs-mesh";
import { INDICES as CUPBAND_INDICES, POSITION as CUPBAND_POSITION } from "./bedsit-cupboardband-mesh";
import { INDICES as RADIO_INDICES, POSITION as RADIO_POSITION } from "./bedsit-radio-mesh";
import { INDICES as RADIOGRILLE_INDICES, POSITION as RADIOGRILLE_POSITION } from "./bedsit-radiogrille-mesh";
import { INDICES as RADIOKNOBS_INDICES, POSITION as RADIOKNOBS_POSITION } from "./bedsit-radioknobs-mesh";
import { INDICES as RADIOSWITCHES_INDICES, POSITION as RADIOSWITCHES_POSITION } from "./bedsit-radioswitches-mesh";
import { INDICES as TABLE_INDICES, POSITION as TABLE_POSITION } from "./bedsit-sidetable-mesh";
import { INDICES as ASHTRAY_INDICES, POSITION as ASHTRAY_POSITION } from "./bedsit-ashtray-mesh";
import { INDICES as WATCH_INDICES, POSITION as WATCH_POSITION, UV as WATCH_UV } from "./bedsit-watch-mesh";
import { BOX as WATCHGLASS_BOX } from "./bedsit-watchglass-mesh";
import { INDICES as MATCHBOX_INDICES, POSITION as MATCHBOX_POSITION, UV as MATCHBOX_UV } from "./bedsit-matchbox-mesh";
import { INDICES as MATCHES_INDICES, POSITION as MATCHES_POSITION, UV as MATCHES_UV } from "./bedsit-matches-mesh";
import { INDICES as PACKCLOSED_INDICES, POSITION as PACKCLOSED_POSITION, UV as PACKCLOSED_UV } from "./bedsit-packclosed-mesh";
import { INDICES as PACKOPEN_INDICES, POSITION as PACKOPEN_POSITION, UV as PACKOPEN_UV } from "./bedsit-packopen-mesh";
import { INDICES as PACKSMOKES_INDICES, POSITION as PACKSMOKES_POSITION, UV as PACKSMOKES_UV } from "./bedsit-packsmokes-mesh";
import { INDICES as SHIP_INDICES, POSITION as SHIP_POSITION, UV as SHIP_UV } from "./bedsit-titanic-mesh";
import { INDICES as FUTILITYCOVER_INDICES, POSITION as FUTILITYCOVER_POSITION } from "./bedsit-futilitycover-mesh";
import { INDICES as FUTILITYBOARDS_INDICES, POSITION as FUTILITYBOARDS_POSITION } from "./bedsit-futilityboards-mesh";
import { INDICES as FUTILITYPAGES_INDICES, POSITION as FUTILITYPAGES_POSITION } from "./bedsit-futilitypages-mesh";
import { INDICES as TELLURIANCOVER_INDICES, POSITION as TELLURIANCOVER_POSITION, UV as TELLURIANCOVER_UV } from "./bedsit-telluriancover-mesh";
import { INDICES as TELLURIANBOARDS_INDICES, POSITION as TELLURIANBOARDS_POSITION } from "./bedsit-tellurianboards-mesh";
import { INDICES as TELLURIANPAGES_INDICES, POSITION as TELLURIANPAGES_POSITION } from "./bedsit-tellurianpages-mesh";
import { INDICES as MEMORIESCOVER_INDICES, POSITION as MEMORIESCOVER_POSITION, UV as MEMORIESCOVER_UV } from "./bedsit-memoriescover-mesh";
import { INDICES as MEMORIESBOARDS_INDICES, POSITION as MEMORIESBOARDS_POSITION } from "./bedsit-memoriesboards-mesh";
import { INDICES as MEMORIESPAGES_INDICES, POSITION as MEMORIESPAGES_POSITION } from "./bedsit-memoriespages-mesh";
import { INDICES as SOFA_INDICES, POSITION as SOFA_POSITION } from "./bedsit-sofa-mesh";
import { INDICES as SOFAFEET_INDICES, POSITION as SOFAFEET_POSITION } from "./bedsit-sofafeet-mesh";
import { INDICES as DESK_INDICES, POSITION as DESK_POSITION } from "./bedsit-desk-mesh";
import { INDICES as DESKPULLS_INDICES, POSITION as DESKPULLS_POSITION } from "./bedsit-deskpulls-mesh";
import { INDICES as DESKLAMP_INDICES, POSITION as DESKLAMP_POSITION } from "./bedsit-desklamp-mesh";
import { INDICES as DESKLAMPCAP_INDICES, POSITION as DESKLAMPCAP_POSITION } from "./bedsit-desklampcap-mesh";

/**
 * What the pieces are made of, and where in the frames a clean patch of each is
 * — a rectangle of one standpoint frame that shows nothing but the material.
 * `scale` is how many world units one repeat of the tile covers on the piece.
 * `keep` is how much of the patch's own contrast survives the de-lighting: a
 * weave is its contrast, a stain nearly none. `tone`, where given, is the colour
 * the piece is painted, which the tile takes as its mean: for a cloth the
 * frames give the weave, not the daylight colour. The woods have none — their
 * near-black in the frames IS their colour, and it is right as it comes.
 */
export const MATERIALS: Readonly<Record<string, { scene?: string; deg?: number; x0?: number; y0?: number; x1?: number; y1?: number; keep: number; scale: number; tone?: readonly number[]; file?: string; fromFrames?: boolean }>> = {
  /**
   * The sofa and chair's olive moquette. The frame coordinates are the sofa's
   * back in `Scene2/View12`, and were what this was cut from until `bedobit.mov`
   * turned up: its close-up of the book on the armchair fills a third of a
   * 512x384 frame with the same cloth, lit and in focus, where the SET frame
   * gave 80x40. `file` is that patch, de-lit the same way and baked by
   * `taoot/tools/bedsitobit.ts`; the frame coordinates stay as the fallback and
   * as the record of where the colour was measured.
   */
  moquette: { scene: "Scene2", deg: 14, x0: 70, y0: 210, x1: 150, y1: 250, keep: 1.4, scale: 240, tone: [0.44, 0.40, 0.20], file: "bedsit/moquette.png" },
  /** the bed's khaki blanket: the flat of it Scene2/View15 sees over the foot,
   *  left of the fold that runs down to the rail */
  /**
   * The near-black stain of the door, the screen's frame, the cupboard and the
   * chimneypiece: the door leaf in Scene2/View15.
   *
   * This had no `tone` — the note above said a wood's near-black in the frames
   * IS its colour and is right as it comes — and that held while the room was
   * lit as an evening. It does not hold now. Re-lighting it as a morning raised
   * the exposure on everything the frames' own pixels are used for, and this
   * patch means (2.3, 0.9, 0.3) out of 255: at that level there is nothing to
   * expose but the red channel, and the cupboard came out scarlet. The two
   * cloths that carry measured albedos put the frame-to-albedo factor between
   * 3.2 and 5.5, which on a patch this dark is multiplying noise. So it is
   * toned like a cloth instead, at the colour `FURNITURE_PAINT.cupboard` was
   * already measured to be, and lit rather than exposed.
   */
  stain: { scene: "Scene2", deg: 64, x0: 140, y0: 130, x1: 185, y1: 195, keep: 0.6, scale: 900, tone: [0.11, 0.07, 0.05], file: "bedsit/mat-stain.png" },
  /** the desk's and table's brown wood: the face of one drawer in Scene3/View23,
   *  between its handle and its edges */
  // no `tone`, so this one is the frame's own pixels with the room's lamp
  // still on them, and it wants the frames' exposure and not an albedo's —
  // which is what `fromFrames` carries now that it arrives as a file
  wood: { scene: "Scene3", deg: 128, x0: 349, y0: 206, x1: 379, y1: 223, keep: 0.4, scale: 800, file: "bedsit/mat-wood.png", fromFrames: true },
  /** the screen's tan cloth: the inside of its middle panel in Scene2/View15,
   *  clear of the stiles either side */
  cloth: { scene: "Scene2", deg: 64, x0: 239, y0: 135, x1: 248, y1: 195, keep: 0.8, scale: 600, tone: [0.66, 0.55, 0.30], file: "bedsit/mat-cloth.png" },
  /** the counter's curtain: its folds from Scene1/View32, over the brighter of
   *  the two greens the frames show it in */
  /**
   * The chimney's brickwork — London stocks in stretcher bond, under soot.
   *
   * The only material here with no frame behind it, and it could not have one:
   * the rip has no view of the inside of a flue, because in the game there is
   * no inside of a flue. What it does have is the same brick everywhere the
   * plaster has come off a wall, and `bedsit-paint.ts` draws that; the tile is
   * that drawing, baked out by `taoot/tools/bedsitbrick.ts` at the fireplace
   * wall's own seed, so these are literally that wall's bricks. 3,400 units is
   * where the bond comes back round — ten bricks by thirty-four courses — which
   * is more than twice the recess, so it never repeats where it is seen.
   */
  /**
   * The chimneypiece's mahogany, drawn by `taoot/tools/bedsitwood.ts`.
   *
   * `stain` is a 45x65 patch of the door, and at 900 units to the repeat that is
   * 20 units to a frame pixel. On a door across the room it is right; on a
   * surround whose pilasters are 300 wide it is fifteen of somebody else's
   * pixels blown up a foot across, which is what all the blur and blocking in it
   * was. This is the same wood at the same 900, drawn at 1.8 units to a texel.
   */
  mahogany: { keep: 1.0, scale: 900, tone: [0.229, 0.126, 0.080], file: "bedsit/wood.png" },
  /**
   * The desk's own board, drawn by the same tool from a second set of dials —
   * darker, and with a fifth of the chimneypiece's figure at twice the
   * wavelength. The desk is the darkest wood in the room and it is seen close,
   * where the chimney's swirl reads as one burl per drawer front.
   *
   * Its `tone` is the drawn board's measured mean, which is what it is FOR: a
   * textured surface takes the tile as its albedo outright — the shader
   * replaces the vertex colour rather than multiplying it — so this tone is
   * the colour the desk actually is, and `FURNITURE_PAINT.desk` only shows if
   * the material fails to load.
   */
  deskwood: { keep: 1.0, scale: 900, tone: [0.072, 0.039, 0.024], file: "bedsit/deskwood.png" },
  /**
   * The wireless's cabinet: moulded bakelite, not a wood, drawn by the same
   * tool with the grain and the pores off and the figure up. See its note in
   * `bedsitwood.ts` for why the marbling comes out running UP the tile and why
   * this is a RED-brown where the two woods are yellow-brown.
   *
   * `tone` is the board's measured mean, and like the desk's it is the colour
   * the set actually is: the shader replaces the vertex colour with the tile.
   */
  bakelite: { keep: 1.0, scale: 900, tone: [0.201, 0.125, 0.113], file: "bedsit/bakelite.png" },
  /**
   * The ship model's atlas, which came with her.
   *
   * The one material here that is not tiled and not box-mapped. Every other
   * entry is a SWATCH — a patch of cloth or wood repeated over the world's axes,
   * where `scale` says how many units to a repeat and nothing cares which part
   * of the picture lands where. This is a painted object's own skin: the gold
   * sheer stripe is three texels in one place and nowhere else, the teak runs
   * the length of the boat deck, and TITANIC · LIVERPOOL is lettered across the
   * counter. Only the mesh's own coordinates can find any of it, so `scale` is
   * unused and `Builder.mesh` is handed the UVs instead.
   *
   * The capture also held an AO and a roughness over the same layout. The page's
   * shader has an input for neither, so they were left where they were found.
   */
  titanic: { keep: 1.0, scale: 1, file: "bedsit/titanic.png" },
  /**
   * The Memories album's cover, cut out of `Scene2/View14` by
   * `scratchpad/albumcut.mts` and squared up.
   *
   * The second material here with `scale` unused, and for the same reason as
   * the ship's: the word is in one place on that cover and nowhere else, so the
   * quad names its own four corners of the picture rather than repeating a tile
   * over the world's axes. It is 103 by 79 frame pixels at eight times, which
   * buys no detail — what it buys is that the room's sampler is not the thing
   * deciding where the lettering's strokes fall.
   */
  album: { keep: 1.0, scale: 1, file: "bedsit/album.png" },
  /**
   * The quarterly lying on the side table, supplied and cut to its boards.
   *
   * The third material here that pins its own corners rather than repeating a
   * tile. It is a PORTRAIT cover on a top face of 300 by 420, so the picture is
   * stretched about a fifth along the book's length; the cover has margins to
   * spare and nothing in the setting is close enough to read the condensing.
   */
  tellurian: { keep: 1.0, scale: 1, file: "bedsit/booktellurian.png" },
  /**
   * Two of the desk's five magazine covers, supplied and cut to the cover.
   *
   * The fourth and fifth materials here with `scale` unused: a cover is a
   * picture, so each quad names its own four corners of it rather than
   * repeating a tile. Both are 512 square, which a PORTRAIT cover is plainly
   * not — see `bedsitmags.ts` for why every picture in this room is a square
   * power of two, and why squashing one into that shape costs nothing when the
   * quad pins its corners.
   *
   * `bedcards.mov` frame 6 is the reference for both: the film holds the two of
   * them up filling the screen, which is the only look at these covers that
   * resolves anything. {@link file://../tools/bedsitcards.ts} cuts them out of
   * it; {@link file://../tools/bedsitmags.ts} trims what comes back.
   *
   * ONE KNOWN DEPARTURE from the frames. BRAVE NEW WORLD's masthead band is
   * OLIVE in the game — the band under the lettering measures rgb 67,69,41,
   * green by a wide margin, where PEEK's masthead on the same frame measures
   * 165,98,80 and is plainly red. The supplied art sets that masthead red and
   * keeps the green for the borders and the cover lines. It is a better-looking
   * cover and the wrong one; it stands until someone decides otherwise.
   */
  magBraveNewWorld: { keep: 1.0, scale: 1, file: "bedsit/mag-brave-new-world.jpg" },
  magPeek: { keep: 1.0, scale: 1, file: "bedsit/mag-peek.jpg" },
  /**
   * The third magazine, and the film gives it a whole frame of its own: a
   * woman in a red hat with a cigarette and a green cabochon ring, on a red
   * ground. It is called `magLady` because nobody can say what it is called —
   * the masthead ends `...VEN` and the rest of the word is off the top of the
   * one frame that shows it, so the title is not recoverable from this disc.
   */
  magLady: { keep: 1.0, scale: 1, file: "bedsit/mag-lady.jpg" },
  /**
   * The face of a packet of Old Reds.
   *
   * A pale grey-silver front with OLD REDS in dark serif capitals across the
   * top, a brown dog over a pale banner below it, and red edging down the side
   * and along the lip — so despite the name the packet is grey and the red is
   * its trim. Read off `oldreds/large` in `data/inven.shp` at 50 by 64 pixels,
   * which is every pixel the disc holds of it.
   *
   * Props carry no palette of their own — the engine colourises them with
   * whatever CLUT is loaded — so the colour was settled by sweeping nine
   * candidates over the same frame. Six agree exactly: the shape file's own,
   * `main.stg`, and the palettes of `smoke`, `cafe`, `bedsit1` and `lounge1c`.
   * The two INVENTORY stages are the odd ones out and render it as garbage,
   * which is how it is known they are not the ones.
   */
  oldreds: { keep: 1.0, scale: 1, file: "bedsit/pack-oldreds.jpg" },
  /**
   * The tarot trump lying at the desk's far end. Trump XIII, LA MORTE: a
   * skeleton in a blue cloak crossing a yellow field, a red border, and a torn
   * crease across the middle of it.
   *
   * It is on the desk in `bedcards.mov` — red border, gold ground, blue figure,
   * white title band, tucked beside the ashtray — and it is NOT in any SET
   * frame at a size worth reading: in `Scene1/View31`, the standpoint that sees
   * the desk squarest, the whole spread of props is a band of coloured pixels
   * about forty across and this card is a handful of them.
   */
  tarot: { keep: 1.0, scale: 1, file: "bedsit/card-tarot.jpg" },
  /** the schnapps bottle's label, wrapped round the glass — see the note at
   *  the bottle's draw for why it is a mesh and not a lathe */
  labelNordendale: { keep: 1.0, scale: 1, file: "bedsit/label-nordendale.jpg" },
  /**
   * The three atlases the desk's two modelled small props came painted on.
   *
   * `scale: 1` like every other pinned picture here, which for these is not a
   * scale at all: the meshes carry the file's OWN texture coordinates, so
   * nothing is being mapped and nothing is being tiled. What `scale` would size
   * is the box projection, and a mesh with UVs never reaches it.
   *
   * They are atlases and not pictures, which is the difference worth knowing:
   * `atlasWatch` is one 512 square holding the case's gold, the enamel dial,
   * its Roman numerals, the engine-turned back and the blued screws, and the
   * dial is about a third of it. The unused ground came through TRANSPARENT and
   * is filled white on the way to JPEG — transparent black composites to black,
   * and a mipmap drags that black into the edge of every island on the sheet.
   */
  atlasWatch: { keep: 1.0, scale: 1, file: "bedsit/atlas-watch.jpg" },
  atlasMatchbox: { keep: 1.0, scale: 1, file: "bedsit/atlas-matchbox.jpg" },
  atlasMatch: { keep: 1.0, scale: 1, file: "bedsit/atlas-match.jpg" },
  /**
   * The three postcards, picture side up.
   *
   * The film holds each of them up twice — once for its picture and once for
   * its message — because the player can turn one over, and between them they
   * are the only writing in this room that says who lives in it: all three are
   * addressed to CARLSON at 9 Stanley Crescent, London W11. A packing hall from
   * New York in 1919 and a café in Tunis in 1939 are signed Jack; the Taj is
   * signed Deanna from Delhi in 1934, and mentions running into Jack in Bombay.
   *
   * These are the PICTURE sides. The message sides are handwriting, which is
   * nothing an enlarger can invent — those stay as the film's own frames until
   * somebody sets them again by hand.
   *
   * LANDSCAPE, where every other picture on this desk is portrait, which is why
   * `postcards` gives its sizes as `wide` and `tall` rather than trusting
   * `slab`'s long-and-short to mean the same thing twice.
   */
  postcardPacking: { keep: 1.0, scale: 1, file: "bedsit/postcard-packing.jpg" },
  postcardTaj: { keep: 1.0, scale: 1, file: "bedsit/postcard-taj.jpg" },
  postcardTunis: { keep: 1.0, scale: 1, file: "bedsit/postcard-tunis.jpg" },
  /**
   * The four photographs standing along the back of the desk.
   *
   * These come off `bedcards.mov` frame 0 like everything else here, but they
   * are the worst-served pictures in the room and it is worth saying by how
   * much. A magazine cover gets a frame of its own at two hundred pixels
   * across; these are in the BACKGROUND of the desk's one close-up, behind the
   * lamp rather than under it, and they measure 74x85, 60x78 and 52x59 pixels.
   * The fourth measures nothing at all — it stands directly behind the lamp,
   * and at four and a half times the film's exposure there is no sitter in it
   * to find. So `photoSeated` is an INVENTION consistent with the others, and
   * the only picture in this room that is not derived from something the disc
   * actually shows.
   *
   * At sixty pixels the officer's cap, uniform and medal ribbons are real and
   * his face is a dozen pixels: what is hanging here is a reconstruction from
   * a silhouette, the same bargain `bedsitpics.ts draw` already makes for the
   * marine picture over the mantel.
   *
   * They are PHOTOGRAPHS and not framed pictures. Three of the four arrived
   * with gilt or stained moulding drawn round them and a drop shadow under it,
   * and all of that is cropped off by `bedsitmags.ts`'s inset: the frame round
   * each of these is real geometry in {@link plate}, lit by the room's own
   * lamps and casting into its own shadow maps, and two of the four are OVALS
   * that no rectangular painted frame could have sat in.
   */
  photoWomen: { keep: 1.0, scale: 1, file: "bedsit/photo-women.jpg" },
  photoSeated: { keep: 1.0, scale: 1, file: "bedsit/photo-seated.jpg" },
  photoNaval: { keep: 1.0, scale: 1, file: "bedsit/photo-naval.jpg" },
  photoLady: { keep: 1.0, scale: 1, file: "bedsit/photo-lady.jpg" },
  /**
   * The tan cloth behind the wireless's grille — the lightest thing on the set,
   * and better than twice the case.
   *
   * NINETY-SIX UNITS TO THE REPEAT, where every other board here runs at 900.
   * The threads of a grille cloth are about half a millimetre apart, which at
   * 900 units to a 512 tile is under one texel and can only alias, so the weave
   * is drawn in TEXELS instead and the tile laid on small enough to bring those
   * texels out at the right size. It is the same picture either way; what
   * changes is how much of the world one copy of it covers.
   */
  grille: { keep: 1.0, scale: 96, tone: [0.603, 0.386, 0.276], file: "bedsit/grille.png" },
  brick: { keep: 1.0, scale: 3400, tone: [0.060, 0.042, 0.036], file: "bedsit/brick.png" },
  curtain: { scene: "Scene1", deg: 0, x0: 240, y0: 195, x1: 295, y1: 250, keep: 1.2, scale: 700, tone: [0.23, 0.44, 0.33], file: "bedsit/mat-curtain.png" },
};

export const BED = {
  /** the frame's footprint */
  x0: 3500, x1: 6800, y0: 10800, y1: 12400,
  /**
   * The side rails, and the mattress they carry — both measured at the HEAD,
   * where the mattress shows white and unmade in `Scene2/View15`, by
   * back-projecting onto the bed's own near-side plane. Three readings there,
   * with the depth levels agreeing on all of them:
   *
   * - 860 the mattress's top, and 710 where the white of it stops, so 150 of it
   *   shows — where this model had 530 showing, which is a third of a metre;
   * - 460 the underside of the frame below it, and black under that, which is
   *   the gap this bed stands on its legs over.
   *
   * 710 was read as the mattress's UNDERSIDE and is not: it is the top edge of
   * the side rail, which is the last thing you can see the mattress past. A
   * mattress balanced on the rails, its whole depth proud of them, is the one
   * thing here that never looked like a bed — it reads as a slab laid on a
   * frame. So the ticking goes down to {@link BED.base} and the rail laps its
   * bottom 110, which is what the rail is for. What the frames measured — 150
   * of mattress standing above the rail — is unchanged, because that is the
   * part the frames could see.
   */
  rail: 710, railDepth: 250, mattress: 860,
  /**
   * The slatted base, and the top of it is where the mattress sits.
   *
   * There was nothing under the mattress at all: it hung in the air between the
   * rails with a flat cap on its bottom, which is only invisible while nobody
   * stoops. A bed of this date has laths or wire across the side rails, and
   * laths are what these are — fifteen of them on the flat, laid across the
   * short way and let into the rails, in the rails' own iron because they are
   * part of the same frame. The whole base lives inside the rail's 250 of depth
   * and shows only from below.
   */
  base: 600, slat: 22, slats: 15, slatWidth: 96,
  /**
   * The counterpane's hem down the near side, as stations from the HEAD to the
   * foot: how far along the bed, how far off the floor the cloth hangs there,
   * and how far it stands out from the bed's own line.
   *
   * It hangs the whole length — not, as a first reading of the frames had it,
   * in one trailing stretch with a tidy hem either side. What varies is how
   * FAR: it is turned back at the head where the sheet shows, drags almost to
   * the boards over the middle, and lifts a little again at the foot. A hem
   * that is level all the way is a hotel; this is a bed somebody got out of.
   */
  hem: [
    [0, 430, 0], [0.14, 330, 12], [0.28, 210, 26], [0.42, 120, 36],
    [0.55, 80, 28], [0.70, 70, 32], [0.85, 105, 20], [1, 150, 8],
  ] as const,
  /**
   * The head and foot rails' CROWNS. Neither rail is straight: this is a brass
   * bed, and both ends are a segmental arch springing from the corner posts and
   * rising to the middle — plainly so in `Scene2/View15`, where the head's arc
   * stands against the plaster, and in `Scene1/View36`, where the foot's runs
   * flat across the top and turns down hard into its post. The straight tube
   * that was here before is the one thing about this bed that could not be
   * mistaken for a photograph of it.
   */
  head: 1850, foot: 1135,
  /**
   * The radius each end turns on, which with the crown above is the whole of
   * its shape: the bar runs straight up from the floor, turns a quarter circle
   * onto the flat, runs across, and turns down as hard on the other side. A
   * capital D laid on its back — a segmental arc through the same three points
   * is a different object and looks it.
   *
   * The two ends are not the same letter. The HEAD turns on 500, so the corners
   * eat most of the span and only a short flat is left between them. The FOOT
   * is lower and turns on 120, so it reads as a square bracket with the corners
   * taken off, which is what `Scene1/View36` shows.
   *
   * There were two more numbers here, how far each rail rose above its post.
   * They stopped meaning anything when the post and the rail became one bar:
   * there is no springing point on a bar that is not jointed, and 500 and 120
   * say where these ones bend.
   */
  headRadius: 500, footRadius: 120,
  tube: 15, spindle: 7,
  /** the bar the whole head and foot is bent from, posts and crown alike — it
   *  is the member that carries the shape, and beside it the spindles are wire */
  topTube: 27,
} as const;

export const SCREEN = {
  /** the screen's two ends along the door wall, and the line it stands about */
  x0: 6900, x1: 8870, y: ROOM.y1 - 420,
  top: 3000,
  panels: 3,
  /** each panel's turn out of the wall's line, alternating — the fold */
  fold: (22 * Math.PI) / 180,
  thickness: 40,
  stile: 60, topRail: 80, bottomRail: 130,
  /** how far the cloth sits back from the frame's face, each side */
  recess: 10,
  feet: 40,
} as const;

export const CUPBOARD = {
  y0: 7300, y1: 10700,
  z0: 2135, z1: 3880,
  depth: 420,
  cornice: 120,
  stile: 70, rail: 80, recess: 16,
  /** the knobs, low on the doors either side of the meeting stiles. `proud` is
   *  how far the imported pair is pulled out of the door face — see the note at
   *  the `CUPKNOBS` draw; `z` and `in` belong to the drawn fallback. */
  knob: { z: 2400, in: 90, proud: 30 },
} as const;

export const COUNTER = {
  /**
   * The counter, off `Scene1/View32`: its ends, its top on the row 1,560 up,
   * and its front two levels out of the wall.
   *
   * EVERYTHING BELOW IS DERIVED FROM THESE. It was not, until the curtains were
   * re-simulated. The carcase used to be a separate set of absolute numbers —
   * 3,076 long where this says 3,500, and a worktop 41 units high — because the
   * cloth had been settled against an imported model of the wrong size and
   * could not be re-fitted by editing a number. Re-simulating the cloth is what
   * let the two be reconciled, and this is the shape that leaves: one measured
   * box, and a carcase worked out from it.
   */
  y0: 7300, y1: 10800,
  top: 1550, slab: 60,
  depth: 900,
  /** the end cheeks, the back panel, the shelves and the bottom board */
  end: 40, board: 30,
  /** how far the worktop oversails, on the front and both ends */
  oversail: 20,
  /** the plinth: set back from the cheeks for a toe, and how tall */
  plinth: { setback: 15, thick: 42, height: 280 },
  /**
   * The rails across the front. The first is the CURTAIN rail and is the reason
   * the cloth hangs straight now: it sits under the worktop's own front edge,
   * which is where the heading has to be. The old cloth was pinned 45 units
   * behind that, on the carcase's top rail, and had to step forward to clear
   * the worktop — one 43-unit kick in the first 150 of drop, about 16 degrees,
   * and then plumb all the way to the hem. That step was the whole of the lean.
   */
  rail: { thick: 30, deep: 150, curtainDrop: 50 },
  /**
   * How many bays between the bottom board and the worktop. Three, which with
   * two shelves of `board` gives 373 units each — 241 mm, which stands a tin.
   */
  bays: 3,
} as const;

/**
 * The bentwood hat and coat stand in the corner beside the door — a Thonet-ish
 * hall stand: a turned pole on three splayed legs, four arms curving up and out
 * near the top and four shorter ones a foot below them, every one of them ending
 * in a knob. Nothing hangs on it. Four views hold it (Scene2/View15 and View19,
 * Scene1/View38, Scene3/View21) and its pegs are bare in all four.
 *
 * Placed off the depth levels of its crown, which two views put within fifty
 * units of each other, and off its feet, which back-project onto the floor —
 * a known plane, and the only exact measurement to be had on a thing this thin.
 * The heights come from picking its own pole up a vertical plane through it.
 */
export const HALL_STAND = {
  /**
   * Where the pole stands. As far towards the counter wall as it will go: the
   * legs are set so the one that reaches furthest that way stops just short of
   * the plaster, which is what the frames show and what a stand in a corner
   * does anyway.
   */
  x: 11310, y: 11990,
  /** how far a leg reaches from the pole, along the diagonal it stands on —
   *  the toe of the built model lands at 328 of it */
  reach: 330,
  /**
   * The collar the pegs spring from, and the finial over it. Both were a
   * twelfth taller until the model was stood beside the frames from two
   * cameras: the feet landed on the game's own, and the crown stood over it by
   * the same eight per cent in both. A pick up a vertical plane through a pole
   * this thin is worth less than that comparison.
   */
  collar: 2760, finial: 2916,
} as const;

export const SIDE_TABLE = {
  y0: 5900, y1: 7100,
  depth: 750,
  top: 1050, slab: 35,
  leg: 40, inset: 45,
  /** the stretcher frame's height */
  stretcher: 260,
} as const;

/**
 * The book on the side table: where it lies and which way it is turned.
 *
 * The table's top is at 1,050 and the imported table's own top surface is 24
 * units above that — the mesh runs to 1,074 — so everything standing on it
 * stands on `SIDE_TABLE.top + 24` and not on `top`.
 */
export const BOOK = {
  x: ROOM.x1 - 30 - SIDE_TABLE.depth / 2 - 216,
  y: (SIDE_TABLE.y0 + SIDE_TABLE.y1) / 2 - 337,
  /** along the turn, across it, and thick: 271 by 194 by 29 mm, a large book */
  length: 420, depth: 300, thick: 45,
  /**
   * Off square, the way the frame has it lying — and turned to the RIGHT.
   *
   * `place` rotates counter-clockwise about +z, so a positive yaw swings the
   * book's back edge towards +y, which is the room's right. The frame has the
   * near corner of the book out to the LEFT, so this is negative.
   */
  yaw: -0.40,
} as const;

export const RADIO = {
  /**
   * Slid 140 units along the table away from the counter, and 9 back, in plan.
   * The frames put the set at 6,600..7,040 and this is not a re-measurement of
   * them — it is where the set has to stand for the other two to have room.
   */
  y0: 6460, y1: 6900,
  /** the set's front, off the wall */
  front: ROOM.x1 - 691,
  depth: 300,
  top: 1970,
  /** the features of the face, as fractions of its width (u, left to right as
   *  the room sees it) and its height (v, from the top) — read off RADIO.STG */
  dial: { u: 0.53, v0: 0.10, v1: 0.61, w: 0.36 },
  eye: { v: 0.19, r: 24 },
  knob: { u: 0.835, v: 0.53, r: 24 },
  speaker: { u: 0.52, v: 0.86, r: 0.27 },
  louvres: { us: [0.03, 0.08, 0.13], v0: 0.65, w: 0.03 },
} as const;

/** an upholstered seat with rolled arms and a rolled back: the sofa, the chair */
interface Settee {
  /** the footprint's centre, and the turn of its back's line, in radians, from
   *  facing the room's -x — built with its back towards +x and turned */
  cx: number; cy: number; yaw: number;
  length: number; depth: number;
  /** the seat, the top of the arms' bulbs and the crest of the back's arch */
  seat: number; arm: number; back: number;
  /** the arm's stem width, the back panel's thickness, and the bulb's radius */
  armWidth: number; backDepth: number; roll: number;
}

export const SOFA: Settee = {
  // tucked into the corner: the back runs from the counter wall at about
  // y 5,300, clear of the side table, to the fireplace end at about
  // (9,670, 2,960): 39° off the wall's line, and a negative turn in the room's
  // left-handed plan
  cx: 10180, cy: 4500, yaw: -(39 * Math.PI) / 180,
  // overall, bulbs included: two bulbs of 480 leave a seat 2.1 m wide
  length: 3050, depth: 1150,
  seat: 840, arm: 1400, back: 1750,
  armWidth: 260, backDepth: 300, roll: 240,
};

export const ARMCHAIR: Settee = {
  // free of the walls, its back to the corner (the back's normal 225° round from
  // +x) and its seat towards the door
  cx: 4400, cy: 4450, yaw: (225 * Math.PI) / 180,
  // overall, bulbs included: two bulbs of 440 leave a seat 0.55 m wide
  length: 1720, depth: 1100,
  seat: 720, arm: 1080, back: 1580,
  armWidth: 240, backDepth: 280, roll: 220,
};

export const STANDARD_LAMP = {
  x: 5250, y: 3900,
  foot: 280, pole: 18,
  /** the knop on the pole, and the shade: its foot at eye height, its crown above */
  knop: 1000,
  shade: { z0: 2480, z1: 2980, r0: 520, r1: 170 },
  /** where the bulb is, for the page's light */
  bulb: 2650,
} as const;

/**
 * The standard lamp's head as a SOLID: how far out it reaches and the band of
 * height it fills, both measured from the shade's own mesh.
 *
 * What a shadow map needs to be told is which geometry is the lamp, and the
 * answer here is not obvious: at the bulb's own height, 2,650, the brass pole
 * has a radius of 17 to 35, so THE LIGHT POINT SITS INSIDE SOLID BRASS. Without
 * this the first thing the bake would see in every direction is the lamp's own
 * stem, and the corner would go black — which is exactly what the desk lamp did
 * before its bulb was excluded.
 *
 * Only the head. The stem below the shade is left to cast, because it does: a
 * standard lamp really does put a thin shadow on the floor under itself, and
 * the column here stops well above the armchair beside it, so nothing but the
 * lamp is inside it.
 */
export function standardLampHead(): { radius: number; z0: number; z1: number } {
  return {
    radius: Math.max(LAMPSHADE_BOX.hi[0], LAMPSHADE_BOX.hi[1]) + 20,
    z0: LAMPSHADE_BOX.lo[2] - 20,
    z1: LAMPSHADE_BOX.hi[2] + 20,
  };
}

export const FIREPLACE = {
  /** the surround's outer edges, and how far it stands off the wall */
  x0: 6100, x1: 8450, proud: 260,
  pilaster: 330, frieze: 240,
  mantel: 2200, shelf: 80, overhang: 90,
  /** the fire opening, and the head of the grate's arch */
  opening: { x0: 6840, x1: 7840, top: 1300 },
  hearth: { x0: 5800, x1: 8750, depth: 900, thick: 40 },
} as const;

/**
 * The model of the ship, on the mantel shelf.
 *
 * Measured off `Scene2/View14`, which is the standpoint that faces this wall and
 * the one frame in the rip that shows her. Everything here is read off it.
 *
 * HOW BIG. She spans frame pixels 162 to 430 of 512. A frame pixel at the
 * shelf's distance is 5.1 room units — the eye is 1,419 back from y 2,900 and
 * the SET's focal length is 256 — so 268 of them is 1,485 units, 96 cm over the
 * rails. That is not a trinket: it is half the shelf's 2,950, and three fifths
 * of it as the frame sees it, which is what "two thirds of the fireplace top"
 * was describing. She was 450 mm before, which was a guess at what a mantel
 * ornament usually is, and the frame says this room's is not a usual one.
 *
 * DEPTH AND LENGTH TRADE OFF EXACTLY, and only one of them can be measured. The
 * apparent span is 268 px whatever she is; turning that into units needs her
 * distance, and the contact row under her stand puts that between 2,900 and
 * 3,013 — a hundred units of slack that is ±8% on the length. So `cy` is pinned
 * at the back of that range and the length taken from it; move one and the
 * other has to move with it or she changes size.
 *
 * WHERE ALONG. Her middle sits at frame x 297, which is 41 px right of centre
 * and so 229 units right of the eye: x 7,722, not the shelf's own 7,275. The
 * frames show why — the Memories album stands at the left end of this shelf,
 * and she is pushed clear of it. Which way she POINTS the frame cannot settle;
 * see `yaw`.
 *
 * `top` is the shelf's own height and is NOT `FIREPLACE.mantel`. That 2,200 is
 * the DRAWN chimneypiece's shelf, kept below as reference; the room builds the
 * imported one, whose shelf tops out at 2,280. Measured off the mesh, not off
 * the constant that used to describe it.
 */
export const SHIP = {
  /** pushed right of the shelf's middle, clear of where the album stands */
  cx: 7705,
  cy: 2900,
  /** the imported chimneypiece's shelf, measured off `bedsit-fireplace-mesh` */
  top: 2280,
  /**
   * A quarter turn lays her length along the wall, and this one leaves her
   * STERN to the left of the room and her bow to the right.
   *
   * Which is not the way `Scene2/View14` has her. Three things say where her
   * bow is and they agree: her -y end tapers to a stem at a half-beam of 55
   * where the +y end stays 80 broad and overhangs, the lowest geometry on her —
   * the rudder and the screws — hangs at y +840, and the counter that carries
   * TITANIC · LIVERPOOL is at y +917. A turn of +PI/2 sends -y to the room's
   * +x, so this puts her bow on the right and the frame puts it on the left.
   *
   * It stands as it is because it is the heading that was asked for. Add PI to
   * follow the frame instead; nothing else has to move, and in particular the
   * lettering does not, because the name was mirrored in the ATLAS rather than
   * by turning the ship — both her flanks read forward now, so she is right way
   * round whichever way she points.
   *
   * The `vs` overlay is no help on this question and was not: end for end she
   * is the same length and very nearly the same silhouette, so laying our
   * render over the frame matches at both ends and says nothing.
   */
  yaw: Math.PI / 2,
  /**
   * The stand, which is gilt and flared and not the dark board she had.
   *
   * `View14` shows a splayed pedestal under her, lighter than the chimneypiece
   * and warmer — brass or a gilt wood — about 830 units across the foot against
   * her 1,485, and some 78 tall. A flat plinth was a guess made before the frame
   * was found; this is the shape in it.
   */
  stand: { foot: 1038, footDepth: 288, head: 700, headDepth: 138, rim: 18, thick: 98 },
} as const;

/**
 * The Memories album, leaning at the left end of the mantel shelf.
 *
 * The game's own object, and the reason the ship is pushed right of the shelf's
 * middle. Measured off `Scene2/View14`, and this one the frame's DEPTH BUFFER
 * confirms independently: the plane pick puts its bottom left corner at
 * 6,038 · 2,727 · 2,280 and the SET's own z level puts it at 6,014 · 2,701 ·
 * 2,277, which is agreement to 25 units on a thing 690 across.
 *
 * IT IS A CUBOID, which sounds like it goes without saying and did not. The
 * first build took the cover as measured and pushed a second copy of it 110
 * units in -y to make the back, which is a SHEARED prism: its ends are
 * parallelograms and its thickness is horizontal rather than square to the
 * boards. A book is a box. So the back face is the front face moved along the
 * cover's OWN normal, and everything else follows from that.
 *
 * AND IT LEANS LIKE A LADDER, which is what fixes which edge it stands on. A
 * ladder's top is against the wall and its foot is out on the floor, so the
 * edge taking the weight is the one at the BACK of the foot — and the front of
 * the foot lifts by the thickness times the sine of the lean, 13 units here.
 * Standing it on its front edge instead, which is what the old build did by
 * accident, buries the back of it 13 units into the shelf.
 *
 * The lean comes off the frame rather than by eye. A world-vertical line
 * projects to an image-vertical line in this camera, so the album's ends would
 * be vertical in the frame if it stood square; they are not, and the slope says
 * by how much. Its left end runs from frame x 22.5 at the foot to 38 at the
 * head — further from the centre at the bottom, which is what leaning AWAY from
 * the eye does — and both ends agree on 6.9 degrees.
 *
 * That lean was the check on the whole reconstruction: a thing measured at 6.9
 * degrees over 539 of board turns out to put its head at y 2,610, against
 * plaster at 2,600 — it reaches the wall it is leaning on, which nothing in the
 * measurement made it do. It is built steeper than that; see `lean` below.
 */
export const ALBUM = {
  x0: 5951, x1: 6641,
  /** the shelf it stands on */
  top: 2280,
  /**
   * Where its HEAD rests against the plaster, which is at `ROOM.y0` = 2,600.
   *
   * Stored at this end rather than at the foot, because this end is the one
   * that cannot move: it is leaning on something. The foot is derived from it
   * and from the lean, so steepening the lean walks the foot out into the room
   * the way a ladder's does, instead of pushing the head through the wall.
   */
  head: 2610,
  /** the board, along its own plane — not its height, which is less */
  length: 539,
  /** read off the fore-edge strip: 8 frame pixels seen 25 degrees off square */
  thick: 110,
  /**
   * The frame measures 6.9 degrees, off the slope of its ends — a
   * world-vertical line projects vertical in this camera, so the album's ends
   * would be vertical if it stood square, and they are not. This is steeper
   * than that by choice: at 6.9 it reads as a book standing upright that
   * happens to be a little out of true, and what it is meant to read as is a
   * book PROPPED. The frame's own number is the one in the line above.
   */
  lean: (15 * Math.PI) / 180,
} as const;

/**
 * The desk under the windows, and everything on it.
 *
 * A mahogany kneehole desk of two pedestals. Its front elevation is read off
 * `Scene3/View23`, which faces it square: the front face stands at x 4150, so
 * a ray through each row of pixels crosses that plane at the height of the line
 * it draws — a top slab 60 deep, a frieze of 118 under it, two drawers to a
 * pedestal with the seam at 750, and a plinth of 220 under those. The ends and
 * the kneehole come off the same elevation across: 6620 to 9200, pedestals of
 * 700, and 1180 of kneehole between them.
 *
 * WHAT STANDS ON IT needs no depth at all. A thing standing on the desk meets
 * the top at z 1400, so the ray through the pixel where it meets the wood
 * crosses that plane exactly where it stands. `Scene1/View31` and
 * `Scene3/View23` were both read that way and agree within a hundred units.
 * From the far end: a bottle, a photograph in a rectangular frame, an oval one,
 * the lamp, a naval officer in another rectangular frame, and a second oval in
 * a gilt one — with papers spread under the lamp where the light pools.
 */
export const DESK = {
  y0: 6620, y1: 9200,
  /** against the window wall, and how far it reaches into the room */
  depth: 1110,
  /** the top, and the slab's own thickness */
  top: 1400, slab: 60,
  /** the frieze's underside, the drawer seam, and the plinth's top */
  frieze: 1222, seam: 750, plinth: 220,
  /**
   * The underside of the drawer over the kneehole, which hangs BELOW the frieze
   * the pedestals carry: over the kneehole the depth level holds at 8 down to
   * row 199 of `Scene3/View23` and steps to 9 at 200, so the face stops there
   * and the opening begins — 1163, where the frieze's own line is 1222.
   */
  kneeholeDrawer: 1170,
  /** each pedestal along the desk, and how far the top oversails */
  pedestal: 760, overhang: 45,
  /** the carcase left showing round a drawer front, across and up */
  stile: 52, rail: 38,
} as const;

/**
 * The lamp: a wide two-tier shade on a turned column, the biggest thing on the
 * desk and the only light in that half of the room. The brim is 810 across —
 * half a metre — which is what the frames say twice over, and it is why the
 * papers under it are the brightest thing in the set.
 */
export const DESK_LAMP = {
  /**
   * MOVED BACK off the measured position, and that is a departure worth
   * flagging rather than burying. It was at 3620, 7830, which is where two SET
   * frames put it — `Scene1/View31` and `Scene3/View23`, read by ray and
   * agreeing within a hundred units. It is at 3447 now, 173 back, to clear the
   * front of the desk for the magazines.
   *
   * 3447 is not a free choice either: the brim is 405 in radius, so the shade
   * reaches back to 3042 — 42 clear of the plaster at `ROOM.x0` and 2 in front
   * of the desk's own back edge. Forty-two units further back and the shade is
   * inside the wall. The foot stops at 3280, which leaves the photographs
   * standing along the back their 30.
   *
   * These two numbers are the LIGHT as well as the model: `bedsit-page.ts`
   * takes the bulb's position from them, and so does the column that keeps the
   * lamp out of its own shadow map. The pool on the desk moved 173 back with
   * the shade, and that pool is the brightest thing in the set.
   */
  x: 3447, y: 7882,
  foot: 167, brim: { r: 405, z: 1921 },
  /** where the lower tier ends, the upper begins and the cap sits */
  waist: 2056, tier: 215, crown: 2146, cap: 2218,
  bulb: 1980,
} as const;

/**
 * What else is on it. The frames were measured off the SET's own views; the
 * rest of it — every loose thing in the pool of light — comes from
 * `movies/bedcards.mov`, whose opening frame is a close-up of this desk lit by
 * this lamp, and which is the only look at these props that resolves them at
 * all. In `Scene3/View23` the same objects are a band of coloured pixels forty
 * across. See {@link file://../../tools/dumpmov.ts}.
 *
 * The close-up reads, left to right (which is the desk's far end to its near
 * end, since the movie looks at it from the room): an ashtray, a matchbox, an
 * open pocket watch, a pen, a stack of small books, the lamp, and five
 * magazines fanned out in front of it with photographic covers — one of them
 * BRAVE NEW WORLD, the others film and picture weeklies.
 */
export const DESK_PROPS = {
  /**
   * The four photographs standing along the back.
   *
   * They used to share one `frameX` and stand square to the wall, which is a row
   * of pictures nobody arranged: four frames on a desk are set down one at a
   * time and each ends up at its own distance and its own angle. Each carries
   * both now. `turn` is about the frame's own vertical axis, on top of the
   * 0.13 radians of LEAN that `plate` gives every one of them.
   */
  frames: [
    { x: 3210, y: 8780, w: 398, h: 508, turn: -0.292, oval: false, gilt: false, art: "photoWomen" },
    { x: 3182, y: 8398, w: 291, h: 470, turn: -0.112, oval: true, gilt: false, art: "photoSeated" },
    { x: 3250, y: 7190, w: 394, h: 559, turn: 0.148, oval: false, gilt: false, art: "photoNaval" },
    { x: 3234, y: 6754, w: 402, h: 560, turn: 0.296, oval: true, gilt: true, art: "photoLady" },
  ],
  /**
   * The bottle: a flask with round shoulders, a SHORT neck and a black closure.
   *
   * `shoulder` is where the side stops being straight and `neck` where it stops
   * curving; the stretch between them is the whole of the shoulder. The neck is
   * 60 units — 39 mm — and deliberately stubby: the reference has a long one and
   * a long one is what this looked wrong with.
   *
   * `fill` is how much of the bottle's straight side holds liquor, which is the
   * only part of it that holds a useful amount: 0.4 of the way from the desk to
   * the shoulder. The glass above it is empty.
   */
  /**
   * The schnapps bottle: an IMPORTED flask, measured and cut down from the
   * supplied sheet's `model_0.082`.
   *
   * It is two meshes because it is two materials. `bottleglass` is the vessel
   * and is the only thing in this room drawn BLENDED — see the two-pass note in
   * `bedsit-page.ts` — and `bottlecap` is the closure, which is black.
   *
   * The model came with a neck a fifth of its height and that was the one thing
   * about it that was not wanted, so three units of it were taken out in
   * Blender before the bake and the closure now sits on the shoulder. What
   * arrived is 96 deep by 200 across by 342 tall, and the flask's WIDE face is
   * on y, which is across the desk: a walker is always at greater x, and a
   * flask stood edge-on reads as a bottle with a dent in it.
   */
  bottle: {
    x: 3300, y: 9086,
    /** the box the two meshes occupy, in their own frame */
    half: 100, deep: 48, tall: 333,
    /**
     * The flat of the front, which is NOT `deep`. The widest the flask gets in
     * depth is 47.8, and that is the fillet flaring at the foot — the face
     * itself stands at 45, measured off the ring that carries the straight side.
     * The label was hung off `deep` and floated 5.9 units clear of the glass.
     */
    face: 45,
    /** where the side stops being straight, as a fraction of the height */
    straight: 0.75,
    /** how full it is, of that straight side */
    fill: 0.4,
    /** which way it stands. The two meshes carry no rotation of their own, so
     *  this is a `place` round the flask's own middle — see the draw. */
    turn: -0.709,
  },
  /**
   * And the small things, at the sizes they actually are — a matchbox is five
   * centimetres and a pocket watch five across, and the first pass had them at
   * thirteen and twelve, which on a desk two and a half metres long reads as a
   * doll's tea service.
   */
  /**
   * The ashtray, which is a MODEL and carries its own size: 278 across and 43
   * deep, centred here and standing on the desk. `r` is that model's radius,
   * kept because everything else on this end of the desk has to keep clear of
   * it and 139 is what they have to clear.
   */
  ashtray: { x: 3741, y: 9018, r: 139 },
  /**
   * The matchbox, and the one of its three sizes that was never measured.
   *
   * `w` and `d` come off the plan view. `h` did not: it was 24 because the
   * drawn slab that stood here was 24, and nothing ever asked what a matchbox
   * is. The Science Museum has the box this one wears — Bryant & May's Pearl,
   * Fairfield Works at Bow, catalogued 1890 to 1940 — at 21 by 57 by 38 mm.
   * Against that, 119 and 82 are this desk's third over life size to within
   * three per cent, and 24 was 0.74 OF life size: a box squashed flat in the
   * one direction nobody had a number for. 21 mm at the same third over is 44.
   */
  matches: { x: 3605, y: 8694, w: 119, d: 82, h: 44, turn: 1.516 },
  /**
   * The pocket watch: where its CASE is, how wide that case is, and which way
   * its bow points.
   *
   * `r` no longer draws anything — the watch is a model and carries its own
   * size. It is kept because it is the number that model was fitted to: 68
   * across the case, which is what `bedsitglb.ts` was given and what the plan
   * view draws. Change it and the bake has to be re-run, which is why it is
   * here rather than left implicit in a shell command nobody can find.
   *
   * `turn` aims the BOW, and a bow is the one thing on this desk that says
   * which way up a round object is. It stands off one side of the case and the
   * dial's XII is under it, so turning the watch turns the dial: at 0 the bow
   * points into the room and the numerals read sideways to anyone at the desk.
   */
  watch: { x: 3802, y: 8533, r: 60, turn: 2.357 },
  /**
   * The two packets of Old Reds stacked by the lamp: the lower one closed, the
   * upper one torn open with the cigarettes showing in it.
   *
   * These were "two small books, the lower one red and the upper gilt" until
   * the close-up was looked at properly. The upper one has a row of pale
   * cigarette ends at its near end under a torn lip, and both carry the same
   * red-and-cream face. The game's own name for the item is `oldreds` — prop
   * group 10 of `data/inven.shp` — and its examine view is the ONLY picture of
   * the packet anywhere on the disc. It is a findable object in no room at all:
   * the object tables of all twenty-three sets name nothing closer than the
   * Café Parisien's `red` and `white`, which are its two coffee pots.
   *
   * SIZED AGAINST THE MATCHBOX, the one thing lying beside them whose size is
   * already settled. In the close-up the packet measures 1.67 matchboxes along
   * its length and the matchbox is 100, so 165 — which is 107 mm where a real
   * packet of twenty is 88. Everything small on this desk is drawn about a
   * third over life size and these are no exception: the frames are what this
   * room is built to.
   *
   * ACROSS, it is the ART that settles it: 121 is 165 at the front's own 0.734,
   * which makes this a squarer box than a modern packet and matches what the
   * game's own examine view shows. The THICKNESS then falls out of the width
   * rather than being chosen — 121 units is 78 mm, which is ten cigarettes at
   * 8 mm laid across; twenty of them is two such rows, and two rows of 8 mm
   * plus the paper round them is about 15 mm, or 28 units. When the open one
   * comes to be built, that is also why the row you can see into is TEN.
   */
  packs: {
    x: 3395, y: 8446, turn: 1.025,
    long: 165, short: 121, thick: 28,
    /** where the upper packet sits on the lower, and how far round it lies */
    over: { dx: 16, dy: 7, turn: -1.91 },
    /**
     * And a THIRD, on its own further along the desk behind the lamp.
     *
     * Missed on the first reading because the lamp is between it and the
     * camera: in `bedcards.mov` it is a pale packet with a red face at frame
     * pixels 308..337 across by 156..177 down, which is the same height in the
     * frame as the pair — so the same depth on the desk — and about 146 pixels
     * further along it.
     *
     * PLACED BY EYE, like the tarot card and for the same reason: there is no
     * camera for this film, and the two ways of reading its distance disagree
     * enough to matter. Interpolating along the desk from the LAMP and BRAVE
     * NEW WORLD gives y 7568; from the magazines alone, 7556. It is at 7578,
     * which is inside that spread.
     *
     * Its DEPTH is no longer the pair's, and that is a deliberate departure
     * from what the frame pixels were read as saying. It was at x 3560 because
     * the packet stands the same height in the film as the two by the lamp, and
     * the same height in that frame is the same depth on the desk. It is at
     * 3384 now — set back where the desk is empty, 103 clear of the lamp's foot
     * instead of 21, and still 41 short of the photographs leaning along the
     * back. The film's reading is the better evidence and this is not it.
     */
    third: { x: 3179, y: 7518, turn: 1.861 },
  },
  /**
   * The magazines: where each lies, how big it is, how far round it is turned,
   * and what it wears on its cover. They overlap, and THE ORDER HERE IS THE
   * ORDER THEY ARE LAID DOWN IN — the only thing that says which of two
   * overlapping covers is on top, since {@link stackFlat} reads it and nothing
   * else does. PEEK is second and BRAVE NEW WORLD third because they lap each
   * other and BRAVE NEW WORLD, the left-hand one from the chair, is the one on
   * top. Swap these two lines and the pile turns over.
   *
   * THREE, WHERE THE FILM SHOWS FIVE, and that is a decision rather than an
   * oversight. Every one of these carries a photographic cover, and the film
   * holds three of them up whole — the lady, BRAVE NEW WORLD and PEEK. The
   * other two lie in the middle of the lamp's pool and are clipped to white in
   * the only frame that sees them, so there was nothing to enlarge: they stood
   * here as flat colour, with a darker plate on each standing in for the
   * photograph they certainly had.
   *
   * That plate was the fault. A pale rectangle with a dark rectangle inset in
   * it is an EMPTY PICTURE FRAME and nothing else, and there were two of them
   * lying face-up on the desk, which made it read as deliberate. Dropping the
   * plate left two blank cream rectangles, which is not better. So they are
   * gone. A magazine whose cover cannot be recovered is worth less here than
   * the clear desk it was standing on.
   *
   * `paint` is still the flat colour the cover averages to — what shows if a
   * file fails to arrive — and `art` names the picture pinned to the slab's
   * four corners.
   *
   * `long` runs along the desk (the room's y) and `short` across it, before
   * `turn`. Untuned, that points a cover's masthead at the desk's FAR end.
   *
   * THREE OF THEM ARE NOW TURNED A QUARTER, which is worth saying because the
   * sentence above is about the convention and not about the desk. `slab` puts
   * the masthead at +V, so the SIGN of a quarter turn decides which way up the
   * cover reads: near -1.571 the masthead swings to +x and near +1.571 to -x.
   *
   * +x is the front edge, where the reader is — and a masthead pointing AT the
   * reader is a magazine upside down, because the top of a page is the edge
   * furthest from you. This desk stands against the window wall, so a person at
   * it faces -x, and -x is where a masthead belongs. The lady, BRAVE NEW WORLD
   * and PEEK are at +1.536, +1.481 and +1.82 and read the right way up; the
   * other two still lie along the desk.
   *
   * Nothing in the film settles it: the close-up is taken from the room and
   * shows the covers foreshortened, which is the one direction that cannot tell
   * a magazine lying lengthwise from one lying across.
   *
   * `thick` is why the LADY is not ten like the other two. BRAVE NEW WORLD and
   * PEEK are magazines — a sheaf of pages between covers, and ten units is 6 mm
   * at this desk's third-over scale, which is a weekly. The lady is a single
   * TORN SHEET: `fray` says so, and a sheet that has been nibbled round every
   * edge is a cover that came away from its staples. Ten units gave her a
   * squared-off edge a finger thick all the way round, standing proud of the
   * desk like a block of wood — the one reading a piece of loose paper cannot
   * have. She is 1, which is the thinnest this room can draw a flat thing and
   * still keep it out of the desk's own plane, and is 0.65 mm besides.
   */
  magazines: [
    { x: 3686, y: 8153, long: 401, short: 307, turn: 1.974, thick: 1, paint: "magRed", art: "magLady", fray: 9 },
    { x: 3809, y: 6826, long: 491, short: 345, turn: 2.363, thick: 10, paint: "magOrange", art: "magPeek" },
    { x: 3631, y: 7105, long: 489, short: 357, turn: 2.019, thick: 10, paint: "magPale", art: "magBraveNewWorld" },
  ] as const,
  /**
   * The tarot card, lying at the far end in front of the ashtray.
   *
   * PLACED BY EYE against `bedcards.mov`, which is worth saying plainly because
   * nothing else here is. Every other prop on this desk was measured through a
   * SET frame with `bedsitlook pick`, which turns a pixel into a place exactly;
   * this card is legible in no SET frame at all. Fitting the film's own camera
   * from props whose places are already known was tried and does not work: they
   * all lie strung along the desk within 200 units of one another in x, so the
   * homography is solved from what is nearly a straight line and comes back
   * degenerate — the fit put the matchbox 420 units from where it is.
   *
   * So: the film shows it just in front of the ashtray and a little toward the
   * near end, turned nearly across the desk with XIII toward the wall, at about
   * the ashtray's own width. That is what these numbers say, to the precision
   * that description deserves. `turn` is a quarter turn less a few degrees,
   * which is what puts the card's long axis into the desk's DEPTH.
   *
   * It sits further forward than it first did, because the ashtray grew. The
   * drawn dish it was placed against was 144 across; the model that replaced it
   * is 278, which is the size the frames actually show — and at 95 from the
   * ashtray's middle the card was inside it.
   *
   * MOVED AGAIN, on the plan view, and the second move was the one that got it
   * onto the desk. Turned 1.42 its long axis is nearly all depth, so it puts
   * 116 units either side of its middle in x — and at x 4100 that reached 4216
   * where the top stops at 4195. The card was hanging 21 units over the front
   * lip and nothing in the room said so, because a plan is the only view that
   * can show it: from the walker's eye it is a card lying flat at the far end.
   * It is at 312 from the ashtray's middle now, 64 clear of its rim and 108
   * clear of the front edge.
   */
  tarot: { x: 3963, y: 8901, long: 229, short: 161, turn: 1.056, thick: 3 },
  /**
   * The corner a card is stamped with. A tarot card is about 70 by 120 mm with
   * a 4 mm corner; this one is 84 by 139, a third over life size like everything
   * else small on this desk, so 4.5 mm is the same corner at the same scale —
   * and 4.5 mm is 7 units.
   */
  cardRadius: 7,
  /**
   * The three postcards, fanned out on the clear patch of desk between the
   * tarot card and the magazines.
   *
   * PLACED BY EYE, and unlike the tarot card not even against the film: the
   * film shows these filling the screen and never shows where they lie, so this
   * is somewhere they plausibly are rather than somewhere they are. 90 by 140
   * mm is the postcard the sizes come from.
   *
   * They are 1 unit thick. They were 2, which is 1.3 mm, and a postcard that
   * has 1.3 mm of white edge showing all the way round reads as a coaster. 1 is
   * 0.65 mm here, or half a millimetre at life size once this desk's third-over
   * scale is taken back out, which is a postcard.
   *
   * They were briefly INSIDE THE LADY, which is the fault this desk is most
   * liable to and the reason {@link stackFlat} exists. A card that overlaps
   * something in plan and stands on `DESK.top` like it does is not lying ON it
   * — it is buried in it, with the other thing's own plane cutting through the
   * card. Nothing in the room shows that: from the walker's eye a buried card
   * and a stacked one are the same picture, and only a plan view catches it. So
   * no flat thing on this desk is given its height by hand any more; they are
   * laid down in order and each one rides on whatever it actually covers.
   */
  postcards: [
    { x: 3807, y: 7675, wide: 217, tall: 139, turn: 2.419, thick: 1, art: "postcardPacking" },
    { x: 3702, y: 7886, wide: 217, tall: 139, turn: 2.829, thick: 1, art: "postcardTaj" },
    { x: 3648, y: 7766, wide: 217, tall: 139, turn: 2.378, thick: 1, art: "postcardTunis" },
  ] as const,
} as const;

export const FURNITURE_PAINT = {
  brass: [0.74, 0.55, 0.26],
  /**
   * The wireless's three knobs, a shade under its cabinet.
   *
   * They are the same moulding as the case and the photograph shows them the
   * same colour, but a knob is a small round thing standing off a flat face and
   * it reads as part of that face unless it is given the darkness it has in the
   * picture — where every one of them sits in its own shadow. This is the
   * bakelite board's own mean at a bit over half: dark enough to separate,
   * close enough in hue that it is plainly the same material.
   */
  radioKnob: [0.110, 0.068, 0.062],
  /** the switch on the set's cheek and its escutcheon: the one metal on the
   *  wireless, and cool where everything else on it is warm */
  radioSwitch: [0.66, 0.68, 0.70],
  /** the station scale in the dial slot — parchment, not white: a printed
   *  celluloid scale behind glass, which is warm, and which is the lightest
   *  thing on the set after the speaker cloth */
  radioDial: [0.80, 0.77, 0.68],
  /**
   * The BED's brass, which is not the lamps' brass at all: it is old, and dark
   * with it. Measured as a ratio rather than a colour, because the frames are a
   * night interior and this room is a morning — in `Scene1/View36` the head rail
   * reads a little over half the wall behind it, where ours read the same as the
   * wall, which is why it looked like a bed made of light.
   */
  /** the bedstead, in the same brass as the cupboard's knobs — `brass` above,
   *  which the frames measure at [0.74, 0.55, 0.26]. It was [0.17, 0.125, 0.07]
   *  and read as an iron bedstead rather than a brass one. */
  bedBrass: [0.74, 0.55, 0.26],
  mattress: [0.84, 0.81, 0.72],
  /**
   * The counterpane: one flat brown, and no tile at all.
   *
   * It wore a patch of `Scene2/View15` at 700 units to the repeat — fifteen
   * units to a frame pixel on the largest surface in the room, so fifteen units
   * of blur over the whole of it. It was then given a drawn two-and-two twill,
   * which was sharp and was wrong: the original has no weave in it to see. So
   * it is the colour that twill was drawn at, carried up a sixth.
   */
  blanket: [0.455, 0.358, 0.228],
  pillow: [0.90, 0.88, 0.82],
  /** the sheet turned back over the counterpane at the head */
  sheet: [0.88, 0.86, 0.80],
  green: [0.14, 0.30, 0.20],
  iron: [0.12, 0.10, 0.09],
  frame: [0.16, 0.10, 0.06],
  panel: [0.66, 0.55, 0.30],
  /** the cupboard: a darker stain still, nearly black in the frames */
  /** the hall stand's bentwood: the one warm thing in that dark corner, and in
   *  the frames a good deal lighter than the door it stands against */
  bentwood: [0.20, 0.13, 0.065],
  /**
   * The stand's legs and pegs: bright brown wood, a shade off the cupboard's
   * knobs — `brass` at [0.74, 0.55, 0.26]. Not the same, because those are
   * metal and these are not: the same warmth and the same value, with the gold
   * taken out of it and the red left in.
   */
  standWood: [0.70, 0.47, 0.22],
  /** and its pole, which is the other end of the same tree: a near-black stain
   *  in the darkest corner the room has, with the finial that caps it */
  standPole: [0.105, 0.062, 0.036],
  cupboard: [0.13, 0.08, 0.05],
  /** the border round the cupboard's doors, which the frames draw dark on the
   *  wood rather than light */
  cupboardBand: [0.075, 0.048, 0.032],
  /** the chimneypiece's joinery, carried well above what the frames
   *  measure so the stain reads as brown wood and not as a silhouette */
  chimneyWood: [0.26, 0.16, 0.10],
  cupboardDoor: [0.15, 0.09, 0.055],
  counterTop: [0.80, 0.77, 0.68],
  /** the china standing on the counter: blue-and-white tins, a cup, a bowl and
   *  a dark pan, which at that distance average to a cool pale grey */
  china: [0.60, 0.62, 0.63],
  /** the counter's curtain: the brighter of the two greens the frames show it in,
   *  flat — the folds' darker green is shading, not cloth */
  curtain: [0.23, 0.44, 0.33],
  table: [0.24, 0.15, 0.09],
  tableTop: [0.30, 0.19, 0.11],
  bakelite: [0.38, 0.20, 0.11],
  dial: [0.88, 0.80, 0.55],
  grille: [0.45, 0.36, 0.14],
  booklet: [0.82, 0.78, 0.66],
  /** and the three cut edges of it, which are paper and not cloth */
  bookEdge: [0.74, 0.71, 0.60],
  /** the desk's magazines, from the close-up: a red film weekly, a cream one,
   *  a gold one, BRAVE NEW WORLD in grey board, and a red-orange picture paper */
  magRed: [0.52, 0.11, 0.09],
  magPale: [0.70, 0.68, 0.60],
  magOrange: [0.60, 0.26, 0.10],
  /** and the small things among them */
  ash: [0.16, 0.13, 0.10],
  ashes: [0.46, 0.44, 0.40],
  matchbox: [0.58, 0.14, 0.10],
  dialFace: [0.86, 0.84, 0.76],
  /** the sofa's moquette: olive, with the seat cushion a shade lighter and the
   *  skirt a shade darker, since one is sat on and the other kicked */
  moquette: [0.44, 0.40, 0.20],
  /**
   * The turned feet under the sofa and the chair, which are stained wood and
   * not moquette — and are the one thing on either piece the frames will not
   * give a colour for. Both settees stand in the room's unlit half: in
   * `Scene3/View25` the chair's skirt fades out around y 220 and everything
   * under it is the floor's black, and `Scene1/View35`, the only standpoint
   * that fits the whole sofa in, cuts its feet off at the bottom edge.
   *
   * So this is not measured, it is placed: between `bentwood`, the hall stand
   * across the room, and `table`, the side table these sit beside — the same
   * stain, on the same joinery, at the same end of the room.
   */
  setteeFeet: [0.22, 0.14, 0.08],
  /** the desk is the darkest wood in the room — deep mahogany in the one corner
   *  no ceiling light reaches, and in the frames it is nearly black except
   *  where its own lamp catches an edge */
  desk: [0.058, 0.032, 0.018],
  deskTop: [0.078, 0.042, 0.023],
  drawer: [0.050, 0.027, 0.016],
  /** inside the kneehole, which no light in the room reaches */
  deskDark: [0.030, 0.019, 0.013],
  /** the lamp: a dark bronze shade, and the pale cap over its crown */
  deskShade: [0.105, 0.082, 0.048],
  deskCap: [0.60, 0.56, 0.44],
  /** what is on the desk: paper, a print's grey, a red binding, a pen, and the
   *  bottle at the far end with its foil and its label */
  paper: [0.72, 0.68, 0.57],
  print: [0.26, 0.24, 0.21],
  /**
   * The packets of Old Reds, for the load where the sheet does not arrive.
   *
   * FALLBACK ONLY: a textured surface takes the tile as its albedo outright and
   * the vertex colour never shows. It is the packet as the game's own inventory
   * render reads it once opened up — that render is so dimly lit that the face
   * measures 0.147 and the red edging 0.174,0.137,0.128, which is not a red at
   * all, it is a packet sitting in the dark.
   */
  packFace: [0.42, 0.40, 0.38],
  /** the top row of twenty: the paper tube, which is most of what shows */
  cigarette: [0.88, 0.86, 0.78],
  /** The cut end of one is TOBACCO, not a filter — 1942 — and that is a block
   *  of the packet's own sheet rather than a paint here: the cigarettes carry
   *  texture coordinates, and what their end caps point at is the brown at the
   *  foot of `pack-oldreds.jpg`. */
  /** the cut paper of a closed book's edges, and the cloth of its boards */
  pages: [0.60, 0.56, 0.45],
  boards: [0.16, 0.115, 0.085],
  /** the blued hands of the pocket watch. It was the fountain pen's barrel too,
   *  and the pen is gone — but this is still the only near-black on the desk
   *  that is not a shadow, and two hands 7 units long need one. */
  pen: [0.08, 0.07, 0.06],
  /**
   * The bottle's glass: CLEAR, where it was a dark green.
   *
   * It is drawn blended now, so this is the tint a pane of it lends to what is
   * behind — and a pale one, because the thing you are meant to read through it
   * is the liquor. At the old [0.055, 0.070, 0.042] the bottle was green
   * whatever was inside it, which is what a bottle looks like when its colour is
   * doing the work its transparency should.
   */
  bottle: [0.42, 0.45, 0.44],
  foil: [0.40, 0.36, 0.26],
  /** the bottle's closure: ALL black, and the darkest thing on this desk */
  cap: [0.030, 0.028, 0.026],
  /** what is in it: BLACK. It was a near-black with a little green in it, which
   *  through clear glass read as more green bottle rather than as dark spirit */
  liquor: [0.012, 0.013, 0.012],
  label: [0.62, 0.58, 0.45],
  /** the picture frames standing along the back: dark wood, or gilt */
  /** what is in the frames: a sepia ground, the sitter's dark mass, a pale face */
  sitter: [0.14, 0.12, 0.10],
  face: [0.52, 0.47, 0.39],
  /**
   * The frames' moulding: NEUTRAL, where it used to be a warm red-brown.
   *
   * Measured as a ratio and not as a colour, the way the bedstead's brass was,
   * because the film is a lamplit night and this room has its own lamps: in
   * `bedcards.mov` frame 0 the naval officer's moulding reads 0.512, 0.504 and
   * 0.520 of the photograph beside it, which is the same fraction in all three
   * channels — a dark that takes the lamp's colour and adds none of its own.
   * Ours read 0.570, 0.481 and 0.410, which is a frame with its own opinion
   * about red. Each channel is scaled by the ratio between the two.
   */
  frameWood: [0.072, 0.057, 0.046],
  /**
   * The gilt, which is a BEADING and not a face — see `plate`. Down from
   * [0.44, 0.34, 0.15], which read 0.78 of the photograph beside it where the
   * film reads 0.52: a bright yellow where the film has a dull, browned gold
   * that has not been cleaned since it was hung.
   */
  gilt: [0.33, 0.23, 0.11],
  frameBack: [0.12, 0.09, 0.065],
  surround: [0.15, 0.09, 0.055],
  tile: [0.12, 0.11, 0.10],
  /** the hearth stone, and the slips over it: grey, and no warmth in either */
  hearth: [0.32, 0.32, 0.32],
  /**
   * The slips: the stone panel the fire opening is cut through, darker than
   * the stone slab in front of it and far lighter than the near-black
   * surround around it, which is the order every frame that sees this wall
   * puts the three in. It wears no tile: the joints between its plates are
   * cut into the mesh now — thirteen square plates on a backing slab — where
   * they used to be painted on by a tile `taoot/tools/bedsittiles.ts` drew.
   */
  slips: [0.26, 0.26, 0.26],
  /** the bottom of the grooves between the plates, which is all anyone sees of
   *  the slab behind them */
  slipsJoint: [0.035, 0.035, 0.034],
  grate: [0.10, 0.10, 0.10],
  soot: [0.03, 0.03, 0.03],
  /** the logs on the grate, burnt down to charcoal, and the ash under them —
   *  which is neither `ash` nor `ashes` above, both of them already spoken
   *  for by the bedstead's wood and by what is in the ashtray */
  log: [0.135, 0.095, 0.070],
  fireAsh: [0.30, 0.29, 0.27],
  /** the fireback: soot over brick, so warmer than the cheeks either side of
   *  it and only just above black */
  fireback: [0.060, 0.038, 0.032],
  cushion: [0.49, 0.45, 0.24],
  skirt: [0.35, 0.32, 0.16],
  /**
   * The ship, for the one load where her atlas does not arrive.
   *
   * She wears a texture, and a textured part falls back to its vertex colour
   * when the picture fails to decode — so this is not a colour anyone should
   * see, it is what she looks like if the network eats a PNG. A hull's mean
   * between black plating and white superstructure, which at least reads as a
   * grey model ship rather than as a hole in the mantelpiece.
   */
  ship: [0.34, 0.32, 0.30],
  /**
   * Her stand: gilt, and the one warm thing on a shelf of near-black joinery.
   *
   * Carried well away from grey. It was [0.38, 0.29, 0.12] — a reasonable ochre
   * on paper — and rendered as pale card, because the room's lamps and its 1/1.85
   * lift both pull a mid tone towards white and towards neutral at the same
   * time. In `View14` this is the brightest thing on the shelf AND the most
   * saturated, so the blue is taken most of the way out rather than the whole
   * colour taken down.
   */
  shipStand: [0.40, 0.26, 0.05],
  /** the album's boards, where its cut cover does not reach: the darkest
   *  leather in the room, and darker than the chimneypiece it stands on */
  albumBoards: [0.055, 0.045, 0.028],
  /** and its fore-edge, which the frame draws as the one pale thing on it */
  albumPages: [0.28, 0.26, 0.21],
} as const;

/** the furniture, as one flat-painted part */
/**
 * What stands in the room, a piece at a time.
 *
 * Each gets its own {@link Builder} rather than sharing one. That is the whole
 * trick behind being able to take a single piece out: a Builder buckets its
 * triangles by MATERIAL, so one shared Builder puts the desk's mahogany and the
 * bed's in the same draw call and there is no seam to cut. A Builder apiece
 * keeps every piece's triangles to itself.
 *
 * It costs draw calls — a few dozen instead of a handful — and draw calls are
 * the one thing this page has to spare: the whole room is 88,000 triangles, and
 * nothing here has ever been limited by how many times it asks the GPU to draw.
 */
const PIECES: readonly [string, (b: Builder) => void][] = [
  ["bed", bed],
  ["screen", screen],
  ["cupboard", cupboardWall],
  ["side table", sideTable],
  ["wireless", wireless],
  ["sofa", (b) => upholstered(b, SOFA, SOFA_POSITION, SOFA_INDICES, SOFAFEET_POSITION, SOFAFEET_INDICES)],
  ["armchair", (b) => upholstered(b, ARMCHAIR, ARMCHAIR_POSITION, ARMCHAIR_INDICES, ARMCHAIRFEET_POSITION, ARMCHAIRFEET_INDICES)],
  ["the book", (b) => futility(b, ARMCHAIR)],
  ["standard lamp", standardLamp],
  ["hall stand", hallStand],
  ["chimneypiece", chimneypiece],
  ["the ship", shipModel],
  ["the album", memoriesAlbum],
  ["desk", desk],
];

export function furnish(): Part[] {
  const out: Part[] = [];
  for (const [piece, draw] of PIECES) {
    const b = new Builder();
    b.on(null);
    draw(b);
    for (const part of b.done()) out.push({ ...part, piece });
  }
  return out;
}

function bed(b: Builder): void {
  const P = FURNITURE_PAINT, { x0, x1, y0, y1 } = BED;
  b.material(null);
  const span = y1 - y0;

  for (const [x, crown, radius] of [
    [x0, BED.head, BED.headRadius],
    [x1, BED.foot, BED.footRadius],
  ] as const) {
    /** where the turn starts: the bar runs dead straight up from the floor to
     *  here, and everything above it is the bend */
    const straight = crown - radius;
    /** the rail's height over a point across the bed: flat between the turns,
     *  and round the quarter circle at each end of it */
    const over = (y: number): number => {
      const into = Math.min(y - y0, y1 - y);
      if (into >= radius) return crown;
      return straight + Math.sqrt(Math.max(0, radius * radius - (radius - into) ** 2));
    };


    // The whole member: up from the floor, round, across, round, and down to the
    // floor again — ONE bent tube, posts included.
    //
    // The posts used to be their own turned members, thinner than the rail, with
    // a ferrule over each joint to cover where the two met. Every version of
    // that ferrule was a bulge: at the rail's own radius it left two surfaces in
    // one place and a dark sliver round them, and wide enough to close over the
    // rail's end it read as a swelling on a bar that has none. A brass bedstead
    // has no joint there to dress — the head is one bar bent twice — so there is
    // nothing to cover and the bulge goes with the thing it was covering.
    //
    // Fourteen steps to the quarter, not six. At six, a 90-degree turn of radius
    // 500 is made of 15-degree chords and the crown of the headboard reads as a
    // row of kinks; the arc is the most looked-at line on this bed and it was
    // the coarsest thing on it. Twelve sides to the tube for the same reason —
    // it is 27 in radius and you stand next to it.
    //
    // And swept by `bend`, not by a tube per step. Fourteen steps fixed where
    // the centre line goes and left the SURFACE in fourteen pieces: each one
    // chose its own cross-section off a reference axis, so the facets jumped a
    // twelfth of a turn out of line partway round the bend, and each shaded off
    // its own face normals, so every seam was a hard edge. The curve was right
    // and the bar round it was a string of sausages.
    const path: V3[] = [[x, y0, 0], [x, y0, straight]];
    const N = 14;
    for (let i = 1; i <= N; i++) {
      const a = (Math.PI / 2) * (i / N);
      path.push([x, y0 + radius * (1 - Math.cos(a)), straight + radius * Math.sin(a)]);
    }
    for (let i = 0; i <= N; i++) {
      const a = (Math.PI / 2) * (1 - i / N);
      path.push([x, y1 - radius * (1 - Math.cos(a)), straight + radius * Math.sin(a)]);
    }
    path.push([x, y1, straight], [x, y1, 0]);
    b.bend(path, BED.topTube, 12, P.bedBrass);

    // the lower rail, straight, and the spindles standing between the two —
    // each one stopping where the rail is over it, so they shorten into the turns
    //
    // `bend` and not `tube` even though both are dead straight: a straight tube
    // is still twelve flat strips with a hard edge between them, and once the
    // top rail was swept round it read as the only turned thing on the bed. A
    // two-point bend IS a cylinder, and it shades as one.
    const lower = crown * 0.42;
    b.bend([[x, y0, lower], [x, y1, lower]], BED.tube, 12, P.bedBrass);
    const n = 13;
    for (let i = 1; i < n; i++) {
      const y = y0 + (span * i) / n;
      b.bend([[x, y, lower], [x, y, over(y)]], BED.spindle, 10, P.bedBrass);
    }
  }

  // The rails: dark, and as deep as the band the frames show under the mattress
  // — a rail, the wire base on it and the shadow between them read as one member
  // from across the room. All FOUR of them: a bedstead is a frame, and with only
  // the two long sides the mattress floated at the head and the foot with
  // nothing under its ends.
  for (const y of [y0, y1]) b.box(x0, y - 20, BED.rail - BED.railDepth, x1, y + 20, BED.rail, P.iron);
  for (const x of [x0, x1]) b.box(x - 20, y0, BED.rail - BED.railDepth, x + 20, y1, BED.rail, P.iron);
  // the slats across them, on the flat, their tops the surface the mattress lies
  // on — and the same iron as the rails they are let into.
  //
  // They run INTO the rails and stop inside them. Ending at the inner face
  // leaves a line of daylight under the mattress at every gap; running out to
  // the outer face puts the slat's end in the same plane as the rail's own
  // side, so fifteen end grains fight the rail for the same pixels down the
  // whole length of the bed. Twelve units short of it is inside the rail and
  // out of the argument.
  for (let i = 0; i < BED.slats; i++) {
    const at = x0 + ((x1 - x0) * (i + 0.5)) / BED.slats;
    b.box(at - BED.slatWidth / 2, y0 - 8, BED.base - BED.slat, at + BED.slatWidth / 2, y1 + 8, BED.base, P.iron);
  }
  // the mattress, and the blanket over it hanging down the near side
  mattress(b);
  /**
   * The counterpane, simulated rather than drawn.
   *
   * What was here was a hem table: eight stations from head to foot saying how
   * far off the boards the cloth hangs at each, cosine-eased between them. It
   * was measured honestly and it was the best a description of a drape can do,
   * which is not very good — a hem is the OUTCOME of a drape, not its cause.
   *
   * This is the outcome of an actual one. Blender was given this bed's own
   * numbers — the mattress at 860 over rails at 710, the footprint from
   * `BED.x0..y1` — a sheet with 3.5% more rest length than the span it covers,
   * so it has to buckle, and a tuck along the far edge, which is the only thing
   * that keeps a blanket on a bed. It fell for 170 frames and this is where it
   * came to rest. Nothing about the folds was chosen.
   *
   * The one measurement that survived is the check on it: the frames put the
   * hem between 70 and 430 off the floor, and the simulation's lowest point
   * landed at 81. That was not tuned for — the drop was set from the mattress
   * height and the cloth found its own hem.
   */
  b.mesh(COUNTERPANE_POSITION, COUNTERPANE_INDICES, [(x0 + x1) / 2, (y0 + y1) / 2, 0], P.blanket);
  /**
   * The sheet turned back over it along the head edge: 390 units of cloth, which
   * is 25 cm, and white where the rest is brown.
   *
   * It is its own mesh because a material's tile REPLACES the albedo — there is
   * no painting a stripe onto cloth that already wears one. Splitting the cloth
   * is what gives the stripe a colour of its own, and the split is made in
   * COLUMNS OF THE CUT and not in world space: the band of ticking that was 390
   * wide while the sheet lay flat is still that same band after it has draped,
   * wherever it has got to, and the grid index is what remembers which band it
   * was. Eleven columns of seventy-two.
   */
  b.mesh(COUNTERSTRIPE_POSITION, COUNTERSTRIPE_INDICES, [(x0 + x1) / 2, (y0 + y1) / 2, 0], P.sheet);
  /**
   * The pillow, imported.
   *
   * The drawn one was 160 triangles of dome and read as a folded envelope, and
   * simulating a replacement did not work: a pillow is two rectangles of ticking
   * sewn at the rim and stuffed, and Blender will do that — cloth with a target
   * volume, resting at the flat cut — but every setting that held it plump also
   * walked it across the mattress or blew it into a ball. So it is a model, in
   * the same footprint the drawn one had: 620 along the bed by 1,360 across,
   * 200 thick, on the mattress at 860.
   *
   *     bedsitglb.ts <pillow.glb> pillow 1360 620 200 \
   *         --drop 1,2,3,4,5,6,7,8,9,10,11,12,13 --simplify 2400
   *
   * Thirteen dropped islands, none bigger than five triangles: the generator
   * left slivers lying ON the surface, a few units across, at heights from 3 to
   * 109. They would never have been seen. They would have been carried anyway,
   * and an island that is not the pillow is not the pillow.
   *
   * 11,919 triangles down to 2,399, which is a fifth of what arrived and still
   * more than the bedstead. It was tried at 1,200 as well, and 1,200 is past the
   * point: the rim starts to serrate where the decimator runs out of edges to
   * spend on it, and the shallower folds across the middle go flat. At 2,400
   * every crease the full mesh has is still there from the far side of the bed,
   * which is where this pillow is seen from.
   *
   * The bake drops the file's texture coordinates — `--simplify` welds on
   * position and renumbers, and no texture coordinate survives that. Nothing
   * here wants them: the pillow is one flat colour and carries no material.
   *
   * Turned half round at the call, not by `--flip`. `--flip` negates the DEPTH
   * axis, which is a mirror and not a turn: it would have swapped the pillow's
   * near and far sides while leaving its head and foot where they were, and on
   * a shape whose creases are all asymmetric that is a different pillow rather
   * than the same one the other way about. `place` turns it about its own
   * standing point, which is what half a turn means.
   *
   * It cost the tool a real fix to import, and the fix stands for whatever comes
   * next: it hangs under a root node carrying the Z-up-to-Y-up turn as a matrix,
   * and `bedsitglb` read only the mesh node's own scale and offset — enough for
   * everything that had come through it before — so the pillow arrived on its
   * side. Nothing failed: the fitter stretched it into the box it was given
   * regardless. What said so was the printout, 36 units per model unit one way
   * against 226 the other, where an upright import reads 44, 36 and 33.
   *
   * It sits at 871 and not at `BED.mattress`. The mattress crowns 12 above its
   * own edges, and under this footprint it reaches 869 — so a pillow whose base
   * is flat at 860 has the mattress standing THROUGH it.
   */
  const pillowAt: V3 = [x0 + 390, (y0 + y1) / 2, 871];
  b.place({ cx: pillowAt[0], cy: pillowAt[1], yaw: Math.PI });
  b.mesh(PILLOW_POSITION, PILLOW_INDICES, pillowAt, P.pillow);
  b.place(null);
  foldedBlanket(b);
}

/**
 * The green blanket folded across the foot.
 *
 * It was a box 10 units thick, floating 100 above the mattress — a sheet of
 * paper hanging in the air over the counterpane rather than lying on it. Two
 * things were wrong and only one of them was the shape.
 *
 * The shape: a blanket folded in three and laid across a bed is a slab with
 * ROUNDED ends, because those ends are folds and a fold has a radius. The cut
 * edges are the other two sides, which is why they stay square. There is one
 * step in the top, where the upper fold stops short of the lower one, and that
 * single step is most of what makes it read as folded rather than as a cushion.
 *
 * The height: it sits at 907, which is measured off the counterpane beneath it —
 * that surface tops out at 905 under this footprint — and not at the 960 the box
 * was using. It will want re-seating whenever the counterpane is simulated
 * again, because it rests on the counterpane and not on the bed.
 */
function foldedBlanket(b: Builder): void {
  const P = FURNITURE_PAINT, { x1, y0, y1 } = BED;
  const fx0 = x1 - 760, fx1 = x1 - 80;      // the folds, along the bed
  const fy0 = y0 + 60, fy1 = y1 - 200;      // the cut edges, across it
  const BASE = 907, THICK = 88, STEP = 170, LIP = 22, K = 6;
  const r = THICK / 2, top = BASE + THICK;

  /** the end-on section: flat underneath, folded round at both ends, and one
   *  step in the top where the upper fold ends */
  const sect: [number, number][] = [[fx0 + r, BASE], [fx1 - r, BASE]];
  for (let i = 1; i < 2 * K; i++) {                       // the far fold
    const a = -Math.PI / 2 + (Math.PI * i) / (2 * K);
    sect.push([fx1 - r + r * Math.cos(a), BASE + r + r * Math.sin(a)]);
  }
  sect.push([fx1 - r, top], [fx0 + STEP, top], [fx0 + STEP, top - LIP], [fx0 + r, top - LIP]);
  // the near fold, which is an ELLIPSE and not an arc: the step has taken LIP
  // off the top on this side, so it has less height to turn through than the far
  // one and a circle of radius r would not meet the two ends it has to meet
  const nz = (BASE + top - LIP) / 2, nr = (top - LIP - BASE) / 2;
  for (let i = 1; i < 2 * K; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / (2 * K);
    sect.push([fx0 + r + r * Math.cos(a), nz + nr * Math.sin(a)]);
  }
  const N = sect.length;
  const STATIONS = 4;
  const at = (k: number, j: number): V3 => {
    const [x, z] = sect[k % N], v = j / STATIONS;
    // the least sag: it is lying on something, it is not hanging
    return [x, fy0 + (fy1 - fy0) * v, z - (z > BASE + 2 ? 5 * Math.sin(Math.PI * v) : 0)];
  };
  for (let j = 0; j < STATIONS; j++) for (let k = 0; k < N; k++) {
    b.quad(at(k, j), at(k + 1, j), at(k + 1, j + 1), at(k, j + 1), P.green);
  }
  // the two cut ends, fanned from the middle of the section
  for (const [j, n] of [[0, -1], [STATIONS, 1]] as const) {
    const mid: V3 = [(fx0 + fx1) / 2, fy0 + (fy1 - fy0) * (j / STATIONS), BASE + r];
    for (let k = 0; k < N; k++) {
      const a = at(k, j), c = at(k + 1, j);
      // the repeat is the LAST corner, never the first: `quad` takes its normal
      // from (b - a) x (d - a), so a first-and-last pair leaves that cross
      // product zero and the face renders with nothing on it but the ambient
      const p = n < 0 ? c : a, q = n < 0 ? a : c;
      b.quad(mid, p, q, q, P.green, [0, n, 0]);
    }
  }
}

/**
 * The mattress.
 *
 * It was a box — twelve triangles, six flat faces, square corners — and a
 * mattress is none of those things. What it is, is a bag: the ticking is cut
 * flat, sewn round a welt that runs the whole way round at mid-height, and
 * stuffed, so the sides BULGE past the top and bottom faces and the corners come
 * round in plan. The top crowns, because that is where the stuffing has nowhere
 * to go.
 *
 * All four of those are one loft: an outline that is a rounded rectangle, a
 * cross-section that carries the belly and the welt, and a top of two rings that
 * lifts to the crown. Around 200 triangles, and none of it needed simulating —
 * a mattress does not drape, it is a shape.
 *
 * It is barely rounded, and that is deliberate. The first cut had a corner
 * radius of 150 on a mattress 1,540 across, a belly of 55 and a crown of 26,
 * and read as a bolster: a mattress is a flat-sided slab that has been softened
 * at the arrises, not a cushion. 70, 24 and 12 leave the long sides straight and
 * take the hardness off only where the hardness would actually be.
 */
function mattress(b: Builder): void {
  const P = FURNITURE_PAINT, { x0, x1, y0, y1 } = BED;
  const INSET = 40, RAD = 70, BELLY = 24, CROWN = 12, K = 4;
  const ax0 = x0 + INSET, ax1 = x1 - INSET, ay0 = y0 + INSET, ay1 = y1 - INSET;
  const cx = (ax0 + ax1) / 2, cy = (ay0 + ay1) / 2;

  /** the plan: a rectangle with its corners taken round, walked anticlockwise */
  const ring: [number, number][] = [];
  for (const [px, py, sx, sy] of [
    [ax1 - RAD, ay1 - RAD, 1, 1], [ax0 + RAD, ay1 - RAD, -1, 1],
    [ax0 + RAD, ay0 + RAD, -1, -1], [ax1 - RAD, ay0 + RAD, 1, -1],
  ] as const) {
    for (let i = 0; i <= K; i++) {
      const a = (Math.PI / 2) * (i / K);
      // each corner starts on the side it came from and ends on the next
      const [u, v] = sx * sy > 0 ? [Math.cos(a), Math.sin(a)] : [Math.sin(a), Math.cos(a)];
      ring.push([px + sx * RAD * u, py + sy * RAD * v]);
    }
  }
  const N = ring.length;

  /** the cross-section: how far the ticking stands out from the plan, and how
   *  high, from the boards up. The widest point is the welt. */
  //
  // The widest point stays where it was, halfway up what SHOWS — between the
  // rail's top edge and the mattress's own. Putting it halfway up the ticking
  // instead would bury the welt behind the rail and leave the visible part
  // reading as a thin pad.
  const SECTION: [number, number][] = [
    [0, BED.base], [BELLY * 0.5, BED.base + 24], [BELLY * 0.82, BED.rail - 20],
    [BELLY, (BED.rail + BED.mattress) / 2],
    [BELLY * 0.72, BED.mattress - 22], [0, BED.mattress],
  ];
  const at = (i: number, k: number): V3 => {
    const [px, py] = ring[i % N], [out, z] = SECTION[k];
    const dx = px - cx, dy = py - cy, len = Math.hypot(dx, dy) || 1;
    return [px + (dx / len) * out, py + (dy / len) * out, z];
  };
  for (let k = 0; k + 1 < SECTION.length; k++) {
    for (let i = 0; i < N; i++) {
      b.quad(at(i, k), at(i + 1, k), at(i + 1, k + 1), at(i, k + 1), P.mattress);
    }
  }
  // the bottom, flat on the slats
  for (let i = 0; i < N; i++) {
    b.quad([cx, cy, BED.base], at(i + 1, 0), at(i, 0), at(i, 0), P.mattress, [0, 0, -1]);   // safe: a and d differ
  }
  // and the top, which crowns: an inner ring three-quarters of the way in,
  // lifted most of the way, and a middle lifted all of it
  const inner = (i: number): V3 => {
    const [px, py] = ring[i % N];
    return [cx + (px - cx) * 0.88, cy + (py - cy) * 0.88, BED.mattress + CROWN * 0.72];
  };
  const top = SECTION.length - 1;
  const peak: V3 = [cx, cy, BED.mattress + CROWN];
  for (let i = 0; i < N; i++) {
    b.quad(at(i, top), at(i + 1, top), inner(i + 1), inner(i), P.mattress);
    // The fan to the peak, and the repeated corner is the LAST one, not the
    // first. `quad` takes its normal from (b - a) crossed with (d - a); written
    // as (peak, inner, inner, peak) the second of those is zero, the normal comes
    // out zero, and the whole crown of the mattress renders with no light on it
    // but the ambient — which is blue, so it read as a navy slab under the pillow.
    b.quad(peak, inner(i), inner(i + 1), inner(i + 1), P.mattress, [0, 0, 1]);
  }
}

/**
 * The DRAWN pillow, which the imported one replaced. Kept for the note in it.
 *
 * A pillow, which is the one thing on this bed a box cannot be.
 *
 * The trick is a height field rather than a solid: a grid of quads whose height
 * is the product of two half sines, raised to a power under one. That power is
 * what does the work — it pulls the shoulders of the curve out towards the
 * edges, so the pillow is plump nearly to its seam and then falls quickly,
 * which is how a stuffed bag behaves and how a rounded box does not. A hollow
 * is taken out of the middle where a head has been.
 *
 * Eighty quads. There is no underside: it lies on the mattress.
 */
function drawnPillow(
  b: Builder, x0: number, y0: number, x1: number, y1: number,
  z: number, thick: number, paint: readonly number[],
): void {
  const NU = 10, NV = 8;
  const at = (i: number, j: number): V3 => {
    const u = i / NU, v = j / NV;
    const plump = Math.pow(Math.sin(Math.PI * u) * Math.sin(Math.PI * v), 0.45);
    const dip = 0.34 * Math.exp(-((u - 0.5) ** 2 + (v - 0.5) ** 2) / 0.055);
    return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, z + thick * plump * (1 - dip)];
  };
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    b.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), paint);
  }
}

function screen(b: Builder): void {
  const P = FURNITURE_PAINT, S = SCREEN;
  // each panel is as long as its share of the span divided by the cosine of its
  // fold, so the three still reach from one end to the other
  const share = (S.x1 - S.x0) / S.panels, width = share / Math.cos(S.fold);
  for (let i = 0; i < S.panels; i++) {
    const cx = S.x0 + share * (i + 0.5), yaw = (i % 2 === 0 ? 1 : -1) * S.fold;
    b.place({ cx, cy: S.y, yaw });
    const x0 = cx - width / 2, x1 = cx + width / 2, y0 = S.y - S.thickness / 2, y1 = S.y + S.thickness / 2;
    b.material("stain", MATERIALS.stain.scale);
    // the frame: two stiles, a top rail, a deeper bottom rail, on two small feet
    b.box(x0, y0, S.feet, x0 + S.stile, y1, S.top, P.frame);
    b.box(x1 - S.stile, y0, S.feet, x1, y1, S.top, P.frame);
    b.box(x0, y0, S.top - S.topRail, x1, y1, S.top, P.frame);
    b.box(x0, y0, S.feet, x1, y1, S.feet + S.bottomRail, P.frame);
    for (const fx of [x0 + 20, x1 - 60]) b.box(fx, y0 - 30, 0, fx + 40, y1 + 30, S.feet, P.frame);
    // the cloth, set back a little from each face
    b.material("cloth", MATERIALS.cloth.scale);
    const za = S.feet + S.bottomRail, zb = S.top - S.topRail, xa = x0 + S.stile, xb = x1 - S.stile;
    b.quad([xa, y0 + S.recess, za], [xb, y0 + S.recess, za], [xb, y0 + S.recess, zb], [xa, y0 + S.recess, zb], P.panel, [0, -1, 0]);
    b.quad([xa, y1 - S.recess, za], [xb, y1 - S.recess, za], [xb, y1 - S.recess, zb], [xa, y1 - S.recess, zb], P.panel, [0, 1, 0]);
    b.material(null);
    b.place(null);
  }
}

/**
 * The counter, the cupboard over it and the china between them — one generated
 * file, split by height into the four things it holds.
 *
 * A generator hands back a buffer, not a set of objects, and this one arrived as
 * fifty islands with no materials at all. Height sorts them, because the room
 * has already measured every one of these off `Scene1/View32`: the cornice at
 * 3,880, the cupboard's bottom rail at 2,135, the counter's top at 1,550. What
 * lands between the counter's top and the cupboard's bottom is whatever is
 * standing on the counter, and it is china.
 *
 * That the mesh's own features fall on those rows — its cornice at 3,880, its
 * top slab at 1,546..1,601, its door knobs at 2,400 where `CUPBOARD.knob` puts
 * them — is the check that the fit is right, and it was not arranged.
 */
function cupboardWall(b: Builder): void {
  const P = FURNITURE_PAINT;
  const cx = ROOM.x1 - COUNTER.depth / 2, cy = (COUNTER.y0 + COUNTER.y1) / 2;
  const at: V3 = [cx, cy, 0];
  // The two curtains across the counter's front, in flat green and no tile at all.
  // `MATERIALS.curtain` is a 55 by 55 patch of the counter in `Scene1/View32`
  // laid on at 700 to the repeat — 13 units to a frame pixel — and on cloth
  // that already has 613 triangles of fold in it, all that adds is a blur. The
  // colour it was toned to is what is worth keeping, and that colour is
  // `FURNITURE_PAINT.curtain`, which is the same measurement.
  //
  // TWO curtains, and neither of them is the cloth the model came with. That was
  // six separate hanging strips — an artefact of how gathered it is — and
  // welding them into two got the topology right without making either of them
  // hang like cloth. These are simulated instead: a pleated sheet hung from the
  // rail under the worktop, pinned along its heading and nowhere else, dropped
  // against the carcase with self-collision on, and settled over sixty frames.
  //
  // What the sim wanted, in the order it taught it: bending at 4 rather than
  // 0.5, because a CORRUGATED sheet with no bending strength buckles into knots
  // under its own weight; air damping at 3, because a free leading edge on light
  // cloth swings and a swinging edge curls back and ties itself off; and both
  // curtains started CLEAR of the end cheeks, because the right one was first
  // given an outer edge fifteen units inside its cheek, and a cloth born inside
  // a collider is thrown out of it — it lost every pleat and draped away
  // sideways while its twin, which happened to miss by one unit, hung perfectly.
  //
  // SIMULATED TWICE. The first pair had a visible kink at the top, and the
  // measurement says exactly what it was: the heading was pinned at a mean x of
  // 10,752 and the cloth below it hung at 10,709, so it stepped 43 units
  // forward in the first 150 of drop — about sixteen degrees — and then fell
  // plumb to the hem, drifting six. A cloth cannot settle 45 units in FRONT of
  // its own pin line; gravity swings it back. So that was never a drape. It was
  // the authored pleated sheet, held in the shape it was authored in by the
  // very numbers above: bending 4 and air damping 3 are stiff enough not to
  // knot, and stiff enough not to fall.
  //
  // The pin was in the wrong place, and it was in the wrong place because there
  // was no curtain rail. The cloth was pinned to the CARCASE's top rail, 45
  // units behind the worktop's front edge, so it had to step forward just to
  // get out from under the counter. `COUNTER.rail` puts a rail under that edge
  // now and the heading hangs on it: the step is 0.4 units on one curtain and
  // 0.2 on the other, the lean over the whole drop is 11, and the two are
  // symmetric where they used to be 6 and 18.
  //
  // Re-simulating is also what let the carcase be built to its own measurement.
  // The old cloth had been settled against an imported model 424 units short of
  // the counter the frames show, and could not be re-fitted by editing a
  // number — so the carcase had been kept wrong to match it. Both are right
  // now, which is the whole reason to re-run a simulation rather than nudge
  // what it produced.
  //
  // Simulated at 40 by 30 and shipped at 40 by 8: cloth never changes how many
  // vertices it has or what order they are in, so the settled positions read
  // straight back into a coarser grid of the same columns. That keeps every
  // pleat where the solver put it and throws away only rows, which a curtain
  // hanging straight has nothing to say between. 1,280 triangles for the pair.
  b.mesh(CURTAINL_POSITION, CURTAINL_INDICES, at, P.curtain);
  b.mesh(CURTAINR_POSITION, CURTAINR_INDICES, at, P.curtain);
  // and the carcase behind them, drawn rather than imported — see drawnCounter
  drawnCounter(b);
  // The cupboard on the wall above, in the same wood as the counter under it —
  // it wore `stain` until the counter stopped, and one piece of this wall in a
  // blurred patch beside four in a drawn tile is worse than either. Its doors,
  // cornice, panels and fittings are one mesh; its knobs and the border round
  // its doors are their own, because neither of them is wood.
  b.material("mahogany", MATERIALS.mahogany.scale);
  b.mesh(CUPBOARD_POSITION, CUPBOARD_INDICES, at, P.cupboard, 0, true);
  b.material(null);
  /**
   * The knobs: brass, turned on ten segments, 108 across and 76 long. The
   * model's own were 324-face lumps that still read as crumpled paper, and they
   * are 140 triangles for the pair now. `Scene3/View22` reads them at z 2,389
   * and 2,394 and 624 apart — which is `COUNTER.knob.z` of 2,400 and this
   * module's own note about "brass knobs LOW on them", arrived at three separate
   * times and agreeing every time.
   *
   * THE HEIGHT WAS RIGHT AND THE DEPTH WAS NOT. The pair is baked spanning x
   * -230 to -154, and the doors' own face is at -190 — so 36 of the 76 were
   * inside the door and only 40 stood out of it. A note here used to say they
   * stood 76 proud; that was true of the model and never true of where it was
   * put.
   *
   * Pulled forward 30, which seats the turning on the face with six units of
   * shank still in the wood — enough that no gap can open along the rim from a
   * grazing angle — and leaves 70 of it in the room. The band round the doors
   * is baked at -190 to -162 and confirms the face independently: its front and
   * the doors' agree exactly.
   */
  b.mesh(CUPKNOBS_POSITION, CUPKNOBS_INDICES, [at[0] - CUPBOARD.knob.proud, at[1], at[2]], P.brass);
  // and the zigzag border that runs round both doors: dark against the wood,
  // 270 teeth at a pitch of 36. That pitch is measured, not chosen — the teeth
  // come every five pixels in `Scene3/View22` and a pixel there is 7.1 units —
  // and it is the whole reason the border costs 540 triangles instead of 270.
  b.mesh(CUPBAND_POSITION, CUPBAND_INDICES, at, P.cupboardBand);
}

/**
 * The counter's carcase and its worktop, DRAWN.
 *
 * It was five imported meshes and they were five different pieces of evidence
 * that nobody had ever cut this thing out of wood. The two end cheeks were 57
 * and 33 thick where `COUNTER.end` says 40. The three front rails were 21, 23
 * and 30 thick and 152, 147 and 203 tall, no two alike. The rails and the
 * plinth ran 33 units past the right cheek and 16 past the left, so the front
 * of the cupboard overhung its own ends. And Blender counts 18 zero-area faces
 * across the cheeks and the worktop, and 82 boundary edges on the plinth and
 * the rails — which are not solids at all but open shells, showing their
 * insides to anyone at a grazing angle. None of that is visible head-on in a
 * dark corner behind a curtain, which is exactly why it survived.
 *
 * The cure is the one this room has used four times already: a carcase made of
 * named boxes cannot come out with one cheek thicker than the other. Ten boxes
 * and a slab, against 268 imported triangles.
 *
 * **AND IT HAS AN INSIDE NOW.** The imported model had three shelf RAILS and no
 * shelves — a rail is the strip across the front of a shelf, so three of them
 * hanging in front of an empty box is a joiner's drawing of a cupboard with the
 * cupboard left out. There was no bottom board either: the room's own
 * floorboards showed through, which you can see from the front, because the two
 * curtains part by 101 units in the middle and stop 75 short of the floor.
 * There is a bottom board on the plinth now and a shelf behind each of the two
 * lower rails, flush with the rail's own top edge, which is where a shelf goes
 * and why the rails are at those heights. Three bays of 380, 375 and 421 —
 * 245, 242 and 272 mm — which will take tins standing up.
 */
function drawnCounter(b: Builder): void {
  const P = FURNITURE_PAINT, K = COUNTER;
  const front = ROOM.x1 - K.depth, back = ROOM.x1;
  const under = K.top - K.slab;                     // the worktop's underside
  const y0 = K.y0 + K.end, y1 = K.y1 - K.end;       // between the cheeks
  const curtain0 = front, curtain1 = front + K.rail.thick;
  const rail0 = curtain1, rail1 = curtain1 + K.rail.thick;
  const backPanel = back - K.board;
  const floorTop = K.plinth.height + K.board;
  /**
   * The shelves, spaced rather than placed. Three equal bays between the bottom
   * board and the worktop is what decides where they go — the imported model's
   * rails were at 568, 978 and 1,353, and those were never a measurement of
   * anything: no frame can see inside this cupboard, and the model that carried
   * them had one cheek 57 thick and the other 33.
   */
  const bay = (under - floorTop - (K.bays - 1) * K.board) / K.bays;
  const shelves = Array.from({ length: K.bays - 1 },
    (_, i) => Math.round(floorTop + (i + 1) * (bay + K.board)));

  b.material("mahogany", MATERIALS.mahogany.scale);
  // the two end cheeks, floor to the worktop's underside, and the back panel
  b.box(front, K.y0, 0, back, y0, under, P.cupboard);
  b.box(front, y1, 0, back, K.y1, under, P.cupboard);
  b.box(backPanel, y0, 0, back, y1, under, P.cupboard);
  // the plinth across the front, set back from the cheeks so there is a toe
  const pl = front + K.plinth.setback;
  b.box(pl, y0, 0, pl + K.plinth.thick, y1, K.plinth.height, P.cupboard);
  // the bottom board on the plinth, closing the floor off
  b.box(front, y0, K.plinth.height, backPanel, y1, floorTop, P.cupboard);
  // a shelf behind each rail, its top flush with the rail's own top edge
  for (const z of shelves) b.box(rail1, y0, z - K.board, backPanel, y1, z, P.cupboard);
  // the curtain rail under the worktop's front edge, then the shelf rails
  // behind it — the curtain rail is what the cloth is pinned to
  b.box(curtain0, y0, under - K.rail.curtainDrop, curtain1, y1, under, P.cupboard);
  for (const z of [...shelves, under]) b.box(rail0, y0, z - K.rail.deep, rail1, y1, z, P.cupboard);
  b.material(null);
  // The worktop: scrubbed deal gone creamy, and a plain slab on purpose — the
  // desk's top carries a lip under its edge to read as a moulding, and this one
  // cannot, because the curtain's heading is pinned immediately under its front
  // edge and a lip would be inside the cloth. What stood on this top came in
  // with the model — a service of bowls, a tureen and a platter, 2,997
  // triangles, more than the counter it stood on and more than the fireplace —
  // and is gone. The frames do show things along here; it was not that.
  const o = K.oversail;
  b.box(front - o, K.y0 - o, under, back, K.y1 + o, K.top, P.counterTop);
}

function drawnCupboard(b: Builder): void {
  const P = FURNITURE_PAINT, C = CUPBOARD;
  b.material("stain", MATERIALS.stain.scale);
  const back = ROOM.x1 - 10, face = ROOM.x1 - C.depth;
  // the carcass, a hair behind the door fields, and the cornice standing proud
  b.box(face + C.recess + 4, C.y0, C.z0, back, C.y1, C.z1 - C.cornice, P.cupboard);
  b.box(face - 50, C.y0 - 50, C.z1 - C.cornice, back, C.y1 + 50, C.z1, P.cupboard);
  b.box(face - 25, C.y0 - 25, C.z1 - C.cornice - 30, back, C.y1 + 25, C.z1 - C.cornice, P.cupboard);
  // two doors: fields set back behind stiles and rails, the meeting stiles in the middle
  const mid = (C.y0 + C.y1) / 2;
  const zLo = C.z0 + C.rail, zHi = C.z1 - C.cornice - C.rail;
  const xR = face + C.recess;
  for (const [ya, yb] of [[C.y0 + C.stile, mid - C.stile / 2], [mid + C.stile / 2, C.y1 - C.stile]] as const) {
    b.quad([xR, ya, zLo], [xR, yb, zLo], [xR, yb, zHi], [xR, ya, zHi], P.cupboardDoor, [-1, 0, 0]);
    b.quad([face, ya, zHi], [face, yb, zHi], [xR, yb, zHi], [xR, ya, zHi], [0.05, 0.03, 0.02], [0, 0, -1]);
    b.quad([face, ya, zLo], [face, yb, zLo], [xR, yb, zLo], [xR, ya, zLo], [0.26, 0.17, 0.10], [0, 0, 1]);
  }
  for (const [ya, yb] of [[C.y0, C.y0 + C.stile], [mid - C.stile / 2, mid + C.stile / 2], [C.y1 - C.stile, C.y1]] as const) {
    b.quad([face, ya, C.z0], [face, yb, C.z0], [face, yb, C.z1 - C.cornice], [face, ya, C.z1 - C.cornice], P.cupboard, [-1, 0, 0]);
  }
  b.quad([face, C.y0, C.z0], [face, C.y1, C.z0], [face, C.y1, zLo], [face, C.y0, zLo], P.cupboard, [-1, 0, 0]);
  b.quad([face, C.y0, zHi], [face, C.y1, zHi], [face, C.y1, C.z1 - C.cornice], [face, C.y0, C.z1 - C.cornice], P.cupboard, [-1, 0, 0]);
  // the ends and the underside, so it reads as a box from the side and from below
  b.quad([face, C.y0, C.z0], [back, C.y0, C.z0], [back, C.y0, C.z1 - C.cornice], [face, C.y0, C.z1 - C.cornice], P.cupboard, [0, -1, 0]);
  b.quad([face, C.y1, C.z0], [back, C.y1, C.z0], [back, C.y1, C.z1 - C.cornice], [face, C.y1, C.z1 - C.cornice], P.cupboard, [0, 1, 0]);
  b.quad([face, C.y0, C.z0], [back, C.y0, C.z0], [back, C.y1, C.z0], [face, C.y1, C.z0], P.cupboard, [0, 0, -1]);
  // knobs, brass, low on the doors beside the meeting stiles
  b.material(null);
  for (const y of [mid - C.stile / 2 - C.knob.in, mid + C.stile / 2 + C.knob.in]) {
    b.tube([face, y, C.knob.z], [face - 26, y, C.knob.z], 14, 8, PAINT.brass);
  }
}

/**
 * The side table, and the book lying on it.
 *
 * SAME SHAPE AS THE ARMCHAIR AND ITS FUTILITY: a generated file arrives as one
 * buffer holding a piece of furniture and whatever the generator decided to
 * stand on it, and the thing standing on it is never made of the same stuff.
 * The chair came with a book on its seat and the book is drawn by
 * {@link futility}; this table came with a wireless AND a book, the wireless
 * was dropped for a modelled one, and the book is `--detach 1` into a module of
 * its own so it can be paper while the table is wood.
 *
 * The table's mesh was fitted to 1200 x 750 x 1970 — the box the frames give
 * the table AND the set that stood on it, `Scene1/View32` putting the top on
 * 1,050 and the set's top on 1,970 — and the radio's islands dropped afterwards,
 * which is why its BOX tops out at 1,118.7 and not at 1,970. That fit is now
 * BAKED INTO THE COORDINATES and must not be done twice: the file the tool
 * reads today is the mended table exported back out of Blender in the room's
 * own frame, and it is taken as it stands.
 *
 *     bedsitglb.ts <sidetable.glb> sidetable 1 1 1 --exact 1549.375 \
 *         --detach 1 sidetablebook
 *
 * WHAT ELSE IS ON THE TOP: a brass ashtray, its own file and its own module,
 * standing behind the book. 179 mm across and 27 mm deep, which is a brass dish.
 *
 *     bedsitglb.ts <ashtray.glb> ashtray 1 1 1 --exact 1549.375
 *
 * It is BUILT rather than imported, and built to the dimensions of the one it
 * replaces. That one was a generated model of 4,282 triangles brought down to
 * 900, and the ring of its rim did not survive the decimation: the brim came out
 * crumpled into facets, the four cigarette rests dissolved into that creasing,
 * and the bowl floor was a faceted cone. None of it was the shape — it was
 * damage, and no budget was going to undo it.
 *
 * So the old mesh was measured instead. Sections cut through it give an outer
 * radius of 89.5 mm, a total height of 27.4, the bowl's floor inside at 2.27 and
 * its mouth at r = 60, and the brim a flat-bottomed flange at 24.8 crowning at
 * 27.4 over r = 68 — a slab two millimetres thick. The bowl wall is a measured
 * curve too, through (47.6, 3.4) (52, 9.5) (55.7, 14.1) (57.1, 17.6) (59.6,
 * 21.3), and the profile that replaces it passes within a millimetre of each.
 *
 * THE CIGARETTE RESTS ARE NOT GROOVES CUT IN THE TOP, which is the one thing
 * worth knowing about this shape. At 0, 90, 180 and 270 degrees the flange is
 * still a slab of the same two millimetres — it sits at z 19.1 to 21.3 instead of
 * 24.8 to 26.9. The whole brim DIPS, the way a pressed tray does, and the bowl's
 * lip dips with it. So the rebuild makes them by lowering a surface of revolution
 * under a four-fold modulation rather than by cutting it, which is why it is
 * symmetrical to the last decimal and why there is no boolean's seam in it.
 *
 * It costs 2,448 triangles against the old 900. That is the price of a rim that
 * is actually round: the columns are graded four-fold — close together at each
 * rest, where the dip is six degrees wide at half depth, and spread between them
 * — and at 72 of them the widest gap flattens the silhouette by 0.17 mm.
 *
 * The build script is `ashbuild.py`, which talks to Blender over the bridge; the
 * profile is a table at the top of it.
 *
 * WHAT WAS MENDED: the lower shelf hung in the middle of the table, touching
 * nothing. It had been cut to the legs' bounding boxes, and a bounding box is a
 * tapered leg at its widest — these run 70 units square at the head and 30 at
 * the foot, and the shelf sits a fifth of the way up, where every leg is still
 * near its foot. So it missed all four; and on the +y side it ran 38 units past
 * the OUTSIDE of a leg as well, which is the ear that stood out. It is now a
 * plain box cut to each leg's face interpolated to the height it actually meets
 * it, buried 12 units into all four — which reads as joinery from any angle the
 * room offers and is hidden inside a leg 30 units thick at that height.
 */
function sideTable(b: Builder): void {
  const T = SIDE_TABLE, P = FURNITURE_PAINT;
  const back = ROOM.x1 - 30, front = back - T.depth;
  const at: V3 = [(front + back) / 2, (T.y0 + T.y1) / 2, 0];
  b.material("wood", MATERIALS.wood.scale);
  b.mesh(TABLE_POSITION, TABLE_INDICES, at, P.table, 0, true);
  b.material(null);
  /**
   * The book and the ashtray, PLACED OFF THE GAME'S OWN FRAME.
   *
   * `Scene2/View12` is the one standpoint that looks down on this table's top
   * squarely enough to measure it: the eye is at 7,493, 4,319, in front of the
   * table and to its left, and the whole top is in the frame with nothing on it
   * hidden. The camera can be trusted there — standing the page at that eye and
   * that lens puts the poster's centroid within four pixels of the game's, on a
   * picture 512 across.
   *
   * Both props are REGISTERED and not picked. A prop's outline is projected for
   * a candidate place, size and turn, and scored against the frame by normalized
   * cross-correlation with the window's brightness above its own median. NCC is
   * used rather than a sum because it survives the two pictures' very different
   * exposure AND penalizes a mask that has grown too big, which a sum will
   * always prefer. Picking corners by eye does not work here and picking
   * centroids does not either: a percentile threshold pins the blob's area to
   * the window, so the size comes out right however wrong it is, and an Otsu
   * threshold latched onto DIFFERENT FEATURES in the two pictures — the game's
   * dim frame gave up only the book's white page edges where our lit one gave
   * the whole pale cover, and the two centroids came out sixteen rows apart.
   *
   * THE BOOK IS DRAWN, NOT IMPORTED, and it is a box: twelve triangles, which
   * is the fewest a book can be and the fewest it needs.
   *
   * It used to be an island cut out of the table's own generated file, fitted
   * to a box by `bedsitglb`. That was a lot of machinery for a slab, and worse,
   * it invited the slab to be measured off the frame — which is where a long
   * detour went wrong. Read off a crop magnified thirty-seven times, the thing
   * on the table gives four corners that un-project into a rectangle 418 by 575
   * with three quarters of it out over the front edge, or, on a lower surface,
   * onto a rectangle sitting square on top of the wireless. Neither is a book
   * lying on a table.
   *
   * The reason is that a four-corner un-projection means nothing unless those
   * four corners really are a rectangle on one plane, and forty pixels of a
   * 512 by 264 frame will not say whether they are. Forced through a rectangle
   * solver, a shape that is not one comes back as a rectangle somewhere it
   * cannot be — which is exactly what happened. Both of the conclusions that
   * detour reached about this TABLE, that its top was at 866 and then that it
   * was not, were built on that, and neither was evidence. The table is where
   * it was, at the height it was.
   *
   * So this is a plain closed book of a plausible size, lying where the frame
   * has one lie: 420 along by 300 across by 45 thick, its front edge a tenth of
   * itself over the table's own, clear of the ashtray and clear of the set. The
   * TURN is the one thing carried over from the reading, because an angle in
   * plan is the one thing no error in the surface's height can touch.
   *
   * ALL THREE OF THESE ARE NOW SET BY HAND, off a plan view of the table with
   * the props draggable on it. That is the right instrument for the job: the
   * only view the game gives of this top is a grazing one, where a row of
   * pixels is thirty-five units of depth and depth and size trade against one
   * another, and no amount of arithmetic on one frame separates them. Looked at
   * from above there is nothing to separate — a thing is where it is put.
   *
   */
  /**
   * THE QUARTERLY, on the closed-book model.
   *
   * Six quads before this — a box, which is the fewest a book can be and was
   * always going to read as one. It is the same model the armchair's Futility
   * wears, cut the same way and fitted to this book's own 300 by 420 by 45, so
   * the two agree about what a book looks like without sharing a module: the
   * bake is `--exact`, and an exact bake has the piece's size in it.
   *
   * WHERE THE TITLE'S HEAD GOES is settled at the bake and not here. The model
   * lies with its length on y and its spine on x, which is this book's way
   * round, so it is fitted with no turn; the cover's coordinates are projected
   * straight down on to the front board with u running from +x, because the
   * eye that measured this table sees the book's local +x to its LEFT and the
   * cover would otherwise read mirrored.
   */
  const z0 = SIDE_TABLE.top + 24;
  b.place({ cx: BOOK.x, cy: BOOK.y, yaw: BOOK.yaw });
  const bookAt: V3 = [BOOK.x, BOOK.y, z0];
  b.material("tellurian", MATERIALS.tellurian.scale);
  b.mesh(TELLURIANCOVER_POSITION, TELLURIANCOVER_INDICES, bookAt, P.booklet, 0, true, TELLURIANCOVER_UV);
  b.material(null);
  b.mesh(TELLURIANBOARDS_POSITION, TELLURIANBOARDS_INDICES, bookAt, P.booklet, 0, true);
  b.mesh(TELLURIANPAGES_POSITION, TELLURIANPAGES_INDICES, bookAt, P.bookEdge, 0, true);
  b.place(null);
  b.mesh(ASHTRAY_POSITION, ASHTRAY_INDICES, [at[0] + 176, at[1] - 323, SIDE_TABLE.top + 24], P.brass, 0, true);
}

/**
 * The set, standing on the table's top where the frames put it: an EKCO AC97,
 * the moulded bakelite cabinet the room's own drawn radio was always a sketch
 * of, in four modules and one drawn panel.
 *
 * The generated file is one buffer of nineteen islands, and which island is
 * which is not a guess — nothing on this set touches anything else it is not
 * made of. So the whole split is `--detach`, by the rank `--list` prints:
 *
 *     bedsitglb.ts <ekco.glb> radio 440 300 920 --flip \
 *         --detach 12 radiogrille --detach 8,10,11 radioknobs \
 *         --detach 7,9,13,14,15,16,17,18 radioswitches
 *
 * `--flip` is not optional and the tool's own header says why: it guesses which
 * side is the back from where the tall geometry leans, and a wireless — flat
 * back, sloped front — is exactly the shape that guess gets wrong. It called
 * the face the back.
 *
 * What each module is made of:
 *
 *   the CASE, and with it the fins, the corner columns, the tuning eye and the
 *     divider down the dial, is bakelite: one moulding, one material.
 *   the GRILLE is the cloth behind the speaker, and it is the only part of the
 *     set that is not bakelite — the photograph puts it at better than twice
 *     the case's brightness. Laid on at a ninth of the case's repeat so the
 *     weave comes out as threads and not as stripes; see `MATERIALS.grille`.
 *   the KNOBS and the SWITCHES take no material at all. A textured surface in
 *     this room takes the tile as its albedo outright, so a material is a way
 *     of saying WHAT a thing is made of and not how dark it is; three knobs
 *     that want to be a shade under the cabinet, and a switch that wants to be
 *     metal, are paint.
 *
 * THE DIAL PANEL IS NOT AN ISLAND, and no amount of detaching will make it one:
 * the back of the slot is welded to the cabinet's own shell all the way round
 * the recess. So it is drawn instead, and where to draw it was measured rather
 * than guessed — the face was rasterised and the slot taken as the HOLE in it.
 * The face stands at -130 in the set's own frame, the slot's back at -119, and
 * its window is y -33..32 by z 537..834: 43 by 197 millimetres. The panel goes
 * a unit and a half in front of that back, which is a millimetre of daylight —
 * enough that nothing z-fights, too little to see.
 *
 * It is one flat parchment at the moment. The station scale itself — MEDIUM
 * WAVES, LONG WAVES and a column of names — wants a chart and a file, the way
 * {@link futility} carries the book's cover, and this rectangle is where it
 * will go.
 */
function wireless(b: Builder): void {
  const R = RADIO, P = FURNITURE_PAINT;
  const at: V3 = [R.front + R.depth / 2, (R.y0 + R.y1) / 2, SIDE_TABLE.top];
  // FLAT, all of it. A cabinet is mouldings and flats meeting at edges, and an
  // averaged normal across one of those is what smeared the desk.
  b.material("bakelite", MATERIALS.bakelite.scale);
  b.mesh(RADIO_POSITION, RADIO_INDICES, at, P.tableTop, 0, true);
  b.material("grille", MATERIALS.grille.scale);
  b.mesh(RADIOGRILLE_POSITION, RADIOGRILLE_INDICES, at, P.tableTop, 0, true);
  b.material(null);
  b.mesh(RADIOKNOBS_POSITION, RADIOKNOBS_INDICES, at, P.radioKnob, 0, true);
  b.mesh(RADIOSWITCHES_POSITION, RADIOSWITCHES_INDICES, at, P.radioSwitch, 0, true);
  // the dial panel, in the slot the measurement above found
  const x = at[0] - 120.5, y0 = at[1] - 33, y1 = at[1] + 32, z0 = at[2] + 537, z1 = at[2] + 834;
  b.quad([x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1], P.radioDial, [-1, 0, 0]);
}

function drawnSideTable(b: Builder): void {
  const P = FURNITURE_PAINT, T = SIDE_TABLE;
  b.material("wood", MATERIALS.wood.scale);
  const back = ROOM.x1 - 30, front = back - T.depth;
  b.box(front, T.y0, T.top - T.slab, back, T.y1, T.top, P.tableTop);
  const legs: [number, number][] = [[front + T.inset, T.y0 + T.inset], [back - T.inset - T.leg, T.y0 + T.inset], [front + T.inset, T.y1 - T.inset - T.leg], [back - T.inset - T.leg, T.y1 - T.inset - T.leg]];
  for (const [x, y] of legs) b.box(x, y, 0, x + T.leg, y + T.leg, T.top - T.slab, P.table);
  // the stretcher frame: four rails between the legs, low down
  const z0 = T.stretcher - 14, z1 = T.stretcher + 14, xa = front + T.inset, xb = back - T.inset, ya = T.y0 + T.inset, yb = T.y1 - T.inset;
  b.box(xa, ya, z0, xb, ya + 24, z1, P.table);
  b.box(xa, yb - 24, z0, xb, yb, z1, P.table);
  b.box(xa, ya, z0, xa + 24, yb, z1, P.table);
  b.box(xb - 24, ya, z0, xb, yb, z1, P.table);
  // the booklet, left of the set
  b.material(null);
  b.box(front + 120, T.y0 + 80, T.top, front + 520, T.y0 + 560, T.top + 28, P.booklet);
  b.box(front + 120, T.y0 + 80, T.top + 28, front + 520, T.y0 + 560, T.top + 32, [0.30, 0.28, 0.24]);
}

/**
 * The set as the room drew it, from `RADIO.STG` — the walnut case, the arched
 * dial slot with its station scale, the tuning eye, the knob, the speaker
 * cloth and the louvres, each placed where that picture has it as a fraction
 * of the face. Nothing calls this now: `wireless` imports a modelled set
 * instead. It is kept because the imported one carries the case's shape and
 * none of its markings, and this is where the markings are written down.
 */
function radio(b: Builder): void {
  const P = FURNITURE_PAINT, R = RADIO, base = SIDE_TABLE.top;
  const front = R.front, back = front + R.depth;
  const width = R.y1 - R.y0, mid = (R.y0 + R.y1) / 2, radius = width / 2, height = R.top - base;
  const shoulder = R.top - radius;
  const walnut: readonly number[] = [0.36, 0.19, 0.10], walnutLit = [0.42, 0.23, 0.12];
  const dark: readonly number[] = [0.06, 0.04, 0.03], parchment: readonly number[] = [0.86, 0.76, 0.50];
  const Y = (u: number): number => R.y0 + u * width, Z = (v: number): number => R.top - v * height;
  // the arch of the top, over the whole width
  const arch = (y: number): number => shoulder + Math.sqrt(Math.max(0, radius * radius - (y - mid) * (y - mid)));
  const N = 18;
  for (let i = 0; i < N; i++) {
    const ya = R.y0 + (width * i) / N, yb = R.y0 + (width * (i + 1)) / N;
    const za = arch(ya), zb = arch(yb);
    b.quad([front, ya, base], [front, yb, base], [front, yb, zb], [front, ya, za], walnut, [-1, 0, 0]);
    b.quad([back, ya, base], [back, yb, base], [back, yb, zb], [back, ya, za], walnut, [1, 0, 0]);
    b.quad([front, ya, za], [back, ya, za], [back, yb, zb], [front, yb, zb], walnutLit, [0, 0, 1]);
  }
  b.quad([front, R.y0, base], [back, R.y0, base], [back, R.y0, shoulder], [front, R.y0, shoulder], walnut, [0, -1, 0]);
  b.quad([front, R.y1, base], [back, R.y1, base], [back, R.y1, shoulder], [front, R.y1, shoulder], walnut, [0, 1, 0]);

  // The face is one surface with nothing cut from it, so what the picture sinks
  // into the cabinet is here built standing off it, a few units each: the dial
  // as a dark arched bezel with the parchment scale inside, two columns of
  // stations as dark ticks and the red pointer across them, the tuning eye at
  // its head; the knob; the speaker cloth inside a ring; the louvres as grooves.
  const D = R.dial, dw = D.w * width, cy = Y(D.u);
  const dz1 = Z(D.v0) - dw / 2, dz0 = Z(D.v1) + dw / 2;
  const slot = (x: number, grow: number, paint: readonly number[], unlit = 0): void => {
    const r = dw / 2 + grow;
    b.quad([x, cy - r, dz0], [x, cy + r, dz0], [x, cy + r, dz1], [x, cy - r, dz1], paint, [-1, 0, 0], unlit);
    b.disc([x, cy, dz1], 0, -1, r, 16, paint, unlit);
    b.disc([x, cy, dz0], 0, -1, r, 16, paint, unlit);
  };
  slot(front - 4, 12, dark);
  slot(front - 6, 0, parchment, 1);
  for (const y of [cy - dw * 0.22, cy + dw * 0.22]) {
    for (let k = 0; k < 9; k++) {
      const z = dz0 + ((dz1 - dz0) * (k + 0.5)) / 9;
      b.quad([front - 8, y - dw * 0.12, z - 4], [front - 8, y + dw * 0.12, z - 4], [front - 8, y + dw * 0.12, z + 4], [front - 8, y - dw * 0.12, z + 4], [0.25, 0.15, 0.08], [-1, 0, 0], 1);
    }
  }
  b.quad([front - 9, cy - dw / 2 + 8, Z(0.42) - 3], [front - 9, cy + dw / 2 - 8, Z(0.42) - 3], [front - 9, cy + dw / 2 - 8, Z(0.42) + 3], [front - 9, cy - dw / 2 + 8, Z(0.42) + 3], [0.85, 0.12, 0.08], [-1, 0, 0], 1);
  // the tuning eye: a dark ring with a lit centre, at the head of the slot
  b.disc([front - 8, cy, Z(R.eye.v)], 0, -1, R.eye.r + 10, 16, dark);
  b.disc([front - 9, cy, Z(R.eye.v)], 0, -1, R.eye.r, 16, [0.95, 0.90, 0.70], 1);
  b.disc([front - 10, cy, Z(R.eye.v)], 0, -1, R.eye.r * 0.35, 12, dark);
  // the knob, right of the slot
  b.tube([front, Y(R.knob.u), Z(R.knob.v)], [front - 26, Y(R.knob.u), Z(R.knob.v)], R.knob.r, 12, [0.10, 0.07, 0.05]);
  b.disc([front - 26, Y(R.knob.u), Z(R.knob.v)], 0, -1, R.knob.r, 12, [0.16, 0.11, 0.08]);
  b.disc([front - 27, Y(R.knob.u), Z(R.knob.v)], 0, -1, R.knob.r * 0.5, 8, [0.22, 0.16, 0.10]);
  // the speaker: a ring of lighter walnut, a dark surround, the gold cloth inside
  const S = R.speaker, sr = S.r * width, sy = Y(S.u), sz = Z(S.v);
  b.disc([front - 5, sy, sz], 0, -1, sr + 22, 28, walnutLit);
  b.disc([front - 7, sy, sz], 0, -1, sr + 8, 28, dark);
  b.disc([front - 9, sy, sz], 0, -1, sr, 28, [0.52, 0.40, 0.16]);
  // the louvres: three vertical grooves low on each flank of the face
  for (const u of R.louvres.us) for (const uu of [u, 1 - u]) {
    const y = Y(uu), lw = R.louvres.w * width;
    b.quad([front - 3, y - lw / 2, base + 20], [front - 3, y + lw / 2, base + 20], [front - 3, y + lw / 2, Z(R.louvres.v0)], [front - 3, y - lw / 2, Z(R.louvres.v0)], dark, [-1, 0, 0]);
  }
}

/**
 * A settee, drawn as the room's owner would describe it. Nothing calls this
 * now — both the sofa and the armchair are imported meshes, see
 * `upholstered` — and it is kept because it is the room's own account of
 * what those two pieces are, and because putting either of them back is a
 * one-line change.
 *
 * Seen from the front seen from the front
 * the arms are a `q` and a `p` — a fat round bulb over a straight stem on the
 * inside, the bulb overhanging the outside — and the back between them is a
 * capital `D` laid on its flat side, one arch from arm to arm. The bulbs are
 * cylinders running front to back, capped flat, so they read as circles from
 * the front and as scrolls from the side; the arch is a panel whose top follows
 * a half-ellipse with a roll along it; the seat is cushions with rounded fronts
 * on a base with a skirt.
 */
function settee(b: Builder, S: Settee): void {
  const P = FURNITURE_PAINT;
  b.place({ cx: S.cx, cy: S.cy, yaw: S.yaw });
  b.material("moquette", MATERIALS.moquette.scale);
  const back = S.cx + S.depth / 2, front = S.cx - S.depth / 2;
  const y0 = S.cy - S.length / 2, y1 = S.cy + S.length / 2;
  const Ra = S.roll, stem = S.armWidth, SEG = 20;
  // the cushion is a plump one: this thick, its top at S.seat
  const seatTop = S.seat - 180;
  // the arms: the bulb's inner edge is tangent to the stem's inner face, so the
  // bulb overhangs the outside by its diameter less the stem
  const yiL = y0 + 2 * Ra, yiR = y1 - 2 * Ra;              // the inner faces
  const bulbZ = S.arm - Ra;
  for (const [yi, out] of [[yiL, -1], [yiR, 1]] as const) {
    const yc = yi + out * Ra;                                 // the bulb's centreline
    b.tube([front + 10, yc, bulbZ], [back - 10, yc, bulbZ], Ra, SEG, P.moquette);
    b.disc([front + 10, yc, bulbZ], 0, -1, Ra, SEG, P.moquette);
    b.disc([back - 10, yc, bulbZ], 0, 1, Ra, SEG, P.moquette);
    const s0 = Math.min(yi, yi + out * stem), s1 = Math.max(yi, yi + out * stem);
    b.box(front + 10, s0, 0, back - 10, s1, bulbZ, P.moquette);
  }
  // the back: an arch between the arms, its top a half-ellipse from the bulbs'
  // height to the crest, a roll along the top and the panel filled beneath
  const cy = (yiL + yiR) / 2, half = (yiR - yiL) / 2 + Ra * 0.6, rb = S.backDepth / 2;
  const crestZ = S.back - rb, footZ = bulbZ + Ra * 0.35;
  const arch = (y: number): number => { const t = Math.max(-1, Math.min(1, (y - cy) / half)); return footZ + (crestZ - footZ) * Math.sqrt(1 - t * t); };
  const N = 22, path: V3[] = [];
  const xb = back - rb;
  for (let i = 0; i <= N; i++) { const y = cy - half + (2 * half * i) / N; path.push([xb, y, arch(y)]); }
  b.sweep(path, rb, 14, P.moquette);
  for (let i = 0; i < N; i++) {
    const ys = path[i][1], yn = path[i + 1][1];
    for (const [x, nx] of [[xb - rb + 3, -1], [back - 3, 1]] as const) {
      b.quad([x, ys, seatTop - 200], [x, yn, seatTop - 200], [x, yn, arch(yn)], [x, ys, arch(ys)], P.moquette, [nx, 0, 0]);
    }
  }
  b.box(xb - rb + 3, cy - half, seatTop - 200, back - 3, cy + half, footZ, P.moquette);
  // the base, its skirt, and the cushions with rolled fronts
  b.box(front + 40, yiL - 10, 0, xb, yiR + 10, seatTop - 200, P.skirt);
  b.box(front + 40, yiL - 10, seatTop - 200, xb, yiR + 10, seatTop, P.moquette);
  const gap = yiR - yiL > 1500 ? 14 : 0, mid = (yiL + yiR) / 2;
  for (const [qa, qb] of (gap ? [[yiL, mid - gap], [mid + gap, yiR]] : [[yiL, yiR]]) as [number, number][]) {
    b.box(front + 100, qa, seatTop, xb - rb, qb, S.seat, P.cushion);
    b.tube([front + 100, qa + 40, S.seat - 90], [front + 100, qb - 40, S.seat - 90], 90, 12, P.cushion);
    b.sphere([front + 100, qa + 40, S.seat - 90], 90, 12, P.cushion);
    b.sphere([front + 100, qb - 40, S.seat - 90], 90, 12, P.cushion);
  }
  b.material(null);
  b.place(null);
}

/**
 * The cover of the book, laid over it straight down.
 *
 * The book is its own island in the armchair's mesh, so it is its own part and
 * can wear its own texture — `bedsit-futility.png`, rectified off `bedobit.mov`
 * by `taoot/tools/bedsitobit.ts`. The chart is a plan view of the book's own
 * box, in the chair's untransformed frame, which is the frame `Builder.mesh`
 * asks a chart in: the yaw is applied after the texture coordinates are taken.
 *
 * The book's long side runs along the chair's depth and the picture's long side
 * is its height, so `u` reads the room's y and `v` reads its x. The edges and
 * the underside take the cover's border smeared down them, which at two
 * centimetres thick is the right amount of wrong.
 */
/**
 * The book on the armchair: `Futility`, or the Wreck of the Titan.
 *
 * It came in with the armchair as an imported mesh and went back out again. A
 * closed book is a rectangular block — that is the whole of its shape — and the
 * generated one was a block with a wobble in every face, which on something 630
 * long put a visible kink down the cover the rectified cover art then had to lie
 * across.
 *
 * It is also smaller than the one it replaces, which was 631 by 499 by 36 — 407
 * by 322 millimetres, a folio, on the seat of a chair. This is 300 by 240 by 38,
 * which is 194 by 155 by 25: a small hardback, which is what an 1898 novella is.
 * It keeps the old block's centre, so it sits where that one sat.
 *
 * The 300 by 240 is not a round number chosen for its roundness. The rectified
 * cover `taoot/tools/bedsitobit.ts` cuts is 320 by 400 pixels, and the chart
 * lays that over the block's y across its x — so 240 by 300 is 0.8, the
 * picture's own ratio, and the cover goes on without being stretched either
 * way.
 *
 * Where it sits was measured off the settee's own mesh rather than inherited.
 * Its upward-facing triangles at seat height make two cushions — one about
 * (-43, -619) and one about (-36, 547) — and the book is on the second of them.
 * That settles where it sits ACROSS the seat. Along it, the settee's depth runs
 * on x, and the back is the end the tall geometry is at: every vertex above
 * 1,150 lies between x 110 and 550, so the front of the cushion is the other
 * way. The book is put at -470 to -170, which is a hand's reach in from that
 * front edge — where a book gets put down, rather than propped against the back
 * where the cushion is already rising.
 *
 * It rests at 918, and the seat it rests on was measured again when the chair
 * was replaced. The new cushion is not flat: along the book's line it comes up
 * from 878 at y 430 to a crown of 923 at y 580 and back down to 899 by y 730.
 * So the book was slid to 460..700, the flattest 240 there is, where the seat
 * runs 906 to 923 — and it is set six units UNDER that crown rather than on top
 * of it, because a book left on a feather cushion sinks into it, and a flat
 * block resting on the one high point floats at all four corners.
 */
const FUTILITY = {
  lo: [-470.0, 460.0, 918.0] as const,
  hi: [-170.0, 700.0, 956.0] as const,
} as const;

function futilityChart(S: Settee): Chart {
  const [lx, ly] = FUTILITY.lo, [hx, hy] = FUTILITY.hi;
  return {
    id: "futility",
    u0: S.cy + ly, u1: S.cy + hy,
    v0: S.cx + lx, v1: S.cx + hx,
    at: (u, v) => [v, u, FUTILITY.hi[2]],
    normalAt: () => [0, 0, 1],
    uvOf: (p) => [p[1], p[0]],
  };
}

/**
 * The sofa and the armchair, which are not drawn here. Each is a mesh generated
 * from the game's own best view of it — `Scene1/View35` for the sofa, the one
 * standpoint whose eye is far enough back that the whole two-seater falls
 * inside the frame, and `Scene3/View25` for the chair, which is the same
 * problem solved by the same means — and baked into a module beside this one by
 * `taoot/tools/bedsitglb.ts`.
 *
 * They arrived with nothing but positions: no normals, no texture coordinates,
 * no material. That suits the room. `Builder.mesh` averages the normals and
 * box-maps the moquette over them out of the tile the frames give, so the two
 * imported pieces are cut from the same cloth as each other and as everything
 * else the room upholsters.
 *
 * Each comes in two modules, not one, because an upholstered chair is not
 * upholstered all the way down: it stands on four turned wooden feet, and a
 * single mesh in a single material put moquette on them. The feet are separate
 * ISLANDS in the generated buffer — nothing on either piece touches them — and
 * they are also the only islands lying on the floor, so `bedsitglb.ts --band`
 * cuts them out by height and nobody has to name a triangle:
 *
 *     bedsitglb.ts <sofa.glb>  sofa  3050 1150 1750 \
 *         --band sofafeet 0 200 --band sofa 200 2000
 *     bedsitglb.ts <chair.glb> armchair 1720 1100 1580 --drop 1 \
 *         --band armchairfeet 0 200 --band armchair 200 2000
 *
 * 200 is a wide gate for feet that top out at 163 and 141, and it is wide on
 * purpose: the next island up the sofa is a stretcher rail whose middle sits at
 * 278, so there is a clear hundred units of nothing to put the line in. The
 * chair's `--drop 1` is the book, which came in lying on the seat and is drawn
 * by {@link futility} instead.
 *
 * The measurements stay ours. Each mesh is stretched into the box the frames
 * give it, because a generated model's proportions are a guess and a measured
 * room's are not — the chair's model is a quarter deeper than the chair, and
 * this is where that is taken out of it.
 */
/**
 * The book on the armchair's arm, on the closed-book model.
 *
 * It was a slab: a quad for the cover, four for the block and one underneath.
 * What replaces it is a real hardback — boards that overhang the block on three
 * sides, a rounded spine, and the turn-in where the leather goes over the
 * board's edge — in 84 triangles, which is seven more than the slab was.
 *
 * THE COVER IS STILL THE CHART'S. The imported case came with texture
 * coordinates for a tiling leather, which say nothing about where a title goes,
 * so the front board is drawn inside {@link futilityChart} exactly as the quad
 * was: the chart projects a point on the cover to a texel by its x and y, and
 * the board's slight roll-off at the spine projects with it. Nothing about the
 * plate changed.
 *
 * Built through `mesh` and not `quad`, which matters here and nowhere else.
 * Both take a chart, but `quad` reads the chart AFTER the turn `place` puts on
 * the piece and `mesh` reads it before — and this chart is written in the
 * settee's own unturned frame. Drawn as quads, the cover's texture coordinates
 * come out of a rotated corner, land off the tile, and the cover disappears.
 *
 * The mesh is baked centred on x and y with its foot at z 0, so the offset is
 * the middle of {@link FUTILITY}'s box and not the settee's own origin.
 */
function futility(b: Builder, S: Settee): void {
  const P = FURNITURE_PAINT;
  const [x0, y0, z0] = FUTILITY.lo, [x1, y1] = FUTILITY.hi;
  b.place({ cx: S.cx, cy: S.cy, yaw: S.yaw });
  const at: V3 = [S.cx + (x0 + x1) / 2, S.cy + (y0 + y1) / 2, z0];
  b.on(futilityChart(S));
  b.mesh(FUTILITYCOVER_POSITION, FUTILITYCOVER_INDICES, at, PAINT.futility, 0, true);
  b.on(null);
  // the back board, the spine and the turn-ins, and the block inside them
  b.mesh(FUTILITYBOARDS_POSITION, FUTILITYBOARDS_INDICES, at, P.boards, 0, true);
  b.mesh(FUTILITYPAGES_POSITION, FUTILITYPAGES_INDICES, at, P.pages, 0, true);
  b.place(null);
}

function upholstered(b: Builder, S: Settee, position: Float32Array, index: Uint16Array,
  feet: Float32Array, feetIndex: Uint16Array): void {
  const at: V3 = [S.cx, S.cy, 0];
  b.place({ cx: S.cx, cy: S.cy, yaw: S.yaw });
  b.material("moquette", MATERIALS.moquette.scale);
  b.mesh(position, index, at, FURNITURE_PAINT.moquette);
  // the feet are wood, so they come out from under the moquette before it is
  // laid: no material, and a stain of their own
  b.material(null);
  b.mesh(feet, feetIndex, at, FURNITURE_PAINT.setteeFeet);
  b.place(null);
}

/**
 * The hall stand, drawn to a rule.
 *
 * The shape is the one a generated model brought here and the frames confirm:
 * four legs bowing out, four arms bound to the pole halfway up, each one rod
 * that curls under into a hook below and sweeps up into a ball-tipped peg
 * above, and a turned finial over the lot. What the generated model could not
 * give was a straight line or a true circle — its bends drifted five to ten
 * units across a curve and its four arms were four different curves that only
 * looked alike — so the shape was measured off it and drawn again from the
 * measurements. Those, in millimetres, s being the distance out from the pole:
 *
 *     leg    z  380  280  240  200  160  120   80   40   20    0
 *            s   18   18   21   28   37   54   83  139  168  208
 *     arm    s 14 at z 1566, where the rod touches the pole and runs vertical
 *            s 92 at z 1479, the bight's bottom
 *            s 184 at z 1556, the hook's tip
 *            s 175 at z 1856, the ball's centre, radius 19
 *     pole   r 12.1 at z 302, 12.0 at 599, 10.6 at 1016, 9.3 at 1815 — one
 *            straight taper, and the wobble round it was the generator's
 *
 * Four anchors and a tangent are enough to pin the arm's oval, and the leg's
 * arc is the one that holds every reading above z 20 to within four; the
 * readings below that are the old model's tapered-to-nothing toe rather than a
 * centre line, so the toe here rests on a rounded end instead.
 *
 * Bentwood is a rod of ONE section bent to ONE curve, so every member here is a
 * curve in its own vertical plane rather than a chain of segments. A leg is a
 * straight run down the pole and one arc of 289.5 through 70 degrees. An arm is
 * one OVAL — 208 by 97, tilted 65 degrees up and out — of which the rod is
 * about five eighths, entering at the pole where the oval runs vertical,
 * bighting under it into the hook and coming round above it into the peg, with
 * the mouth left open between the hook's tip and the ball. A curve named by its
 * radii cannot come out lopsided, and four members off one curve cannot differ
 * — which is the whole of why it was rebuilt rather than smoothed.
 *
 * The oval is the second answer. The first fitted the hook and the peg as two
 * separate arcs through the same anchors, and the peg's arc missed the ball by
 * fifty units, so the rod had to be crooked sharply back up to reach it — an
 * artefact of the fit that read as a kink. On the oval the rod arrives at the
 * ball already travelling outward, 23 degrees above the horizontal, and the
 * ball goes ON that line instead of standing up off the end of it.
 *
 *     bedsitglb.ts <hallstand.glb> hallstand 1 1 1 --exact 1549.375
 *     bedsitglb.ts <hallstandpole.glb> hallstandpole 1 1 1 --exact 1549.375
 *
 * `--exact` and not a fit: the walk is written in the room's own geometry at
 * metre scale, so where its vertices landed IS the answer and a bounding box
 * would only throw it away. It still stands on the diagonals — on the axes one
 * leg would go {@link HALL_STAND.reach} straight at the plaster 290 away and
 * through it, and across the turn the same reach puts a toe 234 out in x and
 * 234 in y, which clears both walls.
 *
 * Two modules because it is two colours, and the split is by object rather than
 * by island: the legs and arms go to one file, the shaft and its finial to the
 * other.
 */
function hallStand(b: Builder): void {
  const H = HALL_STAND, at: V3 = [H.x, H.y, 0];
  b.material(null);
  b.mesh(HALLSTAND_POSITION, HALLSTAND_INDICES, at, FURNITURE_PAINT.standWood);
  b.mesh(HALLSTANDPOLE_POSITION, HALLSTANDPOLE_INDICES, at, FURNITURE_PAINT.standPole);
}

/**
 * The standard lamp beside the armchair, turned to a profile.
 *
 * It arrived generated, and its fault was the hall stand's: the right shape,
 * made the wrong way. Read ring by ring, the circles it is built of are out of
 * round by up to 34 units on a 290-unit foot, and their centres wander up to 60
 * off the axis the rest of the lamp stands on. Everything the eye saw wrong —
 * a pole that waggles, a lumpy foot, a lopsided knop, ridges down the shade —
 * is that one fault, which is that a lathe was SIMULATED rather than used.
 *
 * So the profile was measured off it in 4-unit bands, which at that resolution
 * separates the shape from the shake, and then spun. A lathe cannot make an
 * out-of-round ring or an off-axis one. In millimetres of the piece's own frame,
 * radius at height, as measured by `scratchpad/lampturn.py`:
 *
 *     foot    0:187  26:157  46:131  62:101  70:81  86:34  114:20  186:10
 *     shaft   straight at 10, all the way to 814
 *     knops   838:18  871:50 (bead)  898:40 (cove)  926:62 (the big bead)
 *             966:36 (cove)  976:45 (astragal)  1018:24  1122:10
 *     shaft   straight at 10, to 1574
 *     vase    1595:34  1634:68 (crest)  1667:36  1700:12
 *     finial  1722:19  1742:25 (crest)  1766:16  1781:0
 *     shade   a plain cone, 334 at 1631 to 64 at 1923, and nothing between —
 *             so nothing between is what it gets
 *
 * The control points are joined by a Catmull-Rom through every one of them, not
 * by straight lines: a bead read at four heights is still a bead, and joining
 * those four with chords gives a faceted lump. The two straight shafts are the
 * GAPS between the elements, each one quad-strip end to end — a pole that reads
 * 10.2 at one end and 10.0 at the other is a pole of 10, and rings along it are
 * only places for the wobble to come back.
 *
 *     bedsitglb.ts <standlamp.glb> standlamp 1 1 1 --exact 1549.375
 *     bedsitglb.ts <lampshade.glb> lampshade 1 1 1 --exact 1549.375
 *
 * Two modules, and the split is NOT by colour: the shade is parchment with the
 * bulb behind it, so it is the light and is drawn unlit — its own pixels reach
 * the screen — where the brass is lit like everything else. They could not share
 * a mesh whatever they were painted.
 */
function standardLamp(b: Builder): void {
  const L = STANDARD_LAMP;
  const at: V3 = [L.x, L.y, 0];
  b.mesh(STANDLAMP_POSITION, STANDLAMP_INDICES, at, PAINT.brass);
  b.mesh(LAMPSHADE_POSITION, LAMPSHADE_INDICES, at, PAINT.glass, EMIT.standard);
}

function drawnStandardLamp(b: Builder): void {
  const L = STANDARD_LAMP, brass = PAINT.brass;
  b.lathe(L.x, L.y, [[L.foot, 0], [L.foot, 30], [L.foot * 0.6, 60], [L.pole * 2, 90], [L.pole, 120]], 24, brass);
  b.lathe(L.x, L.y, [[L.pole, 120], [L.pole, L.knop - 60], [L.pole * 2.4, L.knop - 20], [L.pole * 2.4, L.knop + 20], [L.pole, L.knop + 60], [L.pole, L.shade.z1 + 40]], 12, brass);
  // the shade: a cone of parchment, its own light
  b.lathe(L.x, L.y, [[L.shade.r0, L.shade.z0], [L.shade.r1, L.shade.z1]], 32, PAINT.glass, EMIT.standard);
  b.lathe(L.x, L.y, [[L.shade.r1, L.shade.z1], [L.pole * 1.5, L.shade.z1 + 10]], 16, brass);
}

/**
 * The chimneypiece and its hearth, imported.
 *
 * It stands against the fireplace wall, so unlike everything else here it is
 * turned a quarter: the mesh is built with its back towards +x and this wall
 * faces -y, which is a yaw of -90 degrees. Its length then runs along the room's
 * x, which is how the frames measure it — `Scene3/View20` puts the shelf's ends
 * on 5,900 and 8,570 and its top on 2,200.
 *
 * Its parts do not separate by height the way the cupboard's did, so they are
 * separated by where they stand instead. The opening is `FIREPLACE.opening`,
 * 1,000 wide about x 7,340, which is 65 off this piece's own centre: every
 * island that falls inside that width and below the frieze is something
 * standing in the grate, and the one big thin panel spanning the full width
 * between the pilasters is the stone the opening is cut through.
 */
/**
 * The ship on the mantel: one mesh, wearing the skin she was ripped in.
 *
 * She replaces a model that had none. That one was 1,041,538 triangles in 3,634
 * loose shells with 1,192 portholes punched clean through the hull, and getting
 * it down to a mantel ornament meant welding it, sharing a budget out shell by
 * shell, voxel-remeshing everything holed, and then splitting the result into
 * six meshes so each could wear a flat paint — because the file had no UVs and
 * nothing could be hung on it. All of that is gone. THIS one is 127,342
 * triangles, welds to a POSITIVE Euler characteristic — few holes, and none
 * that matter — and every one of its vertices carries a texture coordinate. One
 * Collapse modifier hits any budget asked for, exactly, and the atlas comes
 * through the collapse with it: 29,999 in half a second.
 *
 * 8,000 was tried and is where it breaks: the masts are the thinnest thing on
 * her and go first, which leaves two red ensigns flying in mid-air over the
 * boat deck. The ceiling is near 36,000 — the module indexes its vertices as
 * Uint16, and a mesh cut this way carries about 1.6 vertices a triangle because
 * a UV seam splits every one it crosses, so 40,000 triangles would want more
 * than the 65,536 an index can name.
 *
 * THE LENGTH IS STRETCHED AND NOTHING ELSE IS. Her hull beam amidships is 26.70
 * and her mast trucks stand 60.31 over the keel; at Titanic's real 28.2 m beam
 * that is 0.947 units to the metre, which puts the trucks at 63.7 m — right for
 * masts standing about 29 m over a boat deck 30.5 m up. The same scale makes
 * her 211.6 m long, and she was 269.1. Two of the three agree with each other
 * AND with the ship, so the length is the one that is wrong, by 21%, and the
 * box fit stretches that one axis: `bedsitglb titanic2.glb titanic 1913 230 454`.
 *
 * That stretch is worth knowing about, because it is the one place this model
 * disagrees with the game's. Hers reads 0.085 of hull depth to length off
 * `View14`; ours reads 0.065, because the stretch made her a third more slender
 * than the ship the game put on this shelf. The size was checked against the
 * frame and settled; the slenderness was not, and dropping the stretch would
 * trade a correct Olympic for a closer match to what BEDSIT1 draws.
 *
 * The atlas carries what no geometry at this size could: the gold sheer stripe
 * over the black, the red boot topping under it, teak laid along the boat deck,
 * and TITANIC · LIVERPOOL lettered across the counter at about three quarters of
 * a millimetre tall, which nobody will ever read and which is there.
 */
/**
 * The Memories album: five quads and a cut of the frame on the front one.
 *
 * The cover is the first surface in the room to wear a picture WITHOUT a chart
 * behind it. A chart belongs to a wall — it knows how to turn a point on the
 * plaster into a texel, and the baker fills it from every view that can see it.
 * This is a thing standing on a shelf at seven degrees to everything, seen from
 * one frame, and all it needs is for its four corners to name the four corners
 * of one picture. `Builder.quad`'s last argument does that.
 */
function memoriesAlbum(b: Builder): void {
  const P = FURNITURE_PAINT, A = ALBUM;
  // Baked standing and already leaning, so nothing here turns it. `place` only
  // rotates about the vertical, and standing a book up is a quarter turn about
  // the horizontal — which is why the lean is in the mesh and not in the room.
  //
  // Its anchor is the corner it stands on: x centred, the back-most point at
  // y 0 and the lowest at z 0. That corner is the back of its foot, so the
  // offset is where the head meets the plaster and the shelf it rests on, and
  // the 549 of height and 246 of depth the bake reports are exactly what 539 of
  // board at 15 degrees with 110 of thickness come to.
  const at: V3 = [(A.x0 + A.x1) / 2, A.head, A.top];
  b.material("album", MATERIALS.album.scale);
  b.mesh(MEMORIESCOVER_POSITION, MEMORIESCOVER_INDICES, at, P.albumBoards, 0, true, MEMORIESCOVER_UV);
  b.material(null);
  b.mesh(MEMORIESBOARDS_POSITION, MEMORIESBOARDS_INDICES, at, P.albumBoards, 0, true);
  b.mesh(MEMORIESPAGES_POSITION, MEMORIESPAGES_INDICES, at, P.albumPages, 0, true);
}

function shipModel(b: Builder): void {
  const P = FURNITURE_PAINT, S = SHIP, T = S.stand;
  const keel = S.top + T.thick;
  b.place({ cx: S.cx, cy: S.cy, yaw: S.yaw });
  // The stand: a thin rim with a splayed dome over it, built in the turned frame
  // like the hull standing on it, so its long axis runs with hers.
  //
  // `View14` draws it as a convex silhouette, not a straight taper, so the sides
  // are cut in two — a wide flare off the rim and a narrower one above it, which
  // is as much of a dome as a thing 40 pixels across from the middle of the room
  // can show.
  b.box(S.cx - T.footDepth / 2, S.cy - T.foot / 2, S.top,
        S.cx + T.footDepth / 2, S.cy + T.foot / 2, S.top + T.rim, P.shipStand);
  const at = (k: number, dx: number, dy: number): V3 => {
    // k runs 0 at the rim to 1 at the head; the waist is pulled out towards the
    // foot so the profile bulges instead of running straight
    const t = Math.sin((k * Math.PI) / 2);
    const len = T.foot + (T.head - T.foot) * t, dep = T.footDepth + (T.headDepth - T.footDepth) * t;
    return [S.cx + (dx * dep) / 2, S.cy + (dy * len) / 2, S.top + T.rim + (T.thick - T.rim) * k];
  };
  for (let i = 0; i < 2; i++) {
    const k0 = i / 2, k1 = (i + 1) / 2;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const [ax, ay] = dx ? [dx, -1] : [-1, dy];
      const [bx, by] = dx ? [dx, 1] : [1, dy];
      b.quad(at(k0, ax, ay), at(k0, bx, by), at(k1, bx, by), at(k1, ax, ay), P.shipStand, [dx, dy, 0]);
    }
  }
  const head = (dx: number, dy: number): V3 => at(1, dx, dy);
  b.quad(head(-1, -1), head(1, -1), head(1, 1), head(-1, 1), P.shipStand, [0, 0, 1]);
  // `scale` is not read: the seventh argument hands `mesh` the file's own
  // coordinates, and a mesh that brings those is not box-mapped
  b.material("titanic", MATERIALS.titanic.scale);
  b.mesh(SHIP_POSITION, SHIP_INDICES, [S.cx, S.cy, keel], P.ship, 0, false, SHIP_UV);
  b.material(null);
  b.place(null);
}

function chimneypiece(b: Builder): void {
  const P = FURNITURE_PAINT, F = FIREPLACE;
  const cx = (F.hearth.x0 + F.hearth.x1) / 2, cy = ROOM.y0 + F.hearth.depth / 2;
  const at: V3 = [cx, cy, 0];
  // Set into the wall, by the 275 that used to stand between the back of the
  // slips and the plaster. The chimneypiece was modelled standing off the wall
  // — its shelf reaches back to 2,600 but its pilasters stop at 2,719 — and
  // once the wall behind it was cut open that 119 stopped being a place nobody
  // could see into and became a gap you could look down the side of. There is
  // nothing behind this wall, so the piece is simply pushed through it until
  // the slips sit against the plaster; the shelf, the frieze and the capitals
  // go into the wall with it and are none the worse for it.
  //
  // The hearth stone does NOT go with them. Its front edge at 3,566 is measured
  // off `Scene3/View20`, not inherited from the model, so it keeps its own place
  // and is built in a second turn of its own.
  const set = 275, back: V3 = [cx, cy - 275, 0];
  b.place({ cx, cy: cy - set, yaw: -Math.PI / 2 });
  // the joinery: two pilasters, their capitals, the frieze and the shelf
  b.material("mahogany", MATERIALS.mahogany.scale);
  b.mesh(FIREPLACE_POSITION, FIREPLACE_INDICES, back, P.chimneyWood, 0, true);
  b.material(null);
  // and what stands in the opening: a log grate and the logs burnt down on it.
  // The model's bed of ash came with them and is left out — it is a flat plate
  // across the whole footprint, and a flat plate is what a fire never has under
  // it. Nine hundred and fifty wide inside an opening of 1,220, standing on the
  // stone at 195.8, and reaching from 2,020 to 2,702 — inside the chimney, not
  // out on the hearth in front of it.
  //
  // This work is based on "Animated fire"
  // (https://sketchfab.com/3d-models/animated-fire-ebb16a3df22247dd990a04585de64741)
  // by Yannick Deharo (https://sketchfab.com/YannickDeharo) licensed under
  // CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Its sixty-four
  // flame cards are left behind: nothing here is animated, and they are the
  // whole of its cost.
  b.mesh(FIREGRATE_POSITION, FIREGRATE_INDICES, back, P.iron);
  b.mesh(FIRELOGS_POSITION, FIRELOGS_INDICES, back, P.log);
  b.place(null);
  // and the stone the whole thing stands out of, in its own turn because it did
  // not move. `Scene3/View20` is the only frame that sees the foot of the
  // fireplace, and two of this slab's edges survive in it: its left end where it
  // meets the boards, at x 5,800, and the front of its top face at y 3,566. Both
  // were fitted across sixty columns — the camera is six degrees off square to
  // this wall, so those edges slope through the frame, and reading them at one
  // row would read a slope as a level. The top came out at 160 give or take 25,
  // and is put at 196, which is inside that and is exactly where the slips'
  // lowest joint falls.
  b.place({ cx, cy, yaw: -Math.PI / 2 });
  b.mesh(FIREHEARTH_POSITION, FIREHEARTH_INDICES, at, P.hearth, 0, true);
  b.place(null);
  slips(b);
  chimney(b);
}

/**
 * The slips: the stone panel the fire opening is cut through.
 *
 * Thirteen square plates of 406.8 — five courses to a leg, five across the top
 * with the corner plates counted in both — laid on a backing slab that stands 18
 * behind their faces. The plates are cut 16 short of each other, so what falls
 * between any two of them is a groove down to that backing, and the backing is
 * near-black: the joint is a line because it is a hole, and it is dark because
 * what is at the bottom of it is dark. There is no shadowing in this room, so a
 * groove of stone-coloured stone in stone-coloured stone would read as nothing
 * at all.
 *
 * The panel comes off `CHIMNEY` rather than the other way round: a leg is one
 * plate wide, the opening is three, and a course is one plate high, so the hole
 * in the middle of it IS the hole in the wall and the two cannot drift apart.
 * The lowest course runs 211 under the floorboards, where the hearth stone
 * covers it — a whole plate that happens to be half buried, rather than a plate
 * cut to fit.
 *
 * It was an imported mesh until the joints wanted their own colour. Rebuilding
 * sixteen axis-aligned boxes from the numbers costs the same 192 triangles as
 * baking them did, and the numbers are all here.
 */
function slips(b: Builder): void {
  const P = FURNITURE_PAINT, C = CHIMNEY;
  const s = (C.x1 - C.x0) / 3;                            // the opening is three plates wide
  const y0 = C.mouth, y1 = C.mouth + 53, back = y0 + 35; // 53 of stone, the joint 18 deep
  const x0 = C.x0 - s, top = C.head + s, foot = top - 5 * s;
  const j = 8;                                            // half a joint, off every side
  // the backing: one slab behind each leg and one behind the lintel
  for (const [c0, r0, cols, rows] of [[0, 0, 1, 5], [4, 0, 1, 5], [1, 4, 3, 1]] as const) {
    b.box(x0 + c0 * s, y0, foot + r0 * s, x0 + (c0 + cols) * s, back, foot + (r0 + rows) * s, P.slipsJoint);
  }
  // and the plates over it
  for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
    if (col !== 0 && col !== 4 && row !== 4) continue;    // the opening
    const x = x0 + col * s, z = foot + row * s;
    b.box(x + j, y0, z + j, x + s - j, y1, z + s - j, P.slips);
  }
}

/**
 * The chimney behind the opening.
 *
 * Not an illusion of one any more: the fireplace wall is genuinely cut here —
 * `CHIMNEY` in `bedsit-room.ts` takes the strip of plaster out — and this is the
 * recess that goes back into the hole. Six hundred deep, which is a real chimney
 * breast, and lined with the same London stocks the wall shows wherever its
 * plaster has come away, under enough soot to read as a flue and not as a hole
 * into a brick shed.
 *
 * It is wider and taller than the fire opening at every edge, so what closes the
 * picture is the surround and never the recess's own corners. It needs no bottom
 * edge either: the hearth stone runs the full width of the fireplace from the
 * boards up to 196, which is exactly where this floor starts.
 */
function chimney(b: Builder): void {
  const P = FURNITURE_PAINT, C = CHIMNEY;
  const front = C.mouth, back = ROOM.y0 - C.depth;
  b.material("brick", MATERIALS.brick.scale);
  // the back of the flue, and its two cheeks
  b.quad([C.x0, back, C.floor], [C.x1, back, C.floor], [C.x1, back, C.head], [C.x0, back, C.head], P.soot, [0, 1, 0]);
  b.quad([C.x0, back, C.floor], [C.x0, front, C.floor], [C.x0, front, C.head], [C.x0, back, C.head], P.soot, [1, 0, 0]);
  b.quad([C.x1, back, C.floor], [C.x1, front, C.floor], [C.x1, front, C.head], [C.x1, back, C.head], P.soot, [-1, 0, 0]);
  // the floor it stands on, which stops at the wall: from there forward the
  // hearth stone's own top is at this very height, and two faces in one plane
  // fight
  b.quad([C.x0, back, C.floor], [C.x1, back, C.floor], [C.x1, ROOM.y0, C.floor], [C.x0, ROOM.y0, C.floor], P.soot, [0, 0, 1]);
  b.material(null);
  // and the lid, which is soot and not brick: it is the only face the eye at
  // 2,479 cannot see, looking down as it does into a head at 1,416
  b.quad([C.x0, back, C.head], [C.x1, back, C.head], [C.x1, front, C.head], [C.x0, front, C.head], P.soot, [0, 0, -1]);
}

function drawnFireplace(b: Builder): void {
  const P = FURNITURE_PAINT, F = FIREPLACE, wall = ROOM.y0;
  const face = wall + F.proud, shelfBottom = F.mantel - F.shelf;
  b.material("stain", MATERIALS.stain.scale);
  // the pilasters, the frieze between them, and the shelf over all of it
  b.box(F.x0, wall, 0, F.x0 + F.pilaster, face, shelfBottom, P.surround);
  b.box(F.x1 - F.pilaster, wall, 0, F.x1, face, shelfBottom, P.surround);
  b.box(F.x0, wall, shelfBottom - F.frieze, F.x1, face, shelfBottom, P.surround);
  b.box(F.x0 - F.overhang, wall, shelfBottom, F.x1 + F.overhang, face + F.overhang, F.mantel, P.surround);
  b.box(F.x0 - 40, wall, shelfBottom - 50, F.x1 + 40, face + 40, shelfBottom, P.surround);
  // the tiled inner surround: a panel set back behind the pilasters, down each
  // side of the opening and over it
  b.material(null);
  const tileY = face - 70, o = F.opening;
  const xa = F.x0 + F.pilaster, xb = F.x1 - F.pilaster;
  b.quad([xa, tileY, 0], [o.x0, tileY, 0], [o.x0, tileY, shelfBottom - F.frieze], [xa, tileY, shelfBottom - F.frieze], P.tile, [0, 1, 0]);
  b.quad([o.x1, tileY, 0], [xb, tileY, 0], [xb, tileY, shelfBottom - F.frieze], [o.x1, tileY, shelfBottom - F.frieze], P.tile, [0, 1, 0]);
  b.quad([o.x0, tileY, o.top], [o.x1, tileY, o.top], [o.x1, tileY, shelfBottom - F.frieze], [o.x0, tileY, shelfBottom - F.frieze], P.tile, [0, 1, 0]);
  // the opening: soot-black back and cheeks, a hand inside
  const backY = wall + 30;
  b.quad([o.x0, backY, 0], [o.x1, backY, 0], [o.x1, backY, o.top], [o.x0, backY, o.top], P.soot, [0, 1, 0]);
  b.quad([o.x0, backY, 0], [o.x0, tileY, 0], [o.x0, tileY, o.top], [o.x0, backY, o.top], P.soot, [1, 0, 0]);
  b.quad([o.x1, backY, 0], [o.x1, tileY, 0], [o.x1, tileY, o.top], [o.x1, backY, o.top], P.soot, [-1, 0, 0]);
  b.quad([o.x0, backY, o.top], [o.x1, backY, o.top], [o.x1, tileY, o.top], [o.x0, tileY, o.top], P.soot, [0, 0, -1]);
  // the grate: a fire basket of iron bars on two feet, ash below
  const gy = wall + 160, gx0 = o.x0 + 120, gx1 = o.x1 - 120;
  for (const z of [260, 380, 500]) b.tube([gx0, gy, z], [gx1, gy, z], 12, 8, P.grate);
  for (const x of [gx0, gx1]) { b.tube([x, gy, 60], [x, gy, 560], 16, 8, P.grate); b.tube([x, gy, 560], [x, wall + 60, 560], 12, 8, P.grate); }
  b.box(gx0, wall + 40, 60, gx1, gy + 20, 90, [0.30, 0.29, 0.27]);
  // the hearth slab, out into the room
  b.box(F.hearth.x0, wall, 0, F.hearth.x1, wall + F.proud + F.hearth.depth, F.hearth.thick, P.hearth);
}

/**
 * The desk, imported.
 *
 * It was drawn before this, and the drawing is kept below as `drawnDesk`. What
 * replaces it was built against the game's own scan in Blender, part by part,
 * and it differs from the drawing in the places the drawing had to guess:
 *
 *  - a drawer front is the RECTANGLE the eye can see and nothing wider. The
 *    drawing gave each pedestal a full-width front with a sunk panel inside it,
 *    which reads as a drawer with a moulding on it — a different object, and
 *    one that looks smaller than the part actually is.
 *  - the middle drawer has no moulding at all. It is one flat plane, held by an
 *    8mm RECESS behind the kneehole's cheeks rather than by any line drawn on it.
 *  - the top's edge is a bevel over most of its 16mm, not a square slab with a
 *    lip: it falls 6.5mm forward from the top surface to its widest line and
 *    tucks back under. That is why the edge catches the lamp as a band.
 *  - and the top is NOTCHED over the middle drawer, following the carcase back
 *    the 67mm it steps between the pedestals.
 *
 * It comes in two modules because it is two materials, and the pulls are five
 * separate islands in the file, so which triangles are brass is not a guess:
 *
 *     bedsitglb.ts <desk.glb> desk 2580 1110 1400 --flip \
 *         --detach 23,24,25,26,27 deskpulls
 *
 * The GLB is one JOINED mesh. The tool reads the first mesh node in a file and
 * stops — it is built for generators, which hand back one — so thirteen named
 * objects arrive as one object of thirteen, and the pulls are picked out of it
 * by island. Their ranks were read off `--list`: islands 24..27 are the four at
 * x -555..-529, which is the front, and 23 is the middle drawer's, alone at
 * y -51..84.
 */
function desk(b: Builder): void {
  const P = FURNITURE_PAINT, D = DESK;
  const back = ROOM.x0 + 40;
  const at: V3 = [back + D.depth / 2, (D.y0 + D.y1) / 2, 0];
  /**
   * TURNED END FOR END. `bedsitglb` bakes a piece with its back towards +x,
   * which is right for the counter and the cupboard because those stand against
   * ROOM.x1. This desk stands against ROOM.x0, so its back has to point the
   * other way, and a half turn about its own middle is what does it — `place`
   * carries the normals round with the positions, which is why this is a turn
   * and not a mesh baked mirrored.
   */
  b.place({ cx: at[0], cy: at[1], yaw: Math.PI });
  // the carcase, plinth, top and the five drawer fronts, all one wood
  b.material("deskwood", MATERIALS.deskwood.scale);
  b.mesh(DESK_POSITION, DESK_INDICES, at, P.desk, 0, true);
  // and the pulls, in the cupboard's brass — no material: a wood tile on a
  // handle 136 units long is one texel of grain and reads as dirt
  b.material(null);
  b.mesh(DESKPULLS_POSITION, DESKPULLS_INDICES, at, P.brass, 0, true);
  b.place(null);

  deskLamp(b);
  // and everything that stands on it. Two of the magazines now wear their own
  // covers off `bedcards.mov`; the rest are still the drawn stand-ins they
  // always were, waiting their turn at the same treatment.
  deskProps(b);
}

/**
 * The desk as it was drawn: a kneehole pedestal desk, with the drawers,
 * mouldings and plinth its front elevation shows.
 */
function drawnDesk(b: Builder): void {
  const P = FURNITURE_PAINT, D = DESK;
  const back = ROOM.x0 + 40, front = back + D.depth;
  const carcase = front - 30;          // the drawers stand proud of it
  // flat paint, not the wood tile the rest of the furniture wears: the tile's
  // grain is cut from a frame at its own scale and it reads as noise across
  // mouldings this small, which is what the drawers are made of
  b.material(null);

  // the top: a slab with a lip under its edge, so the edge reads as a moulding
  // rather than a cut, oversailing the carcase at the front and both ends
  const o = D.overhang;
  b.box(back, D.y0 - o, D.top - D.slab, front + o, D.y1 + o, D.top, P.deskTop);
  b.box(back, D.y0 - o + 14, D.top - D.slab - 22, front + o - 14, D.y1 + o - 14, D.top - D.slab, P.desk);

  // the frieze across the whole front, set back under the top's oversail
  b.box(back, D.y0, D.frieze, carcase, D.y1, D.top - D.slab - 22, P.desk);

  for (const [ya, yb] of [[D.y0, D.y0 + D.pedestal], [D.y1 - D.pedestal, D.y1]] as const) {
    // the carcase, then its two drawers standing proud of it, each with a sunk
    // panel and a handle at the middle of it
    b.box(back, ya, D.plinth, carcase, yb, D.frieze, P.desk);
    // the fronts do not fill the pedestal: a stile of carcase stands each side
    // of them and a rail between the two, which is what the frames show
    for (const [z0, z1] of [[D.plinth, D.seam], [D.seam, D.frieze]] as const) {
      drawer(b, carcase, ya + D.stile, z0 + D.rail, front, yb - D.stile, z1 - D.rail);
    }
    // the plinth: set back under the carcase, with a moulding over it that
    // stands proud again, so the foot of the pedestal has a shadow line
    b.box(back, ya - 4, 0, carcase - 26, yb + 4, D.plinth - 40, P.desk);
    b.box(back, ya - 12, D.plinth - 40, carcase - 4, yb + 12, D.plinth, P.drawer);
    const end = ya === D.y0 ? D.y0 - 11 : D.y1 + 11;
    b.quad(
      [back + 90, end, D.plinth + 80], [carcase - 90, end, D.plinth + 80],
      [carcase - 90, end, D.frieze - 80], [back + 90, end, D.frieze - 80],
      P.drawer, [0, ya === D.y0 ? -1 : 1, 0],
    );
  }

  // the kneehole: a long shallow drawer in the frieze over it, a modesty board
  // across the back of it, and the cheeks and roof of the opening — which take
  // no light from anywhere and are the black rectangle the frames show
  const ka = D.y0 + D.pedestal, kb = D.y1 - D.pedestal;
  // it fills the frieze and hangs a little below it, which is what a drawer
  // over a kneehole does — the pedestals' top drawers start at the same line
  drawer(b, carcase, ka + 30, D.kneeholeDrawer, front, kb - 30, D.top - D.slab - 14);
  b.box(back + 30, ka, 0, back + 60, kb, D.frieze, P.deskDark);
  b.quad([back + 60, ka, 0], [carcase, ka, 0], [carcase, ka, D.kneeholeDrawer], [back + 60, ka, D.kneeholeDrawer], P.deskDark, [0, 1, 0]);
  b.quad([back + 60, kb, 0], [carcase, kb, 0], [carcase, kb, D.kneeholeDrawer], [back + 60, kb, D.kneeholeDrawer], P.deskDark, [0, -1, 0]);
  b.quad([back + 60, ka, D.kneeholeDrawer], [carcase, ka, D.kneeholeDrawer], [carcase, kb, D.kneeholeDrawer], [back + 60, kb, D.kneeholeDrawer], P.deskDark, [0, 0, -1]);
}

/**
 * One drawer front: proud of the carcase, with a raised border round a sunk
 * panel and a handle at the middle of it.
 *
 * The border is four rails standing 16 in front of the panel rather than a line
 * drawn on a flat face — at this size the moulding is only visible because its
 * top and bottom edges catch the lamp differently, and a flat face has no edges
 * to catch it with.
 */
function drawer(b: Builder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const P = FURNITURE_PAINT;
  const lip = 16, m = Math.min(58, (z1 - z0) * 0.24);
  b.box(x0, y0, z0, x1 - lip, y1, z1, P.drawer);
  b.box(x1 - lip, y0, z0, x1, y1, z0 + m, P.drawer);
  b.box(x1 - lip, y0, z1 - m, x1, y1, z1, P.drawer);
  b.box(x1 - lip, y0, z0 + m, x1, y0 + m, z1 - m, P.drawer);
  b.box(x1 - lip, y1 - m, z0 + m, x1, y1, z1 - m, P.drawer);
  // a brass drop handle on its backplate, at the middle
  const cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, r = Math.min(70, (z1 - z0) * 0.3);
  b.box(x1 - 4, cy - r * 0.5, cz - 18, x1 + 10, cy + r * 0.5, cz + 18, PAINT.brass);
  const hoop: [number, number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const t = Math.PI * (i / 10);
    hoop.push([x1 + 9, cy + r * Math.cos(t), cz - r * 0.8 * Math.sin(t)]);
  }
  b.sweep(hoop, 7, 6, PAINT.brass);
}

/**
 * The desk lamp: a turned column on a stepped foot under two conical tiers of
 * shade with a pale cap over them. The underside is drawn unlit and warm — in
 * the frames it is the brightest thing in the room after the windows.
 */
function deskLamp(b: Builder): void {
  const P = FURNITURE_PAINT, L = DESK_LAMP;
  b.material(null);
  /**
   * The shade and its column, imported. It arrived already at the measured
   * shape, which is worth recording because it did not have to be: fitted to
   * the 810 x 810 x 818 the frames give this lamp, its brim lands at z 519
   * against `DESK_LAMP.brim.z` of 521 and its crown at 818 against 818.
   *
   * REBUILT AS A TURNING before it came here. What the generator handed over
   * was 4,327 triangles of a lathe-turned object that wobble slightly about an
   * axis they all share. Every vertex was folded onto one half-plane — which is
   * the front elevation, since the thing is a solid of revolution — the section
   * fitted there, and the whole lamp turned again from it at 24 segments. Both
   * shades take a circular ARC: a least-squares circle through the lower one's
   * whole section, all 608 points with none rejected, sits a mean of 0.0057
   * from them, on a lamp 0.93 tall. That is the size of the scan's own ring
   * wobble, so an arc is as good a description as the data supports — and it is
   * the only thing that carries the curve across the lower shade's long gap,
   * where the model has no vertices at all between radius 0.067 and 0.224 and a
   * polyline can only run dead straight.
   *
   * The column is NOT smoothed or fitted to anything: its collars are real
   * steps, and straightening them turns a turned stem into a dowel.
   *
   *     bedsitglb.ts <desklamp.glb> desklamp 810 810 818 --detach 3 desklampcap
   */
  b.mesh(DESKLAMP_POSITION, DESKLAMP_INDICES, [L.x, L.y, DESK.top], P.deskShade);
  /**
   * The crown, white and UNLIT. It is not a thing the room lights — it is where
   * the lamp's own light comes out at the top, which is how the game's close-up
   * shows it: a bright disc over a shade that is otherwise a silhouette. Lit
   * like the rest it would be the darkest part of the lamp, since it faces up
   * and away from every source in the room including this lamp's own.
   */
  b.mesh(DESKLAMPCAP_POSITION, DESKLAMPCAP_INDICES, [L.x, L.y, DESK.top], PAINT.bulb, EMIT.desk);
  // The bulb, unlit so it is light rather than a thing lit by it. This lamp is
  // the only light in that half of the room; what it THROWS is `uLampAt`, and
  // this is only the source seen up inside the shade.
  //
  // There was a glowing disc under the brim too, at 0.93 of the brim's radius.
  // It worked against the drawn shade, whose brim was near enough flat out to
  // its edge; the turned one curves in from the moment it leaves the widest
  // line, so a flat disc a little above that line stands PROUD of the shade and
  // read as a bright ring round the outside of it. A disc cannot sit inside a
  // curve. Gone rather than shrunk: the shade is open underneath now and the
  // bulb is visible up inside it, which is what the disc was standing in for.
  b.sphere([L.x, L.y, L.bulb], 52, 10, PAINT.bulb, EMIT.desk);
}

/** The lamp as it was drawn: lathed, a tier at a time. */
function drawnDeskLamp(b: Builder): void {
  const P = FURNITURE_PAINT, L = DESK_LAMP, z = DESK.top;
  b.material(null);
  // the foot: two steps and a cove up into the column
  b.lathe(L.x, L.y, [
    [L.foot, z], [L.foot, z + 26], [L.foot * 0.86, z + 40], [L.foot * 0.62, z + 62],
    [L.foot * 0.34, z + 96], [46, z + 150],
  ], 20, P.deskShade);
  // the column: a swelled stem up to the shade's throat
  b.lathe(L.x, L.y, [
    [46, z + 150], [58, z + 210], [44, z + 300], [40, z + 420], [52, L.brim.z - 40], [44, L.brim.z + 30],
  ], 16, P.deskShade);
  // the lower tier: the wide brim, rising to the waist
  b.lathe(L.x, L.y, [
    [L.brim.r, L.brim.z], [L.brim.r * 0.97, L.brim.z + 26], [L.brim.r * 0.62, L.brim.z + 76],
    [L.tier * 1.6, L.waist - 20], [L.tier * 1.45, L.waist],
  ], 24, P.deskShade);
  // the upper tier, and the pale cap over its crown
  b.lathe(L.x, L.y, [
    [L.tier, L.waist + 10], [L.tier * 0.92, L.waist + 34], [L.tier * 0.6, L.crown - 26], [L.tier * 0.42, L.crown],
  ], 24, P.deskShade);
  b.lathe(L.x, L.y, [
    [L.tier * 0.36, L.crown + 4], [L.tier * 0.40, L.crown + 26], [L.tier * 0.30, L.cap - 8], [0, L.cap],
  ], 20, P.deskCap);
  // what the shade throws: a glowing mouth under the brim, and the bulb in it
  b.disc([L.x, L.y, L.brim.z + 8], 2, -1, L.brim.r * 0.93, 24, PAINT.glow, EMIT.desk);
  b.sphere([L.x, L.y, L.bulb], 52, 10, PAINT.bulb, EMIT.desk);
}

/**
 * What stands on the desk: four photographs in their frames along the back, a
 * bottle at the far end, and the papers spread in the lamp's pool.
 */
function deskProps(b: Builder): void {
  const P = FURNITURE_PAINT, D = DESK_PROPS;
  b.material(null);
  for (const f of D.frames) plate(b, f.x, f.y, f.w, f.h, f.turn, f.oval, f.gilt, f.art as keyof typeof MATERIALS);

  // the bottle at the far end: dark glass, a shoulder, a neck, a foil cap
  const B = D.bottle;
  const at: V3 = [B.x, B.y, DESK.top];
  // A flask has a face and a face has to point somewhere. The meshes were baked
  // standing square, so the turn is a `place` about the bottle's own middle —
  // and it wraps the label and the liquor too, which are built in world
  // coordinates off the same centre and would otherwise stay where they were.
  b.place({ cx: B.x, cy: B.y, yaw: B.turn });
  // the liquor FIRST, so it is already in the depth buffer when the blended
  // glass is laid over it
  liquor(b, B);
  b.mesh(BOTTLECAP_POSITION, BOTTLECAP_INDICES, at, P.cap);
  bottleLabel(b, B);
  // and the glass last, in its own material, which is what the draw loop
  // picks out to blend
  b.material("glass");
  b.mesh(BOTTLEGLASS_POSITION, BOTTLEGLASS_INDICES, at, P.bottle);
  b.material(null);
  b.place(null);

  // Everything flat and paper on this desk, in the order it was laid down: the
  // magazines, then the tarot card, then the postcards fanned over them. How
  // high each one rides is not written down anywhere — `stackFlat` works it out
  // from what each one actually covers, so a prop moved on the plan lands on
  // its neighbour or on the desk without anyone having to notice which.
  const flats = [
    ...D.magazines.map((m) => ({ x: m.x, y: m.y, long: m.long, short: m.short, turn: m.turn, thick: m.thick })),
    { x: D.tarot.x, y: D.tarot.y, long: D.tarot.long, short: D.tarot.short, turn: D.tarot.turn, thick: D.tarot.thick },
    ...D.postcards.map((c) => ({ x: c.x, y: c.y, long: c.tall, short: c.wide, turn: c.turn, thick: c.thick })),
  ];
  const lift = stackFlat(flats);
  const TAROT = D.magazines.length, CARDS = TAROT + 1;

  // The magazines fanned out in the pool of light. A magazine seen from above
  // is its cover and four thin edges, so that is what each one is: a slab of
  // five quads, turned in plan, with a darker plate on the cover for the
  // photograph every one of them carries.
  D.magazines.forEach((m, i) => {
    // the lady is TORN, which the film shows and a cut rectangle cannot
    if ("fray" in m && m.fray) {
      roundSlab(b, m.x, m.y, m.long, m.short, m.thick, m.turn, DESK.top + lift[i], 0, P[m.paint], P.paper,
                m.art as keyof typeof MATERIALS, m.fray);
    } else {
      slab(b, m.x, m.y, m.long, m.short, m.thick, m.turn, DESK.top + lift[i], P[m.paint], P.paper,
           m.art as keyof typeof MATERIALS);
    }
  });

  // the three packets of Old Reds: a pair by the lamp, closed underneath and
  // opened on top, and a third on its own behind the lamp further along
  const K = D.packs;
  packet(b, K.x, K.y, K.turn, DESK.top, false);
  packet(b, K.x + K.over.dx, K.y + K.over.dy, K.turn + K.over.turn, DESK.top + K.thick, true);
  packet(b, K.third.x, K.third.y, K.third.turn, DESK.top, false);

  // the tarot card at the far end, wearing its own face. Three units thick,
  // because a card is one — the magazines are ten and are a sheaf of pages.
  const t = D.tarot;
  roundSlab(b, t.x, t.y, t.long, t.short, t.thick, t.turn, DESK.top + lift[TAROT], D.cardRadius,
    P.gilt, P.booklet, "tarot");

  // the three postcards fanned out in front of it, riding on each other where
  // they overlap so the fan reads as a pile and not as a plane fighting itself
  D.postcards.forEach((c, i) => {
    slab(b, c.x, c.y, c.tall, c.wide, c.thick, c.turn, DESK.top + lift[CARDS + i], P.booklet, P.booklet,
      c.art as keyof typeof MATERIALS);
  });

  // The matchbox: the box, its tray and eighteen matches in it, modelled. It
  // was a five-quad slab painted red with cream edges — which is a matchbox at
  // the size the frames show it and nothing at all from the chair. The PRINT
  // that used to lie beside it is gone: it was a pale slab with a darker one
  // inset in it, which is an empty picture frame and nothing else.
  //
  // The matches are their own module because they are their own MATERIAL in the
  // file, which is the only thing that could have gathered them: they are one
  // mesh instanced eighteen times, so no island test and no height band could
  // tell one from the box it lies in.
  const m = D.matches;
  const mat: V3 = [m.x, m.y, DESK.top];
  b.place({ cx: m.x, cy: m.y, yaw: m.turn });
  b.material("atlasMatchbox", MATERIALS.atlasMatchbox.scale);
  b.mesh(MATCHBOX_POSITION, MATCHBOX_INDICES, mat, P.matchbox, 0, false, MATCHBOX_UV);
  b.material("atlasMatch", MATERIALS.atlasMatch.scale);
  b.mesh(MATCHES_POSITION, MATCHES_INDICES, mat, P.booklet, 0, false, MATCHES_UV);
  b.material(null);
  b.place(null);

  // the ashtray — THE SAME MODEL the side table carries, not a drawn dish. It
  // is 278 across where the lathe was 144, and 278 is the one the frames agree
  // with: in the close-up it measures about two and a half matchboxes, and the
  // matchbox is 100. Its base sits at z 0 in its own frame, so it stands on
  // the desk with no packing under it.
  const a = D.ashtray;
  b.mesh(ASHTRAY_POSITION, ASHTRAY_INDICES, [a.x, a.y, DESK.top], P.brass, 0, true);

  // The pocket watch, which has a close-up of its own in the same film. It was
  // four turned parts — a lathed case, two discs for the dial and its hand, and
  // a tilted `tube` for the lid — and it is a model now, with the enamel dial,
  // its Roman numerals, the engine turning on the back and the blued screws all
  // on one 512 sheet. The dial is the one thing on this desk brighter than the
  // paper and the thing the eye finds first in the frames, which is what made
  // four parts worth spending on something 68 units across, and is the same
  // reason it is worth 2,940 triangles now.
  //
  // It IS a hunter, with its lid hinged at the case's far side and standing
  // open, which is what the frames show and what the drawn one was trying to
  // be. At 68 units across that lid read as a smear on the wood and the watch
  // looked open-faced; at 148 it is plainly a lid.
  //
  // `D.watch.x` and `y` are the CASE's middle, which is not the mesh's. The bow
  // stands off one side, so the model's bounding box — which is what the bake
  // centres on — is a fifth of a case-width off the case itself, and placing it
  // by the box would move the watch a bow's length from where it was measured.
  // The CRYSTAL settles it: it is a disc on the case's own axis, so the middle
  // of its box is the middle of the case, and it comes from the same bake and
  // moves with it.
  const w = D.watch;
  const off = (c: 0 | 1): number => -(WATCHGLASS_BOX.lo[c] + WATCHGLASS_BOX.hi[c]) / 2;
  b.place({ cx: w.x, cy: w.y, yaw: w.turn });
  b.material("atlasWatch", MATERIALS.atlasWatch.scale);
  b.mesh(WATCH_POSITION, WATCH_INDICES, [w.x + off(0), w.y + off(1), DESK.top], PAINT.brass, 0, false, WATCH_UV);
  b.material(null);
  b.place(null);

  // NO PEN. There was one here — a black tube laid across the corner of the
  // lady's cover, at a height typed in as `DESK.top + 10` because that was how
  // thick she was at the time. Nothing in the film put it there; it was a
  // plausible thing to find on a writing desk, which is the same argument that
  // put an empty PRINT beside the matchbox and two cover-less magazines in the
  // lamp's pool, and it ends the same way. What it actually read as, once she
  // went paper thin and it did not, was a black bar lying across her face.
}

/**
 * A packet of Old Reds lying face up: closed, or opened at one end.
 *
 * Three models and no drawing at all. A soft packet is a printed sheet folded
 * round twenty and pulled tight under cellophane, and none of those words is
 * something the builder can say: the folded ends, where the flaps overlap and
 * stand PROUD of the fold line round them; the arrises, which are creases and
 * not the soap-bar a generous bevel makes of them; and the opening.
 *
 * THE OPENING IS ON THE PACKET'S OWN TOP — the SMALL END face — and is wholly
 * within it. Take the packet for a die in its own frame, standing: 1 is the
 * foot, 6 is the small face at the top, and the big printed faces are the
 * front and the back. A packet of twenty is opened at 6. Ours LIE on the desk,
 * so that face points along it and the cigarettes come out roughly level,
 * which is what `bedcards.mov` shows on the upper of the two. Cutting the big
 * printed face instead is a hole in the packet's FRONT, and the slot must not
 * run out to the top or the long side either, or it stops being on the small
 * face at all.
 *
 * THE PACKET IS A SHELL, 1.3 of skin. Cut as a solid, the slot opened into a
 * shallow recess whose back wall stood behind the cigarettes and whose surface
 * fought them for the same plane. It is hollowed AFTER the bevel and the
 * belly, so those still shape the outside and the inside is the flat faces
 * paper actually has.
 *
 * SIX CIGARETTES, of the twenty it is sized for. Twenty is what fixed the
 * diameter and the thickness — two rows of ten at 7.2 across a 74 interior —
 * but this is a closed shell with one hole in one end, and the other fourteen
 * are behind opaque paper from anywhere a person can stand. Modelling them
 * cost 1,040 triangles to draw nothing; these six are 312.
 *
 *     bedsitglb.ts <packclosed.glb>  packclosed 165 121 28 --exact 1.549375
 *     bedsitglb.ts <packopen.glb>    packopen   165 121 28 --exact 1.549375
 *     bedsitglb.ts <packsmokes.glb>  packsmokes 165 121 28 --exact 1.549375
 *
 * `--exact` AND NOT THE BOX FITTER, which is why these three land together and
 * the right way up. The fitter takes the room's length from glTF x — the
 * model's WIDTH — so it transposes the axes: the wrap came out turned a
 * quarter, the mesh was stretched 2.56 one way against 1.37 the other, and the
 * folded ends ended up on the long sides. `--exact` maps straight through, so
 * the models are built at the room's own size in millimetres and the
 * cigarettes keep their place inside the packet instead of each mesh being
 * centred in a box of its own.
 *
 * All three wear ONE sheet, `pack-oldreds.jpg`: the front art over its left
 * 0.7344, then the packet's own border red, the cigarette paper, and the
 * tobacco at a cut end. The packet's flat faces collapse onto a single point
 * of a block — which is how a face takes one flat colour from a textured
 * material without a second material — while a cigarette samples a COLUMN of
 * the paper down its length and a DISC of the tobacco at each end, so what
 * shows there is cut leaf rather than a brown circle.
 */
function packet(b: Builder, cx: number, cy: number, turn: number, z: number, open: boolean): void {
  const P = FURNITURE_PAINT;
  const at: V3 = [cx, cy, z];
  b.place({ cx, cy, yaw: turn });
  b.material("oldreds", MATERIALS.oldreds.scale);
  if (open) {
    b.mesh(PACKOPEN_POSITION, PACKOPEN_INDICES, at, P.packFace, 0, false, PACKOPEN_UV);
    b.mesh(PACKSMOKES_POSITION, PACKSMOKES_INDICES, at, P.cigarette, 0, false, PACKSMOKES_UV);
  } else {
    b.mesh(PACKCLOSED_POSITION, PACKCLOSED_INDICES, at, P.packFace, 0, false, PACKCLOSED_UV);
  }
  b.material(null);
  b.place(null);
}

/**
 * How high each flat thing on the desk rides, from the order they were laid
 * down in.
 *
 * A magazine, a postcard and a playing card are all drawn standing on a plane,
 * and the plane they were all standing on was `DESK.top`. Where two of them
 * overlap in plan that is not a pile — it is one slab passing THROUGH another,
 * with the lower one's cover cut in half by the upper one's underside. From the
 * walker's eye it is very nearly invisible, which is the trouble: the eye is
 * 1,000 units above the desk and looking along it, so a buried card and a
 * stacked card make the same picture until the moment the light catches the
 * wrong edge. Only a plan view shows it, and the plan view is the artifact
 * these positions are moved on.
 *
 * Every one of these positions is moved by hand, on that plan, a dozen at a
 * time. So the heights cannot be numbers in the data — they were, and they went
 * stale the first time anything moved. This takes the ORDER as the input, which
 * is the thing that does not change: the magazines went down first, the tarot
 * card after them, the postcards fanned over the top. Each item is then lifted
 * to sit on the tallest earlier thing it actually covers, and on nothing at all
 * if it covers nothing.
 *
 * The covering test is the separating-axis one for two turned rectangles: four
 * axes, two from each box's own edges, and a gap on ANY of them means they do
 * not touch. It is exact for rectangles — no circles round them, no grid — so
 * two cards that lie a hair apart stay on the desk and two that lap by a hair
 * stack. Six items make fifteen tests, once, at build.
 */
function stackFlat(
  items: readonly { x: number; y: number; long: number; short: number; turn: number; thick: number }[],
): number[] {
  /** a turned rectangle as its centre, its two half-edge vectors */
  const box = (it: typeof items[number]) => {
    const cs = Math.cos(it.turn), sn = Math.sin(it.turn);
    // `slab` puts u along `short` and v along `long`, which is what these are
    return { x: it.x, y: it.y, u: [cs * it.short / 2, sn * it.short / 2], v: [-sn * it.long / 2, cs * it.long / 2] };
  };
  const boxes = items.map(box);
  const laps = (a: typeof boxes[number], b: typeof boxes[number]): boolean => {
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const n of [a.u, a.v, b.u, b.v]) {
      const reach = (c: typeof a): number => Math.abs(c.u[0] * n[0] + c.u[1] * n[1]) + Math.abs(c.v[0] * n[0] + c.v[1] * n[1]);
      if (Math.abs(dx * n[0] + dy * n[1]) > reach(a) + reach(b)) return false;
    }
    return true;
  };
  const z = items.map(() => 0);
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < i; j++) {
      if (laps(boxes[j], boxes[i])) z[i] = Math.max(z[i], z[j] + items[j].thick);
    }
  }
  return z;
}

/**
 * A flat thing lying on the desk, turned in plan: a magazine, a book, a
 * matchbox. Five quads — the face, and the four edges under it — because a
 * magazine seen from above is exactly that and nothing more, and `box` cannot
 * be turned.
 *
 * `art` puts a PICTURE on the face: a material whose four corners are pinned to
 * the slab's, so the cover lands where it is printed instead of a tile
 * repeating over the world's axes. The mapping runs masthead-to-foot along
 * `long`, with the masthead at the +V end — which `DESK_PROPS.magazines` says
 * is the desk's far end — and the cover's own width across `short`. The edges
 * underneath stay flat `side`, since what shows there is paper and not print.
 */
/**
 * A slab with ROUNDED corners, for the one thing on this desk that has them.
 *
 * `slab` is four square corners and that is right for a magazine, a postcard and
 * a matchbox, which are cut square. A playing card is not: it is stamped, and
 * the corner it is stamped with is the first thing that tells the eye it is a
 * card and not a rectangle of paper.
 *
 * THE RADIUS IS THE CARD'S, NOT THE TEXTURE'S. The supplied art arrived with the
 * corners already rounded — on a white ground, at a radius that measures 39 px
 * across and 30 down out of 512. That art is pinned corner-to-corner onto a
 * 130 by 215 card, so the texture is squashed by 215/130 on the way in and a
 * corner that is round in the file comes out an ELLIPSE on the desk, half as
 * round across as along. It was also far too big: 39 px of 512 is ten units, or
 * 6 mm on a card 84 mm wide, where a real one is three or four. So the art's
 * corners were painted out — its own border extended to all four edges of the
 * texture, which is what `card-tarot.jpg` holds now — and the rounding is done
 * HERE, where it is circular because the card is, and where the number is a
 * number rather than a measurement of somebody's brush.
 */
function roundSlab(
  b: Builder, cx: number, cy: number, long: number, short: number, h: number,
  turn: number, z: number, radius: number, face: readonly number[], side: readonly number[],
  art?: keyof typeof MATERIALS, fray = 0,
): void {
  const cs = Math.cos(turn), sn = Math.sin(turn);
  const U = short / 2, V = long / 2;
  const r = Math.min(radius, U * 0.9, V * 0.9);
  /** three segments a corner: at 4.5 mm the arc is two pixels from a metre off */
  const SEG = 3;
  /** the four corners in `slab`'s own order, each as its centre and the quarter
   *  it sweeps — so the outline runs the same way round and the art pins alike */
  const QUARTER: readonly (readonly [number, number, number])[] = [
    [-1, -1, Math.PI], [1, -1, 1.5 * Math.PI], [1, 1, 0], [-1, 1, 0.5 * Math.PI],
  ];
  /**
   * FRAY: the outline walked at a fine step and pushed in and out, for paper
   * that has been read rather than cut.
   *
   * The film's lady is not a rectangle. Her cover is torn along the bottom and
   * nibbled at every corner, and a clean four-cornered slab is the one thing it
   * plainly is not. There is no alpha in this room — the smoke is the only
   * blended thing in it — so the raggedness cannot be painted into the texture
   * and left to cut itself out. It has to be the SILHOUETTE, which means the
   * outline carries it.
   *
   * The displacement is a hash of the point's index rather than `Math.random`,
   * so the same magazine tears the same way on every load and in every browser:
   * a cover that reshuffled itself each time you walked back into the room
   * would be the most distracting thing on the desk.
   */
  const outline: [number, number][] = [];
  const hash = (i: number): number => {
    const x = Math.sin(i * 127.1 + long * 0.37 + short * 0.11) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  const push = (u: number, v: number, nu: number, nv: number): void => {
    const d = fray ? fray * (0.45 + 0.55 * Math.abs(hash(outline.length))) * Math.sign(hash(outline.length * 7 + 3)) : 0;
    outline.push([u + nu * d, v + nv * d]);
  };
  /** how finely the straight runs are walked — only worth it when fraying */
  const STEP = 16;
  for (const [qi, [su, sv, from]] of QUARTER.entries()) {
    for (let k = 0; k <= SEG; k++) {
      const a = from + (0.5 * Math.PI * k) / SEG;
      push(su * (U - r) + r * Math.cos(a), sv * (V - r) + r * Math.sin(a), Math.cos(a), Math.sin(a));
    }
    if (!fray) continue;
    // and the straight run from this corner to the next
    const [nu2, nv2, ] = QUARTER[(qi + 1) % 4];
    const a0 = outline[outline.length - 1];
    const b0: [number, number] = [nu2 * (U - r) + r * Math.cos(from + Math.PI / 2),
                                 nv2 * (V - r) + r * Math.sin(from + Math.PI / 2)];
    const run = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
    const steps = Math.max(1, Math.round(run / STEP));
    const ex = (b0[0] - a0[0]) / run, ey = (b0[1] - a0[1]) / run;
    for (let k = 1; k < steps; k++) {
      push(a0[0] + (b0[0] - a0[0]) * (k / steps), a0[1] + (b0[1] - a0[1]) * (k / steps), -ey, ex);
    }
  }
  const N = outline.length;
  const world = (u: number, v: number, zz: number): [number, number, number] =>
    [cx + u * cs - v * sn, cy + u * sn + v * cs, zz];
  // the same pinning `slab` uses, and for the same reason — see the note there
  const pin = (u: number, v: number): [number, number] => [(1 - u / U) / 2, (1 - v / V) / 2];

  // the face, as a fan from the middle, wearing the art
  const fp = new Float32Array((N + 1) * 3), fu = new Float32Array((N + 1) * 2);
  fp.set(world(0, 0, z + h), 0); fu.set(pin(0, 0), 0);
  outline.forEach(([u, v], i) => { fp.set(world(u, v, z + h), (i + 1) * 3); fu.set(pin(u, v), (i + 1) * 2); });
  const fi: number[] = [];
  for (let i = 0; i < N; i++) fi.push(0, i + 1, ((i + 1) % N) + 1);
  if (art) b.material(art, MATERIALS[art].scale);
  b.mesh(fp, fi, [0, 0, 0], face, 0, true, fu);
  if (art) b.material(null);

  // and its edge, a strip round the outline
  const sp = new Float32Array(N * 2 * 3);
  outline.forEach(([u, v], i) => {
    sp.set(world(u, v, z + h), i * 6);
    sp.set(world(u, v, z), i * 6 + 3);
  });
  const si: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = i * 2, c = ((i + 1) % N) * 2;
    si.push(a, a + 1, c + 1, a, c + 1, c);
  }
  b.mesh(sp, si, [0, 0, 0], side, 0, true);
}

function slab(
  b: Builder, cx: number, cy: number, long: number, short: number, h: number,
  turn: number, z: number, face: readonly number[], side: readonly number[],
  art?: keyof typeof MATERIALS,
): void {
  const cs = Math.cos(turn), sn = Math.sin(turn);
  const at = (u: number, v: number): V3 => [cx + u * cs - v * sn, cy + u * sn + v * cs, z + h];
  const foot = (u: number, v: number): V3 => [cx + u * cs - v * sn, cy + u * sn + v * cs, z];
  const U = short / 2, V = long / 2;
  const corners: readonly (readonly [number, number])[] = [[-U, -V], [U, -V], [U, V], [-U, V]];
  /**
   * The picture's corners, in the same order the quad's run: DOWN the cover
   * from the masthead at +V to the foot at -V, and across it from +U to -U.
   *
   * ACROSS IT BACKWARDS, and that is not a mistake. `glOf` hands the room to
   * GL as (x, z, y) — y and z swapped with neither negated — which is a
   * reflection, determinant minus one. Every face therefore reaches the
   * rasterizer with its winding mirrored against its own normal, and a picture
   * pinned to one comes out reversed: right-reading art, wrong-reading room.
   * Flipping u here is the correction, and it belongs here rather than in
   * `glOf` because the whole room is built in that mirrored frame and has been
   * measured against the game's frames inside it.
   */
  const pinned = corners.map(([u, v]) => [(1 - u / U) / 2, (1 - v / V) / 2] as [number, number]);
  if (art) b.material(art, MATERIALS[art].scale);
  b.quad(at(...corners[0]), at(...corners[1]), at(...corners[2]), at(...corners[3]), face, [0, 0, 1],
    0, art ? pinned : undefined);
  if (art) b.material(null);
  for (let i = 0; i < 4; i++) {
    const p = corners[i], q = corners[(i + 1) % 4];
    b.quad(foot(...p), foot(...q), at(...q), at(...p), side);
  }
}

/**
 * A picture standing on the desk: a frame, its glass, an easel strut behind.
 *
 * Rectangular or oval by the same code — the outline is a ring of points either
 * way — and leaning back the little that a strut props it to, which is what
 * puts the lamp on the glass in the frames.
 */
/**
 * The bottle's label, wrapped round the glass.
 *
 * A LATHE CANNOT WEAR A PICTURE. `lathe` and `spun` make a surface of
 * revolution and carry no texture coordinates, and a material box-mapped onto a
 * cylinder projects on whichever axis each triangle's normal is nearest — so a
 * label laid on that way is right at the front, stretched at the sides and
 * mirrored round the back. This is a band of quads with `u` walked round the
 * arc and `v` up it, which is the only mapping that puts the printing where the
 * printing goes.
 *
 * It faces the ROOM. The desk stands against the window wall with its back at
 * `ROOM.x0`, so a walker is always at greater x, and the label's middle is
 * hung on +x.
 *
 * Its width is the artwork's own: `bedsitmags` trimmed the supplied label to
 * 1,475 by 963 before squaring it, so the printing is 1.53 wide for 1 tall and
 * the band is cut to that. At 190 units up it is 290 round, which on a bottle
 * 100 in radius is 166 degrees of it — a wrap, which is what a flask this shape
 * carries.
 */
/**
 * What is in the bottle: a dark spirit standing 0.4 up the straight side.
 *
 * An oval column, a hair inside the glass so the two never fight for a pixel,
 * and the one thing on this desk the lamp does not get into. It is drawn before
 * the glass and in the ordinary opaque pass, which is what lets the blended
 * glass over it read as glass with something behind it.
 */
function liquor(b: Builder, B: typeof DESK_PROPS.bottle): void {
  const SEG = 20, z0 = DESK.top + 6, z1 = DESK.top + B.tall * B.straight * B.fill;
  const K = 0.93;
  const ring = (z: number): [number, number, number][] =>
    Array.from({ length: SEG }, (_, i) => {
      const a = (2 * Math.PI * i) / SEG;
      return [B.x + B.deep * K * Math.cos(a), B.y + B.half * K * Math.sin(a), z];
    });
  const lo = ring(z0), hi = ring(z1);
  const pos: number[] = [], idx: number[] = [];
  for (const p of [...lo, ...hi]) pos.push(...p);
  for (let i = 0; i < SEG; i++) {
    const c = (i + 1) % SEG;
    idx.push(i, c, c + SEG, i, c + SEG, i + SEG);
  }
  const mid = pos.length / 3;
  pos.push(B.x, B.y, z1);
  for (let i = 0; i < SEG; i++) idx.push(mid, SEG + i, SEG + ((i + 1) % SEG));
  b.mesh(new Float32Array(pos), idx, [0, 0, 0], FURNITURE_PAINT.liquor, 0, false);
}

function bottleLabel(b: Builder, B: typeof DESK_PROPS.bottle): void {
  const ASPECT = 1475 / 963, REACH = 0.78;     // how far across the face it goes
  const HIGH = (2 * B.half * REACH) / ASPECT;
  const z0 = DESK.top + B.tall * 0.17, z1 = z0 + HIGH;
  const SEG = 2;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    /**
     * FLAT, and standing clear of the glass at every point along it.
     *
     * It was bent to an ellipse of the flask's own depth, which is wrong twice:
     * the flask is a rounded rectangle and its front is nearly flat, so an
     * ellipse falls away from it — and where it falls away, the label ends up
     * INSIDE the glass and the blended pass tints it. That is the green wash
     * that appeared down the label's left and right. A flat panel one unit
     * proud of the face is outside the glass everywhere and touching it.
     */
    const fy = (t * 2 - 1) * REACH;
    const cx = B.x + B.face + 1;
    const cy = B.y + B.half * fy;
    pos.push(cx, cy, z0, cx, cy, z1);
    // u runs BACKWARDS, for the reason `slab` gives: the room reaches GL
    // through a reflection and a pinned picture is mirrored without it
    uv.push(1 - t, 1, 1 - t, 0);
  }
  for (let i = 0; i < SEG; i++) {
    const a = i * 2, c = (i + 1) * 2;
    idx.push(a, a + 1, c + 1, a, c + 1, c);
  }
  b.material("labelNordendale", MATERIALS.labelNordendale.scale);
  b.mesh(new Float32Array(pos), idx, [0, 0, 0], FURNITURE_PAINT.label, 0, false, new Float32Array(uv));
  b.material(null);
}

function plate(b: Builder, x: number, y: number, w: number, h: number, turn: number,
               oval: boolean, gilt: boolean, art?: keyof typeof MATERIALS): void {
  const P = FURNITURE_PAINT;
  const TILT = 0.13, N = oval ? 28 : 4;
  const cs = Math.cos(TILT), sn = Math.sin(TILT);
  const ct = Math.cos(turn), st = Math.sin(turn);
  /**
   * Local across `u`, up `v`, out of the face `d`, in room coordinates.
   *
   * TWO ROTATIONS, and they are not interchangeable. `TILT` leans the frame
   * back on its strut and acts in the vertical plane; `turn` swings it about
   * its own upright and acts in plan. The lean is applied first, in the frame's
   * own coordinates, and the result is then turned — which is what a frame
   * standing on a desk does, and the other order would tip it sideways.
   */
  const at = (u: number, v: number, d: number): [number, number, number] => {
    const deep = -v * sn + d * cs, across = u;
    return [x + deep * ct - across * st, y + deep * st + across * ct, DESK.top + v * cs + d * sn];
  };
  /** the outline at a fraction of full size, as a ring of (u, v) */
  const ring = (k: number, f: number): [number, number] => {
    if (oval) {
      const t = (2 * Math.PI * k) / N;
      return [(w / 2) * f * Math.cos(t), h / 2 + (h / 2) * f * Math.sin(t)];
    }
    const t = ((k % N) + N) % N;
    const ux = [-1, 1, 1, -1][t] * (w / 2) * f, vy = [0, 0, 1, 1][t];
    return [ux, h / 2 + (vy * 2 - 1) * (h / 2) * f];
  };
  /**
   * THE MOULDING, measured off `movies/bedcards.mov` frame 0 — the game's own
   * close-up of this desk, which is the only place these four frames are more
   * than a dozen pixels.
   *
   * `OPEN` is where the picture starts, as a fraction of the plate. It was
   * 0.74, which is thirteen per cent of the full width of wood down each side
   * and reads as a mount rather than a moulding. Scanned across the naval
   * officer's frame in that film, the dark band runs about seven pixels of a
   * frame seventy-eight across — eight per cent — so the opening is 0.84.
   *
   * `FLAT` and `BEVEL` are the part that makes it read as a frame at all. The
   * film's moulding is not one tone: there is a flat outer face and a lighter
   * inner lip where the section falls away to the picture, and that step is
   * what the eye takes for a frame. It is GEOMETRY here and not a second
   * colour — the bevel faces a different way, so the room's own lamps light it
   * differently, which is the whole reason a real one shows.
   */
  const OPEN = 0.84, FLAT = 0.90, BEVEL = 7;
  /**
   * THE GILT FRAME IS NOT A GOLD FRAME. Enlarged out of the film, the oval on
   * the right is a dark moulding with a thin gold LINE run round it where the
   * section turns — a beading, catching the lamp along one edge. It was drawn
   * here as a broad gold face, which is why it read as the brightest thing on
   * the desk. The face is the same wood as its neighbours now and the gilt is
   * on the bevel, which is exactly the edge the film lights.
   */
  const face = P.frameWood;
  const lip = gilt ? P.gilt : P.frameWood;
  const T = 26;
  for (let k = 0; k < N; k++) {
    const [au, av] = ring(k, 1), [bu, bv] = ring(k + 1, 1);
    const [eu, ev] = ring(k + 1, FLAT), [fu, fv] = ring(k, FLAT);
    const [cu, cv] = ring(k + 1, OPEN), [du, dv] = ring(k, OPEN);
    // the frame's flat face, the BEVEL down from it to the opening, the outer
    // rim, and the back of the whole plate
    b.quad(at(au, av, T), at(bu, bv, T), at(eu, ev, T), at(fu, fv, T), face, [cs, 0, sn]);
    b.quad(at(fu, fv, T), at(eu, ev, T), at(cu, cv, T - BEVEL), at(du, dv, T - BEVEL), lip);
    b.quad(at(au, av, 0), at(bu, bv, 0), at(bu, bv, T), at(au, av, T), face);
    b.quad(at(0, h / 2, 0), at(au, av, 0), at(bu, bv, 0), at(bu, bv, 0), P.frameBack, [-cs, 0, -sn]);
    // The photograph inside it, a shade behind the frame's face: a fan of
    // triangles from the middle of the opening out to its edge, which is what
    // lets one piece of code fill a rectangle and an oval alike.
    //
    // `pin` is where each of those points sits in the picture. The opening runs
    // to 0.74 of the plate, so an offset of 0.74*w/2 across is the picture's
    // own edge and lands at 0 or 1; the middle lands at a half; and v runs the
    // other way, because in this frame v climbs and a picture's rows fall. On
    // an OVAL that maps the ellipse inscribed in the photograph and leaves its
    // corners outside the mount, which is precisely what an oval mount does to
    // a rectangular print.
    // u runs BACKWARDS across the opening, for the reason `slab` gives: the
    // room reaches GL through a reflection, so a pinned picture is mirrored
    // unless one of its axes is turned round here
    const pin = (u: number, v: number): [number, number] =>
      [0.5 - u / (OPEN * w), 0.5 - (v - h / 2) / (OPEN * h)];
    if (art) b.material(art, MATERIALS[art].scale);
    b.quad(at(0, h / 2, T - BEVEL - 1), at(du, dv, T - BEVEL - 1), at(cu, cv, T - BEVEL - 1),
      at(cu, cv, T - BEVEL - 1), P.print, [cs, 0, sn],
      0, art ? [pin(0, h / 2), pin(du, dv), pin(cu, cv), pin(cu, cv)] : undefined);
    if (art) b.material(null);
  }
  // Whoever is in it, for the load where the picture does not arrive: a dark
  // mass where the sitter's shoulders are and a pale one where the face is.
  // This was the portrait until the four photographs existed, and at four
  // hundred units across seen from the door it was as much of one as the game's
  // own frames carry. It stays as the fallback and nothing more.
  if (!art) {
    const w2 = w * 0.30, hd = h * 0.10;
    b.quad(at(-w2, h * 0.16, T - BEVEL - 2), at(w2, h * 0.16, T - BEVEL - 2), at(w2, h * 0.52, T - BEVEL - 2), at(-w2, h * 0.52, T - BEVEL - 2), P.sitter, [cs, 0, sn]);
    b.quad(at(-hd, h * 0.55, T - BEVEL - 3), at(hd, h * 0.55, T - BEVEL - 3), at(hd, h * 0.72, T - BEVEL - 3), at(-hd, h * 0.72, T - BEVEL - 3), P.face, [cs, 0, sn]);
  }
  // the strut: a leg from the back of the plate down to the desk BEHIND it
  b.tube(at(0, h * 0.55, -10), [x - h * 0.26 * ct, y - h * 0.26 * st, DESK.top + 8], 22, 6, P.frameBack);
}
