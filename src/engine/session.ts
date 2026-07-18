import { readContainerFile } from "../df/container";
import { SetFile, readSetFile } from "../df/set";
import { sniffScript } from "../df/script";
import { parseScript } from "./parser";
import { Interpreter, ScriptInstance, registerCoreBuiltins, toStr } from "./interp";
import { PropRuntime } from "./props";
import { AudioLibrary, AudioSink, NullAudioSink } from "./audio";
import { FileProvider } from "./setscripts";

/**
 * Game-wide state that outlives individual sets: one interpreter (globals
 * persist across rooms), the boot script (the game's standard library of
 * ~65 helpers — changeset, progress, spotmovie, ...), the master stage
 * script (MAIN.STG — gotospecial etc.), audio banks and props.
 *
 * Set switching bottoms out here: boot's `changeset` calls the engine
 * primitives `opensetfile(name, scene, view)` / `closesetfile()`, which are
 * builtins registered by the host (SetScripts wires them to onSetChange).
 */
export class GameSession {
  readonly interp = new Interpreter();
  readonly audioLib = new AudioLibrary();
  readonly propRuntime = new PropRuntime();

  boot: ScriptInstance | null = null;
  stage: ScriptInstance | null = null;
  currentSetName = "none";
  /** the active set's script binding (SetScripts) — set by its constructor */
  currentBinding: import("./setscripts").SetScripts | null = null;
  builtinsRegistered = false;

  onLog: (line: string) => void = () => {};
  /** host hook: actually load + display a set (async in the browser) */
  onSetChange: (fileName: string, sceneName: string, viewName: string) => void = () => {};
  /** host hooks for currentscene()/currentview() queries */
  currentSceneName: () => string = () => "";
  currentViewName: () => string = () => "";

  constructor(
    readonly files: FileProvider = () => null,
    readonly audio: AudioSink = new NullAudioSink(),
  ) {
    registerCoreBuiltins(this.interp);
  }

  /** parse a script container into an instance bound to `owner` */
  instanceFrom(data: Uint8Array | undefined, owner: string): ScriptInstance | null {
    if (!data) return null;
    const tokens = sniffScript(data);
    if (!tokens) return null;
    try {
      return new ScriptInstance(owner, parseScript(tokens));
    } catch (e) {
      this.onLog(`parse error in ${owner}: ${(e as Error).message}`);
      return null;
    }
  }

  /** load BOOTFILE and MAIN.STG standard-library scripts if available */
  loadCoreScripts(): void {
    const boot = this.files("bootfile");
    if (boot && !this.boot) {
      try {
        const file = readContainerFile(boot);
        // boot scripts live in containers 1..n; merge their code blocks,
        // later containers hold the bulk (changeset & friends)
        for (let i = 1; i < file.containers.length; i++) {
          const inst = this.instanceFrom(file.containers[i].data, "boot");
          if (!inst) continue;
          if (!this.boot) this.boot = inst;
          else for (const [k, v] of inst.script.codes) this.boot.script.codes.set(k, v);
        }
        if (this.boot) this.onLog(`boot script loaded (${this.boot.script.codes.size} handlers)`);
      } catch (e) {
        this.onLog(`bootfile: ${(e as Error).message}`);
      }
    }
    const stg = this.files("main.stg");
    if (stg && !this.stage) {
      try {
        const file = readContainerFile(stg);
        this.stage = this.instanceFrom(file.containers[1].data, "main.stg");
        if (this.stage) this.onLog(`stage script loaded (${this.stage.script.codes.size} handlers)`);
      } catch (e) {
        this.onLog(`main.stg: ${(e as Error).message}`);
      }
    }
    this.interp.fallbackScripts = [this.stage, this.boot].filter(
      (x): x is ScriptInstance => !!x,
    );
  }

  /** engine primitive behind boot's changeset(): switch to another set */
  openSetFile(fileName: string, sceneName = "", viewName = ""): void {
    const key = fileName.toLowerCase();
    this.onLog(`opensetfile("${key}", "${sceneName}", "${viewName}")`);
    this.onSetChange(key, sceneName.toLowerCase(), viewName.toLowerCase());
  }

  /** try to parse a set through the provider (null if not available yet) */
  loadSet(fileName: string): SetFile | null {
    const data = this.files(fileName.toLowerCase());
    if (!data) return null;
    try {
      return readSetFile(data);
    } catch (e) {
      this.onLog(`${fileName}: ${(e as Error).message}`);
      return null;
    }
  }

  openTrackFile(fileName: string): boolean {
    const key = toStr(fileName).toLowerCase();
    const data = this.files(key);
    if (!data) {
      this.onLog(`opentrackfile: "${fileName}" not available`);
      return false;
    }
    return this.audioLib.openBank(key, data);
  }
}
