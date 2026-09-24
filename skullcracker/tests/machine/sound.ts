/**
 * Does the game make its own noise?
 *
 *   npx tsx tests/machine/sound.ts        (from skullcracker/)
 *
 * The game asks its `Sounds` for everything it plays — `open(book)` as a level
 * stands up, `own(i)` out of the character's bank, `effect(i)` out of the
 * chapter's — so this records those calls ({@link recordSound}) and reads the
 * banks they name straight off the disc. That turns "is there music" into
 * arithmetic, because the durations are the disc's own and they are distinctive.
 *
 * `THEME01`, the theme STREETS opens (`0x44dc1e`), is eleven bars and a 62-step
 * play order that begins `1 1 5 5 5 3 4 …`. Bars 1 and 2 are 1.63s and bar 5 is
 * **6.55s**, so the first four things the bed plays are 1.63, 1.63, 6.55, 6.55 —
 * an order no other reading of the bank produces. The effects are equally
 * unmistakable: a footfall out of `skulz.snd` is 0.19s or 0.23s, and they
 * alternate because the engine fires them off the walk cycle's frame number
 * (`0x429b3d` plays sound 0 on frame 1, `0x429b5c` sound 1 on frame 6).
 *
 * The last of it is the FILMS, whose sounds are not the level's at all: they live
 * in the film's own chunk table and are named by the frame that starts a segment.
 */
import { decodeAudioContainer } from "@dreamfactory/engine/df/audio";
import { readBankTables } from "@dreamfactory/engine/df/banks";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import type { DecodedAudio } from "@dreamfactory/engine/df/audio";
import type { AudioSink, PlayHandle } from "@dreamfactory/engine/runtime/audio";
import { Film } from "../../src/film";
import { FOES } from "../../src/foes";
import { DEATH_FILMS } from "../../src/mission";
import { BANK_RANK, FOE_SFX, LEVEL_BANKS, Mixer, OWN, PLAYER_BANK, Sounds, THEME_SIDES, placeAt, priorityOf, sides } from "../../src/sound";
import { fail, headless, ok, pass, recordSound } from "./harness";

