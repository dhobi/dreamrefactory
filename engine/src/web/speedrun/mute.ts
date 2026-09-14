/**
 * The mute switch under the picture — silence, without going through the game.
 *
 * Dust and Titanic both let a player turn the sound down, and both do it the way
 * the original does: a control drawn on a flat, reached by opening a panel the
 * run then has to close again. On a workbench that is three gestures and a
 * couple of seconds to answer a question that is not about the game at all —
 * whoever is watching a route run fifty times would like it quiet.
 *
 * So this is the LISTENER's switch and it sits outside the game entirely. It
 * does not write `wavevolume ()`, it does not open a flat, and it leaves no mark
 * on the state a route is being timed against: {@link AudioSink.setMuted}
 * multiplies over whatever volume the game has asked for, so a script that turns
 * the theme up while this is on changes only what unmuting will restore.
 *
 * Muting and not suspending, which is the distinction that matters for a
 * stopwatch: `setSuspended` stops the AudioContext clock, and a movie that waits
 * for its own voice track to finish would then wait for ever. A muted run has to
 * take exactly as long as a loud one or the number at the end is not the number.
 *
 * Remembered per game, like the picture scale beside it, because the answer is
 * about the person rather than about the session — and re-applied on every boot,
 * including the reload a `reset()` performs.
 */
import type { PanelKeys } from "./panel-keys";

const KEY = (keys: PanelKeys): string => keys.key("mute");

/** the sink the game is playing into, or null before it has booted */
function sink(): { setMuted?: (on: boolean) => void } | null {
  const dbg = (window as unknown as { dbg?: { session?: { audio?: { setMuted?: (on: boolean) => void } } } }).dbg;
  return dbg?.session?.audio ?? null;
}

export function installMute(keys: PanelKeys): void {
  const box = document.getElementById("srmute") as HTMLInputElement | null;
  if (!box) return;

  let on = false;
  try {
    on = localStorage.getItem(KEY(keys)) === "on";
  } catch {
    /* unreadable is the same as unset — the page opens with sound, as it did */
  }
  box.checked = on;

  /**
   * Told to the sink whenever there IS one.
   *
   * The switch outlives the game: this page is reloaded by `reset()` and the
   * sink is built lazily, on the first gesture the autoplay policy accepts, so a
   * box that is ticked when the module loads has nobody to tell yet.
   * `DeferredAudioSink` carries the flag across its own attach, which covers the
   * gap between boot and the first click — this interval covers the gap before
   * the boot, and stops as soon as it has been able to say it once.
   */
  const apply = (): boolean => {
    const s = sink();
    if (!s?.setMuted) return false;
    s.setMuted(box.checked);
    return true;
  };
  if (!apply()) {
    const waiting = setInterval(() => {
      if (apply()) clearInterval(waiting);
    }, 250);
  }

  box.addEventListener("change", () => {
    apply();
    try {
      localStorage.setItem(KEY(keys), box.checked ? "on" : "off");
    } catch {
      /* not remembering is survivable — the switch still holds for this tab */
    }
  });
}
