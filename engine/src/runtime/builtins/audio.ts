import { Value, toNum, toStr } from "../interp";
import { BuiltinCtx } from "./context";

/**
 * Sound + theme playback: the sample-audio channels (sound/voice), the
 * done-polls scripts spin on, and the looping music theme (playtheme /
 * playnewtheme) with its track-bank open/close.
 */
export function registerAudioBuiltins(ctx: BuiltinCtx): void {
  const { session, interp, r, log } = ctx;

  // sound playback
  // tracks the voice line currently playing, for currentvoice()
  let voice: { name: string; handle: { done: boolean } } | null = null;
  const playNamed = (name: Value, channel: "sound" | "voice", overlap = false) => {
    // the sound channel honours soundloop() flags + tracks looping handles
    if (channel === "sound") {
      session.scheduler.playSound(toStr(name), overlap);
      return;
    }
    const audio = session.audioLib.sound(toStr(name));
    if (!audio) {
      log(`sound not found: ${toStr(name)} (banks: ${session.audioLib.bankNames.join(", ") || "none"})`);
      return;
    }
    voice = { name: toStr(name).toLowerCase(), handle: session.audio.play(channel, audio, { overlap }) };
  };
  // currentvoice(): name of the voice line playing, "" when idle. `while
  // currentvoice() = sname endwhile` spins until a line ends — like sounddone,
  // the empty loop needs a real frame yielded to progress; headless is always
  // done and resolves at once.
  r("currentvoice", async () => {
    await ctx.yieldFrame();
    return voice && !voice.handle.done ? voice.name : "";
  });
  r("voicesound", (_i, [n]) => playNamed(n, "voice"));
  r("singlesound", (_i, [n]) => playNamed(n, "sound"));
  r("multiplesound", (_i, [n]) => playNamed(n, "sound", true));
  r("bothsound", (_i, [n]) => playNamed(n, "sound"));
  r("dualsound", (_i, [n]) => playNamed(n, "sound", true));
  // haltsound(n): stops looping sounds too — TAOOT's crank cleanup relies on it
  // to end the gramophone hiss (an untracked loop would outlive the stage)
  r("haltsound", () => session.scheduler.haltSounds());
  r("haltvoice", () => session.audio.halt("voice"));
  // halttheme(): the music stops AND `currenttheme()` says so. Reporting the
  // stopped track as still playing is not cosmetic — the scripts read it back.
  // TAOOT's `transtoflat` does `savetheme = currenttheme(2); halttheme()` and
  // `transfromflat` restores with `if savetheme != currenttheme(2)`, so a name
  // that survives the halt makes the restore a no-op and the room comes back
  // silent; `quiettheme`/`loudtheme` dial a track that is not playing; and the
  // trace reported the London flat's radio still playing aboard the ship.
  r("halttheme", () => {
    session.audio.halt("theme");
    session.currentThemeName = "none";
  });
  // sounddone/voicedone: scripts spin `while not voicedone() endwhile` to wait
  // for a line/SFX to finish (TAOOT's Enigma power switch, many puppet beats). That
  // empty-body loop has no other yield, so the poll itself must give up a real
  // frame — otherwise it spins synchronously and the audio can never progress
  // to "done". Mirrors stilldown; headless returns immediately (NullAudioSink
  // is always done, so the wait resolves at once and stays deterministic).
  const audioDonePoll = (channel: "sound" | "voice") => async () => {
    await ctx.yieldFrame();
    return session.audio.isDone(channel) ? 1 : 0;
  };
  r("sounddone", audioDonePoll("sound"));
  r("voicedone", audioDonePoll("voice"));
  // currentsound(channel): the name of the SFX playing on channel 1 or 2, ""
  // if idle. Scripts test both channels to wait on / gate against a specific
  // sound — `while currentsound(1)="radioswitch" | currentsound(2)="radioswitch"
  // endwhile` (spin until the radio click ends), `if currentsound(1)="wloop" …`.
  // Like sounddone that empty busy-wait has no other yield, so the poll gives up
  // a real frame; headless has no frames and the tracked one-shot is already
  // done, so it resolves at once and stays deterministic.
  r("currentsound", async (_i, [channel]) => {
    await ctx.yieldFrame();
    return session.scheduler.currentSound(toNum(channel ?? 1));
  });
  // soundvol(name[, v]) / soundpan(name[, v]): 0..255 volume / pan for a named
  // sound, getter with one arg and setter (returns the value) with two. Scripts
  // set these immediately before playing (TAOOT's windgust ambients randomise pan+vol
  // per shot), so we stash them per name and apply on the next play; the getter
  // reads the stashed value back (BOOTFILE's cricket debug print).
  r("soundvol", (_i, [name, v]) => {
    const key = toStr(name ?? "");
    if (v === undefined) return session.scheduler.getSoundVol(key);
    session.scheduler.setSoundVol(key, toNum(v));
    return toNum(v);
  });
  r("soundpan", (_i, [name, v]) => {
    const key = toStr(name ?? "");
    if (v === undefined) return session.scheduler.getSoundPan(key);
    session.scheduler.setSoundPan(key, toNum(v));
    return toNum(v);
  });
  // apply the theme channel's master gain from the global themevolume (0..255) —
  // so a theme that starts on set entry (without its own themevol call) still
  // reflects the player's music-volume slider setting. Through the session, so
  // a later `themevol(track)` reads back the level actually in effect.
  const applyThemeVolume = (track: string) => {
    // What the script asked THIS track to play at, if it said — and only the
    // master slider otherwise. The order matters because the two games use
    // opposite ones: Dust sets the volume and then plays (its saloon scores one
    // piano at 55 from the bar and 24 from the landing above), TAOOT plays and
    // then sets. Reading the global unconditionally, as this used to, threw
    // Dust's answer away at the instant the music started.
    const asked = track ? session.volumeForTrack(track) : undefined;
    session.setThemeVolume(asked ?? toNum(interp.globals.get("themevolume") ?? 255), track || undefined);
  };
  r("playtheme", (_i, [n]) => {
    const theme = session.audioLib.theme(n === undefined ? undefined : toStr(n));
    if (!theme) {
      log(`playtheme: no theme available${n !== undefined ? ` (${toStr(n)})` : ""}`);
      return;
    }
    session.audio.play("theme", theme, { loop: true });
    session.currentThemeName = n === undefined ? "none" : toStr(n);
    applyThemeVolume(n === undefined ? "" : toStr(n));
  });
  // playnewtheme(name): swap the looping theme to a specific track/bank. Puzzle
  // scripts save the prior theme via currenttheme() and restore it afterwards
  // (TAOOT: the gramophone plays a record over the ambient theme, then puts it back).
  // playnewtheme is NOT registered: it has no opcode id, it is two lines of
  // BOOTFILE script — `playtheme(name); themevol(currenttheme(2), themevolume)` —
  // and a builtin of the same name shadowed them. What was here inlined exactly
  // those two lines, faithfully; the objection is only that a game's own script
  // should not have to get past us to run. Both halves it calls ARE real opcodes.
  // countsounds(bank)/indextosound(bank, n): enumerate the one-shot SFX in a
  // bank (1-based). Crickets pick a random ambient this way — `soundcount =
  // countsounds(soundtrack); indextosound(soundtrack, random(soundcount))`.
  r("countsounds", (_i, [bank]) => session.audioLib.soundNames(toStr(bank ?? "")).length);
  r("indextosound", (_i, [bank, idx]) =>
    session.audioLib.soundNames(toStr(bank ?? ""))[toNum(idx ?? 0) - 1] ?? "",
  );
  // counttracks()/indextotrack(n): open music-track banks (TAOOT's CTL.STG lists them).
  r("counttracks", () => session.audioLib.trackNames().length);
  r("indextotrack", (_i, [idx]) => session.audioLib.trackNames()[toNum(idx ?? 0) - 1] ?? "");
  r("opentrackfile", async (_i, [n]) => {
    await session.openTrackFile(toStr(n));
  });
  r("closetrackfile", (_i, [n]) => {
    // Unloading a bank stops what was playing OUT of it. The theme is not held
    // in a buffer of its own — it is the bank's loop chunks — so freeing the
    // bank ends the music, and the scripts are written for that. TAOOT's `sinkmovie`
    // does `putdownsinksound()` (closetrackfile "sinkN.trk") immediately before
    // `playmovie("sinkN.mov")` so the movie plays over silence, and the endgame
    // does the same before leave.mov/debris.mov. Without this the sinking
    // soundtrack played on under the ship going down and the closing narration.
    //
    // Only the bank the theme is actually playing from, though: room-to-room
    // travel closes the DEPARTING deck's bank (closeset -> putdownsound) and the
    // arriving room's setupsound plays its own, and travel within one deck's
    // themetype closes nothing at all, so ordinary music is untouched.
    const name = toStr(n ?? "");
    const closing = session.audioLib.trackNameOf(name);
    const playing = session.currentThemeName
      ? session.audioLib.trackNameOf(session.currentThemeName) ?? session.currentThemeName.toLowerCase()
      : "";
    session.audioLib.closeBank(name);
    if (closing && playing && closing === playing) {
      session.audio.halt("theme");
      session.currentThemeName = "none";
    }
  });
}