/**
 * 0. The mixer, on its own and on a clock of its own: `0x427b20`, `0x427c20`
 *    and `0x427d20`, the three tails of the three one-shot calls.
 */
{
  const cut: string[] = [];
  const m = new Mixer();
  const voice = (name: string) => () => ({ stop: () => cut.push(name) });
  const fx = (i: number) => priorityOf(BANK_RANK.chapter, i);
  // the priority is `(bank << 16) | (index + 1)` (`0x40ed63`..`0x40ed6d`)
  if (fx(0x15) !== 0x10016 || priorityOf(BANK_RANK.own, 0) !== 0x20001)
    fail(`a record's priority is (bank << 16) | (index + 1)`);
  // two free channels: the first sound takes 2 (both 0, so 1 is not the lower)
  if (m.play("mix", fx(5), 0, 1, voice("a")) !== 2) fail(`0x427b54: with both free the sound goes onto channel 2`);
  if (m.play("mix", fx(3), 0, 1, voice("b")) !== 1) fail(`...and the next onto channel 1`);
  // the same sound again while it plays: refused, not doubled, not restarted
  if (m.play("mix", fx(5), 0.5, 1, voice("a2")) !== -1 || cut.length)
    fail(`0x427b6b: the sound still playing on the other channel refuses itself`);
  // a lower one than both: refused
  if (m.play("mix", fx(2), 0.5, 1, voice("c")) !== -1) fail(`0x427b5f: a priority at or under the lower channel's is refused`);
  // a higher one replaces the LOWER channel, and cuts what was there
  if (m.play("mix", fx(9), 0.5, 1, voice("d")) !== 1 || cut.join() !== "b")
    fail(`a higher priority takes the lower channel and cuts it there and then (0x456f00); cut ${cut.join()}`);
  // the character's own outrank the whole chapter bank
  if (m.play("mix", priorityOf(BANK_RANK.own, 0), 0.5, 1, voice("e")) !== 2 || cut.join() !== "b,a")
    fail(`bank 2's lowest outranks bank 1's highest`);
  // a finished channel drops to nothing (`0x427890`)
  if (m.play("mix", fx(1), 2, 1, voice("f")) < 0) fail(`0x427890: channels whose sounds have ended are free again`);
  ok(`0x427b20: two channels by priority, a sound never doubled, the lower one cut for a higher`);

  // `0x427c20`: a tie is let through, and the same sound starts over where it is
  const r = new Mixer();
  cut.length = 0;
  r.play("mix", fx(5), 0, 1, voice("a"));
  r.play("mix", fx(3), 0, 1, voice("b"));
  if (r.play("renew", fx(5), 0.5, 1, voice("a2")) !== 2 || cut.join() !== "a")
    fail(`0x427c71/0x427c87: renewing a sound still playing restarts it on its own channel; cut ${cut.join()}`);
  if (r.play("renew", fx(2), 0.5, 1, voice("c")) !== -1) fail(`0x427c65: renew still refuses under the lower channel`);
  ok(`0x427c20: a renewed sound starts over on its own channel, and is refused only by something above it`);

  // `0x427d20`: channel 0 takes it whatever it held, and the other two are untouched
  const l = new Mixer();
  cut.length = 0;
  l.play("mix", fx(5), 0, 1, voice("a"));
  if (l.play("lead", fx(1), 0, 1, voice("x")) !== 0 || l.play("lead", fx(1), 0.1, 1, voice("y")) !== 0 || cut.join() !== "x")
    fail(`0x427d20: the lead goes onto channel 0 unconditionally, cutting the one before`);
  if (l.held(0.2)[2] !== fx(5)) fail(`...and leaves channels 1 and 2 alone`);
  ok(`0x427d20: the lead takes channel 0 whatever it held and touches nothing else`);

  // `0x40efb0`: the two numbers, and `0x427da0`/`0x427ed0` + the mixing loop's
  // `0x458ab1`/`0x458ab4`: what the speakers get
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const mid = placeAt(0, 0)!;
  if (mid.volume !== 128 || mid.pan !== 64) fail(`0x40efb0: dead centre is volume 128, pan 64; got ${JSON.stringify(mid)}`);
  const far = placeAt(768, 0);
  if (far !== null) fail(`...768 across is volume 0, which is under the gate`);
  const edge = placeAt(762, 0);
  if (edge !== null || placeAt(761, 0)?.volume !== 2) fail(`the gate is volume <= 1: 762 across is silent and 761 plays at 2`);
  if (placeAt(-384, 0)!.pan !== 32 || placeAt(384, 0)!.pan !== 96 || placeAt(0, 769) !== null)
    fail(`the pan is (dx + 768) * 128 / 1536, and 768 past on either axis is out`);
  const c = sides(128, 64);
  if (!near(c.left, (128 / 255) * (191 / 255)) || !near(c.right, (128 / 255) * (64 / 255)))
    fail(`sides: linear, volume/255 times (255 - pan)/255 left and pan/255 right; got ${JSON.stringify(c)}`);
  if (!near(c.left / c.right, 191 / 64)) fail(`...so the middle of the view is 191:64 to the left`);
  const east = sides(2, 128);
  if (!near(east.left, (2 / 255) * (127 / 255))) fail(`...and the far right is balanced`);
  if (!near(THEME_SIDES.left, 127 / 255) || !near(THEME_SIDES.right, 128 / 255))
    fail(`0x427824: a record opens at volume 0xff, pan 0x80 — 0.498 and 0.502`);
  ok(`0x40efb0 places at volume 128 - d/6 and pan (dx + 768)/12, and the mixer splits it linearly, 191:64 in the middle`);
}

const h = await headless("level=1&x=9500");
const { game } = h;
const calls = recordSound(game);
await h.load("level=1&x=9500");

/** a bank off the disc: its tables, and each record's length and rate */
const bank = async (name: string) => {
  const bytes = await game.files.load(name.toLowerCase());
  if (!bytes) fail(`${name} is not in the rip`);
  const file = readContainerFile(bytes!);
  const tables = readBankTables(file);
  const order = file.order === "be" ? "be" : "le";
  const audio = (loc: number): DecodedAudio => decodeAudioContainer(file.containers[loc].data, order);
  const secs = (a: DecodedAudio): number => Number((a.samples.length / a.sampleRate).toFixed(2));
  return { tables, audio, secs };
};
const round = (s: number): number => Number(s.toFixed(2));

// 1. the theme, in the order the bank's own table gives
const opened = calls.filter((c) => c.call === "open").map((c) => String(c.args[0]).toUpperCase());
if (opened.at(-1) !== "STREETS") fail(`STREETS should open its own banks; the game opened ${opened.join(" ") || "nothing"}`);
const want = LEVEL_BANKS.STREETS;
if (want.theme !== "theme01.snd") fail(`STREETS' theme is THEME01 (0x44dc1e); the table says ${want.theme}`);
const theme = await bank(want.theme);
const bars = theme.tables.loopOrder.slice(0, 4).map((n) => {
  const rec = theme.tables.loopRecords[n - 1];
  return theme.secs(theme.audio(rec.containerLoc));
});
if (theme.tables.loopOrder.slice(0, 2).join(" ") !== "1 1" || bars[0] !== 1.63 || bars[1] !== 1.63) {
  fail(`THEME01 opens on two 1.63s bars (its order starts 1 1); got ${theme.tables.loopOrder.slice(0, 4).join(" ")} = ${bars.join(" ")}`);
}
if (bars[2] !== 6.55) fail(`...and its third is bar 5's 6.55s; got ${bars.join(" ")}`);
ok(`the level's theme plays its own arrangement: ${bars.join(" ")}`);

