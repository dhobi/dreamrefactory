/**
 * The page around a DreamFactory 0 machine (`v0/machine.ts`): what *Lunicus*'s
 * and *Jump Raven*'s `src/main.ts` each did line for line before it was here.
 *
 *   - the log under the screen, the fullscreen button and the title card
 *   - the rip: the files the machine asks for, fetched in the background while
 *     it waits (`GameFiles.want`), and the boot's gauge over the ones read
 *     before Enter
 *   - the sound: a speaker with one looping channel and one master volume
 *   - the screen drawn doubled when its version moves, and a pointer event
 *     turned into its pixels
 *   - the `.SCO` file (keys and high scores) kept in the browser, and the
 *     saved games written through the shared dialog
 *
 * What stays in each game's page is what differs: its clock (Lunicus replays
 * and is driven, Jump Raven plays itself), its status line, its menu bar and
 * dialogs, and how its hands reach the machine. The engine knows no site, so
 * the bug report is the game's to install, from {@link V0Page.bugReport}.
 */
import { SCREEN_H, SCREEN_W, type Screen } from "../v0/screen";
import type { GameFiles, Speaker } from "../v0/machine";
import { installFullscreen } from "./fullscreen";
import { pageUrl } from "./page-url";
import { browseForSave } from "./save-browser";
import type { GestureKey } from "./touch";

export const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt" }[c]};`);

/** a gesture's key, as `KeyboardEvent.key` names it */
export const GESTURE_KEYS: Record<GestureKey, string> = { uparrow: "ArrowUp", downarrow: "ArrowDown", leftarrow: "ArrowLeft", rightarrow: "ArrowRight", ".": "Escape" };

const SCALE = 2;
const BUG_NOTE_MS = 6000;

export interface V0PageOptions {
  /** the game's name, as the log and the bug report say it ("Jump Raven") */
  name: string;
  /** the year on the boot's first line */
  year: number;
  /** the package's folder, and the stem of its screenshot and stored `.sco` ("jumpraven") */
  slug: string;
  /** the rip's folder under the page ("gamefiles/RAVEN/") */
  rip: string;
  /** the site's version, shown in the band */
  version: string;
}

export interface V0Boot {
  /** what the opening reads, fetched before Enter */
  preload: readonly string[];
  /** the log's line once they are here */
  ready: string;
  /** the whole manifest, read: for what else the page lists from it */
  manifest?(manifest: Record<string, number>): void;
}

export class V0Page {
  readonly canvas = $<HTMLCanvasElement>("screen");
  /** the status line under the screen */
  readonly locEl = $<HTMLPreElement>("loc");
  private readonly ctx = this.canvas.getContext("2d")!;
  private readonly logEl = $<HTMLPreElement>("log");
  private readonly errEl = $<HTMLSpanElement>("err");
  private readonly logLines: string[] = [];

  private sizes: Record<string, number> = {};
  private readonly bytes = new Map<string, Uint8Array>();
  private readonly fetching = new Map<string, Promise<Uint8Array>>();

  private audio: AudioContext | null = null;
  /** Sound ▸ Sound Off … Level 7: the device's volume, which every sound goes through */
  private master: GainNode | null = null;
  private level = 1;
  private readonly playing = new Set<AudioBufferSourceNode>();
  /** the looping channel (Lunicus's ambience, Jump Raven's theme): one source, round and round */
  private loopSrc: AudioBufferSourceNode | null = null;

  private readonly image = this.ctx.createImageData(SCREEN_W, SCREEN_H);
  private readonly offCtx = new OffscreenCanvas(SCREEN_W, SCREEN_H).getContext("2d")!;
  private drawn = -1;

  constructor(private readonly opts: V0PageOptions) {
    this.ctx.imageSmoothingEnabled = false;
    $("ver").textContent = `v${opts.version}`;

    /** the title card, which closes the band up when it fails to load — see #brand in index.html */
    const brandEl = $<HTMLImageElement>("brand");
    const dropBrand = (): void => {
      brandEl.hidden = true;
      document.body.classList.add("nobrand");
    };
    // a module runs after parsing, so the image may already have failed by now
    if (brandEl.complete && brandEl.naturalWidth === 0) dropBrand();
    else brandEl.addEventListener("error", dropBrand);

    $("logBtn").addEventListener("click", this.toggleLog);
    installFullscreen($<HTMLButtonElement>("fsBtn"), $<HTMLDivElement>("stage"), { report: this.say, landscape: true });
  }

