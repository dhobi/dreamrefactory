/**
 * The photo album — `plugin("camera", …)`, and the only DreamFactory plugin with
 * a store behind it.
 *
 * Timelapse gives the player a camera, 36 exposures, and a book to look at them
 * in. That is not a script feature: the BOOTFILE and `P.Stg` reach it through
 * four `pluginfx("camera", …)` calls and the work happens inside `tz.dll`, which
 * is why this needed reading rather than guessing. What follows is off that DLL
 * and off `camera.fil`, the album the 1996 build shipped with one photograph
 * already in it.
 *
 * ## The three calls
 *
 * All four call sites are in `docamera` (the shutter) and the album flat's
 * `updateflat` loop, and they are told apart by their argument count:
 *
 *   | call                                   | what it is | answers |
 *   |----------------------------------------|------------|---------|
 *   | `pluginfx("camera", path)`             | open       | 0, or `cameraerror(err, 1\|3)` |
 *   | `pluginfx("camera", path, id, point)`  | SAVE       | 0, or non-zero for an id already used |
 *   | `pluginfx("camera", path, id)`         | DISPLAY    | 0, or `cameraerror(err, 2)` |
 *
 * The save's answer is load-bearing, and it is the reason ids are random rather
 * than sequential. `docamera` is
 *
 *     while true
 *         rand = random (32000)
 *         variable ("pic" @ numtostring (pictotal), rand)
 *         if pluginfx ("camera", path (0), rand, arg) = 0
 *             currentpic = pictotal
 *             pictotal = pictotal + 1
 *             …
 *
 * — a rejection means "that id is taken, pick another", so the only failure this
 * may ever report is a collision. Anything else must answer 0 or the game spins
 * in that loop forever, which is why {@link PhotoAlbum} keeps working from memory
 * when its store is unavailable instead of refusing.
 *
 * ## The geometry, and it is the same at both ends
 *
 * A photograph is **320x240**, and the album shows it at **(160, 120)** — the
 * middle of the 640x480 screen. Both numbers are the DLL's:
 *
 *   - the display path (0x140016af) writes its destination rect as four u16 in
 *     the Y-FIRST order this engine stores every rect in — top `0x78` (120), left
 *     `0xa0` (160), bottom `0x168` (360), right `0x1e0` (480);
 *   - both the grab and the draw loop `bp` to `0x140` (320) and `bx` to `0xf0`
 *     (240), the draw offsetting each column by `0xa0` (160).
 *
 * And the script agrees from the other side: `docamera` clamps the viewfinder to
 * `x` in [160, 480] and `y` in [120, 360], which is exactly the range a 320x240
 * window's CENTRE can take on a 640x480 screen without leaving it.
 *
 * ## camera.fil, which this port does not write
 *
 * The shipped album is a DreamFactory container file whose container 0 is the
 * index — `{u32 count; u32 0x12345678; count x {u32 id; u32 container}}`, and the
 * magic is in the DLL at 0x14001918 — and whose other containers are one photo
 * each: a 4-byte seed, 256 palette entries of `{u8 index, u8 pad, u16 r, u16 g,
 * u16 b}` (8-bit channels in 16-bit fields, so the component is the odd byte),
 * then 76800 bytes of 8-bit pixels **column-major** — `mov byte [ecx + edi +
 * 0x804], al` at 0x1400131c, where `ecx` is `240 * x` and `0x804` is 2052, the
 * size of that palette block. Decoding the shipped file that way gives a
 * coherent photograph of clouds over a hillside; decoding it row-major gives
 * four copies of it side by side, which is how the layout was found.
 *
 * None of that is needed here — a browser store has no reason to quantise a
 * screen grab to 256 colours and transpose it — so photos are kept as RGBA. It
 * is written down because it is the only record of the format, and because an
 * exporter that hands the player a real `camera.fil` is now a small job rather
 * than a research one.
 */
import type { Value } from "./interp";

