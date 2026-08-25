/**
 * The DreamFactory 4.0 opcode table — every command/operator ID the script
 * container format can carry, mapped to its source-text name. Split out of
 * script.ts so the decoder isn't buried under 120 lines of data; the
 * disassembly tools (taoot/tools/disasmcmd.mts, tools/scancmds.mts) import it alone.
 */
/** DreamFactory 4.0 command IDs, from dfet DFscript.h (GPL-3.0, M3tox).
 * ID bands: 4xxx control flow / syntax, 8xxx operators, 12xxx actions,
 * 16xxx property get/set, 20xxx queries/functions, 24xxx visual transitions.
 *
 * ## DreamFactory 1 does not agree with all of it
 *
 * This table is version FOUR's, and Dust's scripts are decoded with it. Both
 * engines carry their own command table as data — name pointer, id, handler — and
 * `taoot/tools/exetable.ts` reads either, so the two can simply be compared:
 * `DF.EXE` has 302 commands, `ti.exe` 349, every one of v1's ids is also in v4,
 * and **twenty of them mean different things**:
 *
 *   | id    | DreamFactory 1  | DreamFactory 4     | calls in Dust |
 *   |-------|-----------------|--------------------|---------------|
 *   | 12007 | makeball        | makecricket        | 1   |
 *   | 12012 | stopball        | stopcricket        | 0   |
 *   | 12037 | floorscript     | paintingscript     | 0   |
 *   | 12066 | sendtofloor     | sendtopainting     | 0   |
 *   | 16011 | currentdir      | currentview        | 635 |
 *   | 16034 | actorhitbox     | currentcd          | 32  |
 *   | 16047 | pauseball       | pausecricket       | 18  |
 *   | 20011 | isball          | iscricket          | 0   |
 *   | 20017 | setwidth        | pointinpainting    | 0   |
 *   | 20018 | setheight       | countpaintings     | 0   |
 *   | 20021 | rowcoltoscene   | sendtopostfx       | 4   |
 *   | 20022 | scenefloor      | indextopainting    | 0   |
 *   | 20023 | scenerow        | actorexists        | 7   |
 *   | 20024 | scenecol        | propexists         | 7   |
 *   | 20067 | findfile        | fileexists         | 13  |
 *   | 20082 | cacheinfo       | calcmod            | 0   |
 *   | 20090 | sendtofloorfx   | sendtopaintingfx   | 0   |
 *   | 20100 | scenebuild      | sendtoserverfx     | 2   |
 *   | 20101 | indextoball     | indextocricket     | 0   |
 *   | 20104 | countballs      | countcrickets      | 0   |
 *
 * Most of the twelve Dust actually uses are the SAME thing renamed — a "ball" is
 * what v4 calls a cricket, a "dir" what it calls a view, `findfile` what it calls
 * `fileexists` — so the v4 name reaching the v4 implementation is right, and 654
 * of the 719 call sites were never wrong. Five were: `rowcoltoscene`,
 * `scenebuild`, `scenerow`, `scenecol` and `actorhitbox` are unrelated to the v4
 * commands sharing their ids.
 *
 * Three of those five are already answered under the v4 name, by the meaning the
 * SET decides: `scenerow`/`scenecol` are `actorexists`/`propexists` on a v1 set
 * (see BuiltinCtx.sceneCell) and `rowcoltoscene`/`scenebuild` are
 * `sendtopostfx`/`sendtoserverfx` there (registerDispatchBuiltins). Overloading
 * the v4 name rather than swapping the table is deliberate: a v1 table would have
 * to alias fifteen renames as well, and getting one of them wrong takes out
 * something like `currentdir`'s 635 calls. `actorhitbox` (32 calls, v4
 * `currentcd`) is NOT done — nothing is known about what it does beyond its
 * shape, `actorhitbox(actor, index[, value])`.
 */
