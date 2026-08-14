// The gesture, kept apart from the sorting.
//
// Pointer Events only: mouse, finger and stylus through the same code. No HTML5 drag and
// drop, which is unusable with a thumb.
//
// A card is dragged as one block — image, text, padding. But **links and buttons stay
// clickable**: only form fields are excluded outright; on an `a` or a `button` we wait for a
// few pixels of movement before deciding, and cancel the click that would have followed.
// Without this, a card whose link covers half its surface becomes impossible to sort.
//
// Three things here exist because of real tablets rather than theory:
//
// - **One callback per frame.** `pointermove` can fire faster than the display refreshes, and
//   coalesced events arrive in bursts. Every extra call meant another style write and another
//   hit-test; on a 2015 iPad that is the difference between gliding and stuttering.
// - **A safety net on `window`.** iOS Safari sometimes never delivers `pointerup` to the
//   element that captured the pointer. Without the net the card freezes mid-air — neither
//   filed nor returned — which is exactly the bug this replaced.
// - **A cancelled pointer is not a drop.** `pointercancel` fires when the system takes the
//   touch back; filing on it would file cards the user never let go of.

export interface GestureState {
  dx: number;
  dy: number;
  dist: number;
  /** the drag has taken over (past the engagement threshold) */
  engaged: boolean;
  /** the gesture started on a link or a button */
  interactive: boolean;
  /** the system took the touch back — this is not a drop */
  cancelled: boolean;
}

export interface GestureHandlers {
  onMove(g: GestureState, e: PointerEvent): void;
  onEnd(g: GestureState, e: PointerEvent): void;
  /** the finger stayed down without moving — the touch way into a held mode */
  onHold?(g: GestureState, e: PointerEvent): void;
}

export interface GestureOptions {
  /** ms before `onHold` fires; 0 or absent disables it */
  holdDelay?: number | undefined;
}

/** Distance, in px, past which a press on a link becomes a drag. */
const ENGAGE = 6;

/** Everything that can finish a gesture. `lostpointercapture` catches the cases where iOS
 *  hands the pointer back without ever sending `pointerup`. */
const ENDERS = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;

/**
 * Starts a gesture on `el`. Returns `null` when the event should not be captured
 * (secondary button, form field).
 */
export function startGesture(
  el: HTMLElement,
  e: PointerEvent,
  handlers: GestureHandlers,
  opts: GestureOptions = {},
): GestureState | null {
  const target = e.target as Element | null;
  if (e.button > 0 || target?.closest('input, select, textarea, [contenteditable]')) return null;

  const interactive = Boolean(target?.closest('a, button'));
  const g: GestureState = { dx: 0, dy: 0, dist: 0, engaged: !interactive, interactive, cancelled: false };
  const x0 = e.clientX;
  const y0 = e.clientY;
  const id = e.pointerId;

  try {
    el.setPointerCapture(id);
  } catch {
    // capture is a nicety; the window-level listeners below do the real work
  }
  if (g.engaged) el.classList.add('tr-dragging');

  let frame = 0;
  let last = e;
  let done = false;

  const hold =
    opts.holdDelay && handlers.onHold
      ? setTimeout(() => {
          if (!done && g.dist < ENGAGE) handlers.onHold!(g, last);
        }, opts.holdDelay)
      : null;

  const flush = () => {
    frame = 0;
    if (!done) handlers.onMove(g, last);
  };

  const move = (ev: PointerEvent) => {
    if (done || ev.pointerId !== id) return;
    last = ev;
    g.dx = ev.clientX - x0;
    g.dy = ev.clientY - y0;
    g.dist = Math.hypot(g.dx, g.dy);
    // started on a link: only take over once the intent to drag is established
    if (!g.engaged) {
      if (g.dist < ENGAGE) return;
      g.engaged = true;
      el.classList.add('tr-dragging');
    }
    if (!frame) frame = requestAnimationFrame(flush);
  };

  const end = (raw: Event) => {
    const ev = raw as PointerEvent;
    if (done || ev.pointerId !== id) return;
    done = true;
    if (hold) clearTimeout(hold);
    if (frame) cancelAnimationFrame(frame);
    g.cancelled = ev.type === 'pointercancel';
    el.removeEventListener('pointermove', move as EventListener);
    for (const type of ENDERS) {
      el.removeEventListener(type, end);
      window.removeEventListener(type, end);
    }
    el.classList.remove('tr-dragging');
    // the drag started on a link: cancel the click that would follow
    if (g.interactive && g.engaged) {
      el.addEventListener(
        'click',
        (click) => {
          click.preventDefault();
          click.stopPropagation();
        },
        { capture: true, once: true },
      );
    }
    handlers.onEnd(g, ev);
  };

  el.addEventListener('pointermove', move as EventListener);
  for (const type of ENDERS) {
    el.addEventListener(type, end);
    // the net: only for the events that finish a gesture, never for `pointermove` — doubling
    // the move handler would double the work this file exists to avoid
    if (type !== 'lostpointercapture') window.addEventListener(type, end);
  }
  return g;
}
