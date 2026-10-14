/**
 * Which engine commands answer a BOOLEAN, and which take one — before
 * DreamFactory 5 a boolean is a type of its own (see interp.ts), and a command
 * says which it hands back by the tag it writes into its result.
 *
 * Read off the executables, not the scripts: every function handler ends in
 * `mov word ptr [result], 2|3|4` (sounddone, DF.EXE 0x4078b6: `mov word [eax],
 * 2`), and every setter that wants a boolean checks its argument with `cmp word
 * ptr [arg], 2` and answers error 0xe otherwise (actorvisible, DF.EXE
 * 0x412a48). Keyed by command ID because the two tables disagree under one ID:
 * Dust's 20023 `scenerow` is an integer where Titanic's `actorexists` is a
 * boolean (engine/src/df/opcodes.ts lists the twenty that changed meaning).
 *
 * Everything not listed answers an integer or a string, or hands back a value
 * it was given (`variable`, the `sendto…fx` family, `pluginfx`).
 */

/** a property's boolean, shared by DF.EXE, TI.EXE and tl.exe (getter tag 2 /
 *  setter `cmp word [arg], 2`): id -> the setter's argument index */
const BOOL_PROPERTIES: ReadonlyMap<number, number> = new Map([
  [16001, 1], // actorvisible   DF 0x412a80 / set 0x4129e0 (0x412a48)
  [16005, 1], // actoris3d      DF 0x413370 / set 0x4132c0
  [16007, 0], // setvisible     DF 0x410420 / set 0x410100
  [16008, 0], // stagevisible   DF 0x401bb0 / set 0x401bf0
  [16015, 1], // propvisible    DF 0x41c8f0 / set 0x41c850; TI set 0x4410f0
  [16019, 1], // propis3d       DF 0x41cfc0 / set 0x41cf10
  [16037, 0], // menuvisible    DF 0x42bd00 / set 0x41ff50
  [16039, 1], // soundloop      DF 0x407840 / set 0x4075e0 (0x407656)
  [16045, 0], // keyaborts      DF 0x42bd30 / set 0x420ae0
  [16046, 2], // pauseloop      DF 0x42cf20 / set 0x420cc0 (0x420d21)
  [16047, 1], // pauseball / pausecricket  DF 0x42d020 / set 0x420dc0
  [16048, 1], // pausewalk      DF 0x42cfb0 / set 0x420d50
  [16050, 0], // puppetvisible  DF 0x436850 / set 0x4367f0
]);

/** functions answering tag 2 in all three engines */
const BOOL_FUNCTIONS = [
  20005, // button          DF 0x42cbe6
  20007, // stilldown       DF 0x42cc70
  20009, // iswalk          DF 0x42d090
  20010, // isloop          DF 0x42d100
  20011, // isball / iscricket  DF 0x42d190, TI/tl the same tag
  20016, // sounddone       DF 0x4078b6
  20039, // pointinactor    DF 0x412dc4
  20040, // pointinprop     DF 0x41c980
  20041, // pointinset      DF 0x4107c0
  20042, // pointinstage    DF 0x401e30
  20043, // pointinbutton   DF 0x401ee0
  20058, // optionkey       DF 0x42d9a0
  20059, // shiftkey        DF 0x42d9d0
  20060, // commandkey      DF 0x42da00
  20067, // findfile / fileexists  DF 0x42c560
  20068, // questiondialog  DF 0x42c7a4
  20083, // actionframe     DF 0x42c620
  20097, // voicedone       DF 0x4078e6
];

/** DF.EXE only: 20100 `scenebuild` (0x410b90). Its v4 twin `sendtoserverfx`
 *  hands back the target's value, and 20017/20023/20024 are integers here
 *  (`setwidth` 0x4108e0, `scenerow` 0x410460, `scenecol` 0x4104b0). */
const BOOL_V1 = new Set([...BOOL_PROPERTIES.keys(), ...BOOL_FUNCTIONS, 20100]);

/** TI.EXE and tl.exe agree on every one (function tables 0x4297f8 / 0x438f38) */
const BOOL_V4 = new Set([
  ...BOOL_PROPERTIES.keys(),
  ...BOOL_FUNCTIONS,
  20017, // pointinpainting  TI 0x4297f8[15]
  20023, // actorexists
  20024, // propexists
  20109, // pluginexists
  20110, // networkon
  20116, // roadahead
]);

