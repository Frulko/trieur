// Hangs the shortcut sheet off a button in the deck's own bar.
//
// A library that reads keys should be able to say which ones, from where you are using it —
// not from a page you have to go and find.

import type { Deck } from '@trieur/core';
import { barButton } from './gui';

export function shortcutsButton(deck: Deck, label = 'Shortcuts'): HTMLButtonElement | null {
  const dialog = document.querySelector<HTMLDialogElement>('#shortcuts');
  if (!dialog) return null;
  const btn = barButton(deck, label);
  btn.addEventListener('click', () => dialog.showModal());
  // clicking the backdrop is the other way people close these
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  return btn;
}
