/**
 * The page around a DreamFactory game booted by a {@link GameHost}: what
 * *Timelapse*'s, *RedJack*'s and *Dust*'s `src/main.ts` each did line for line
 * before it was here.
 *
 *   - the picture's plate, composed at the game's own size and blitted up
 *   - the log panel, which on these pages is still a deliverable
 *   - audio held until the gesture that lets a browser play it
 *   - the boot run, timed, and summed up in the log
 *   - the title card rising off the loading gauge
 *
 * What stays in each game's page is what differs: its screen, its loading page,
 * its keys and touch, and its bug report — the engine knows no site.
 */
import { DeferredAudioSink, WebAudioSink } from "../runtime/audio";
import type { GameHost } from "./host";

/** text made safe to put into the log's HTML */
export const escHtml = (s: string): string => s.replace(/[&<>]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt" }[c]};`);

/**
 * The picture is composed at the game's own size and blitted up, rather than the
 * canvas being that size and stretched by CSS.
 *
 * 640 CSS pixels in a 1920px window is a postage stamp, and the alternative to
 * this is asking the browser to draw a 640-wide canvas at, say, 1100 — a
 * non-integer nearest-neighbour UPSCALE, where some source pixels come out two
 * device pixels wide and their neighbours one. On 1996 art that reads as a limp.
 *
 * So the engine draws its own picture into the plate, one `drawImage` doubles it
 * into the page's canvas (a nearest-neighbour blit in the compositor, with
 * smoothing off), and the PAGE only ever shrinks that — a downscale of an
 * already-doubled picture, which is soft at worst.
 */
export function screenPlate(
  canvas: HTMLCanvasElement,
  screen: { width: number; height: number },
): { ctx: CanvasRenderingContext2D; plate: HTMLCanvasElement; plateCtx: CanvasRenderingContext2D } {
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const plate = document.createElement("canvas");
  plate.width = screen.width;
  plate.height = screen.height;
  const plateCtx = plate.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingEnabled = false;
  return { ctx, plate, plateCtx };
}

/** the build's version, where the page has a place for it */
export function showVersion(version: string): void {
  const verEl = document.getElementById("ver");
  if (verEl) verEl.textContent = `v${version}`;
}

/**
 * The log: a panel over the picture, opened by its button or a key.
 *
 * Two voices, and they are the two the pages' stylesheets know: `step` is
 * something the boot did, `warn` is something it had to complain about. The
 * plain lines are kept as strings as well, because a bug report carries the tail
 * of them and because the newest one is the caption under the loading gauge.
 */
export class PageLog {
  readonly lines: string[] = [];

  constructor(
    readonly el: HTMLPreElement,
    button: HTMLElement | null,
    private readonly max = 600,
  ) {
    button?.addEventListener("click", () => this.show(this.el.hidden));
  }

  /** one line of the log */
  say = (line: string, kind: "" | "step" | "warn" = ""): void => {
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    let tag = "";
    if (kind === "step") tag = "b";
    else if (kind === "warn") tag = "i";
    this.el.insertAdjacentHTML("beforeend", tag ? `<${tag}>${escHtml(line)}</${tag}>\n` : `${escHtml(line)}\n`);
    // scrollTop forces layout, so only when there is something to scroll
    if (!this.el.hidden) this.el.scrollTop = this.el.scrollHeight;
  };

  show = (open: boolean): void => {
    this.el.hidden = !open;
    if (open) this.el.scrollTop = this.el.scrollHeight;
  };

  /** a failure the page cannot go on from: said, put under the picture, and the log opened on it */
  fail(e: unknown, errEl: HTMLElement): void {
    this.say(`!! ${(e as Error).stack ?? e}`, "warn");
    errEl.textContent = `${(e as Error).message ?? e} — press b for the log`;
    this.show(true);
  }

  /** the boot, run and timed; a throw is said rather than raised, and answers false */
  async coldBoot(host: GameHost, errEl: HTMLElement): Promise<boolean> {
    this.say("coldBoot()…", "step");
    const started = performance.now();
    try {
      await host.coldBoot();
      this.say(`boot returned after ${Math.round(performance.now() - started)} ms`, "step");
      return true;
    } catch (e) {
      this.say(`!! coldBoot threw: ${(e as Error).message}`, "warn");
      errEl.textContent = `boot failed: ${(e as Error).message} — press b for the log`;
      return false;
    }
  }

  /**
   * What the boot left: where the session stands, what it fetched, and what it
   * asked for that the rip does not have. `lead` goes before the stage, for a
   * game whose rooms are worth naming too.
   */
  bootSummary(
    host: GameHost,
    files: { loads: readonly string[]; misses: readonly string[]; serverUrl(name: string): string | null },
    lead = "",
  ): void {
    const s = host.session;
    this.say(
      `${lead}stage ${s.stageName} · flat ${s.currentFlat} · ` +
        `${s.propRuntime.shops.size} shop(s) · ${s.actorRuntime.actors.size} actor(s) · ` +
        `screen owned by "${host.director.screenOwner()}"`,
      "step",
    );
    this.say(`fetched ${files.loads.length} file(s): ${files.loads.join(", ") || "(none)"}`);
    const absent = [...new Set(files.misses)].filter((m) => !files.serverUrl(m));
    this.say(
      absent.length
        ? `asked for ${absent.length} name(s) the rip does not have: ${absent.join(", ")}`
        : "every name the boot asked for is on the discs",
      absent.length ? "warn" : "step",
    );
  }
}

/**
 * Audio waits for a gesture, as every browser insists.
 *
 * Deferred rather than absent so whatever the boot starts before then is HELD
 * and started when the sink arrives, instead of being lost: a silent boot would
 * look like an audio bug when it is only an autoplay policy. {@link ensure} is
 * idempotent, because the error paths reach it too.
 */
export class GestureAudio {
  readonly sink = new DeferredAudioSink();
  private ready = false;

  constructor(private readonly say: (line: string, kind: "step") => void) {}

  ensure = (): void => {
    if (this.ready) return;
    this.ready = true;
    try {
      this.sink.attach(new WebAudioSink());
      this.say("audio attached", "step");
    } catch {
      /* no audio in this browser */
    }
  };
}

/**
 * The title card rises off the loading gauge, by FLIP; returns the one call that
 * does it, once however many paths reach it.
 *
 * Measure where it is, switch the state, measure where it landed, then play the
 * difference back as a transform. Which is not ceremony: the two states size the
 * image by DIFFERENT properties — centred by `max-height: 46vh`, risen by
 * `height: 100%` of a `clamp()`ed band — and a transition between two sizing
 * modes has nothing to interpolate. A transform does, and it is the one property
 * that animates without touching layout, which matters here because the game's
 * first film starts in the same frame this does.
 *
 * The gauge is PINNED before the switch and faded after it: it is a flex child of
 * the band the card is rising into, so the class change removes it from the
 * layout it is standing in, and freezing it at the rect it already occupies lets
 * it fade out where the player last saw it instead of jumping to the top with the
 * logo.
 */
export function titleRise(bootEl: HTMLElement, brandEl: HTMLElement | null): () => void {
  let risen = false;
  return () => {
    if (risen) return;
    risen = true;
    const bar = bootEl.getBoundingClientRect();
    if (bar.width) {
      bootEl.style.position = "fixed";
      bootEl.style.left = `${bar.left}px`;
      bootEl.style.top = `${bar.top}px`;
      bootEl.style.width = `${bar.width}px`;
    }
    const first = brandEl?.getBoundingClientRect();
    document.body.classList.remove("booting");
    document.body.classList.add("playing");
    const last = brandEl?.getBoundingClientRect();
    if (brandEl && first?.width && last?.width) {
      const k = first.width / last.width;
      const dx = first.left + first.width / 2 - (last.left + last.width / 2);
      const dy = first.top + first.height / 2 - (last.top + last.height / 2);
      brandEl.style.transition = "none";
      brandEl.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`;
      // two frames: one for the browser to accept the start pose, one to leave it
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          brandEl.style.transition = "transform 980ms cubic-bezier(.28,.74,.22,1)";
          brandEl.style.transform = "";
        }),
      );
    }
    // the gauge goes out: down, dim and blurred, under the rising card
    bootEl.style.opacity = "0";
    bootEl.style.translate = "0 18px";
    bootEl.style.filter = "blur(3px)";
    bootEl.addEventListener("transitionend", () => bootEl.remove(), { once: true });
  };
}
