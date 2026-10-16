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
export * from "./state";
export * from "./keys";
export * from "./motion";
export * from "./cels";
export * from "./camera";
export * from "./rooms";
export * from "./arsenal";
export * from "./blows";
export * from "./hurt";
export * from "./death";
export * from "./fixtures";
export * from "./scenery";
export * from "./casts";
export * from "./machines";
export * from "./foehit";
export * from "./shots";
export * from "./enemies";
export * from "./contact";
export * from "./level";
export * from "./loop";