  /* ----------------------------------------------------------------------- *
   * The log
   * ----------------------------------------------------------------------- */

  readonly step = (line: string): void => {
    this.logLines.push(line);
    this.logEl.innerHTML += `<b>${esc(line)}</b>\n`;
  };
  readonly complain = (line: string): void => {
    this.logLines.push(line);
    this.logEl.innerHTML += `<i>${esc(line)}</i>\n`;
    this.errEl.textContent = line;
    this.logEl.hidden = false;
  };
  readonly say = (line: string): void => {
    this.logLines.push(line);
    this.logEl.innerHTML += `${esc(line)}\n`;
    this.logEl.scrollTop = this.logEl.scrollHeight;
  };
  readonly toggleLog = (): void => {
    this.logEl.hidden = !this.logEl.hidden;
  };

  /** what the site's bug report (`@dreamfactory/site/bug-report`) asks of the page */
  get bugReport() {
    const bugNote = $("bugNote");
    const { name, slug, rip, version } = this.opts;
    return {
      game: name,
      canvas: this.canvas,
      shotName: `${slug}-bug.png`,
      version,
      where: () => this.locEl.textContent ?? "",
      edition: () => `${name} CD (${rip})`,
      log: (n: number) => this.logLines.slice(-n),
      note: (how: string) => {
        bugNote.textContent =
          how === "clipboard" ? "the screen is on the clipboard — paste it into the issue" : "the screen was downloaded — attach it to the issue";
        setTimeout(() => (bugNote.textContent = ""), BUG_NOTE_MS);
      },
    };
  }

  /* ----------------------------------------------------------------------- *
   * The disc
   * ----------------------------------------------------------------------- */

