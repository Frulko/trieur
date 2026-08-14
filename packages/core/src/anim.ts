// Animations d'entrée et de sortie des cartes.
//
// Une seule sortie, deux entrées. La carte qui part est toujours aspirée dans sa tuile :
// lancer la carte hors écran dans la direction du geste ne dit pas où elle a atterri.
// Les entrées, elles, disent d'où vient la carte — dépilée d'un cran après un rangement,
// tombée du dessus après une annulation.

/** D'où vient la carte qui apparaît. */
export type Enter = 'sort' | 'undo';

/**
 * Pose un état de départ sur un élément fraîchement inséré, puis le relâche : il rejoint
 * sa position de repos en transition.
 *
 * Le reflow forcé est indispensable — sans lui le navigateur ne voit qu'un seul état et
 * n'anime rien.
 */
export function animateFrom(el: HTMLElement, transform: string, opacity: number): void {
  el.style.transition = 'none';
  el.style.transform = transform;
  el.style.opacity = String(opacity);
  void el.offsetWidth;
  el.style.transition = '';
  el.style.transform = '';
  el.style.opacity = '';
}

/** La carte du dessus apparaît : dépilée d'un cran, ou retombée du ciel après une annulation. */
export function enterTop(el: HTMLElement, kind: Enter): void {
  if (kind === 'sort') animateFrom(el, 'scale(0.94) translateY(14px)', 0.55);
  else animateFrom(el, 'translateY(-160px) scale(1.03) rotate(-2deg)', 0);
}

/** La carte de derrière remonte d'un cran. */
export function enterBehind(el: HTMLElement): void {
  animateFrom(el, 'scale(0.86) translateY(28px)', 0);
}

/** Effet « génie » : la carte est aspirée dans sa tuile. `tilt` garde la sensation du geste. */
export function genie(el: HTMLElement, to: { x: number; y: number }, tilt: number): void {
  el.classList.add('tr-genie');
  el.style.transform = `translate(${to.x}px, ${to.y}px) scale(0.06) rotate(${tilt}deg)`;
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 500); // filet si la transition ne se déclenche pas
}

/** La tuile accuse réception, à l'aller comme au retour. */
export function catchPulse(tile: Element | null | undefined): void {
  if (!tile) return;
  tile.classList.remove('tr-catch');
  void (tile as HTMLElement).offsetWidth; // relance l'animation même sur deux cartes d'affilée
  tile.classList.add('tr-catch');
}
