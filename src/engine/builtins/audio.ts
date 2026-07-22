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
  const playNamed = (name: Value, channel: "sound" | "voice", overlap = false) => {
    // the sound channel honours soundloop() flags + tracks looping handles
    if (channel === "sound") {
      session.playSound(toStr(name), overlap);
      return;
    }
    const audio = session.audioLib.sound(toStr(name));
    if (!audio) {
      log(`sound not found: ${toStr(name)} (banks: ${session.audioLib.bankNames.join(", ") || "none"})`);
      return;
    }
    session.audio.play(channel, audio, { overlap });
  };
  r("voicesound", (_i, [n]) => playNamed(n, "voice"));
  r("singlesound", (_i, [n]) => playNamed(n, "sound"));
  r("multiplesound", (_i, [n]) => playNamed(n, "sound", true));
  r("bothsound", (_i, [n]) => playNamed(n, "sound"));
  r("dualsound", (_i, [n]) => playNamed(n, "sound", true));
  // haltsound(n): stops looping sounds too — the crank cleanup relies on it
  // to end the gramophone hiss (an untracked loop would outlive the stage)
  r("haltsound", () => session.haltSounds());
  r("haltvoice", () => session.audio.halt("voice"));
  r("halttheme", () => session.audio.halt("theme"));
  // sounddone/voicedone: scripts spin `while not voicedone() endwhile` to wait
  // for a line/SFX to finish (the Enigma power switch, many puppet beats). That
  // empty-body loop has no other yield, so the poll itself must give up a real
  // frame — otherwise it spins synchronously and the audio can never progress
  // to "done". Mirrors stilldown; headless returns immediately (NullAudioSink
  // is always done, so the wait resolves at once and stays deterministic).
  const audioDonePoll = (channel: "sound" | "voice") => async () => {
    if (session.hasRealFrames) {
      session.realYieldSeq++;
      await session.nextFrame();
    }
    return session.audio.isDone(channel) ? 1 : 0;
  };
  r("sounddone", audioDonePoll("sound"));
  r("voicedone", audioDonePoll("voice"));
  // apply the theme channel's master gain from the global themevolume (0..255) —
  // so a theme that starts on set entry (without its own themevol call) still
  // reflects the player's music-volume slider setting.
  const applyThemeVolume = () => {
    const v = toNum(interp.globals.get("themevolume") ?? 255);
    session.audio.setChannelVolume("theme", Math.max(0, Math.min(1, v / 255)));
  };
  r("playtheme", (_i, [n]) => {
    const theme = session.audioLib.theme(n === undefined ? undefined : toStr(n));
    if (!theme) {
      log(`playtheme: no theme available${n !== undefined ? ` (${toStr(n)})` : ""}`);
      return;
    }
    session.audio.play("theme", theme, { loop: true });
    session.currentThemeName = n === undefined ? "none" : toStr(n);
    applyThemeVolume();
  });
  // playnewtheme(name): swap the looping theme to a specific track/bank. Puzzle
  // scripts save the prior theme via currenttheme() and restore it afterwards
  // (the gramophone plays a record over the ambient theme, then puts it back).
  r("playnewtheme", (_i, [n]) => {
    const name = toStr(n ?? "");
    if (name === "none" || name === "") {
      session.audio.halt("theme");
      session.currentThemeName = "none";
      return;
    }
    const theme = session.audioLib.theme(name);
    if (!theme) {
      log(`playnewtheme: no theme "${name}"`);
      return;
    }
    session.audio.play("theme", theme, { loop: true });
    session.currentThemeName = name;
    applyThemeVolume();
  });
  r("opentrackfile", async (_i, [n]) => {
    await session.openTrackFile(toStr(n));
  });
  r("closetrackfile", (_i, [n]) => {
    // Only unload the bank — do NOT stop the theme. Set travel closes and
    // reopens theme tracks around transitions (BOOTFILE closes deckb/deckc/…
    // then setupsound reopens the destination's), so halting the theme here
    // would silence normal room-to-room music. A theme ends only when
    // explicitly replaced (playnewtheme) or halted (halttheme/playnewtheme "none").
    session.audioLib.closeBank(toStr(n ?? ""));
  });
}
