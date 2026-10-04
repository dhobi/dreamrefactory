import type { GameHost } from "@dreamfactory/engine/web/host";
import { TURN } from "@dreamfactory/engine/df/sett";
import { SWIPE_MIN_PX, type TouchGestures } from "@dreamfactory/engine/web/touch";

/** what a finger in a room needs of the page */
export interface RoomTouchDeps {
  host: Pick<GameHost, "session" | "director">;
  /** the page's gestures, which have the finger everywhere but at a node */
  touch: TouchGestures;
  /** framebuffer coordinates for a pointer event */
  coords: (e: { clientX: number; clientY: number }) => { x: number; y: number };
  screen: { width: number; height: number };
  now?: () => number;
}

/**
 * A drag that lifts sooner than this was a flick, and is the arrow key the
 * swipe always was: the flicks walk on, back away and turn a step.
 */
const FLICK_MS = 250;

/** the pitch a room's own scroll stops at (the BOOTFILE's scroll step): 60° up, 50° down */
const PITCH_UP = (60 * TURN) / 360;
const PITCH_DOWN = (-50 * TURN) / 360;

/**
 * What a finger does in a RedJack room, where a mouse does two things a finger
 * cannot.
 *
 * The mouse LOOKS ROUND by resting near an edge: the BOOTFILE's `idle` sends the
 * set main `setcursor`, whose `region` turns the pointer's depth into the margin
 * into a scroll speed. A finger never hovers, and one lifted inside the margin
 * leaves the pointer there, so the view spun on after it. Here a slow drag turns
 * the camera itself, holding the picture under the finger the way a panorama
 * viewer does, and the pointer is parked in the middle whenever no finger is
 * pressing. A quick flick still sends its arrow key: up walks on, down backs
 * away (the scripts' `retreat`), left and right turn to the next view. A tap is
 * a click on a hotspot, a prop or the panel, and nothing on the bare room (see
 * `swallowsPress`).
 *
 * The right button ZOOMS while held: `mousedown` asks `sysparam (7)` and hands a
 * 2 to `rightmouse`, which narrows the field of view in a `while stilldown ()`
 * loop and widens it again at release. Two fingers down are that right button,
 * held until one of them lifts.
 *
 * Both only at a node. Everywhere else (a film, a conversation, the panel)
 * {@link TouchGestures} has the finger as before.
 */
export function bindRoomTouch({ host, touch, coords, screen, now = () => performance.now() }: RoomTouchDeps) {
  const s = host.session;
  const fingers = new Map<number, { clientX: number; clientY: number }>();
  let zoom: { x: number; y: number } | null = null;
  let look: {
    id: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    head: number;
    pitch: number;
    detail: number;
    at: number;
    panning: boolean;
  } | null = null;

  const atNode = () => {
    const m = s.maze;
    if (!m || m.walk || s.puppet?.visible || s.currentViewName() !== "node") return null;
    return host.director.screenOwner() === "world" ? m : null;
  };
  // a pointer in the middle is outside every scroll margin
  const park = () => {
    if (s.maze) s.setPointer(screen.width / 2, screen.height / 2);
  };
  const middle = () => {
    let cx = 0;
    let cy = 0;
    for (const f of fingers.values()) {
      cx += f.clientX / fingers.size;
      cy += f.clientY / fingers.size;
    }
    return coords({ clientX: cx, clientY: cy });
  };
  const endLook = (restore: boolean) => {
    const m = s.maze;
    if (look?.panning && m) {
      if (restore) {
        m.setHeading(look.head);
        m.setPitch(look.pitch);
      }
      m.detail = look.detail;
      m.onChange();
    }
    look = null;
  };
  const endZoom = () => {
    if (zoom && s.pointerDown) {
      s.pointerDown = false;
      host.director.release(zoom.x, zoom.y);
    }
  };

  return {
    /**
     * A finger's tap or hold on the bare room is not handed over. The room's
     * `mousedown` walks on when the press is on nothing (`keydown ("up")`), and
     * a finger that rests before it drags, or lifts from a look round, kept
     * walking when it meant to look. The walk is the flick up.
     */
    swallowsPress(x: number, y: number): boolean {
      return atNode() !== null && s.hitTestAt(x, y).type === "scene";
    },
    /** a finger went down; true when it is the second of a zoom and is ours */
    down(e: PointerEvent): boolean {
      fingers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (zoom) return true;
      if (fingers.size !== 2 || !atNode()) return false;
      const first = [...fingers.keys()].find((id) => id !== e.pointerId)!;
      endLook(true);
      touch.cancel({ pointerId: first, clientX: e.clientX, clientY: e.clientY });
      zoom = middle();
      s.setPointer(zoom.x, zoom.y);
      s.pointerDown = true;
      s.pointerButton = 2;
      void s.track(host.director.press(zoom.x, zoom.y), `zoom ${zoom.x},${zoom.y}`);
      return true;
    },
    /** after {@link TouchGestures.down}: a finger on the room, not a control, may look round */
    afterDown(e: PointerEvent): void {
      if (zoom || !touch.owns(e)) return;
      const m = atNode();
      const { x, y } = coords(e);
      const kind = s.hitTestAt(x, y).type;
      if (!m || kind === "prop" || kind === "button") return;
      look = {
        id: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
        x,
        y,
        head: m.heading,
        pitch: m.pitch,
        detail: m.detail,
        at: now(),
        panning: false,
      };
    },
    /** true when the move is the zoom's and nothing else should see it */
    move(e: PointerEvent): boolean {
      if (!fingers.has(e.pointerId)) return false;
      fingers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (zoom) {
        zoom = middle();
        s.setPointer(zoom.x, zoom.y);
        return true;
      }
      const m = s.maze;
      if (look?.id !== e.pointerId || !m) return false;
      if (!look.panning && Math.hypot(e.clientX - look.clientX, e.clientY - look.clientY) >= SWIPE_MIN_PX) {
        look.panning = true;
        // the scroll's own lower detail (tracknodescroll's `nodequality (24, 8, 0)`)
        m.detail = 8;
      }
      if (look.panning) {
        const { x, y } = coords(e);
        const perPx = m.fov / screen.width;
        m.setHeading(look.head + (x - look.x) * perPx);
        const p0 = look.pitch >= TURN / 2 ? look.pitch - TURN : look.pitch;
        m.setPitch(Math.max(PITCH_DOWN, Math.min(PITCH_UP, p0 + (y - look.y) * perPx)));
        park();
      }
      return false;
    },
    /** true when the lift is handled here */
    up(e: PointerEvent): boolean {
      if (!fingers.delete(e.pointerId)) return false;
      if (zoom) {
        endZoom();
        if (fingers.size === 0) {
          zoom = null;
          park();
        }
        return true;
      }
      if (look?.id !== e.pointerId) return false;
      const flick = look.panning && now() - look.at < FLICK_MS;
      if (look.panning && !flick) {
        endLook(false);
        touch.cancel(e);
      } else {
        endLook(flick);
        touch.up(e);
      }
      park();
      return true;
    },
    /** true when the cancel is handled here */
    cancel(e: PointerEvent): boolean {
      if (!fingers.delete(e.pointerId)) return false;
      if (zoom) {
        endZoom();
        if (fingers.size === 0) zoom = null;
        return true;
      }
      if (look?.id === e.pointerId) endLook(true);
      return false;
    },
  };
}