// 2. every buffer is at one of the two rates the disc mixes
const own = await bank(PLAYER_BANK);
const sfx = await bank(want.sfx);
for (const b of [theme, own, sfx]) {
  const locs = [...b.tables.loopRecords, ...b.tables.singles].map((r) => r.containerLoc);
  for (const loc of locs) {
    const rate = b.audio(loc).sampleRate;
    if (rate !== 22050 && rate !== 11025) fail(`a record came out at ${rate}Hz`);
  }
}
ok(`and every record in the three banks is 22k or 11k, the disc's own rates`);

// 3. footfalls: two sounds, alternating, off the walk cycle's frames
let mark = calls.length;
h.hold("left", true);
h.frame(39);
h.hold("left", false);
const steps = calls.slice(mark).filter((c) => c.call === "own").map((c) => Number(c.args[0]));
const feet = steps.filter((i) => (OWN.step as readonly number[]).includes(i));
if (feet.length < 4) fail(`walking made ${feet.length} footfalls, wanted at least 4 (own sounds: ${steps.join(" ")})`);
for (let i = 1; i < feet.length; i++) if (feet[i] === feet[i - 1]) fail(`the footfalls should alternate foot by foot; got ${feet.join(" ")}`);
const footSecs = feet.map((i) => own.secs(own.audio(own.tables.singles[i].containerLoc)));
if (!footSecs.includes(0.19) || !footSecs.includes(0.23)) fail(`the two steps are 0.19s and 0.23s; got ${footSecs.join(" ")}`);
ok(`walking alternates the two footfalls: ${footSecs.slice(0, 6).join(" ")}`);

// 4. a kick makes a swing whether or not it lands
mark = calls.length;
h.press("kick");
h.frame(10);
const swung = calls.slice(mark).filter((c) => c.call === "own" && (OWN.swing as readonly number[]).includes(Number(c.args[0])));
if (!swung.length) fail(`a kick made no swing (0x434540(4) + 5); heard ${calls.slice(mark).map((c) => `${c.call} ${c.args[0]}`).join(", ") || "nothing"}`);
ok(`a kick swings audibly (skulz.snd ${swung.map((c) => c.args[0]).join(" ")})`);

/**
 * 5. the hydrant, which is the one sound with an unarguable name.
 *
 *    `0x44fb94` plays index 4 of the chapter's bank on the frame the water is
 *    created, and index 4 of `woods.snd` is the record called "0040 hydrant".
 *    Its buffer is 1.07s — longer than a footfall and shorter than a bar.
 */
// a kick's box hangs 95..125 ahead of the player's anchor (`0x40e680`), so
// the valve is kicked from about a hundred short of it, not from on top of it
await h.load("level=1&x=8480");
h.frame(9);
// a step, not a stroll: the walk settles at twelve a frame against the drag
h.hold("right", true);
h.frame(1);
h.hold("right", false);
mark = calls.length;
const water = (): boolean => game.spawnedHere().some((e) => e.state === "burst");
for (let i = 0; i < 4 && !water(); i++) {
  h.press("kick");
  h.until(water, 8);
  h.frame(3);
}
if (!water()) fail(`the hydrant never burst, so its sound cannot be checked`);
const hit = calls.slice(mark).filter((c) => c.call === "effect").map((c) => Number(c.args[0]));
if (!hit.includes(FOE_SFX.hydrant)) fail(`the burst should play woods.snd's index ${FOE_SFX.hydrant}; played ${hit.join(" ")}`);
const rec = sfx.tables.singles[FOE_SFX.hydrant];
const hydrantSecs = sfx.secs(sfx.audio(rec.containerLoc));
if (!/hydrant/i.test(rec.identifier) || hydrantSecs !== 1.07) fail(`woods.snd ${FOE_SFX.hydrant} should be the 1.07s "0040 hydrant"; it is "${rec.identifier}" ${hydrantSecs}s`);
ok(`the hydrant bursts on its own sound: "${rec.identifier.trim()}", ${hydrantSecs}s`);

