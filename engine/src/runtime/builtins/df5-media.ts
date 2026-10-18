import { ScriptError, Value } from "../interp";
import { pointX, pointY } from "../point";
import { BuiltinCtx } from "./context";
import { v5Registrar } from "./df5";
import { int, str } from "./df5-args";

/**
 * DreamFactory 5's outside movie players — `playqt`, `playsmacker`,
 * `playactivemovie`, `plaympeg`, `playdvd` — each read out of `RedJack.exe`
 * (`redjack/tools/rjdis.mts cmd NAME`). Every one answers only in a v5 game.
 * RedJack's scripts call none of them; Disney's Villains' Revenge runs the same
 * engine with the same table.
 *
 * None of these plays a `.move`. Each hands a file to a player outside the
 * engine (pmed.c), in a child window over the game's, and returns when it is
 * done; the engine's own movie path is not involved. What each hands to:
 *
 *  - `playqt` — nothing. Its handler is `xor ax, ax; ret` (0x409ae0): it does
 *    not even read its arguments. RedJack.exe has no QuickTime in it.
 *  - `playsmacker` — nothing either. Its handler checks its arguments and finds
 *    the file, and its player is `xor ax, ax; ret` (0x48c6d0). The exe imports
 *    no SMACKW32.DLL and names none.
 *  - `plaympeg` — MCI, device type "MpegVideo" (0x48c320): `MCI_OPEN` with the
 *    file as the element and a child window as the parent, time format
 *    milliseconds, `MCI_PUT` the window, `MCI_PLAY` from/to, then a loop on
 *    `MCI_STATUS` (position below `to` and mode `MCI_MODE_PLAY`) that pumps
 *    messages, then `MCI_STOP` and `MCI_CLOSE`.
 *  - `playactivemovie` — DirectShow (0x48bf00): `CoCreateInstance
 *    (CLSID_FilterGraph, IID_IGraphBuilder)`, `IGraphBuilder::RenderFile`, the
 *    video window parented to the game's, `IMediaSeeking::SetPositions` from/to
 *    in 100 ns units, `IMediaControl::Run`, and a loop on `GetState` until it
 *    is no longer running.
 *  - `playdvd` — by its second argument (0x48bd20): "dshow" is DirectShow's DVD
 *    graph (`CLSID_DvdGraphBuilder`, 0x48b8e0), "mci" each of MCI's
 *    "Mpeg2Video", "DVDVideo", "PCDVDVideo", "MpegVideo" in turn (0x4c2118),
 *    "auto" the one and then the others, and any other name — "dvdvideo" when
 *    it is "" — that MCI device type (0x48b490).
 *
 * The player loops stop early by the mode argument (0x48c5af, 0x48c1c5,
 * 0x48b7a1): 0 never, 1 on Escape or space (`GetAsyncKeyState` 0x1b, 0x20 —
 * 0x469c30, 0x469c10), 2 — the default — on those or any mouse button (0x4886e0).
 *
 * This machine has none of those players, so every call ends where a Windows
 * machine without them ends: the MCI open or the COM create fails. The MCI and
 * DirectShow players answer 0 whatever went wrong (0x48c6a0 and 0x48c24f both
 * fall through to `xor ax, ax`), so `plaympeg` and `playactivemovie` return
 * at once with no error, as `playsmacker` always does. `playdvd`'s players do
 * answer their failure (0x48b64a: −1; 0x48bcf5: the HRESULT), so it is error
 * 0x2a. Each one that gets as far as its player raises the repaint level to 2,
 * "redraw the whole window" (0x432090 -> 0x4c95f8, read at 0x432f59), which
 * here is every frame anyway.
 */
