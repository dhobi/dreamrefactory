/**
 * The conversation runtime over a puppet written by the engine's own builder
 * (engine/src/runtime/puppet.ts, engine/src/runtime/builtins/puppets.ts): the
 * commands with no puppet open, the plaques' limits, `puppetevent`'s timeout,
 * the repeat of the last exchange, and which studio notes a subtitle keeps.
 *
 *   npx vitest run engine/tests/puppet-runtime.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { buildPupFile } from "@dreamfactory/engine/df/pup-build";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import type { PupDialogue } from "@dreamfactory/engine/df/pup";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { heardSubtitle, subtitled } from "@dreamfactory/engine/runtime/puppet";
import { GameSession } from "@dreamfactory/engine/runtime/session";

type Arg = number | string | undefined;

const art = () => ({ width: 2, height: 2, posXraw: 0, posYraw: 0, indexed: new Uint8Array(4), opaque: new Uint8Array(4).fill(1) });

const PUP = writeContainerFile(buildPupFile({
  palette: [0, 0, 0],
  boot: compileScript("code hello ()\nendcode\n"),
  stances: [{ layers: { background: [art()], jaw: [art(), art()] } }],
  dialogue: [
    { ident: "nick.001", text: "Good evening.", anim: [0, 1].map((f) => ({ layers: { background: { frame: 0 }, jaw: { frame: f } } })) },
    { ident: "nick.002", text: "Yes?" },
  ],
}).file);
const EMPTY = writeContainerFile(buildPupFile({ palette: [0, 0, 0] }).file);

function rig() {
  const files: Record<string, Uint8Array> = { "nick.pup": PUP, "empty.pup": EMPTY, "bad.pup": new Uint8Array(8) };
  const session = new GameSession((n) => files[n] ?? null, new NullAudioSink());
  const log: string[] = [];
  session.onLog = (m: string) => log.push(m);
  const call = (name: string, ...args: Arg[]) =>
    session.interp.builtins.get(name)!(session.interp, args as never, {} as never, {} as never);
  /** let a promise run to the end on the session's clock */
  const run = async <T>(p: Promise<T> | T): Promise<T> => {
    let done = false;
    const out = Promise.resolve(p).finally(() => {
      done = true;
    });
    out.catch(() => {}); // the caller has it; this only keeps it from looking unhandled meanwhile
    for (let i = 0; i < 2000 && !done; i++) {
      session.clock.advance(session.clock.now + 17);
      await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  };
  return { session, log, call, run, ctrl: session.puppetCtrl };
}

const line = (ident: string, text: string) => ({ ident, text, raw: text }) as PupDialogue;

test("which lines are subtitled, and what a studio note leaves of a line", () => {
  expect(subtitled(line("idle 2", "Hm."))).toBe(false);
  expect(subtitled(line("a.1", "   "))).toBe(false);
  expect(subtitled(line("a.1", "Hello."))).toBe(true);
  expect(heardSubtitle(line("idle 1", "* SIGHS"))).toBe("");
  // a movie note before the words goes, the words stay
  expect(heardSubtitle(line("a.1", "*Penny MOV: Look here."))).toBe("Look here.");
  // a note that is only a note says nothing
  expect(heardSubtitle(line("a.1", "* VO"))).toBe("");
  // a sound in capitals is printed as a caption prints one
  expect(heardSubtitle(line("a.1", "*LAUGHS.")).toString()).toBe("[Laughs]");
  // a direction in lower case, with no note, is not heard
  expect(heardSubtitle(line("a.1", "*looks around"))).toBe("");
  // capitals followed by the line written in another script: the written words
  expect(heardSubtitle(line("a.1", "*SIGH あい"))).toBe("あい");
  // ...unless that runs onto another line: then, with no lower case, it is all one sound
  expect(heardSubtitle(line("a.1", "*SIGH あ\nい"))).toBe("[Sigh あ\nい]");
});