/** statements taking a boolean, beyond the properties: id -> argument index */
const BOOL_ARGS_V1: ReadonlyMap<number, number> = new Map([
  ...BOOL_PROPERTIES,
  [12074, 0], // puppetgrab  DF 0x4361c0
]);
const BOOL_ARGS_V4: ReadonlyMap<number, number> = new Map([
  ...BOOL_PROPERTIES,
  [12074, 0], // puppetgrab  TI 0x416970 (0x416999)
  [12104, 1], // actorhide   TI 0x40aa70 (0x40aaca)
  [12105, 1], // prophide    TI 0x441250
  [12107, 1], // actorlock   TI 0x40a7a0 (0x40a7f1)
  [12108, 1], // proplock    TI 0x440f60
  [12109, 1], // shoplock    TI 0x441010 (0x441060)
  [12110, 1], // castlock    TI 0x40a850
]);

/** does command `id` answer a boolean in engine version `v` (1 or 4)? */
export function answersBoolean(v: number, id: number): boolean {
  return (v === 1 ? BOOL_V1 : BOOL_V4).has(id);
}

/**
 * Does the engine's dispatch for this context reach command `id` at all?
 *
 * A command is run by one of two dispatchers, each a pair of jump-table bands:
 * the statement one for a call written as a statement, the value one for a
 * call inside an expression. An id outside the dispatcher's bands is error 1
 * (`mov ax, 1` past the range checks) — so a statement-only command asked for
 * its value, or a value-only one written as a statement, fails there, and so
 * does an id the engine never had:
 *
 *   TI.EXE  statement 0x43c768: 12001..12110, 16001..16056   value 0x4258c8: 16001..16056, 20001..20121
 *   tl.exe  statement 0x448d68: the same                       value 0x437888: the same
 *   DF.EXE  statement 0x41ee68: 12001..12088, 16001..16053   value 0x42a5b8: 16001..16053, 20001..20108
 *
 * (16001 and 20001 are tested apart, `je` before the subtraction, and handled
 * outside the tables.) Every slot inside a band leads to a handler of its own.
 * Measured over every script in the TAOOT, Timelapse and Dust trees — 137k,
 * 141k and 20k engine calls — no shipped call falls outside, so this only
 * answers what a script the games never shipped would meet. Only ids in the
 * command range are asked: the 24xxx effect names are values, not calls.
 */
export function dispatches(v: number, id: number, asValue: boolean): boolean {
  if (id < 12000 || id >= 24000) return true;
  const [stmt12, prop16, value20] = v === 1 ? [12088, 16053, 20108] : [12110, 16056, 20121];
  if (id >= 16001 && id <= prop16) return true;
  return asValue ? id >= 20001 && id <= value20 : id >= 12001 && id <= stmt12;
}

/** the argument of command `id` that must be a boolean, or -1 */
export function booleanArg(v: number, id: number): number {
  return (v === 1 ? BOOL_ARGS_V1 : BOOL_ARGS_V4).get(id) ?? -1;
}

/**
 * Which arguments of a command must be INTEGERS — the rest of the type check
 * {@link booleanArg} does for booleans. Every command reads its arguments with
 * the expression evaluator into tagged records (TI.EXE 0x431e90, DF.EXE
 * 0x40d010) and then tests a record's tag with `cmp word ptr [rec], 4`, answering
 * error 0xe when it is not (calcdeg: TI.EXE 0x429e9e/0x429eae). Read off the
 * executables by following each implementation's records from the evaluator to
 * those tests, the command's own and its argument helpers' (0x42bc70 for two,
 * 0x42bdc0 for four…): `value` is the form a call in an expression reaches (the
 * function table, TI.EXE 0x429718/0x4297f8), `action` the statement's (0x414920/
 * 0x414ad8) — a property's getter and setter are two implementations. tl.exe
 * agrees with TI.EXE on every entry; DF.EXE's tables are its own (0x42b998/
 * 0x42ba6c, 0x41fd18/0x41fe78). Each entry names the implementation(s).
 *
 * Kept only where the evaluated records ARE the arguments — as many evaluations
 * as the shipped scripts pass arguments to that form. Some commands read an
 * argument as a raw token instead (visualeffect's effect name, 0x414f6a, is the
 * token 24001..24021 itself), so their records do not line up with the
 * argument list, and a command no shipped script calls is not listed.
 */
