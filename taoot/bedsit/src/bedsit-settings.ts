/**
 * What the room is set to — and nothing at all about how it is set.
 *
 * Every one of these numbers used to live in the control that happened to
 * change it: the lamp gains in a `gain` object beside the slider handler, the
 * skin and the smoke in a `let` beside the key that toggled them, and the
 * shadow taps NOWHERE but the GPU — `shadows.value`, a string on a `<select>`,
 * was the only record of what the shadows were set to. That is workable while
 * the panel is the one way in, and it is the reason there can only ever BE one
 * way in: a second interface would have to reach into the first one's DOM and
 * read a string off an element to find out what the room is currently doing.
 *
 * So the state comes out here, the controls become views of it, and a change
 * arrives at the room the same way whichever view made it. What this module
 * knows about is numbers and a set of names. It touches no DOM and no GL —
 * which is why it can be tested without either, and why the page is still the
 * only thing that decides what a setting MEANS to the picture.
 *
 * The one thing it deliberately does not hold is MSAA. That setting reloads the
 * page to take effect — the context has to be born with it — so its home is
 * `localStorage` and not a store that lives and dies with the page.
 */

/** how the surfaces are painted: dressed, or bare */
export const SKINS = ["painted", "plaster"] as const;
export type SkinMode = (typeof SKINS)[number];

/** the exposure at which a frame's pixels read as the material they show */
export const NOMINAL_EXPOSURE = 1.8;

/**
 * How much of the edge of vision to take away while gliding.
 *
 * Gliding is the thing that makes people ill — the eye is carried across a room
 * and every other sense says the body did not move — and the disagreement is
 * worst at the EDGE, which is the part of the eye that reads motion. Taking it
 * away is the usual answer, and how much of it to take is not the same for two
 * people: what one visitor needs, the next feels as a tunnel.
 *
 * So it is a setting rather than a constant, and it lives HERE rather than in
 * the session, because the visitor has to be able to change it from inside the
 * headset — which is to say from the board, which only reads this store.
 */
export const VIGNETTES = ["big", "middle", "none"] as const;
export type VignetteSetting = (typeof VIGNETTES)[number];

export interface RoomSettings {
  /** one gain per lamp — pendant, standard, desk, and the two skies, which are
   *  one slider and therefore always the same number twice */
  lamp: number[];
  /** the ambient and the shade's up-throw, together */
  fill: number;
  /** taps per shadowed lamp: 0 off, 1 a hard edge, 5 a soft one. It is the
   *  CHOSEN number, which is not always the number the shader is running — a
   *  headset gets one tap whatever this says, and that is the page's business
   *  rather than this store's */
  shadowTaps: number;
  skin: SkinMode;
  smoke: boolean;
  exposure: number;
  /** how much of the screen's own resolution to draw at */
  detail: number;
  /** how far the ring closes while gliding in a headset — see {@link VIGNETTES} */
  vignette: VignetteSetting;
  /**
   * The pieces taken OUT of the room, by name.
   *
   * A set of what is ABSENT rather than a list of what is present, so the room
   * comes up furnished without anything having to say so, and a piece added to
   * the furniture later needs no entry here to appear. Read it directly — the
   * draw loop asks it once per part per frame — but change it through
   * {@link takeOut}, which is what tells the room to re-bake.
   */
  out: Set<string>;
}

export type SettingKey = keyof RoomSettings;

/**
 * The room as it opens.
 *
 * The five light values are PLACEHOLDERS and are meant to be: the markup is the
 * single place the room's opening light is written down — see the panel in
 * `index.html` — and the page seeds them from it at boot. They are here so that
 * this module is complete without a document behind it, which is what lets a
 * test drive it, and they are the numbers nobody ever sees.
 */
export const settings: RoomSettings = {
  lamp: [1, 1, 1, 1, 1],
  fill: 1,
  shadowTaps: 5,
  skin: "painted",
  smoke: true,
  exposure: NOMINAL_EXPOSURE,
  detail: 1,
  vignette: "big",
  out: new Set<string>(),
};

type Listener = (changed: ReadonlySet<SettingKey>) => void;
const listeners: Listener[] = [];

/**
 * Hear about changes, whoever made them.
 *
 * The listener is told WHICH settings moved rather than merely that something
 * did, and that distinction is the whole economy of the thing: taking a piece
 * of furniture out re-bakes three shadow cubes — eighteen passes over the room
 * — and dragging the fill slider must not.
 */
export function onSettings(fn: Listener): void {
  listeners.push(fn);
}

function announce(changed: Set<SettingKey>): void {
  if (changed.size === 0) return;
  for (const fn of listeners) fn(changed);
}

/**
 * Change one or more settings, and tell everybody once.
 *
 * A value equal to the one already there is not a change and is dropped here
 * rather than by each listener in turn: a slider dragged across its own current
 * value fires an event per pixel, and a re-bake is not something to do because
 * a mouse moved. `lamp` is compared element by element, since it is an array
 * and a new array of the same five numbers is the same setting.
 */
export function set(patch: Partial<Omit<RoomSettings, "out">>): void {
  const changed = new Set<SettingKey>();
  for (const [key, value] of Object.entries(patch) as [SettingKey, never][]) {
    if (key === "out") continue;         // the set has its own door: takeOut
    if (key === "lamp") {
      const next = value as readonly number[];
      if (next.length === settings.lamp.length && next.every((n, i) => n === settings.lamp[i])) continue;
      settings.lamp = [...next];
      changed.add("lamp");
      continue;
    }
    if (settings[key] === value) continue;
    (settings as Record<SettingKey, unknown>)[key] = value;
    changed.add(key);
  }
  announce(changed);
}

/**
 * Take a piece out of the room, or put it back.
 *
 * Separate from `set` because the value is a membership rather than a number,
 * and because this is the one setting whose change is expensive enough that the
 * no-op case has to be free.
 */
export function takeOut(name: string, out: boolean): void {
  if (out === settings.out.has(name)) return;
  if (out) settings.out.add(name); else settings.out.delete(name);
  announce(new Set<SettingKey>(["out"]));
}

/**
 * All of them, or none, and they announce ONCE.
 *
 * Fifteen calls to {@link takeOut} would re-bake the shadows fifteen times —
 * eighteen passes over the room apiece — for one answer at the end of it.
 */
export function takeOutAll(names: Iterable<string>, out: boolean): void {
  const before = settings.out.size;
  for (const name of names) {
    if (out) settings.out.add(name); else settings.out.delete(name);
  }
  if (settings.out.size !== before) announce(new Set<SettingKey>(["out"]));
}

/** the next way of painting the surfaces round, which is what P does */
export function cycleSkin(): void {
  set({ skin: SKINS[(SKINS.indexOf(settings.skin) + 1) % SKINS.length] });
}