test("with no puppet open every command answers nothing and changes nothing", async () => {
  const { session, call, ctrl } = rig();
  expect(await call("currentpuppet")).toBe("none");
  expect(await call("countpuppets")).toBe(0);
  expect(await call("indextopuppet")).toBe("");
  expect(await call("puppetvisible")).toBe(0);
  expect(await call("puppetevent")).toBe(-1);
  for (const c of ["puppetspeak", "puppetclear", "puppetbevel", "puppetbase", "puppetscramble", "puppetsubtitle"]) {
    await call(c);
  }
  ctrl.skipLine();
  ctrl.puppetPress(0);
  ctrl.puppetRelease(0);
  expect(ctrl.puppetFrame()).toBeNull();
  expect(session.puppet).toBeNull();
  // the render params: slot 7 (subtitles) defaults on, any other to 0
  expect(await call("puppetparam", 7)).toBe(1);
  expect(await call("puppetparam", 30)).toBe(0);
  await call("puppetgrab");
  expect(session.puppetGrab).toBe(false);
  await call("puppetgrab", 1);
  expect(session.puppetGrab).toBe(true);
});

test("opening: a file that is not there, one that does not read, one with no lines", async () => {
  const { log, call, ctrl, session } = rig();
  expect(await call("openpuppetfile")).toBe(0);
  expect(log.at(-1)).toMatch(/not available/);
  expect(await call("openpuppetfile", "bad.pup")).toBe(0);
  expect(log.at(-1)).toMatch(/^openpuppetfile: bad\.pup: /);
  expect((await ctrl.spokenWords("gone.pup")).size).toBe(0);
  expect((await ctrl.spokenWords("bad.pup")).size).toBe(0);
  expect(log.at(-1)).toMatch(/^captions: bad\.pup: /);
  expect(await call("openpuppetfile", "empty.pup")).toBe(1);
  expect(session.puppet!.pose).toBeNull();
  expect(session.puppet!.stanceIdx).toBe(0);
  expect(await call("currentpuppet")).not.toBe("none");
});

test("plaques: five at most, scrambled only with two or more, cleared by puppetclear", async () => {
  const { session, log, call } = rig();
  await call("openpuppetfile", "nick.pup");
  expect(await call("countpuppets")).toBe(1); // its boot script
  expect(await call("puppetvisible")).toBe(1);
  await call("puppetvisible", 0);
  expect(session.puppet!.visible).toBe(false);
  await call("puppetbevel");
  expect(session.puppet!.bevels).toEqual([{ text: "", id: 0 }]);
  await call("puppetscramble");
  for (let i = 1; i <= 5; i++) await call("puppetbevel", `say ${i}`, i);
  expect(session.puppet!.bevels).toHaveLength(5);
  expect(log.at(-1)).toMatch(/offered a sixth choice \("say 5"\)/);
  await call("puppetscramble");
  expect(session.puppet!.bevels.map((b) => b.id).sort()).toEqual([0, 1, 2, 3, 4]);
  await call("puppetclear");
  expect(session.puppet!.bevels).toEqual([]);
  await call("puppetsubtitle");
  expect(session.puppet!.subtitleUngated).toBe(true);
});

test("puppetbase: no name is the opening pose, an unknown line is logged, a line with no animation keeps the pose", async () => {
  const { session, log, call, ctrl } = rig();
  await call("openpuppetfile", "nick.pup");
  const opening = session.puppet!.pose;
  expect(opening).not.toBeNull();
  await call("puppetbase", "nick.001");
  await call("puppetbase", "nick.002");
  expect(session.puppet!.pose).toBe(session.puppet!.pose);
  await call("puppetbase", "nobody.1");
  expect(log.at(-1)).toBe('puppetbase: no line "nobody.1" in nick.pup');
  await call("puppetbase");
  expect(session.puppet!.pose).toBe(opening);
  expect(ctrl.puppetFrame()).toBe(opening);
});

test("puppetspeak: an unknown line is held as its own words, a known one animates and ends on its last pose", async () => {
  const { session, log, call, run, ctrl } = rig();
  await call("openpuppetfile", "nick.pup");
  const p = session.puppet!;
  // the unknown line, then the script writes its own subtitle before it is over
  const held = run(call("puppetspeak", "who goes there"));
  await new Promise((r) => setTimeout(r, 0));
  expect(p.subtitle).toBe("who goes there");
  p.subtitle = "something else";
  await held;
  expect(p.subtitle).toBe("something else");
  expect(log).toContain('puppetspeak: no line "who goes there" in nick.pup');
  // the line with an animation: the frame comes from it while it plays
  const speaking = run(call("puppetspeak", "nick.001"));
  await new Promise((r) => setTimeout(r, 0));
  expect(p.anim).not.toBeNull();
  expect(p.anim!.frames).toContain(ctrl.puppetFrame());
  await speaking;
  expect(p.anim).toBeNull();
  expect(p.subtitle).toBe("");
  // one argument too many is error 2 where calls are strict
  await expect(run(call("puppetspeak", "nick.002", 101))).rejects.toMatchObject({ code: 2 });
});

