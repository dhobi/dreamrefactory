/**
 * The game itself — Skull Cracker's world, stepped a tick at a time, with no
 * page, no canvas and no clock of its own. {@link file://./walk.ts} shows it;
 * a headless run (`tests/machine`) drives it directly. See {@link tick}.
 *
 * Skull Cracker has no script to interpret: its game logic is compiled into
 * `SC.EXE`, and this is that logic ported from the disassembly, function by
 * function, with the module-level `let`s standing in for the executable's
 * globals. It lives in {@link file://./world/} — one module a subsystem, each
 * block still beside the address it cites, and the modules import one another
 * one way only, from {@link file://./world/state.ts} up to
 * {@link file://./world/loop.ts}. This file is the door: everything the page
 * and the tests take from the game, they take from here.
 */
export * from "./world/state";
export * from "./world/keys";
export * from "./world/motion";
export * from "./world/cels";
export * from "./world/camera";
export * from "./world/rooms";
export * from "./world/arsenal";
export * from "./world/blows";
export * from "./world/hurt";
export * from "./world/death";
export * from "./world/fixtures";
export * from "./world/scenery";
export * from "./world/casts";
export * from "./world/machines";
export * from "./world/foehit";
export * from "./world/shots";
export * from "./world/enemies";
export * from "./world/contact";
export * from "./world/level";
export * from "./world/loop";
