/**
 * `savegame` and `opengame`, the two commands the control panel's levers call
 * (engine/src/runtime/builtins/savegame.ts).
 *
 *   npx vitest run engine/tests/savegame-builtins.ts
 *
 * The games' save suites go through these by way of each game's own menu, and
 * none of them reaches the edges: RedJack.exe's two refusals, a session with
 * nothing to save, a load that is cancelled or handed bytes it cannot read. So
 * they are driven here on a bare session, with the save and the load stubbed,
 * which is all the commands themselves decide anything about: what reaches the
 * host, what the world's clock does while the host's dialog is up, and what the
 * screen looks like when the dialog goes away.
 */
import { expect, test } from "vitest";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function session() {
  const audio = new NullAudioSink();
  const s = new GameSession(() => null, audio);
  const notes: string[] = [];
  const logs: string[] = [];
  s.onNoteDialog = (m) => void notes.push(m);
  s.onLog = (l) => void logs.push(l);
  const call = (name: string, ...args: unknown[]): Promise<unknown> =>
    Promise.resolve(s.interp.builtins.get(name)!(s.interp, args as never, {} as never, {} as never));
  return { s, audio, notes, logs, call };
}

test("a save reaches the host with the version, and the world is frozen while it is up", async () => {
  const { s, audio, call } = session();
  s.snapshotSave = (v) => new Uint8Array([1, 2, v?.length ?? 0]);
  const seen: { bytes: number[]; version: string; frozen: boolean; suspended: boolean }[] = [];
  s.onSaveGame = (bytes, version) =>
    void seen.push({ bytes: [...bytes], version, frozen: s.frozen, suspended: audio.suspended });

  await call("savegame", "v3");
  expect(seen).toEqual([{ bytes: [1, 2, 2], version: "v3", frozen: true, suspended: true }]);
  expect(s.frozen).toBe(false);
  expect(audio.suspended).toBe(false);
});

test("a host that throws still thaws the world", async () => {
  const { s, call } = session();
  s.snapshotSave = () => new Uint8Array([1]);
  s.onSaveGame = () => Promise.reject(new Error("disk full"));
  await expect(call("savegame")).rejects.toThrow("disk full");
  expect(s.frozen).toBe(false);
});

test("nothing to save asks the host nothing", async () => {
  const { s, logs, call } = session();
  s.snapshotSave = () => null;
  let asked = false;
  s.onSaveGame = () => void (asked = true);
  expect(await call("savegame")).toBe(0);
  expect(asked).toBe(false);
  expect(logs.some((l) => l.includes("nothing to save"))).toBe(true);
});

test("RedJack refuses with a puppet open, and on a road, before any dialog", async () => {
  const { s, notes, call } = session();
  s.isV5 = true;
  let snapshots = 0;
  s.snapshotSave = () => (snapshots++, new Uint8Array([1]));

  (s.puppetCtrl as { puppet: unknown }).puppet = {};
  await call("savegame");
  (s.puppetCtrl as { puppet: unknown }).puppet = null;
  s.maze = { walk: {} } as never;
  await call("savegame");

  expect(notes).toEqual(["Can't save game with puppet open.", "Can't save game while travelling on road."]);
  expect(snapshots).toBe(0);
});

test("the same two states do not stop a save in an older game", async () => {
  const { s, notes, call } = session();
  let saved = 0;
  s.snapshotSave = () => new Uint8Array([1]);
  s.onSaveGame = () => void saved++;
  (s.puppetCtrl as { puppet: unknown }).puppet = {};
  s.maze = { walk: {} } as never;
  await call("savegame");
  expect(notes).toEqual([]);
  expect(saved).toBe(1);
});

test("a cancelled load puts the screen back exactly as it was", async () => {
  const { s, call } = session();
  s.fade.level = 0.25;
  s.fade.pendingReveal = true;
  const during: number[] = [];
  s.onLoadGame = (version) => {
    during.push(s.fade.level, s.frozen ? 1 : 0, version.length);
    return Promise.resolve(null);
  };
  expect(await call("opengame", "v2")).toBe(0);
  // black while the dialog was up, frozen, and handed the version
  expect(during).toEqual([1, 1, 2]);
  expect(s.fade.level).toBe(0.25);
  expect(s.fade.pendingReveal).toBe(true);
  expect(s.frozen).toBe(false);
});

test("bytes the session cannot read are a cancel too", async () => {
  const { s, call } = session();
  s.fade.level = 0.5;
  const given: string[] = [];
  s.onLoadGame = () => Promise.resolve(new Uint8Array([9]));
  s.loadGame = (_b, v) => (given.push(v ?? ""), Promise.resolve(false));
  await call("opengame", "x");
  expect(given).toEqual(["x"]);
  expect(s.fade.level).toBe(0.5);
});

test("a load that works leaves the room showing, not the black", async () => {
  const { s, call } = session();
  s.fade.level = 0.5;
  s.onLoadGame = () => Promise.resolve(new Uint8Array([9]));
  s.loadGame = () => Promise.resolve(true);
  await call("opengame");
  expect(s.fade.level).toBe(0);
});
