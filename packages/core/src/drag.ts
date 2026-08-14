// The gesture, kept apart from the sorting.
//
// Pointer Events only: mouse, finger and stylus through the same code. No HTML5 drag and
// drop, which is unusable with a thumb.
//
// A card is dragged as one block — image, text, padding. But **links and buttons stay
// clickable**: only form fields are excluded outright; on an `a` or a `button` we wait for a
// few pixels of movement before deciding, and cancel the click that would have followed.
// Without this, a card whose link covers half its surface becomes impossible to sort.

export interface GestureState {
  dx: number;
  dy: number;
  dist: number;
  /** the drag has taken over (past the engagement threshold) */
  engaged: boolean;
  /** the gesture started on a link or a button */
  interactive: boolean;
}

export interface GestureHandlers {
  onMove(g: GestureState, e: PointerEvent): void;
  onEnd(g: GestureState, e: PointerEvent): void;
}

/** Distance, in px, past which a press on a link becomes a drag. */
const ENGAGE = 6;

/**
 * Starts a gesture on `el`. Returns `null` when the event should not be captured
 * (secondary button, form field).
 */
export function startGesture(el: HTMLElement, e: PointerEvent, handlers: GestureHandlers): GestureState | null {
  const target = e.target as Element | null;
  if (e.button > 0 || target?.closest('input, select, textarea, [contenteditable]')) return null;

  const interactive = Boolean(target?.closest('a, button'));
  const g: GestureState = { dx: 0, dy: 0, dist: 0, engaged: !interactive, interactive };
  const x0 = e.clientX;
  const y0 = e.clientY;

  el.setPointerCapture(e.pointerId);
  if (g.engaged) el.classList.add('tr-dragging');

  const move = (ev: PointerEvent) => {
    g.dx = ev.clientX - x0;
    g.dy = ev.clientY - y0;
    g.dist = Math.hypot(g.dx, g.dy);
    // started on a link: only take over once the intent to drag is established
    if (!g.engaged) {
      if (g.dist < ENGAGE) return;
      g.engaged = true;
      el.classList.add('tr-dragging');
    }
    handlers.onMove(g, ev);
  };

  const end = (ev: PointerEvent) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
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

  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return g;
}