export const OPCODES: ReadonlyMap<number, string> = new Map([
  [1, " "],
  [4001, "code"], [4002, "global"], [4003, "local"], [4004, "endcode"],
  [4005, "exitcode"], [4006, "if"], [4007, "endif"], [4008, "else"],
  [4009, "switch"], [4010, "endswitch"], [4011, "case"], [4012, "for"],
  [4013, "to"], [4014, "step"], [4015, "endfor"], [4016, "while"],
  [4017, "endwhile"], [4018, "("], [4019, ")"], [4020, ","],
  [4021, "true"], [4022, "false"], [4023, "not"], [4024, "return"],
  [4025, "passcode"], [4026, "me"], [4027, "target"], [4028, "dumplocal"],
  [4029, "dumpglobal"],
  [8001, "+"], [8002, "-"], [8003, "*"], [8004, "/"], [8005, "&"],
  [8006, "|"], [8007, "@"], [8008, "="], [8009, "!="], [8010, ">"],
  [8011, "<"], [8012, ">="], [8013, "<="],
  [12001, "message"], [12002, "hidecursor"], [12003, "showcursor"],
  [12004, "delay"], [12005, "makeloop"], [12006, "walktostar"],
  [12007, "makecricket"], [12008, "exportclut"], [12009, "visualeffect"],
  [12010, "stopwalk"], [12011, "stoploop"], [12012, "stopcricket"],
  [12013, "opencastfile"], [12014, "closecastfile"], [12015, "actorscript"],
  [12016, "sendtoactor"], [12017, "playmovie"], [12018, "openpuppetfile"],
  [12019, "opentrackfile"], [12020, "closetrackfile"], [12021, "playtheme"],
  [12022, "singlesound"], [12023, "multiplesound"], [12024, "dualsound"],
  [12025, "bothsound"], [12026, "voicesound"], [12027, "plugin"],
  [12028, "haltsound"], [12029, "halttheme"], [12030, "haltvoice"],
  [12031, "bootscript"], [12032, "opensetfile"], [12033, "closesetfile"],
  [12034, "sendtoscene"], [12035, "setscript"], [12036, "scenescript"],
  [12037, "paintingscript"], [12038, "clut"], [12039, "cursor"],
  [12040, "debugger"], [12041, "puppetclear"], [12042, "closepuppetfile"],
  [12043, "puppetspeak"], [12044, "puppetbevel"], [12045, "sendtopuppet"],
  [12046, "puppetscript"], [12047, "castscript"], [12048, "sendtocast"],
  [12049, "blacktoscreen"], [12050, "screentoblack"], [12051, "blackscreen"],
  [12052, "forceupdate"], [12053, "error"], [12054, "propscript"],
  [12055, "sendtoprop"], [12056, "openshopfile"], [12057, "closeshopfile"],
  [12058, "shopscript"], [12059, "sendtoshop"], [12060, "openstagefile"],
  [12061, "closestagefile"], [12062, "gotoflat"], [12063, "stagescript"],
  [12064, "flatscript"], [12065, "buttonscript"], [12066, "sendtopainting"],
  [12067, "sendtoset"], [12068, "sendtobutton"], [12069, "sendtoflat"],
  [12070, "sendtostage"], [12071, "quit"], [12072, "turntodeg"],
  [12073, "flushevents"], [12074, "puppetgrab"], [12075, "actorinstance"],
  [12076, "propinstance"], [12077, "savegame"], [12078, "opengame"],
  [12079, "notedialog"], [12080, "drawstring"], [12081, "sendtoboot"],
  [12082, "mixclut"], [12083, "puppetscramble"], [12084, "puppetsubtitle"],
  [12085, "actorwarm"], [12086, "propwarm"], [12087, "shopwarm"],
  [12088, "castwarm"], [12089, "postscript"], [12090, "sendtopost"],
  [12091, "serverscript"], [12092, "sendtoserver"], [12093, "actordelete"],
  [12094, "propdelete"], [12095, "netconnect"], [12096, "netdisconnect"],
  [12097, "netbroadcast"], [12098, "netjoingroup"], [12099, "netleavegroup"],
  [12100, "walkonpath"], [12101, "walktoxyz"], [12102, "walkonroad"],
  [12103, "walkonframes"], [12104, "actorhide"], [12105, "prophide"],
  [12106, "reboot"], [12107, "actorlock"], [12108, "proplock"],
  [12109, "shoplock"], [12110, "castlock"],
  [16001, "actorvisible"], [16002, "actordeg"], [16003, "actorxyz"],
  [16004, "actorxy"], [16005, "actoris3d"], [16006, "actorstar"],
  [16007, "setvisible"], [16008, "stagevisible"], [16009, "path"],
  [16010, "result"], [16011, "currentview"], [16012, "actordist"],
  [16013, "propdist"], [16014, "actorpose"], [16015, "propvisible"],
  [16016, "propdeg"], [16017, "propxyz"], [16018, "propxy"],
  [16019, "propis3d"], [16020, "propstar"], [16021, "actorset"],
  [16022, "framerate"], [16023, "actorspeed"], [16024, "actorscale"],
  [16025, "propview"], [16026, "propspeed"], [16027, "propset"],
  [16028, "propscale"], [16029, "currentscene"], [16030, "variable"],
  [16031, "currentdeg"], [16032, "propowner"], [16033, "wavevolume"],
  [16034, "currentcd"], [16035, "camerahi"], [16036, "actorturn"],
  [16037, "menuvisible"], [16038, "soundpan"], [16039, "soundloop"],
  [16040, "soundvol"], [16041, "themevol"], [16042, "propvalue"],
  [16043, "actorowner"], [16044, "actorvalue"], [16045, "keyaborts"],
  [16046, "pauseloop"], [16047, "pausecricket"], [16048, "pausewalk"],
  [16049, "puppetparam"], [16050, "puppetvisible"], [16051, "actorzclip"],
  [16052, "propzclip"], [16053, "puppetbase"], [16054, "themepan"],
  [16055, "setparam"], [16056, "stageparam"],
  [20001, "random"], [20002, "pointx"], [20003, "pointy"],
  [20004, "makepoint"], [20005, "button"], [20006, "mouse"],
  [20007, "stilldown"], [20008, "tick"], [20009, "iswalk"],
  [20010, "isloop"], [20011, "iscricket"], [20012, "countactors"],
  [20013, "indextoactor"], [20014, "countsounds"], [20015, "indextosound"],
  [20016, "sounddone"], [20017, "pointinpainting"], [20018, "countpaintings"],
  [20019, "countscenes"], [20020, "indextoscene"], [20021, "sendtopostfx"],
  [20022, "indextopainting"], [20023, "actorexists"], [20024, "propexists"],
  [20025, "stringtonum"], [20026, "numtostring"], [20027, "freemem"],
  [20028, "puppetevent"], [20029, "countcasts"], [20030, "indextocast"],
  [20031, "countprops"], [20032, "indextoprop"], [20033, "countshops"],
  [20034, "indextoshop"], [20035, "countflats"], [20036, "indextoflat"],
  [20037, "flattoindex"], [20038, "currentflat"], [20039, "pointinactor"],
  [20040, "pointinprop"], [20041, "pointinset"], [20042, "pointinstage"],
  [20043, "pointinbutton"], [20044, "countbuttons"], [20045, "indextobutton"],
  [20046, "countpuppets"], [20047, "indextopuppet"], [20048, "currentstage"],
  [20049, "currentpuppet"], [20050, "type"], [20051, "countglobals"],
  [20052, "indextoglobal"], [20053, "currentset"], [20054, "findword"],
  [20055, "substring"], [20056, "stringlength"], [20057, "putword"],
  [20058, "optionkey"], [20059, "shiftkey"], [20060, "commandkey"],
  [20061, "calcvectx"], [20062, "calcvecty"], [20063, "cameraxyz"],
  [20064, "playerxyz"], [20065, "machinetype"], [20066, "machinespeed"],
  [20067, "fileexists"], [20068, "questiondialog"], [20069, "textdialog"],
  [20070, "hittest"], [20071, "calcdeg"], [20072, "calcturn"],
  [20073, "starxyz"], [20074, "frame"], [20075, "counttracks"],
  [20076, "indextotrack"], [20077, "currentsound"], [20078, "currentvoice"],
  [20079, "currenttheme"], [20080, "soundrate"], [20081, "calcdist"],
  [20082, "calcmod"], [20083, "actionframe"], [20084, "sendtoactorfx"],
  [20085, "sendtoscenefx"], [20086, "sendtopuppetfx"], [20087, "sendtocastfx"],
  [20088, "sendtopropfx"], [20089, "sendtoshopfx"], [20090, "sendtopaintingfx"],
  [20091, "sendtosetfx"], [20092, "sendtobuttonfx"], [20093, "sendtoflatfx"],
  [20094, "sendtostagefx"], [20095, "sendtobootfx"], [20096, "scenexyz"],
  [20097, "voicedone"], [20098, "pluginfx"], [20099, "walkdest"],
  [20100, "sendtoserverfx"], [20101, "indextocricket"], [20102, "indextoloop"],
  [20103, "indextowalk"], [20104, "countcrickets"], [20105, "countloops"],
  [20106, "countwalks"], [20107, "countbevels"], [20108, "sqrt"],
  [20109, "pluginexists"], [20110, "networkon"], [20111, "netcountmembers"],
  [20112, "netindextomember"], [20113, "netourid"], [20114, "netmessagesender"],
  [20115, "netmessagegroup"], [20116, "roadahead"], [20117, "stringwidth"],
  [20118, "countviews"], [20119, "indextoview"], [20120, "sysmem"],
  [20121, "heapsize"],
  [24001, "barndoorclose"], [24002, "barndooropen"], [24003, "irisclose"],
  [24004, "irisopen"], [24005, "scrolldown"], [24006, "scrollup"],
  [24007, "scrollright"], [24008, "scrolleft"], [24009, "venetian"],
  [24010, "wipedown"], [24011, "wipeup"], [24012, "wiperight"],
  [24013, "wipeleft"], [24014, "plain"], [24015, "turnright"],
  [24016, "turnleft"], [24017, "turnup"], [24018, "turndown"],
  [24019, "nodraw"], [24020, "turnhalfleft"], [24021, "turnhalfright"],
]);