test("puppetevent: a timeout answers -2; a press off the row, or in the picture, repeats the last exchange", async () => {
  const { session, call, run, ctrl } = rig();
  session.isV5 = true; // RedJack.exe honours puppetevent's wait
  await call("openpuppetfile", "nick.pup");
  const p = session.puppet!;
  await call("puppetbevel", "Yes?", 7);
  expect(await run(call("puppetevent", 3))).toBe(-2);
  // choose one: the plaque's id, and it is remembered as the last exchange
  const asked = call("puppetevent") as Promise<number>;
  await new Promise((r) => setTimeout(r, 0));
  ctrl.puppetPress(0);
  ctrl.puppetRelease(1); // released off the row: nothing answered
  expect(p.press).toBeNull();
  ctrl.puppetChoose(0);
  expect(await asked).toBe(7);
  expect(p.lastPlaque).toEqual({ bevels: [{ text: "Yes?", id: 7 }], chosen: 0 });
  // a press in the picture while waiting says the chosen line again
  const again = call("puppetevent") as Promise<number>;
  await new Promise((r) => setTimeout(r, 0));
  ctrl.puppetPress(-1, true);
  await new Promise((r) => setTimeout(r, 0));
  expect(p.repeating).toBe(true);
  expect(p.subtitle).toBe("Yes?");
  // a second press while repeating is ignored, and a skip ends the line
  ctrl.puppetPress(-1, true);
  ctrl.skipLine();
  await run(new Promise((r) => setTimeout(r, 0)));
  expect(p.repeating).toBe(false);
  ctrl.puppetChoose(0);
  expect(await again).toBe(7);
  // released with no wait running: the press is kept, nothing is answered
  p.press = { index: 0, until: 0 };
  ctrl.puppetRelease(0);
  expect(p.chosen).toBe(0);
});

test("a repeat with no exchange yet says the lines queued since, and a skip stops it", async () => {
  const { session, call, run, ctrl } = rig();
  await call("openpuppetfile", "nick.pup");
  const p = session.puppet!;
  // nothing said and nothing chosen: a press in the picture repeats nothing
  await call("puppetbevel", "Go on.", 1);
  const asked = call("puppetevent") as Promise<number>;
  await new Promise((r) => setTimeout(r, 0));
  ctrl.puppetPress(-1, true);
  expect(p.repeating).toBe(false);
  ctrl.puppetChoose(0);
  expect(await asked).toBe(1);
  // two lines said: both queued, and the repeat says them back in order
  p.lastPlaque = null;
  await run(call("puppetspeak", "nick.001"));
  await run(call("puppetspeak", "nick.002"));
  expect(p.voiceQueue.map((l) => l.ident)).toEqual(["nick.001", "nick.002"]);
  const again = call("puppetevent") as Promise<number>;
  await new Promise((r) => setTimeout(r, 0));
  // (the wait empties the queue when it ends, so it is read before)
  ctrl.puppetPress(-1, true);
  await new Promise((r) => setTimeout(r, 0));
  expect([p.repeating, p.subtitle]).toEqual([true, "Good evening."]);
  // the plaques on show while it repeats are the last exchange's: none
  expect(p.bevels).toEqual([]);
  ctrl.skipLine();
  await run(new Promise((r) => setTimeout(r, 0)));
  expect(p.repeating).toBe(false);
  expect(p.bevels).toEqual([{ text: "Go on.", id: 1 }]);
  ctrl.puppetChoose(0);
  expect(await again).toBe(1);
});

test("puppetscript wants a puppet open and one of its scripts", async () => {
  const { session, call } = rig();
  const fails = (...args: Arg[]) => expect((async () => call("puppetscript", ...args))()).rejects;
  await fails("boot script").toMatchObject({ code: 0x2d });
  await call("openpuppetfile", "nick.pup");
  expect([...session.puppet!.scripts.keys()]).toEqual(["boot script"]);
  expect(await call("countpuppets")).toBe(1);
  expect(await call("indextopuppet", 1)).toBe("boot script");
  await call("puppetscript", "BOOT SCRIPT");
  await fails("other").toMatchObject({ code: 0xa });
  await fails().toMatchObject({ code: 0xa });
});
