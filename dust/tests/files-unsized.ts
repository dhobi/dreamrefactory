/**
 * The Dust CD's file store (`src/files.ts`) on a manifest that lists the
 * BOOTFILE itself, and on a file it lists with no size.
 *
 *   npx vitest run dust/tests/files-unsized.ts
 *
 * `files.ts` pins the store on the shipped manifest, which leaves the BOOTFILE
 * out (it lives under INSTALL/, a directory the manifest skips) and sizes every
 * file. Where a manifest does list a BOOTFILE, that listing is the one served —
 * the fallback is only for its absence. And a file the manifest gives no size
 * adds nothing to the bar while it streams, rather than a guess.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DustFiles } from "../src/files";

const MANIFEST: Record<string, number> = {
  "gamefiles/dustcd/DATA/BOOTFILE": 300,
  "gamefiles/dustcd/DATA/blank.snd": 0,
};

let release: () => void = () => {};

beforeEach(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("gamefiles.json")) return { ok: true, json: async () => MANIFEST } as unknown as Response;
    const gate = new Promise<void>((r) => (release = r));
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        if (i > 0) await gate;
        if (i++ < 2) ctl.enqueue(new Uint8Array(10));
        else ctl.close();
      },
    });
    return { ok: true, body } as unknown as Response;
  });
});
afterEach(() => vi.unstubAllGlobals());

test("a BOOTFILE the manifest lists is the one served, not the INSTALL fallback", async () => {
  const files = await DustFiles.open();
  expect(files.serverUrl("bootfile")).toMatch(/dustcd\/DATA\/BOOTFILE$/);
  expect(files.sizeOf("bootfile")).toBe(300);
});

test("a file the manifest gives no size adds nothing to the bar while it streams", async () => {
  const files = await DustFiles.open();
  const chunks: number[] = [];
  const loading = files.load("blank.snd", (n) => chunks.push(n));
  await vi.waitFor(() => expect(chunks).toEqual([10]));
  expect(files.partialProgress()).toBe(0);
  release();
  expect((await loading)?.length).toBe(20);
});
