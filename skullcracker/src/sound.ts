/**
 * The game's own sound: sixteen arranged themes and the banks the handlers play
 * their one-shots out of.
 *
 * ## What a `.SND` is
 *
 * A DreamFactory 4 audio bank, the same one Titanic spells `.TRK` and Timelapse
 * `.SFX` — and the engine has read that format for a long time. One field kept
 * Skull Cracker's shut: `readBankTables` took the loop table to be container 1,
 * which is true of 615 of the 630 v4 banks on the four discs and false of exactly
 * the fifteen that are this game's music. Container 0's own pointer at +28 says
 * where it is (`THEME01` puts it in 12, with its bars in 1..11), and reading that
 * field opens all 24 banks. See `engine/tests/skull-sound.ts`.
 *
 * ## Which bank a level uses
 *
 * Every one of the 23 bank names in `SC.EXE` is a Pascal string referenced from
 * exactly ONE place, and each place is `0x40ea80(slot, name, flag)` — the open —
 * so the whole arrangement can be read off by pairing each name's reference with
 * the `.SBK` opened beside it:
 *
 * ```
 *   0x412c3a  theme13 + maze.sbk        0x43698e  mall.snd   -> 0x4a75b0
 *   0x4164fa  theme14 + barrel.sbk      0x436f7b  theme06 + mall.sbk
 *   0x417b4a  theme15 + lab.sbk         0x43beeb  theme07 + service.sbk
 *   0x419b2e  theme16 + vat.sbk         0x43d37a  theme03 + sewer.sbk
 *   0x41267e  lab.snd    -> 0x4a56d0    0x44058b  theme08 + arcade.sbk
 *   0x4128c2  boggs.snd  -> 0x4a56d0    0x44d72e  woods.snd  -> 0x4a7910
 *   0x41f2ee  belfry.snd -> 0x4a5870    0x44dc1e  theme01 + streets.sbk
 *   0x41f95a  theme09 + grave.sbk       0x4515de  theme02 + city.sbk
 *   0x421eda  theme10 + cavern.sbk      0x453fde  theme04 + woods.sbk
 *   0x42422a  theme11 + ravecave.sbk    0x45526a  theme05 + playgr.sbk
 *   0x42584b  theme12 + tower.sbk       0x42e3bc  skulz.snd  -> 0x4ac3e0
 *                                       0x4488cd  bones.snd  -> 0x4ac3e0
 * ```
 *
 * Which is four slots and a pattern: `0x4ac370` holds the LEVEL's theme,
 * `0x4ac3e0` the CHARACTER's own sounds — `skulz.snd` for SKULLCRACKER and
 * `bones.snd` for the second character `0x46b1a8` selects — and one slot per
 * chapter for its creatures and its furniture. `THEME00` is the one bank nothing
 * in `SC.EXE` names.
 *
 * ## How a sound is placed
 *
 * `0x40ef30(bank, index, point)` plays one-shot number `index` — a record index
 * in the one-shot table, not a name — and `0x40efb0` turns the point into a volume
 * and a pan against the camera rect `0x4309d0` returns:
 *
 * ```
 *   centre = (left + 256, top + 192)                 the middle of the view
 *   if |dx| > 768 or |dy| > 768: do not play at all
 *   pan    = (dx + 768) * 128 / 1536                 0..128, 64 dead centre
 *   volume = 128 - (|dx| + |dy|) * 128 / 768         Manhattan, and it is linear
 * ```
 *
 * So a sound fades with the distance from the middle of the screen and is silent
 * three quarters of a screen-width past its edge. {@link REACH} and
 * {@link Sounds.place} are those four lines.
 *
 * `0x40f090` is the same function with one call different at the end (`0x427d20`
 * where `0x40ef30` calls `0x427b20`) — both deaths use it and every other sound
 * uses the first, which is why they are not told apart here.
 */
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { readBankTables, type BankTables } from "@dreamfactory/engine/df/banks";
import { decodeAudioContainer } from "@dreamfactory/engine/df/audio";
import type { SkullFiles } from "./files";