type IntArgs = { value?: readonly number[]; action?: readonly number[] };
const INT_ARGS_V4: ReadonlyMap<number, IntArgs> = new Map<number, IntArgs>([
  [20001, { value: [0] }], // random 0x42a900 (dispatched apart, 0x428848)
  [12004, { action: [0] }], // delay 0x415720
  [12005, { action: [3] }], // makeloop 0x43b260
  [12007, { action: [1, 2, 3, 4, 5] }], // makecricket 0x43ca40
  [12028, { action: [0] }], // haltsound 0x427110
  [12044, { action: [1] }], // puppetbevel 0x416670
  [12049, { action: [1] }], // blacktoscreen 0x415650
  [12050, { action: [1] }], // screentoblack 0x4155d0
  [12072, { action: [1] }], // turntodeg 0x43b6f0
  [12101, { action: [1, 2, 3] }], // walktoxyz 0x43b940
  [16002, { action: [1] }], // actordeg 0x40a150
  [16003, { value: [1], action: [1, 2, 3] }], // actorxyz 0x40ace0 / 0x40abc0
  [16009, { value: [0], action: [0] }], // path 0x42a830 / 0x414df0
  [16013, { action: [1] }], // propdist 0x4409b0
  [16016, { action: [1] }], // propdeg 0x440910
  [16017, { value: [1], action: [1, 2, 3] }], // propxyz 0x441640 / 0x441530
  [16018, { value: [1], action: [1, 2] }], // propxy 0x441840 / 0x441760
  [16022, { action: [0] }], // framerate 0x4153f0
  [16023, { action: [1] }], // actorspeed 0x40a3f0
  [16024, { action: [1] }], // actorscale 0x40a4a0
  [16028, { action: [1] }], // propscale 0x440c60
  [16033, { action: [0] }], // wavevolume 0x414e80
  [16035, { action: [0] }], // camerahi 0x414ce0
  [16036, { action: [1] }], // actorturn 0x40c330
  [16038, { action: [1] }], // soundpan 0x4274a0
  [16040, { action: [1] }], // soundvol 0x4271d0
  [16041, { action: [1] }], // themevol 0x4272a0
  [16042, { action: [1] }], // propvalue 0x4401f0
  [16044, { action: [1] }], // actorvalue 0x40c530
  [16049, { value: [0], action: [0, 1] }], // puppetparam 0x417270 / 0x417130
  [16051, { action: [1] }], // actorzclip 0x40c5d0
  [16052, { action: [1] }], // propzclip 0x440290
  [16055, { action: [0, 1] }], // setparam 0x404700
  [16056, { action: [0, 1] }], // stageparam 0x422db0
  [20002, { value: [0] }], // pointx 0x42a980
  [20003, { value: [0] }], // pointy 0x42a9e0
  [20004, { value: [0, 1] }], // makepoint 0x42aa40
  [20013, { value: [0] }], // indextoactor 0x40c180
  [20015, { value: [1] }], // indextosound 0x4279b0
  [20020, { value: [0] }], // indextoscene 0x4038b0
  [20022, { value: [2] }], // indextopainting 0x403ab0
  [20026, { value: [0] }], // numtostring 0x42b1a0
  [20028, { value: [0] }], // puppetevent 0x416760
  [20030, { value: [0] }], // indextocast 0x40c280
  [20032, { value: [0] }], // indextoprop 0x442940
  [20034, { value: [0] }], // indextoshop 0x442a40
  [20036, { value: [0] }], // indextoflat 0x421720
  [20040, { value: [1] }], // pointinprop 0x4413a0
  [20043, { value: [2] }], // pointinbutton 0x421e30
  [20045, { value: [1] }], // indextobutton 0x421930
  [20047, { value: [0] }], // indextopuppet 0x416f30
  [20054, { value: [2] }], // findword 0x42b3a0
  [20057, { value: [2] }], // putword 0x42b690
  [20061, { value: [0, 1] }], // calcvectx 0x42b9b0
  [20062, { value: [0, 1] }], // calcvecty 0x42ba30
  [20063, { value: [0] }], // cameraxyz 0x42bab0
  [20064, { value: [0] }], // playerxyz 0x42bb90
  [20070, { value: [0] }], // hittest 0x42a070
  [20071, { value: [0, 1] }], // calcdeg 0x429e70
  [20073, { value: [1] }], // starxyz 0x429c60
  [20076, { value: [0] }], // indextotrack 0x427a90
  [20077, { value: [0] }], // currentsound 0x427b40
  [20079, { value: [0] }], // currenttheme 0x427c00
  [20081, { value: [0, 1] }], // calcdist 0x429f20
  [20082, { value: [0, 1] }], // calcmod 0x429af0
  [20083, { value: [0] }], // actionframe 0x42a500
  [20101, { value: [0] }], // indextocricket 0x42ad10
  [20108, { value: [0] }], // sqrt 0x429a80
  [20119, { value: [1] }], // indextoview 0x404570
]);
const INT_ARGS_V1: ReadonlyMap<number, IntArgs> = new Map<number, IntArgs>([
  [20001, { value: [0] }], // random 0x42ca20 (dispatched apart, 0x42ac5b)
  [12004, { action: [0] }], // delay 0x420a90
  [12005, { action: [3] }], // makeloop 0x438c20
  [12007, { action: [1, 2, 3, 4, 5, 6] }], // makecricket 0x439a90
  [12044, { action: [1] }], // puppetbevel 0x435ef0
  [12049, { action: [1] }], // blacktoscreen 0x4209c0
  [12050, { action: [1] }], // screentoblack 0x420940
  [12072, { action: [1] }], // turntodeg 0x4390d0
  [16002, { action: [1] }], // actordeg 0x412380
  [16003, { value: [1], action: [1, 2, 3] }], // actorxyz 0x412c10 / 0x412b10
  [16004, { action: [1, 2] }], // actorxy 0x412ec0
  [16009, { value: [0], action: [0] }], // path 0x42c950 / 0x420180
  [16012, { action: [1] }], // actordist 0x412420
  [16013, { action: [1] }], // propdist 0x41c290
  [16016, { action: [1] }], // propdeg 0x41c1f0
  [16017, { value: [1], action: [1, 2, 3] }], // propxyz 0x41cc10 / 0x41cb10
  [16018, { value: [1], action: [1, 2] }], // propxy 0x41ce20 / 0x41cd30
  [16022, { action: [0] }], // framerate 0x420740
  [16023, { action: [1] }], // actorspeed 0x412620
  [16024, { action: [1] }], // actorscale 0x4126e0
  [16026, { action: [1] }], // propspeed 0x41c490
  [16028, { action: [1] }], // propscale 0x41c550
  [16033, { action: [0] }], // wavevolume 0x420210
  [16034, { value: [1], action: [1, 2] }], // currentcd 0x4131b0 / 0x4130a0
  [16036, { action: [1] }], // actorturn 0x4146a0
  [16040, { action: [1] }], // soundvol 0x407330
  [16041, { action: [1] }], // themevol 0x407400
  [16042, { action: [1] }], // propvalue 0x41bb40
  [16044, { action: [1] }], // actorvalue 0x4148b0
  [16049, { value: [0], action: [0, 1] }], // puppetparam 0x4369b0 / 0x436890
  [16051, { action: [1] }], // actorzclip 0x414950
  [16052, { action: [1] }], // propzclip 0x41bbe0
  [20002, { value: [0] }], // pointx 0x42ca90
  [20003, { value: [0] }], // pointy 0x42caf0
  [20004, { value: [0, 1] }], // makepoint 0x42cb50
  [20013, { value: [0] }], // indextoactor 0x4144f0
  [20015, { value: [1] }], // indextosound 0x407980
  [20021, { value: [0, 1] }], // sendtopostfx 0x410a90
  [20026, { value: [0] }], // numtostring 0x42d280
  [20028, { value: [0] }], // puppetevent 0x435fe0
  [20032, { value: [0] }], // indextoprop 0x41e150
  [20039, { value: [1] }], // pointinactor 0x412d30
  [20040, { value: [1] }], // pointinprop 0x41c980
  [20041, { value: [0] }], // pointinset 0x4107c0
  [20042, { value: [0] }], // pointinstage 0x401e30
  [20043, { value: [2] }], // pointinbutton 0x401ee0
  [20054, { value: [2] }], // findword 0x42d430
  [20057, { value: [2] }], // putword 0x42d710
  [20061, { value: [0, 1] }], // calcvectx 0x42da30
  [20062, { value: [0, 1] }], // calcvecty 0x42dab0
  [20063, { value: [0] }], // cameraxyz 0x42db30
  [20064, { value: [0] }], // playerxyz 0x42dc10
  [20070, { value: [0] }], // hittest 0x42c1c0
  [20071, { value: [0, 1] }], // calcdeg 0x42bfc0
  [20073, { value: [1] }], // starxyz 0x42bd90
  [20079, { value: [0] }], // currenttheme 0x407b50
  [20081, { value: [0, 1] }], // calcdist 0x42c070
  [20083, { value: [0] }], // actionframe 0x42c620
  [20096, { value: [1] }], // scenexyz 0x42bea0
  [20108, { value: [0] }], // sqrt 0x42bc20
]);

/** the arguments of command `id` that must be integers, as a value (`asValue`) or a statement */
export function integerArgs(v: number, id: number, asValue: boolean): readonly number[] {
  const e = (v === 1 ? INT_ARGS_V1 : INT_ARGS_V4).get(id);
  return (asValue ? e?.value : e?.action) ?? [];
}
