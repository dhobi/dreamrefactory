/**
 * The shared headless harness: a real GameHost over the on-disk game files.
 *
 * Lives at the root of tests/ rather than in one category because more than
 * one needs it (auto/regression.ts scenarios and playthrough/ routes), and two
 * copies of it is
 * precisely the failure this harness exists to avoid — see the note on
 * {@link newHost}.
 */
import { activeLanguage, gamefiles, gamefilesRoot } from "../tools/gamefiles";
import { GameSession } from "../src/engine/session";
import { AudioSink, NullAudioSink } from "../src/engine/audio";
import { SetViewer } from "../src/viewer";
import { GameHost } from "../src/host";

export const root = gamefilesRoot();

/**
 * A session under the REAL host (src/host.ts) — the same set activation, the
 * same prefetching, the same cold boot the browser runs. Only the two things
 * the host is parameterised on differ: files come off the disk index instead of
 * HTTP, and the sink records instead of making noise.
 *
 * This used to be a hand-rolled 7-line `onSetChange` standing in for the host's
 * 139, which is exactly why a run of host-side defects (a theme blip on entry,
 * a scene loop surviving a set swap) were invisible here: the suite tested a
 * stand-in that didn't do those things at all.
 */
export async function newHost<S extends AudioSink = NullAudioSink>(
  opts: {
    onEvict?: (name: string) => void;
    sink?: S;
    /**
     * Which `gamefiles/` tree to read — the default (`TAOOT_LANG`, else English)
     * when left out. Named for the one case where a test has to say: the 1996
     * demo is a different cut of the game, not a translation of one.
     */
    edition?: string;
    /**
     * Every time the host says the stage is showing. The page hangs real work off
     * this (src/main.ts), so how OFTEN it fires is part of the host's contract.
     */
    onShowStage?: () => void;
  } = {},
): Promise<{
  host: GameHost;
  session: GameSession;
  sink: S;
  viewer: () => SetViewer;
  logs: string[];
}> {
  // The default sink reports every non-looping play as finished the instant it
  // starts, which is what keeps a headless run deterministic — but it also
  // makes "is this sound still playing?" unanswerable, and some scripts sequence
  // themselves on exactly that (tests/auto/sound-channels.ts). Those pass their
  // own clock-driven sink.
  const sink = (opts.sink ?? new NullAudioSink()) as S;
  // Its own view of the data: a fresh session is a fresh boot, starting on disc
  // 1 (where bootfile and the opening rooms live) and then following BOOTFILE's
  // setpath(disk) as the story moves. Per-session so a test that reaches act 2
  // can't leave the next one reading post-sinking rooms.
  const index = gamefiles(root, opts.edition);
  const logs: string[] = [];
  const host = new GameHost(
    {
      provide: index.provider,
      // the disk index is synchronous; the host only needs a promise
      load: async (name) => index.provider(name),
      setDisc: (disc) => index.setDisc(disc),
      // TAOOT_LANG picks the tree; the host turns it into the code page the
      // tree's subtitles are stored in, exactly as the browser side does
      activeEdition: () => activeLanguage(root, opts.edition) ?? "",
      // The rooms this tree offers. The browser's FileStore has always answered
      // this and the harness did not, which left the cold boot of an edition with
      // no `bedsit1.set` — the demo, which needs any room at all as a surface to
      // draw its menu into — untestable here for want of one method.
      serverSetNames: () => index.names(/\.set$/),
      // nothing to free (the index reads from disk each time), but record what the
      // host asked to give back
      evict: (name) => {
        opts.onEvict?.(name);
        return 0;
      },
    },
    sink,
    { log: (l) => logs.push(l), showStage: () => opts.onShowStage?.() },
  );
  // Pre-boot, so a test that opens a room directly finds the boot library up. Only
  // for a tree the port's stand-in boot is FOR, which is the same question
  // GameHost.coldBoot asks — does this game's boot name a first room of its own:
  // a game whose `boot()` opens its own resources has to arrive at that boot
  // un-booted, or the stand-in has already opened the interface band and in-game
  // stage its menu never asked for.
  if ((await host.bootPlan()).landingSet) await host.session.ensureBooted();
  // Seed `random()`, so a suite run is a repeatable one.
  //
  // Left on Math.random, any test whose timing a script draws is a coin toss —
  // and the coin was being tossed. C73's openset arms the door-knock loop, and
  // `smethknock` re-arms itself `60 + random(180)` ticks out: whether a knock
  // cricket happens to be outstanding at the tick the test counts them therefore
  // depended on the draw. `tests/auto/regression.ts`'s "one-shot cricket removed
  // after firing" failed about two runs in five in a full suite and passed alone
  // (nothing before it had moved the stream), which reads exactly like a
  // regression from whatever else changed and is not one.
  //
  // The playthrough harness seeds its own (tests/playthrough/play.ts, SEED) for
  // the same reason and per-segment, so this only fills the gap for everything
  // else. Any fixed value would do; this one is 1912-04-15.
  host.session.seedRandom(19120415);
  return { host, session: host.session, sink, viewer: () => host.viewer!, logs };
}

/** let suspended scripts (await points, resolved delays) continue */
export const drain = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));