/**
 * 5b. ...and which call a death goes through. The punk's `0x44f184` plays its
 *     0x21 through `0x40f090` — the mixer's channel 0 — where the dog's
 *     `0x4551cf` plays its 0x18 through `0x40ef30`.
 */
{
  const punk = game.level!.spawned.flat().find((e) => e.kind === "initwerea");
  if (!punk) fail(`STREETS places a punk`);
  mark = calls.length;
  game.killFoe(punk, FOES.initwerea);
  const died = calls.slice(mark).find((c) => c.call === "effect" && c.args[0] === FOE_SFX.wereaDeath);
  if (!died || died.args[3] !== "lead") fail(`0x44f18b: the punk's death goes through 0x40f090; heard ${JSON.stringify(died?.args)}`);
  if (FOES.initdog.deathLead) fail(`0x4551d4: the dog's death goes through 0x40ef30`);
  ok(`a punk's death is the lead, on channel 0 (0x44f18b)`);
}

/**
 * 6. the FILMS' own one-shots, which are where nearly all of this game's
 *    speech and most of its atmosphere live.
 *
 *    Only `menu.mov` and the sixteen chapter briefings carry a loop-table bed.
 *    Everything else — Boggs' spoken orders, the seven kill vignettes, the four
 *    time-out ones — is a one-shot NAMED BY A FRAME.
 *
 *    Every one of those films is the same four-part shape: a console powering
 *    down (`soundout 2` 2.97s, `soundout 3` 0.74s), the little monitor coming on
 *    (`sound 1` 0.98s), the vignette itself, and the monitor snapping off
 *    (`Mon. OFF` 0.46s). Four fixed durations, whichever of the seven is rolled.
 *
 *    The vignette segment is also where the film's PACE is checked, because the
 *    two facts are the same fact: its frames are authored at the film's own
 *    3 ticks (50ms) and the sound over it is exactly as long as the picture —
 *    `kill1.mov`'s 186 frames against 9.29s.
 *
 *    A kill film is the LAST life's (`0x4294cb`: the lives below zero is state 9),
 *    so the death is staged with none left: CITY has no floor east of its ledge,
 *    and walking off it is a death the damage switch does not decide.
 */
const films: string[] = [];
game.ui.film = async (name: string) => {
  films.push(name);
};
await h.load("level=2&x=650");
h.frame(6);
game.stats.lives = 0;
h.hold("right", true);
h.until(() => films.length > 0, 600);
h.hold("right", false);
if (!films.length) fail(`walking off CITY's ledge with no lives left should play a kill film; none was asked for`);
const kill = films[0];
if (!(DEATH_FILMS as readonly string[]).includes(kill)) fail(`the last death plays one of KILL1..7.MOV (0x4033ca); it asked for ${kill}`);

// ...and the film itself, played by the page's own player on a clock this
// suite owns: every one-shot it starts is recorded with its length, and a
// one-shot is "done" once that much of the clock has passed
const bytes = await game.files.load(kill);
if (!bytes) fail(`${kill} is not in the rip`);
let now = performance.now();
const heard: { secs: number; at: number }[] = [];
const sink: AudioSink = {
  play(channel, audio): PlayHandle {
    const secs = audio.samples.length / audio.sampleRate;
    const at = now;
    let stopped = false;
    if (channel === "sound") heard.push({ secs: round(secs), at });
    return {
      get done() {
        return stopped || now >= at + secs * 1000;
      },
      stop() {
        stopped = true;
      },
    };
  },
  halt() {},
  isDone: () => true,
  setChannelVolume() {},
  setSuspended() {},
};
let ended = false;
let began = -1;
let stopped = -1;
let frames = 0;
const film = new Film(kill, readMovFile(bytes!), {
  audio: sink,
  paint() {},
  log() {},
  onChain() {},
  onEnd() {
    ended = true;
  },
});
for (let ms = 0; ms < 120_000 && !ended; ms++) {
  now += 1;
  film.tick(now);
  const m = /segment 3\/4 · frame \d+\/(\d+)/.exec(film.where);
  if (m) {
    if (began < 0) began = now;
    frames = Number(m[1]);
    stopped = now;
  }
}
if (!ended) fail(`${kill} never ended on the suite's clock; stuck at ${film.where}`);
if (began < 0) fail(`${kill} never reached its vignette, segment 3 of 4`);
const secs = heard.map((s) => s.secs);
for (const [dur, what] of [[2.97, "soundout 2"], [0.74, "soundout 3"], [0.98, "sound 1"], [0.46, "Mon. OFF"]] as const) {
  if (!secs.includes(dur)) fail(`the kill film should play its own "${what}" (${dur}s); heard ${secs.join(" ") || "silence"}`);
}
ok(`the last death asks for ${kill}, and it plays its four frame-entry one-shots: ${secs.join(" ")}`);
const ran = (stopped - began + 50) / 1000;
const authored = frames * 0.05;
if (Math.abs(ran - authored) > 0.06) {
  fail(`the vignette is ${frames} frames at the film's own 50ms — ${authored.toFixed(2)}s; it took ${ran.toFixed(2)}s`);
}
ok(`...and its ${frames} frames run in ${ran.toFixed(2)}s, the ${authored.toFixed(2)}s its author gave them`);

