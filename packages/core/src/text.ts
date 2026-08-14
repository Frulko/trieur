// Libellés. Le français par défaut (c'est la langue du dépôt), l'anglais fourni,
// n'importe quoi d'autre par l'option `text`.

import type { DeckText } from './types.js';

export const fr: DeckText = {
  empty: 'Rien à trier.',
  skip: 'Passer',
  undo: 'Annuler',
  expand: 'Agrandir',
  close: 'Fermer (Échap)',
  free: 'zone libre',
  count: (n) => `${n} à trier`,
};

export const en: DeckText = {
  empty: 'Nothing to sort.',
  skip: 'Skip',
  undo: 'Undo',
  expand: 'Expand',
  close: 'Close (Esc)',
  free: 'free zone',
  count: (n) => `${n} left`,
};