/** a photograph, as this port keeps one */
export interface Photo {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

/** what the album is, in pixels — see the docblock: both numbers are tz.dll's */
export const PHOTO_W = 320;
export const PHOTO_H = 240;
/** where the album flat shows one (tz.dll 0x140016af, a Y-first rect) */
export const PHOTO_X = 160;
export const PHOTO_Y = 120;
/** the film in the camera: `docamera` refuses past 35, `updateflat` counts 36 down */
export const EXPOSURES = 36;

/**
 * Somewhere for photographs to live between sessions.
 *
 * Deliberately tiny, and deliberately async: the only implementation that
 * matters is IndexedDB, everything about which is a promise. A host that
 * provides none gets an album that works for as long as the page is open, which
 * is what the port did before there was a store at all — the difference is that
 * now the album has something in it.
 */
export interface PhotoStore {
  /** every photo kept, by id. Awaited once, by the album's `open` call. */
  all(): Promise<Map<number, Photo>>;
  /** keep one. The album has already accepted it; a rejection here only logs. */
  put(id: number, photo: Photo): Promise<void>;
}

/** answers the scripts read — 0 is "no error" and the only one they want */
export const CAMERA_OK = 0;
/** the id is taken: `docamera`'s loop rolls another one. Its ONLY use. */
export const CAMERA_ID_TAKEN = 1;
/** no such photo — `updateflat` turns this into "Picture not in photo album" */
export const CAMERA_NO_PHOTO = 2;

export class PhotoAlbum {
  /** the album in hand, by the id `docamera` rolled for each shot */
  readonly photos = new Map<number, Photo>();
  /** the persistent store, if the host gave us one */
  store: PhotoStore | null = null;
  /** log line for a store that failed; the session points this at its own log */
  onLog: (line: string) => void = () => {};

  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  /**
   * `pluginfx("camera", path)` — make sure the album is in hand.
   *
   * Called before every save and before every display, so it is hydrated once
   * and shared afterwards. A store that throws is reported and dropped rather
   * than raised: `cameraerror(err, 3)` in the shutter path would tell the player
   * their camera is broken when the truth is that this browser will not keep the
   * pictures, and they can still take and look at them.
   */
  async open(): Promise<Value> {
    if (this.hydrated) return CAMERA_OK;
    if (!this.store) {
      this.hydrated = true;
      return CAMERA_OK;
    }
    this.hydrating ??= (async () => {
      try {
        for (const [id, photo] of await this.store!.all()) {
          if (!this.photos.has(id)) this.photos.set(id, photo);
        }
        this.onLog(`photo album: ${this.photos.size} photo(s) in the store`);
      } catch (e) {
        this.onLog(`photo album: the store could not be read (${(e as Error).message}) — this session only`);
        this.store = null;
      }
      this.hydrated = true;
    })();
    await this.hydrating;
    return CAMERA_OK;
  }

  /**
   * `pluginfx("camera", path, id, point)` — keep this shot under that id.
   *
   * Non-zero ONLY for an id already in the album, because that is the one answer
   * `docamera`'s `while true` knows how to act on.
   */
  async save(id: number, photo: Photo): Promise<Value> {
    if (this.photos.has(id)) return CAMERA_ID_TAKEN;
    this.photos.set(id, photo);
    if (this.store) {
      try {
        await this.store.put(id, photo);
      } catch (e) {
        // kept in memory regardless: the shot is taken, and the album must not
        // claim a collision it did not have
        this.onLog(`photo album: ${id} could not be stored (${(e as Error).message})`);
      }
    }
    return CAMERA_OK;
  }

  /** `pluginfx("camera", path, id)` — the photo, or nothing to show */
  get(id: number): Photo | null {
    return this.photos.get(id) ?? null;
  }

  /** a new game: the session's album is emptied, the store is not */
  reset(): void {
    this.photos.clear();
    this.hydrated = false;
    this.hydrating = null;
  }
}
