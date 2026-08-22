/**
 * The event queue — input the player made while the engine was mid-gesture.
 *
 * TI.EXE keeps one, and the port had none: a key pressed during a turn or a
 * walk was simply dropped, so holding the forward key walked a single room
 * instead of a corridor, and `flushevents()` — which the scripts call in 92
 * places to discard input they don't want to inherit — had nothing to discard.
 *
 * Recovered from the binary (`npx tsx taoot/tools/disasmcmd.mts flushevents`, then the
 * three functions it leads to), because the policies here are not guessable:
 *
 * - one array at `0x486150`, `0x12`-byte records, count at `0x485a58` — the
 *   global `flushevents` zeroes.
 * - **32 slots** (`cmp dword ptr [0x485a58], 0x20`).
 * - a record's **kind is a bitmask** word at `+0x10`, not an enum: the lookup
 *   `0x41a650(mask, &out)` finds the first queued event whose kind ANDs with the
 *   mask (`test word ptr [edx], ax`), and `0xffff` means "anything". Posting
 *   (`0x41a3c0`) maps an event code `1..0x2a` to that bitmask in two hops — a
 *   byte table at `0x41a574` indexed by `code - 1`, then a jump table at
 *   `0x41a550`. Read the jump table's dwords; do NOT pair the arms with the
 *   indices in source order, because the default arm (mask 0) is written first
 *   and sits at index 8, which shifts every kind by one. The codes that matter:
 *
 *       1  mouse down   mask 2      4  key up       mask 0x10
 *       2  mouse up     mask 4      5  auto-repeat  mask 0x20
 *       3  key down     mask 8     0x2a quit        mask 0x100
 *
 *   The rest are mask 0 — no lookup can ever find them. Confirmed against a
 *   CONSUMER rather than trusted from the tables: the modal input loop at
 *   `0x44a260` removes mask `0x15e` and then compares the popped record's own
 *   code field against 1, 6 and `0x2a`.
 * - **posting can coalesce** (`0x41a3c0`, when its flag argument is set): it
 *   looks for an already-queued event of the same kind whose payload matches,
 *   deletes it, and repeats — so a stream of the same event collapses to the
 *   newest rather than piling up.
 * - **when full**, it scans for the first event whose kind includes bit `0x20`
 *   — the auto-repeat of a held key or joystick direction — and memmoves the
 *   tail down over it; if that finds nothing it clamps the count to 31, which
 *   overwrites the newest slot. So the one droppable class is the one the
 *   player did not deliberately make, and everything else is kept at the cost
 *   of the tail.
 *
 * The numeric bits are TI.EXE's own vocabulary and are deliberately not
 * reproduced — the port's events are named. What is reproduced is every policy
 * above, because those are what a player feels.
 */

/** TI.EXE's queue length: `cmp dword ptr [0x485a58], 0x20`. */
export const EVENT_CAPACITY = 32;

export type QueuedEvent =
  | { kind: "keydown"; key: string; special: boolean }
  | { kind: "mousedown"; x: number; y: number };

/** what a queued event coalesces against — the original compares kind + payload */
function sameEvent(a: QueuedEvent, b: QueuedEvent): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "keydown" && b.kind === "keydown") return a.key === b.key;
  return false; // two clicks are two clicks, wherever they landed
}

export class EventQueue {
  private q: QueuedEvent[] = [];
  /** every event ever posted / taken / dropped, for tests and the debug HUD */
  posted = 0;
  taken = 0;
  dropped = 0;

  get length(): number {
    return this.q.length;
  }

  /** what is waiting, oldest first (read-only — for assertions and diagnostics) */
  get pending(): readonly QueuedEvent[] {
    return this.q;
  }

  /**
   * Queue an event.
   *
   * `coalesce` is the original's optional collapse: with it, a repeat of the
   * same event replaces the one already waiting instead of adding to it. Held
   * keys are posted this way, which is what makes holding a movement key walk
   * continuously (one press always pending, taken as each move ends) without
   * a released key leaving thirty more moves queued behind it.
   */
  post(e: QueuedEvent, { coalesce = false }: { coalesce?: boolean } = {}): void {
    this.posted++;
    if (coalesce) {
      const before = this.q.length;
      this.q = this.q.filter((q) => !sameEvent(q, e));
      this.dropped += before - this.q.length;
    }
    if (this.q.length >= EVENT_CAPACITY) {
      // No droppable class exists here — the original's is the auto-repeat of a
      // held key, which the port never queues as its own kind (a repeat arrives
      // as a coalescing keydown) — so this is its fallback: clamp to
      // capacity-1, which overwrites the newest slot.
      this.q.length = EVENT_CAPACITY - 1;
      this.dropped++;
    }
    this.q.push(e);
  }

  /** the oldest waiting event, or null */
  take(): QueuedEvent | null {
    const e = this.q.shift() ?? null;
    if (e) this.taken++;
    return e;
  }

  /** is anything of this kind waiting? (the original's find-by-mask) */
  has(kind: QueuedEvent["kind"]): boolean {
    return this.q.some((e) => e.kind === kind);
  }

  /**
   * `flushevents()`: discard the lot.
   *
   * The original (`0x41f0c0`) discards all but one thing: it peeks mask `0x100`
   * first, zeroes the count, and re-posts a quit event if one was waiting, so a
   * player who closed the window mid-script does not have that undone by the
   * next `flushevents()`. The port never queues a quit — the browser owns the
   * close — so discarding everything is the same behaviour here.
   */
  flush(): void {
    this.dropped += this.q.length;
    this.q.length = 0;
  }
}