/** the camera-relative rule `0x40efb0` computes, in its own numbers */
export const REACH = {
  /** `add word ptr [esp+0x16], 0x100` — half the 512-wide view */
  centreX: 256,
  /** `add word ptr [esp+0x14], 0xc0` — half of 384 */
  centreY: 192,
  /** `lea eax, [esi ± 0x300]` — the cutoff, and the divisor of both curves */
  span: 768,
  from: "0x40efb0",
} as const;

/**
 * Which theme and which effects bank each level opens — the table above, keyed by
 * the book name this page already knows a level by.
 *
 * A chapter's effects bank is opened by the chapter's own entry function rather
 * than by the level, which is why four levels share one: the exception is VAT,
 * whose branch opens `boggs.snd` over the `lab.snd` its three siblings use
 * (`0x4128c2`, and `0x4128dd` calls VAT's own function straight after).
 */
export const LEVEL_BANKS: Readonly<Record<string, { theme: string; sfx: string }>> = {
  MAZE: { theme: "theme13.snd", sfx: "lab.snd" },
  BARREL: { theme: "theme14.snd", sfx: "lab.snd" },
  LAB: { theme: "theme15.snd", sfx: "lab.snd" },
  VAT: { theme: "theme16.snd", sfx: "boggs.snd" },
  GRAVE: { theme: "theme09.snd", sfx: "belfry.snd" },
  CAVERN: { theme: "theme10.snd", sfx: "belfry.snd" },
  RAVECAVE: { theme: "theme11.snd", sfx: "belfry.snd" },
  TOWER: { theme: "theme12.snd", sfx: "belfry.snd" },
  MALL: { theme: "theme06.snd", sfx: "mall.snd" },
  SERVICE: { theme: "theme07.snd", sfx: "mall.snd" },
  SEWER: { theme: "theme03.snd", sfx: "mall.snd" },
  ARCADE: { theme: "theme08.snd", sfx: "mall.snd" },
  STREETS: { theme: "theme01.snd", sfx: "woods.snd" },
  CITY: { theme: "theme02.snd", sfx: "woods.snd" },
  WOODS: { theme: "theme04.snd", sfx: "woods.snd" },
  PLAYGR: { theme: "theme05.snd", sfx: "woods.snd" },
};

/** the character's own bank — `0x42e3bc` opens it into `0x4ac3e0` */
export const PLAYER_BANK = "skulz.snd";

/**
 * The player's own indices, out of `skulz.snd`, with the sites that play them.
 *
 * Every one of these is a record index in that bank's one-shot table, and the
 * names the table gives them are the check: 0 and 1 are `#0050 skull ste[p]` and
 * `#0060 skull ste[p]`, 2 and 3 are the two `ladder st[ep]`s, and 6..9 are
 * `fist ha!`, `fist ha!2` and two `fist swis[h]`es.
 */
export const OWN = {
  /**
   * The two footfalls, and the engine fires them off the WALK CYCLE's frame
   * number rather than off a timer: `0x429b3d` plays 0 when `obj+0x42` is 1 and
   * `0x429b5c` plays 1 when it is 6. Twelve cels, two steps.
   */
  step: [0, 1] as const,
  stepFrames: [1, 6] as const,
  /**
   * A rung, alternating with the climb tag — the ladder state plays 3 as it
   * installs tags 1 and 3, and 2 as it installs 0 and 2 (`0x42b00a`, `0x42b043`,
   * `0x42b098`, `0x42b0d3`). One hand, then the other.
   */
  rung: [2, 3] as const,
  /** `0x434540(4) + 5` — the same four for the punch and the kick */
  swing: [6, 7, 8, 9] as const,
  /** `0x429a76` and `0x429e07`: pressing J plays one sound, always this one */
  jump: 7,
  /**
   * Taking one — `0x4490f0` plays `12 + 0x434540(2)`, so 13 or 14, out of the
   * player's own bank as the blow lands.
   */
  hurt: [13, 14] as const,
  /** `0x42a172`: the landing tag goes in with this one... */
  land: 4,
  /** ...and `0x42a126`, a fall past 360, with this one and ten health off */
  landHard: 5,
  from: "0x429990 / 0x429b80 / 0x42ae50",
} as const;