export function registerDf5MediaBuiltins(ctx: BuiltinCtx): void {
  const { session } = ctx;
  const r5 = v5Registrar(ctx);
  const disk = () => session.df5Disk;

  /**
   * The integers after the file — `(from, to)`, `(from, to, mode)`,
   * `(from, to, at, size)` or `(from, to, at, size, mode)` — read by each
   * handler's own loop (0x409b85, 0x409e04, 0x40a074, 0x40a2e4): up to five,
   * each `cmp word [arg], 4` or 0xe, and a lone one is 0xe too (the jump
   * tables' case 1, 0x409c1e). `from` and `to` are milliseconds, 0 and
   * 0x7fffffff by default; `at` and `size` are points, (−1000, −1000) and
   * (0, 0) by default, which the players take as centred in the game's window
   * and 720 × 480 (0x48c34e, 0x48bfeb, 0x48b4cd); `mode` is 2.
   */
  const timing = (cmd: string, rest: Value[]): Timing => {
    const n = Math.min(rest.length, 5);
    const v = rest.slice(0, n).map((a) => int(cmd, a));
    if (n === 1) throw new ScriptError(0xe, `${cmd}: a start with no end`);
    const t: Timing = { from: 0, to: 0x7fffffff, x: -1000, y: -1000, width: 0, height: 0, mode: 2 };
    if (n >= 2) [t.from, t.to] = v;
    if (n === 3) t.mode = v[2];
    if (n >= 4) {
      t.x = pointX(v[2]);
      t.y = pointY(v[2]);
      t.width = pointX(v[3]);
      t.height = pointY(v[3]);
    }
    if (n === 5) t.mode = v[4];
    return t;
  };

  /**
   * The file, as `path (k) @ name` for k = 1..8 — slot 0 skipped — the first
   * that 0x48ceb0 finds (0x409ce2..0x409d23, and the same loop in each
   * handler), as `copylocal` looks; none is error 0x6b.
   */
  const find = (cmd: string, name: string): string => {
    for (let k = 1; k <= 8; k++) {
      const path = session.pathSlots[k] + name;
      if (disk().stat(path)) return path;
    }
    throw new ScriptError(0x6b, `${cmd}: ${name} is in no path slot`);
  };

  /** the player, which is not here: what it would have been handed, in the log */
  const outside = (cmd: string, player: string, path: string, t: Timing): void => {
    const where = t.x === -1000 && t.y === -1000 ? "centred" : `at ${t.x},${t.y}`;
    const size = t.width || t.height ? `${t.width}x${t.height}` : "720x480";
    session.onLog(`${cmd}: ${path} to ${player}, ${t.from}..${t.to} ms, ${size} ${where}, mode ${t.mode} — no such player here`);
  };

  // playqt (...): nothing at all (0x409ae0)
  r5("playqt", () => {});

  /** plaympeg, playactivemovie, playsmacker (file, ints…): the three alike but for the player */
  const players: [string, string][] = [
    ["plaympeg", 'MCI "MpegVideo" (0x48c320)'],
    ["playactivemovie", "DirectShow's filter graph (0x48c2d0 -> 0x48bf00)"],
    ["playsmacker", "no player (0x48c6d0 returns 0)"],
  ];
  for (const [cmd, player] of players) {
    r5(cmd, (_i, [file, ...rest]) => {
      const name = str(cmd, file);
      const t = timing(cmd, rest);
      const path = find(cmd, name);
      if (cmd !== "playsmacker") outside(cmd, player, path, t);
      // the players answer 0 whatever happened, so there is no 0x2a here (0x409fc7, 0x40a237, 0x40a4a7)
    });
  }

  /**
   * playdvd (file, player, ints…): the player's name is kept in 0x4c7700, and
   * "" is "dvdvideo" (0x409b5b). Two arguments at least: one alone is 0x1c,
   * 0x41ab50's "no comma" (0x41ab84).
   */
  r5("playdvd", (_i, [file, device, ...rest]) => {
    if (device === undefined) throw new ScriptError(0x1c, "playdvd: a file with no player");
    const name = str("playdvd", file);
    const asked = str("playdvd", device) || "dvdvideo";
    const t = timing("playdvd", rest);
    const path = find("playdvd", name);
    const key = asked.toLowerCase();
    const tried = dvdPlayers(key, asked);
    outside("playdvd", tried, path, t);
    throw new ScriptError(0x2a, `playdvd: ${tried} would not open ${path}`);
  });
}

/** the MCI device types `playdvd` tries for "mci" and "auto", in order (0x4c2118) */
export const MCI_DVD = ["Mpeg2Video", "DVDVideo", "PCDVDVideo", "MpegVideo"] as const;

/** a player's timing and window, as the handlers hand them on */
interface Timing {
  from: number;
  to: number;
  x: number;
  y: number;
  width: number;
  height: number;
  mode: number;
}

/** which players playdvd tries for the name it was given (0x409b5b, 0x48bd20) */
function dvdPlayers(key: string, asked: string): string {
  switch (key) {
    case "auto": return `DirectShow's DVD graph, then MCI ${MCI_DVD.join(", ")}`;
    case "dshow": return "DirectShow's DVD graph (CLSID_DvdGraphBuilder)";
    case "mci": return `MCI ${MCI_DVD.join(", ")}`;
    default: return `MCI "${asked}"`;
  }
}
