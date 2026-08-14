// Le geste, isolé du tri.
//
// Pointer Events uniquement : souris, doigt et stylet avec le même code. Pas de drag &
// drop HTML5, inutilisable au doigt.
//
// Une carte se glisse d'un bloc — image, texte, marges. Mais **les liens et les boutons
// restent cliquables** : on n'écarte tout de suite que les champs de saisie ; sur un `a`
// ou un `button` on attend quelques pixels de mouvement pour décider, et on annule le
// clic qui aurait suivi. Sinon une carte dont le lien couvre la moitié de la surface
// devient impossible à trier.

export interface GestureState {
  dx: number;
  dy: number;
  dist: number;
  /** le glisser a pris la main (au-delà du seuil d'engagement) */
  engaged: boolean;
  /** le geste a démarré sur un lien ou un bouton */
  interactive: boolean;
}

export interface GestureHandlers {
  onMove(g: GestureState, e: PointerEvent): void;
  onEnd(g: GestureState, e: PointerEvent): void;
}

/** Distance, en px, au-delà de laquelle un appui sur un lien devient un glisser. */
const ENGAGE = 6;

/**
 * Démarre un geste sur `el`. Renvoie `null` si l'événement ne doit pas être capté
 * (bouton secondaire, champ de saisie).
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
    // parti d'un lien : on ne prend la main qu'une fois l'intention de glisser établie
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
    // le glisser a démarré sur un lien : on annule le clic qui suivrait
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