/**
 * The chapter's own indices, out of `woods.snd` — this port's classes are all
 * chapter four's ({@link file://./foes.ts}), so these are the only creature
 * sounds it can ask for.
 *
 * The names are again the check, and they are what settles that this reading is
 * real rather than arithmetic that happens to land in range: `0040 hydrant`,
 * `0050 mailbox fa[lls]`, `0150 rat gets s[quashed]`, `0560 wolf death`, and
 * 36..39 are the four takes `0590 wolf hit s`, `0600 wolf hit 1`, `0610 wolf hit
 * 2`, `0620 wolf hit 3`.
 */
export const FOE_SFX = {
  /** `0x44fb8d` — the burst, played as the water object is created */
  hydrant: 4,
  /** `0x44feea` — a blow that dents or topples it */
  mailbox: 5,
  /** `0x44e423` — one blow of any size, and the rat is done */
  rat: 12,
  /** `0x44f15a`: `0x434540(4) + 0x23`, and `0x44f942` for the other punk */
  punkHit: [36, 37, 38, 39] as const,
  /** `0x44f184` — through `0x40f090`, on the blow that takes its health under 0 */
  wereaDeath: 0x21,
  /** `0x44f965` — the chain-carrying one drops its chain instead */
  werebDeath: 0x1b,
  /** `0x454828` — the big one takes ONE sound, with no `0x434540` behind it */
  weredHit: 0x27,
  /** `0x45485b` — and dies on this one, through `0x40f090` like the others */
  weredDeath: 0x1f,
  /** `0x454669` and `0x4546c4` — the two beats of the hatch, as it splits open */
  weredHatch: 0x20,
  /**
   * The dog's five, and `woods.snd`'s own names are the check on every one of
   * them: 20 is "0400 wolfy running", 21 "0410 wolfy look", 22 "0415 wolfy hit",
   * 23 "0420 wolfy bark" and 24 "0440 wolfy death". The class calls 20 when it
   * breaks into a trot (`0x454caf`), 21 as it sniffs (`0x454dd6`), 23 as it barks
   * or leaps (`0x454cfb` and three more), 22 on a blow (`0x4551b7`) and 24 on the
   * one that finishes it (`0x4551d4`).
   */
  dogHit: 0x16,
  dogDeath: 0x18,
  /**
   * Level five's, and these come out of a DIFFERENT bank — `mall.snd`, which
   * chapter two shares the way chapter four shares `woods.snd`. `0x43906d` plays
   * 4 on a blow that lands on the masked one and `0x439ad1` plays 12 on the one
   * with the bat; neither has a death sound of its own, and neither randomises.
   */
  maskboyHit: 4,
  batboyHit: 12,
  knotboyHit: 9,
  /**
   * ...and the three of them waking. Every enemy in level five stands dormant
   * until the player's point crosses its own record's rect, and each plays one
   * sound as it starts walking: `0x4388f4` the masked one, `0x43937b` the one
   * with the bat, `0x437c5a` the third.
   */
  maskboyWake: 3,
  batboyWake: 11,
  knotboyWake: 8,
  /**
   * Level six's two, out of the same chapter bank.
   *
   * The one with the knife takes the gang's shape exactly — `0x439dd0` wakes it
   * with 14 and `0x43a6d1` plays 15 on a blow — and adds one its siblings share
   * but MALL never reaches: `0x43a695` plays 11 when the thing that hit it was
   * GOOP, which heals rather than hurts.
   *
   * The one at the end of the level is not of the gang and sounds nothing like
   * it: one index, `0x43d31b`'s 0x45, on every blow that does not kill it.
   */
  knifeboyWake: 14,
  knifeboyHit: 15,
  knifeboyFed: 11,
  hardcoreHit: 0x45,
  /**
   * Level seven's two, out of the same chapter bank again.
   *
   * The floating eye takes one sound on every blow (`0x43e8fc`) and has a whole
   * ceremony for dying: `0x43e942` stops a LOOP it has been running at 0x38 and
   * `0x43e964` plays 0x3a over the burst. The thing in the pipe is plainer —
   * 0x33 on a blow, 0x34 as it goes down — but its flinch picks a sound with the
   * tag: `0x43fa9e` adds the roll to 0x2f, so 47, 48 or 49 with the take.
   */
  eyeballHit: 0x39,
  eyeballLoop: 0x38,
  eyeballDeath: 0x3a,
  oxHit: 0x33,
  oxDeath: 0x34,
  oxFlinch: [47, 48, 49] as const,
  /**
   * The thing at the end of chapter two. `0x441dc9` takes `0x434540(2) + 0x17`
   * on every blow — 23 or 24 — and the same pair answers a flare; `0x441d72`
   * plays 0x13 on top of the flare's own reaction, and `0x441e26` stops the
   * loop it has been running at 0x17 as it goes down.
   */
  kraggHit: [23, 24] as const,
  kraggFlare: 0x13,
  kraggLoop: 0x17,
  /**
   * Chapter THREE's, out of `belfry.snd`, and its names are again the check:
   * 12..18 are `0040 zombie die`, `0041 zombie a4`, `0042 zombie tak`,
   * `0043 zombie get`, `0045 zombie bre` and `0046 zombie bre`, 3 is
   * `0020 hands brea[k]`, 58 is `0136 grave pull` and 49 `0100 skull muff[led]`
   * — the one the player makes going into a hole.
   */
  zombHit: 0xf,
  zombDeath: 0xc,
  /** `0x421135` — what a closed grave plays as it throws you off it */
  gravePull: 0x3a,
  /** `0x421256` — and what you make on the way down */
  graveTake: 0x31,
  /** `0x4211e4` and `0x420c8b` — the hand, coming up and going down */
  hand: 3,
  /** `0x42332c` — `0012 bat hit`, and a bat dies to any blow at all */
  batDeath: 2,
  /** `0x422bcb` and `0x422cd7` — `0096 GHENGIS ST` and `0090 GHENGIS SN` */
  ghengisHit: 0x2a,
  ghengisDeath: 0x2f,
  /** `0x423ac4` — `0053 skeleton z` */
  skelHit: 0x16,
  /** `0x4224xx` — `0124 bridge cru` as one gives way, `0125 bridge cav` after */
  bridgeCrack: 0x34,
  bridgeFall: 0x35,
  /** `0x423d9d` — `0070 swiningbla[de]` */
  axe: 0x20,
  /** `0x425058` and `0x4250c8` — the wraith, hit and gone */
  wraithHit: 0x21,
  wraithDeath: 0x29,
  /** `0x42704a` and `0x427075` — `0120 floor crea[ks]` then `0121 floor cave[s]` */
  floorCreak: 0x32,
  floorCave: 0x33,
  /** `0x426aa8` — `0134 surge` */
  surge: 0x38,
  /** `0x426582` and `0x4265dd` — and belfry.snd calls it the BISHOP */
  priestHit: 2,
  priestDeath: 0x1e,
  /**
   * Chapter FOUR's, out of `lab.snd`, and its names are the check again — they
   * are also what the classes are actually CALLED. `initcop` is the TCop:
   * 14..17 are `#0085 TCop eats` and three `TCop punc[h]`es, 13 is
   * `#0084 TCop Dies`. 19 and 20 are `#0100 claw wizz` and `#0101 clawclamp`.
   */
  copHit: [14, 15, 16, 17] as const,
  copDeath: 13,
  /** `0x417a7c` and `0x417ab8` — the claw, travelling and closing */
  clawMove: 19,
  clawShut: 20,
  /**
   * LAB's three, and the names are the classes' own: 5 and 6 are
   * `#0061 Pukeboy d[ies]` and `#0062 Pukeboy p[unched]` — `0x418362` rolls
   * `0x434540(2) + 5` between them — 0x25 is `#2013 arm hit` and 0x19 is
   * `#0201 test tube`.
   */
  pukeHit: [5, 6] as const,
  pukeDeath: 5,
  armHit: 0x25,
  tube: 0x19,
  /** `0x43b6a3` — `mall.snd` names index 32 "#0120 coke mach[ine]" */
  cokeHit: 32,
  /**
   * The boss of level four, out of the same `woods.snd` its chapter shares.
   *
   * `0x455a14` wakes it with 0x2c, `0x455a55` runs 0x2b under the stirring as a
   * LOOP, `0x456459` takes `0x434540(3) + 0x2c` on a blow — one of 45, 46, 47 —
   * `0x4564c6` plays 48 as it goes down, and `0x456418` loops 51 over the death.
   */
  boolyWake: 0x2c,
  boolyStir: 0x2b,
  boolyHit: [45, 46, 47] as const,
  boolyKnock: 48,
  boolyDeath: 51,
  from: "0x44f0a0 / 0x44f8b0 / 0x44e3f0 / 0x44fe80 / 0x44fb20",
} as const;

