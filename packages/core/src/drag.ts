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
  /** pointer velocity at lift-off, px/ms, fitted over the last samples. A throw reads this. */
  vx: number;
  vy: number;
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

/** How far back a velocity estimate looks. Android uses the same 100ms. */
const HORIZON = 100;
/** And no more samples than that, so a slow drag cannot fill the window with stale points. */
const SAMPLES = 20;

/**
 * Velocity at the last sample, from a weighted quadratic fit of position against time.
 *
 * Degree two, not one: a fling is usually still accelerating when the finger lifts, and a
 * straight line through the window reports the speed of its middle. The fit is centred on the
 * newest sample, so the slope at zero *is* the lift-off velocity. Weights fall off with age so
 * a stale sample cannot drag the answer back. Falls back to the plain two-point estimate when
 * there is not enough to fit — three samples do not determine a parabola.
 */
function velocity(samples: Array<{ t: number; x: number; y: number }>, key: 'x' | 'y'): number {
  const n = samples.length;
  const last = samples[n - 1]!;
  if (n < 2) return 0;
  if (n < 4) {
    const first = samples[0]!;
    const dt = last.t - first.t;
    return dt > 0 ? (last[key] - first[key]) / dt : 0;
  }
  // normal equations for w·(a + b·t + c·t²), t relative to the last sample (so t ≤ 0)
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let y0 = 0;
  let y1 = 0;
  let y2 = 0;
  for (const s of samples) {
    const t = s.t - last.t;
    const w = 1 + t / HORIZON; // 1 at the newest sample, 0 at the edge of the window
    const v = s[key] - last[key];
    const t2 = t * t;
    s0 += w;
    s1 += w * t;
    s2 += w * t2;
    s3 += w * t2 * t;
    s4 += w * t2 * t2;
    y0 += w * v;
    y1 += w * t * v;
    y2 += w * t2 * v;
  }
  // solve the 3×3 system by Cramer's rule; b is the slope at t = 0
  const det =
    s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) < 1e-9) return 0;
  const detB =
    s0 * (y1 * s4 - y2 * s3) - y0 * (s1 * s4 - s3 * s2) + s2 * (s1 * y2 - y1 * s2);
  const b = detB / det;
  return Number.isFinite(b) ? b : 0;
}

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

  const interactive = Boolean(target?.closest('a, button, [role="button"], label, summary'));
  const g: GestureState = { dx: 0, dy: 0, dist: 0, engaged: false, interactive, cancelled: false, vx: 0, vy: 0 };
  const x0 = e.clientX;
  const y0 = e.clientY;
  const id = e.pointerId;

  /**
   * Capture is taken **when the drag engages**, never at pointerdown.
   *
   * A captured pointer retargets its events to the capturing element, and the browser then
   * dispatches `click` to the common ancestor of down and up — which is the card. Capturing
   * straight away therefore killed every link and button inside a card: the click fired on
   * the card, not on the anchor. Waiting until the finger has actually moved keeps a plain
   * tap on a link a plain tap on a link.
   */
  const engage = () => {
    if (g.engaged) return;
    g.engaged = true;
    try {
      el.setPointerCapture(id);
    } catch {
      // capture is a nicety; the window-level listeners below do the real work
    }
    el.classList.add('tr-dragging');
  };
  if (!interactive) engage();

  let frame = 0;
  let last = e;
  let done = false;

  /* Velocity is sampled on the raw move, not on the throttled one: a flick is over in three
     frames, and averaging it across a frame boundary flattens exactly the peak that makes it
     a flick. The estimate is a weighted least-squares fit over the last HORIZON ms rather than
     a running average — the trick Android's VelocityTracker uses. A fling is usually still
     *accelerating* when the finger leaves, and an average of the whole gesture reports the
     speed of its middle, not of its end. */
  const samples: Array<{ t: number; x: number; y: number }> = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];

  /** Records a sample and re-fits. A finger that rests clears the window: it threw nothing. */
  const push = (t: number, x: number, y: number) => {
    const last = samples[samples.length - 1];
    if (last && t - last.t > HORIZON) samples.length = 0; // a pause ends the throw
    samples.push({ t, x, y });
    while (samples.length > SAMPLES || (samples.length > 2 && t - samples[0]!.t > HORIZON)) samples.shift();
    g.vx = velocity(samples, 'x');
    g.vy = velocity(samples, 'y');
  };

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
    push(ev.timeStamp, ev.clientX, ev.clientY);
    g.dx = ev.clientX - x0;
    g.dy = ev.clientY - y0;
    g.dist = Math.hypot(g.dx, g.dy);
    // started on a link: only take over once the intent to drag is established
    if (!g.engaged) {
      if (g.dist < ENGAGE) return;
      engage();
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
    // the release is a sample like any other, and the one that matters most
    if (typeof ev.clientX === 'number') push(ev.timeStamp, ev.clientX, ev.clientY);
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