/**
 * 9. The music switch is the THEME and nothing else. `0x403cfb` starts or
 *    stops the theme bank (`0x40f190` / `0x427960`) and never touches the
 *    effects banks, so with the music off a fist is as loud as it was.
 *
 *    The real `Sounds`, on a stand-in AudioContext that counts what starts.
 */
{
  const started: number[] = [];
  const gains: { value: number }[] = [];
  const node = () => {
    const n = { connect() {}, gain: { value: 1 }, pan: { value: 0 } };
    gains.push(n.gain);
    return n;
  };
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createGain = node;
    createStereoPanner = node;
    createChannelMerger = node;
    createBuffer(_c: number, len: number, rate: number) {
      return { duration: len / rate, copyToChannel() {} };
    }
    createBufferSource() {
      const src = { buffer: null as { duration: number } | null, context: this, connect() {}, stop() {},
        start: () => started.push(src.buffer?.duration ?? 0) };
      return src;
    }
    resume() {}
  }
  const g = globalThis as { window?: unknown };
  const had = g.window;
  g.window = { AudioContext: FakeContext };
  try {
    const sounds = new Sounds(game.files);
    await sounds.open("STREETS");
    sounds.listen(0, 0);
    sounds.setMusic(false);
    if (sounds.musicOn) fail(`setMusic(false) should turn the theme off`);
    const gainsWere = gains.length;
    sounds.own(0, 0, 0);
    await new Promise((r) => setTimeout(r, 20));
    if (!started.length) fail(`with the music off a footfall should still play (0x403cfb touches only the theme); nothing started`);
    // ...and it goes out on the two linear sides `0x427da0`/`0x427ed0` give
    // the middle of the view: volume 128, pan 64
    const mid = sides(128, 64);
    const set = gains.slice(gainsWere).map((g) => g.value);
    if (!set.some((v) => Math.abs(v - mid.left) < 1e-9) || !set.some((v) => Math.abs(v - mid.right) < 1e-9))
      fail(`a sound at the eye plays ${mid.left.toFixed(3)} left and ${mid.right.toFixed(3)} right; the gains were ${set.join(" ")}`);
    const before = started.length;
    sounds.pump();
    if (started.length !== before) fail(`with the music off the theme's bed should not be queued; pump started ${started.length - before}`);
    sounds.setMusic(true);
    sounds.pump();
    if (started.length === before) fail(`with the music back on pump should queue the theme again`);
  } finally {
    g.window = had;
  }
  ok(`the music switch stops the theme and leaves every effect playing`);
}

/**
 * 10. ...and whether anything is listening changes nothing about the GAME.
 *     `0x434540` is rolled before a sound is asked for, so the same fight with
 *     no sound and with a sound attached has to end in the same place with the
 *     random stream at the same point — a roll made only when there is a
 *     `sound` to hand it to would split the two.
 */
{
  const { nextRandom } = await import("../../src/random");
  const fight = async (): Promise<string> => {
    await h.load("level=1&x=2300&damage=1&foehit=1&score=0&lives=3");
    h.hold("right", true);
    for (let i = 0; i < 240; i++) {
      if (i % 6 === 0) h.press(i % 12 === 0 ? "punch" : "kick");
      h.frame();
    }
    h.hold("right", false);
    const foes = game.spawnedHere().map((e) => `${e.kind}:${Math.round(e.x)}:${e.hp}:${e.state}`);
    return [game.stats.health, game.stats.score, Math.round(game.p.x), nextRandom(), ...foes].join(" ");
  };
  game.setSound(null);
  // once to settle what the earlier blocks left in the player's own state
  await fight();
  const quiet = await fight();
  recordSound(game);
  const heard = await fight();
  game.setSound(null);
  if (quiet !== heard) fail(`the same fight should come out the same with or without sound:\n  silent ${quiet}\n  sound  ${heard}`);
  ok(`the same fight comes out the same with sound and without — every roll is made before the sound is asked for`);
}

pass(`the level's theme is its own arrangement, and the handlers' and films' one-shots are the disc's`);