/** one bank, its tables read and its chunks decoded as they are asked for */
interface Bank {
  name: string;
  tables: BankTables;
  /** container location -> the decoded buffer, once decoded */
  buffers: Map<number, AudioBuffer>;
  /** the raw containers, for decoding on demand */
  data: Uint8Array[];
  order: "le" | "be";
}

/** how far ahead of the clock the theme keeps its bars queued, in seconds */
const QUEUE_AHEAD = 0.75;

/**
 * The page's sound, and it is all optional: a page with no `AudioContext`, a
 * rip with no banks, or a browser that will not start audio without a gesture all
 * end up here doing nothing, which is what the film player already does.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private banks = new Map<string, Bank | null>();
  /** the level's two banks, once its own names are known */
  private themeName = "";
  private sfxName = "";
  /** where the camera is, in world coordinates — the middle of the view */
  private eye = { x: 0, y: 0 };
  /** the theme's place in its own play order, and the clock it is queued to */
  private step = 0;
  private queuedTo = 0;
  private playing = false;
  /** the bars already handed to the clock, so a level change can take them back */
  private queued: AudioBufferSourceNode[] = [];
  private muted = false;
  /** what this page has been asked for and could not find */
  readonly misses: string[] = [];

  constructor(private readonly files: SkullFiles) {}

  /** on, off, and what the status line says about it */
  get on(): boolean {
    return this.playing;
  }

  get theme(): string {
    return this.themeName.replace(/\.snd$/, "");
  }

  get sfx(): string {
    return this.sfxName.replace(/\.snd$/, "");
  }

  /**
   * The gesture gate. Every browser starts an `AudioContext` suspended until the
   * user has touched the page, and this page is played with the keyboard, so the
   * first key is the gesture — the caller hands it over and everything after that
   * just works.
   */
  resume(): void {
    const ctx = this.context();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  /** open a level's two banks, and start its theme from the top */
  async open(book: string): Promise<void> {
    const want = LEVEL_BANKS[book.toUpperCase()];
    if (!want) return;
    this.stop();
    this.themeName = want.theme;
    this.sfxName = want.sfx;
    await Promise.all([this.bank(want.theme), this.bank(want.sfx), this.bank(PLAYER_BANK)]);
    this.step = 0;
    this.queuedTo = 0;
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
    this.queuedTo = 0;
    // a bar scheduled ahead of the clock would otherwise play into the next level
    for (const src of this.queued) {
      try {
        src.stop();
      } catch {
        /* already finished */
      }
    }
    this.queued = [];
  }

  /**
   * Silence, and it is this page's — nothing in `SC.EXE`'s key table is a mute
   * (the shipped launcher has a DirectSound checkbox and the game itself has no
   * such key). The page needs one anyway.
   */
  toggle(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
    return this.muted;
  }

  get silent(): boolean {
    return this.muted;
  }

  /** the camera's centre, in world coordinates — see {@link Sounds.place} */
  listen(x: number, y: number): void {
    this.eye.x = x;
    this.eye.y = y;
  }

  private async bank(name: string): Promise<Bank | null> {
    const key = name.toLowerCase();
    const had = this.banks.get(key);
    if (had !== undefined) return had;
    const bytes = await this.files.load(key);
    if (!bytes) {
      this.misses.push(key);
      this.banks.set(key, null);
      return null;
    }
    try {
      const file = readContainerFile(bytes);
      const bank: Bank = {
        name: key,
        tables: readBankTables(file),
        buffers: new Map(),
        data: file.containers.map((c) => c.data),
        order: file.order === "be" ? "be" : "le",
      };
      this.banks.set(key, bank);
      return bank;
    } catch {
      this.misses.push(key);
      this.banks.set(key, null);
      return null;
    }
  }

  private buffer(bank: Bank, loc: number): AudioBuffer | null {
    const ctx = this.context();
    if (!ctx) return null;
    const had = bank.buffers.get(loc);
    if (had) return had;
    const raw = bank.data[loc];
    if (!raw) return null;
    try {
      const audio = decodeAudioContainer(raw, bank.order);
      const buf = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
      // a fresh Float32Array over a plain ArrayBuffer: the decoder's view may sit
      // on a SharedArrayBuffer, which copyToChannel's type will not take
      buf.copyToChannel(new Float32Array(audio.samples), 0);
      bank.buffers.set(loc, buf);
      return buf;
    } catch {
      return null;
    }
  }

  /**
   * `0x40efb0` — the volume and the pan a world point gets, or null where the
   * engine would not have played the sound at all.
   */
  private place(x: number, y: number): { gain: number; pan: number } | null {
    const dx = x - this.eye.x;
    const dy = y - this.eye.y;
    if (Math.abs(dx) > REACH.span || Math.abs(dy) > REACH.span) return null;
    const gain = 1 - (Math.abs(dx) + Math.abs(dy)) / REACH.span;
    if (gain <= 1 / 128) return null; // `cmp ax, 1; jle` — under one step, silence
    return { gain, pan: Math.max(-1, Math.min(1, dx / REACH.span)) };
  }

  /** one one-shot from the level's effects bank, at a place in the world */
  effect(index: number, x: number, y: number): void {
    void this.oneShot(this.sfxName, index, x, y);
  }

  /** one one-shot from the character's own bank */
  own(index: number, x: number, y: number): void {
    void this.oneShot(PLAYER_BANK, index, x, y);
  }

  private async oneShot(bankName: string, index: number, x: number, y: number): Promise<void> {
    if (!this.playing || !bankName) return;
    const at = this.place(x, y);
    if (!at) return;
    const ctx = this.context();
    const bank = await this.bank(bankName);
    if (!ctx || !this.master || !bank) return;
    const rec = bank.tables.singles[index];
    if (!rec) return;
    const buf = this.buffer(bank, rec.containerLoc);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = at.gain;
    // a StereoPannerNode is not everywhere; without one the sound is centred,
    // which is the part of `0x40efb0` a page can lose without losing the point
    const panner = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
    if (panner) panner.pan.value = at.pan;
    src.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(this.master);
    } else gain.connect(this.master);
    src.start();
  }

  /**
   * Keep the theme's bed queued — called once a frame, and it is the whole of the
   * music.
   *
   * A theme bank is a set of BARS and a play ORDER over them: `THEME01` is eleven
   * bars and a 62-step order that runs `1 1 5 5 5 3 4 3 4 …`, three and a third
   * minutes of arrangement out of eighteen seconds of audio. The engine's own
   * player is not read here — what is read is the table it plays from — so this
   * schedules each bar to start exactly where the last one ended, which is what a
   * bar bed needs and nothing more, and starts the order again at the end.
   */
  pump(): void {
    if (!this.playing) return;
    const ctx = this.context();
    const bank = this.banks.get(this.themeName.toLowerCase());
    if (!ctx || !this.master || !bank || ctx.state !== "running") return;
    const order = bank.tables.loopOrder;
    if (!order.length) return;
    this.queued = this.queued.filter((q) => q.context.currentTime < this.queuedTo);
    if (this.queuedTo < ctx.currentTime) this.queuedTo = ctx.currentTime + 0.05;
    let guard = 0;
    while (this.queuedTo < ctx.currentTime + QUEUE_AHEAD && guard++ < 8) {
      const rec = bank.tables.loopRecords[order[this.step % order.length] - 1];
      this.step = (this.step + 1) % order.length;
      const buf = rec ? this.buffer(bank, rec.containerLoc) : null;
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master);
      src.start(this.queuedTo);
      this.queued.push(src);
      this.queuedTo += buf.duration;
    }
  }
}
