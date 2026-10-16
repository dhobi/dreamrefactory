import { decodeAudioContainer } from "../../df/audio";
import { depthV5 } from "../../df/image-v5";
import { ticksAt } from "../clock";
import { ScriptError, Value, truthy } from "../interp";
import type { ActorInstance } from "../actors";
import { FilmFrames, SphereImage } from "../maze-render";
import { pointX, pointY } from "../point";
import type { PropInstance } from "../props";
import { LIT_BY, LIT_MOVIE, Shade, contrastOf, gammaOf } from "../shading";
import type { PlayHandle } from "../audio";
import { panFrom255 } from "../scheduler";
import { BuiltinCtx } from "./context";
import { v5Registrar } from "./df5";

/**
 * DreamFactory 5's picture and sound commands — brightness, contrast, roll and
 * pitch, the sprites' own sounds — each read out of `RedJack.exe`
 * (`redjack/tools/rjdis.mts cmd NAME`). Every one answers only in a v5 game.
 *
 * Unlike the commands in df5.ts, these answer a name that is no prop or actor
 * with the exe's error 0xa (0x42c490 and 0x406550, the lookups every handler
 * here calls first, return it) rather than quietly with 0.
 */
export function registerDf5LookBuiltins(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);

  /** an integer argument, or 0xe (`cmp word [arg], 4`) */
  const int = (cmd: string, v: Value | undefined): number => {
    if (typeof v !== "number") throw new ScriptError(0xe, `${cmd}: ${String(v)} is not an integer`);
    return v | 0;
  };
  /** a string argument, or 0xe (0x410560) */
  const str = (cmd: string, v: Value | undefined): string => {
    if (typeof v !== "string") throw new ScriptError(0xe, `${cmd}: ${String(v)} is not a string`);
    return v;
  };
  const prop = (cmd: string, n: Value | undefined): PropInstance => {
    const p = session.propRuntime.get(str(cmd, n));
    if (!p) throw new ScriptError(0xa, `${cmd}: no prop "${String(n)}"`);
    return p;
  };
  const actor = (cmd: string, n: Value | undefined): ActorInstance => {
    const a = session.actorRuntime.get(str(cmd, n));
    if (!a) throw new ScriptError(0xa, `${cmd}: no actor "${String(n)}"`);
    return a;
  };
  /** a channel 1..3 for a value form (0x42c26b, 0x41adcf), or 0xa */
  const channel = (cmd: string, v: Value | undefined): number => {
    const k = int(cmd, v);
    if (k < 1 || k > 3) throw new ScriptError(0xa, `${cmd}: channel ${k}`);
    return k - 1;
  };
  const level = (v: number): number => Math.max(-255, Math.min(255, v));
  const contrast = (v: number): number => contrastOf(gammaOf(v));
  /** three integers, every one checked before anything is set (0x42be2e..0x42be4e) */
  const rgb = (cmd: string, args: Value[]): [number, number, number] =>
    [int(cmd, args[0]), int(cmd, args[1]), int(cmd, args[2])];

  /**
   * propcontrast (p, r, g, b) and actorcontrast (a, r, g, b): a sprite's own
   * gamma per channel (0x42bf40, 0x406000 -> 0x40a870), as screencontrast is the
   * screen's; (p, k) reads channel k back, 128 less the gamma (0x42c300, 0x4063c0).
   */
  const sprites = [
    ["prop", prop],
    ["actor", actor],
  ] as const;
  for (const [kind, find] of sprites) {
    r5(`${kind}contrast`, (_i, [n, ...rest]) => {
      const cmd = `${kind}contrast`;
      if (rest.length < 3) {
        const e = find(cmd, n);
        return e.contrast[channel(cmd, rest[0])];
      }
      const e = find(cmd, n);
      e.contrast = rgb(cmd, rest).map(contrast) as [number, number, number];
    });

    /**
     * proplitby (p, name) and actorlitby (a, name): which group's record the
     * sprite is drawn under — "default", "screen", "stage", "set", "movie" or
     * "puppet", any case (0x40a500); anything else is 0xa. Asked again for the
     * name it has, nothing happens (0x42c133); "default" keeps whatever group
     * it was under (0x42c16b skips the re-parent, runtime/shading.ts). With
     * one argument, the name (0x42c464 -> 0x40a680).
     */
    r5(`${kind}litby`, (_i, [n, name]) => {
      const cmd = `${kind}litby`;
      const e = find(cmd, n);
      if (name === undefined) return LIT_BY[e.litby];
      const want = str(cmd, name).toLowerCase();
      const k = (LIT_BY as readonly string[]).indexOf(want);
      if (k < 0) throw new ScriptError(0xa, `${cmd}: no light "${want}"`);
      if (k === e.litby) return;
      e.litby = k;
      if (k > 0) e.lightGroup = k;
    });
  }

  /**
   * stagebrightness, setbrightness, moviebrightness, puppetbrightness (r, g, b)
   * and their …contrast twins: the records the stage's flat, the movie's frames,
   * the puppet's layers — and every sprite lit by that group — are drawn
   * through (0x40a8f0 / 0x40aa10 with the group's index; the movie's own copies
   * at 0x40ab30 / 0x40abe0). The set's lights nothing but the sprites put under
   * it: no picture of the room is drawn through it (its slot 0x4c7958 has no
   * other reader). (k) reads channel k (0x41ad90 / 0x41ae50).
   *
   * The puppet's value forms read the MOVIE's record, not the puppet's:
   * 0x432034 and 0x432064 hand 0x41ad90 / 0x41ae50 group 4, where the statements
   * at 0x431fef / 0x43200f hand it 5. Ported as they are.
   */
  for (const name of ["stage", "set", "movie", "puppet"] as const) {
    const rec = (): Shade => session.lights[name];
    const read = (): Shade => (name === "puppet" ? session.lights.group(LIT_MOVIE)! : rec());
    r5(`${name}brightness`, (_i, args) => {
      const cmd = `${name}brightness`;
      if (args.length < 3) return read().bright[channel(cmd, args[0])];
      rec().bright = rgb(cmd, args).map(level) as [number, number, number];
    });
    r5(`${name}contrast`, (_i, args) => {
      const cmd = `${name}contrast`;
      if (args.length < 3) return read().contrast[channel(cmd, args[0])];
      rec().contrast = rgb(cmd, args).map(contrast) as [number, number, number];
    });
  }

  // ---- turning ------------------------------------------------------------

  /** an angle as the turning setters keep it: its low 24 bits (0x428b1c, 0x441a34) */
  const angle = (cmd: string, v: Value | undefined): number => int(cmd, v) & 0xffffff;

  // cameraroll (r) and cameraroll (): the camera's turn about the way it looks
  // (0x441a00 -> 0x438cf0; 0x441f10 reads it back). The room's picture and the
  // sprites in it both turn with it (MazeRuntime.spriteCamera, SphereImage.render).
  // RedJack.exe answers 0xa while its 3D pass is drawing (0x441a3a), which a
  // script can never be in the middle of here
  r5("cameraroll", (_i, [v]) => {
    const m = session.maze;
    if (v === undefined) return m?.roll ?? 0;
    const r = angle("cameraroll", v);
    m?.setRoll(r);
  });

  // proproll (p, r): a true-3D prop's turn about its own face (0x428aa0, kept at
  // +0x22 like proppitch's +0x1e — and like it, held to 24 bits). See PropRuntime.cardOf
  r5("proproll", (_i, [n, v]) => {
    const p = prop("proproll", n);
    if (v === undefined) return p.roll;
    p.roll = angle("proproll", v);
  });

  // actorpitch, actorroll (a, v): the actor's twins of proppitch and proproll
  // (0x4022a0, 0x4023b0, held to 24 bits), and actorisfacer, actorsnap (a, on)
  // of propisfacer and propsnap (0x403860, 0x403b70, which want a boolean).
  // A snapped screen actor moves with the stage's origin (0x407098). The angles
  // and the facer are kept for the script and the save: an actor is drawn as
  // the sprite it always was, true-3D or not (ActorInstance.true3d)
  r5("actorpitch", (_i, [n, v]) => {
    const a = actor("actorpitch", n);
    if (v === undefined) return a.pitch;
    a.pitch = angle("actorpitch", v);
  });
  r5("actorroll", (_i, [n, v]) => {
    const a = actor("actorroll", n);
    if (v === undefined) return a.roll;
    a.roll = angle("actorroll", v);
  });
  r5("actorisfacer", (i, [n, v]) => {
    const a = actor("actorisfacer", n);
    if (v === undefined) return i.bool(a.facer);
    a.facer = truthy(v);
  });
  r5("actorsnap", (i, [n, v]) => {
    const a = actor("actorsnap", n);
    if (v === undefined) return i.bool(a.snap);
    a.snap = truthy(v);
  });

  // ---- sound --------------------------------------------------------------

  /**
   * actorsound (a, volume, pan) and propsound (p, volume, pan): play the sound
   * of the pose the actor is in, or of the view the prop shows — the u32 at the
   * record's 0x0c (0x40840b, CastPose.sound; PropState.sound) — at a volume and
   * a pan of 0..255 (0x471fc0, 0x4721e0; the sink's units as the crickets have
   * them). A pose or view with none is 0xa (0x408243). Each has one buffer of its
   * own, "Actor Sound" and "Prop Sound" (0x4c2a50, 0x4c8494), so a new one stops
   * the last, and the same one starts again from its beginning (0x4718e0).
   *
   * And a sprite whose pictures go by the clock (a step time) and that has not
   * had its first pass yet starts its clock now, at step 0 (0x408305..0x40833a,
   * 0x42e1b5..0x42e1ea): the animation keeps time with its sound.
   */
  const channels: Record<"actor" | "prop", PlayHandle | null> = { actor: null, prop: null };
  const playOwn = (
    which: "actor" | "prop", data: Uint8Array | undefined, volume: number, pan: number,
  ): void => {
    channels[which]?.stop();
    channels[which] = null;
    if (!data) return;
    const audio = decodeAudioContainer(data);
    channels[which] = session.audio.play("sound", audio, {
      overlap: true,
      volume: Math.max(0, Math.min(1, volume / 255)),
      pan: panFrom255(pan),
    });
  };
  r5("actorsound", (_i, [n, vol, pan]) => {
    const a = actor("actorsound", n);
    const v = int("actorsound", vol);
    const p = int("actorsound", pan);
    const pose = a.pose();
    if (!pose?.sound) throw new ScriptError(0xa, `actorsound: ${a.name}'s "${a.poseName}" has no sound`);
    playOwn("actor", a.cast.cst.file.containers[pose.sound]?.data, v, p);
    if (!a.endTold && !a.poseStarted && (pose.frameTicks ?? 0) > 0) {
      a.poseStarted = true;
      a.poseTicks = ticksAt(session.clock.now);
      a.step = 0;
    }
  });
  r5("propsound", (_i, [n, vol, pan]) => {
    const p = prop("propsound", n);
    const v = int("propsound", vol);
    const pn = int("propsound", pan);
    const st = p.state();
    if (!st?.sound) throw new ScriptError(0xa, `propsound: ${p.name}'s "${p.stateName}" has no sound`);
    playOwn("prop", p.shop.shp.file.containers[st.sound]?.data, v, pn);
    if (p.animating && !p.lastTick && (st.frameTicks ?? 0) > 0) {
      // the first pass's stamp, taken now (PropRuntime.tick); any lastTick
      // but 0 says the pass has been
      p.lastTick = -1;
      p.passTicks = ticksAt(session.clock.now);
      p.frameIdx = 0;
    }
  });

  // soundexists (name): is a one-shot of that name in any open bank (0x448700,
  // the name compared whole, without regard to case)
  r5("soundexists", (i, [n]) => i.bool(!!session.audioLib.soundChunk(str("soundexists", n))));

  /**
   * soundticks (name): how long a one-shot is, in sixtieths: its byte count over
   * the i16 at 0x1a, times 60 over the rate at 0x1c, each division an integer
   * one (0x448483..0x44849e). Not in any open bank is 0xa (0x448ff0).
   */
  r5("soundticks", (_i, [n]) => {
    const d = session.audioLib.soundChunk(str("soundticks", n));
    if (!d || d.length < 0x28) throw new ScriptError(0xa, `soundticks: no sound "${String(n)}"`);
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const align = v.getInt16(0x1a, true);
    const rate = v.getInt32(0x1c, true);
    if (!align || !rate) return 0;
    return Math.trunc((Math.trunc(v.getInt32(0x24, true) / align) * 60) / rate);
  });

  /**
   * countpuppetsounds () and indextopuppetsoundname (n), indextopuppetsubtitle
   * (n): the open puppet's lines — their count (the i16 at 0x6e, 0x4301f3), and
   * the n-th's sound name (+0x118) or subtitle (+0x18), n in 1..count or 0xa
   * (0x430220, 0x430300). No puppet open is 0x2d (0x4301ca).
   */
  const lines = (cmd: string) => {
    const pup = session.puppet?.pup;
    if (!pup) throw new ScriptError(0x2d, `${cmd}: no puppet open`);
    const c0 = pup.file.containers[0].data;
    const count = c0.length >= 0x70 ? new DataView(c0.buffer, c0.byteOffset, c0.byteLength).getInt16(0x6e, true) : 0;
    return { pup, c0, count };
  };
  const line = (cmd: string, n: Value | undefined) => {
    const k = int(cmd, n);
    const { pup, c0, count } = lines(cmd);
    if (k < 1 || k > count) throw new ScriptError(0xa, `${cmd} (${k}): ${count} lines`);
    const at = 0x70 + (k - 1) * 312;
    const d = [...pup.dialogue.values()].find((x) => x.record === at);
    // a line whose ident a later one repeats is not in the map; its bytes are
    const pstr = (o: number): string => String.fromCharCode(...c0.subarray(at + o + 1, at + o + 1 + (c0[at + o] ?? 0)));
    return { ident: d?.ident ?? pstr(0x118), text: d?.text ?? pstr(0x18) };
  };
  r5("countpuppetsounds", () => lines("countpuppetsounds").count);
  r5("indextopuppetsoundname", (_i, [n]) => line("indextopuppetsoundname", n).ident);
  r5("indextopuppetsubtitle", (_i, [n]) => line("indextopuppetsubtitle", n).text);

  // ---- other --------------------------------------------------------------

  // actorseek (a) and propseek (p): read every pose's (view's) record, sound and
  // first picture into memory ahead of need (0x402ab0 -> 0x407560 with 1,
  // 0x429010 -> 0x42d410). The port reads a file whole the first time it is
  // asked, so only the name is checked
  r5("actorseek", (_i, [n]) => void actor("actorseek", n));
  r5("propseek", (_i, [n]) => void prop("propseek", n));

  /**
   * setcolor (point) and setdepth (point): what the room shows at a screen point
   * — the colour, 0x00RRGGBB as calcrgb makes it, or how far away the scenery
   * there is — and 0 outside the room's view or with no room open (0x4392c0,
   * 0x4391f0). At a node the sphere is asked (0x4973a0, SphereImage.at); on film,
   * the film's frame and the depths behind it (0x43933e, 0x439295 -> 0x44c7f0).
   */
  let spheres: { file: object; picture: Map<number, SphereImage>; depth: Map<number, SphereImage> } | null = null;
  let film: { file: object; container: number; frames: FilmFrames } | null = null;
  const roomAt = (cmd: string, pt: Value | undefined, depth: boolean): number => {
    const point = int(cmd, pt);
    const m = session.maze;
    if (!m) return 0;
    const x = pointX(point);
    const y = pointY(point);
    const { width, height } = m.size;
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const file = m.sett.file;
    const shotFrame = m.walkFrame() ?? (m.shot ? m.shot.film.frames[m.shot.frame] : null);
    const run = m.walk ?? m.shot;
    if (shotFrame && run) {
      const d = file.containers[shotFrame.picture]?.data;
      if (depth) {
        const map = d ? depthV5(d) : null;
        return map && x < map.w && y < map.h ? map.z[y * map.w + x] : 0;
      }
      if (film?.file !== file || film.container !== run.film.container) {
        film = { file, container: run.film.container, frames: new FilmFrames(file, run.film.frames.map((f) => f.picture)) };
      }
      const out = new Uint32Array(width * height);
      return film.frames.render(run.frame, out, width, height) ? rgbOf(out[y * width + x]) : 0;
    }
    const cam = m.camera();
    if (!m.node || !cam) return 0;
    if (spheres?.file !== file) spheres = { file, picture: new Map(), depth: new Map() };
    const cache = depth ? spheres.depth : spheres.picture;
    let s = cache.get(m.node.sphere);
    if (!s) {
      cache.clear();
      s = new SphereImage(file, m.node.sphere, depth);
      cache.set(m.node.sphere, s);
    }
    const v = s.at(x, y, width, height, cam);
    return depth ? v : rgbOf(v);
  };
  /** a little-endian RGBA word as the engine's 0x00RRGGBB */
  const rgbOf = (w: number): number => ((w & 0xff) << 16) | (w & 0xff00) | ((w >>> 16) & 0xff);
  r5("setcolor", (_i, [pt]) => roomAt("setcolor", pt, false));
  r5("setdepth", (_i, [pt]) => roomAt("setdepth", pt, true));

  // stagecolor (point): the colour of the open stage's flat at a screen point,
  // the stage's origin taken off (0x417295), 0x00RRGGBB; 0 off the flat or with
  // no stage open (0x417200)
  r5("stagecolor", (_i, [pt]) => {
    const point = int("stagecolor", pt);
    const flat = session.stageCtrl.flatImage();
    if (!flat) return 0;
    const x = pointX(point) - session.stageOrigin.x;
    const y = pointY(point) - session.stageOrigin.y;
    if (x < 0 || y < 0 || x >= flat.width || y >= flat.height) return 0;
    const c = flat.pixels[y * flat.width + x] * 4;
    return (flat.palette[c] << 16) | (flat.palette[c + 1] << 8) | flat.palette[c + 2];
  });
}
