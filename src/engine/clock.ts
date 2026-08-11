/**
 * Game time. TI.EXE keeps two granularities and scripts touch both:
 *
 *  * the SCRIPT TICK, 1/60 s. Confirmed in the binary twice over: `delay(n)`
 *    (0x41deb0) spins until `timeGetTime() >= start + n × 50/3` ms, and the
 *    tick counter it and the movie loop read (0x41de90) is
 *    `timeGetTime() × 3 / 50` — the same 16.667 ms unit.
 *  * the SERVICE PASS, 50 ms, below — what loops, crickets and walks advance on.
 *
 * The paced screen ramps — a `visualeffect` reveal and a `screentoblack` /
 * `blacktoscreen` fade — are on the SCRIPT TICK, not the service pass; see
 * {@link RAMP_STEP_MS}.
 *
 * The viewer feeds real/virtual time into advance(); delay() suspends scripts
 * on sleep().
 */

/**
 * The engine's master heartbeat: one service step every 50 ms (20 Hz).
 *
 * This was 66 ms for a long time, on the strength of a comment claiming TI.EXE
 * was "observed" to use it and citing nothing. 50 ms is what the game's own
 * scripts require, from two directions that don't depend on each other:
 *
 *  * TAOOT's BOOTFILE `calctime()` advances the clock one second every **20 calls**,
 *    and it is called once per main-loop pass (the loop dispatches its idle
 *    event at 0x432075 once quiet). Frank's pocketwatch is a real clock with a
 *    visible second hand, so 20 passes MUST be one real second: 50 ms a pass.
 *    Our own scheduler already had to hard-code `CALCTIME_MS = 50` to make the
 *    watch keep time — i.e. the codebase already knew this number and only the
 *    heartbeat disagreed.
 *  * A loop armed to run out an animation is armed with the animation's FRAME
 *    COUNT (house.shp's watch: `open` is 12 frames, `makeloop("prop", me,
 *    "open", 12)`; the bag's `lightopen` is 6 frames, period 6). So one step is
 *    one animation frame — and the map's 12-frame open/close, cut to the
 *    `openmap`/`closemap` sounds (0.60 s / 0.65 s), put a frame at 50–54 ms.
 *
 * At 66 ms every timed sequence in the game ran ~32% slow: BEDSIT1's air raid
 * arms `makeloop("scene", "scene1", "gotoship", 320)`, which is 16.0 s at 50 ms
 * and was taking 21.1 s — the "the bomb falls seconds too late" report that
 * started this.
 *
 * **CONFIRMED out of TI.EXE, 2026-08-06**, from a third direction that needs
 * neither of the above — the binary states 50 ms outright:
 *
 *  * the tick source (`0x41de90`) is `timeGetTime() * 3 / 50`, so one engine tick
 *    is 50/3 ms and there are exactly **60 ticks a second**;
 *  * the frame throttle (`0x43a940`) spins on it until
 *    `now >= lastFrame + [0x489efe]`, and `[0x489efe]` is what `framerate()`
 *    reads (`0x428a2e`) and `framerate(n)` writes, clamped to 0..60
 *    (`0x43e3a9`);
 *  * its default is **3** (`0x429643: mov dword ptr [0x489efe], 3`).
 *
 * 3 ticks x 50/3 ms = **50 ms a frame, 20 frames a second** — the same number, and
 * it closes the arithmetic the first bullet above opens: 20 frames a second
 * against `calctime`'s one game second per 20 calls is game time running at
 * exactly 1x, which is what a pocketwatch with a second hand has to do. The idle
 * dispatch behind it is `0x432075`, gating event id 8 on a tick deadline and
 * sending it to three script objects.
 *
 * So `Scheduler.CALCTIME_MS = 50` is not a fudge to make the watch keep time; it
 * is the frame period, measured.
 *
 * Not to be confused with the script tick: 1/60 s is `delay()`'s unit, not
 * this. A loop period is service passes, and the two are different clocks in
 * the original as much as here.
 */
export const ENGINE_STEP_MS = 50;

/**
 * One step of a paced screen ramp, in ms — TI.EXE's OTHER clock.
 *
 * Neither of its ramps is paced against the service clock. `0x41de90` reads the OS
 * millisecond timer and returns `(ms * 3) / 50` — ms/16.67, 60 per second — and
 * both spin on it for one step per tick:
 *
 *  * the WIPE pacer (0x43c600) waits until the counter reaches `timeBase + i` for
 *    strip i. So the scrapbook's `visualeffect(wipeleft, 30)` runs in half a
 *    second; at the 50 ms engine step it would crawl for one and a half.
 *  * the FADE ramps — `screentoblack` (0x43e550 -> 0x435b90) and `blacktoscreen`
 *    (0x43e5d0 -> 0x435be0) — are the same loop twice: `di = 1`, draw the blend
 *    for step `di`, `inc ebx` and spin on 0x41de90 until the counter reaches it,
 *    `inc di` while `di <= steps`. One step, one tick, in both directions.
 *
 * That second bullet was the 50 ms service pass here for a long time, which made
 * every fade in the game three times as slow as the original's. It is only
 * *noticeable* where a script asks for a long one, which is why it was reported from
 * the one place that does (#87): losing the fistfight brings the engine room back
 * over 240 steps — 4.0 s in the original, 12.0 s at the service pass — while the
 * ordinary 10-step fade the rest of the game uses went 0.17 s -> 0.50 s.
 *
 * (The engine room keeps fading in slowly for the rest of that game, and *that* is
 * the data's own doing: the boot library's `restorescreen` picks the 240 out of
 * `currentset () = "engine" & actorowner ("vlad") = "wonfight"`, and nothing ever
 * clears `wonfight`. Faithful, and four seconds rather than twelve.)
 *
 * Kept as a third of the step rather than 16.67 so the arithmetic is exact.
 */
export const RAMP_STEP_MS = ENGINE_STEP_MS / 3;

/**
 * Wall time (ms) as SCRIPT TICKS — TI.EXE's `timeGetTime() * 3 / 50` at
 * 0x41de90, the 1/60 s unit above. That function is the engine's canonical
 * "what time is it": 53 call sites read it, `delay()` builds its deadline from
 * the same arithmetic, and the displayed-frame throttle (0x43a940) compares
 * against it. Anything in the port that wants to pace like the original should
 * derive from this rather than from counting host callbacks.
 */
export const ticksAt = (ms: number): number => Math.floor((ms * 3) / 50);
export class Clock {
  now = 0;
  private waiters: { at: number; resolve: () => void }[] = [];

  sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ at: this.now + ms, resolve }));
  }

  advance(now: number): void {
    if (now <= this.now) return;
    this.now = now;
    if (!this.waiters.length) return;
    const due = this.waiters.filter((w) => w.at <= now);
    this.waiters = this.waiters.filter((w) => w.at > now);
    for (const w of due) w.resolve();
  }
}