  readonly fetchBytes = (path: string, onProgress?: (got: number) => void): Promise<Uint8Array> => {
    let p = this.fetching.get(path);
    if (!p) {
      p = (async () => {
        const res = await fetch(pageUrl(this.opts.rip + path));
        if (!res.ok || !res.body) throw new Error(`${path}: ${res.status}`);
        const reader = res.body.getReader();
        const parts: Uint8Array[] = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          got += value.length;
          onProgress?.(got);
        }
        const out = new Uint8Array(got);
        let at = 0;
        for (const part of parts) (out.set(part, at), (at += part.length));
        this.bytes.set(path, out);
        return out;
      })();
      p.catch((e) => this.complain(String(e)));
      this.fetching.set(path, p);
    }
    return p;
  };

  readonly files: GameFiles = {
    has: (p) => this.opts.rip + p in this.sizes,
    get: (p) => this.bytes.get(p) ?? null,
    want: (p) => {
      if (!this.fetching.has(p)) this.say(`reading ${p} (${(this.sizes[this.opts.rip + p] / 1e6).toFixed(1)} MB)…`);
      void this.fetchBytes(p);
    },
  };

  /* ----------------------------------------------------------------------- *
   * Sound
   * ----------------------------------------------------------------------- */

  private out(): AudioNode {
    if (!this.master) {
      this.master = this.audio!.createGain();
      this.master.gain.value = this.level;
      this.master.connect(this.audio!.destination);
    }
    return this.master;
  }

  private buffer(audio: AudioContext, samples: Float32Array, rate: number): AudioBufferSourceNode {
    const buf = audio.createBuffer(1, samples.length, rate);
    buf.getChannelData(0).set(samples);
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(this.out());
    return src;
  }

  readonly speaker: Speaker = {
    play: (samples, rate) => {
      if (!this.audio) return;
      const src = this.buffer(this.audio, samples, rate);
      src.onended = () => this.playing.delete(src);
      this.playing.add(src);
      src.start();
    },
    stop: () => {
      for (const s of this.playing) s.stop();
      this.playing.clear();
    },
    loop: (samples, rate) => {
      this.loopSrc?.stop();
      this.loopSrc = null;
      if (!this.audio || !samples) return;
      this.loopSrc = this.buffer(this.audio, samples, rate);
      this.loopSrc.loop = true;
      this.loopSrc.start();
    },
    volume: (level) => {
      this.level = level;
      if (this.master) this.master.gain.value = level;
    },
  };

  /** Enter's click: the sound's device, which a browser opens only on a gesture */
  async startSound(): Promise<void> {
    this.audio ??= new AudioContext();
    await this.audio.resume();
  }

  /** is the looping channel playing — a loop asked for before there was sound is not */
  get looping(): boolean {
    return this.loopSrc !== null;
  }

  /* ----------------------------------------------------------------------- *
   * The screen
   * ----------------------------------------------------------------------- */

  draw(screen: Screen): void {
    if (screen.version === this.drawn) return;
    this.drawn = screen.version;
    screen.rgba(this.image.data);
    this.offCtx.putImageData(this.image, 0, 0);
    this.ctx.drawImage(this.offCtx.canvas, 0, 0, SCREEN_W * SCALE, SCREEN_H * SCALE);
  }

  /**
   * A pointer event in the screen's pixels. Pointer events and not mouse events:
   * a mouse event's position is rounded to whole CSS pixels, and with the canvas
   * at a fractional place on the page (it is centred) and a screen pixel under
   * two CSS pixels wide, that rounding can land a click in the pixel next door.
   * A pointer event carries the position as it is.
   *
   * One over the canvas is on the screen by definition, so it is held inside it
   * (a click on the canvas's very edge is still on its edge pixel); a release let
   * go off the canvas keeps where it really was.
   */
  readonly at = (e: PointerEvent): { x: number; y: number } => {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SCREEN_W);
    const y = Math.floor(((e.clientY - r.top) / r.height) * SCREEN_H);
    if (e.target !== this.canvas) return { x, y };
    return { x: Math.min(SCREEN_W - 1, Math.max(0, x)), y: Math.min(SCREEN_H - 1, Math.max(0, y)) };
  };

  /* ----------------------------------------------------------------------- *
   * The .SCO file and the saved games
   * ----------------------------------------------------------------------- */

  private get scoKey(): string {
    return `${this.opts.slug}.sco`;
  }

  /** the `.SCO` file the browser kept, if it kept one */
  storedSco(): Uint8Array | undefined {
    try {
      const b64 = localStorage.getItem(this.scoKey);
      return b64 ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : undefined;
    } catch {
      return undefined;
    }
  }
  readonly keepSco = (bytes: Uint8Array): void => {
    try {
      localStorage.setItem(this.scoKey, btoa(String.fromCharCode(...bytes)));
    } catch (e) {
      this.complain(`the high scores and keys could not be kept: ${String(e)}`);
    }
  };

  /** the machine's saver: a game's bytes, through the shared saved-games dialog */
  readonly saver = (bytes: Uint8Array, name: string, done: () => void): void => {
    browseForSave(bytes, name, { log: (l) => this.say(`  ${l}`) }).then(done, (e) => {
      this.complain(String(e));
      done();
    });
  };

  /* ----------------------------------------------------------------------- *
   * The boot
   * ----------------------------------------------------------------------- */

  private gauge(fraction: number, what: string): void {
    const pct = Math.round(fraction * 100);
    $("charge").style.width = `${pct}%`;
    $<HTMLProgressElement>("barvalue").value = pct;
    $("bootpct").textContent = `${pct}%`;
    $("bootsay").textContent = what;
  }

  /** the manifest read, the preload fetched under the gauge, the boot screen let go */
  async boot({ preload, ready, manifest: listed }: V0Boot): Promise<void> {
    const { name, year, slug, rip } = this.opts;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.step(`${name} (${year}) — DreamFactory 0`);
    const res = await fetch(pageUrl("gamefiles.json"));
    if (!res.ok) throw new Error(`no gamefiles.json (${res.status}) — is ${slug}/gamefiles/ there?`);
    const manifest = (await res.json()) as Record<string, number>;
    this.sizes = Object.fromEntries(Object.entries(manifest).filter(([k]) => k.startsWith(rip)));
    listed?.(manifest);
    const missing = preload.filter((p) => !(rip + p in this.sizes));
    if (missing.length) throw new Error(`not in the rip: ${missing.join(", ")}`);
    const total = preload.reduce((n, p) => n + this.sizes[rip + p], 0);
    const got = new Map<string, number>();
    await Promise.all(
      preload.map((p) =>
        this.fetchBytes(p, (n) => {
          got.set(p, n);
          this.gauge([...got.values()].reduce((a, b) => a + b, 0) / total, `reading ${p}…`);
        }),
      ),
    );
    this.gauge(1, "ready");
    $("boot").classList.add("ready");
    document.body.classList.remove("booting");
    this.step(ready);
  }
}
