---
layout: ../../layouts/Doc.astro
title: Keyboard and gestures
description: Every key the deck listens to, every gesture it answers, and how to change them.
---

The keyboard is not the accessible fallback here: it is the fast path. A mouse sorts one card
at a time at the speed of an arm; a hand on `a s d f` sorts a hundred at the speed of reading.
Everything the pointer can do has a key, and the deck never grabs a key it does not use.

## Sorting

| | |
|---|---|
| <kbd>a</kbd> <kbd>s</kbd> <kbd>d</kbd> … | file into that zone — the letters follow the zone order |
| <kbd>↵</kbd> | accept what the model suggests (nothing happens when it suggests nothing) |
| <kbd>space</kbd> | skip: the card goes to the back of the pile |
| <kbd>⌫</kbd> | undo, and unlearn the filing that undo removes |
| <kbd>esc</kbd> | leave fullscreen, or drop the multi-zone stack |

The keys come from `keys`, a plain string handed out in order:

```js
new Deck(el, { zones, keys: 'asdfghjkl' });   // the default
new Deck(el, { zones, keys: '123456789' });   // a numeric pad
```

A zone can also name its own: `{ id: 'dev', key: 'v' }`. What matters is that the key belongs
to the *position*, not to the folder — the muscle memory is spatial, and a zone that keeps its
spot keeps its key even when what it holds changes.

## Several zones at once

Only when `multi` is on. See [Several zones at once](/docs/multi/).

| | |
|---|---|
| hold <kbd>⇧</kbd> + <kbd>a</kbd> <kbd>s</kbd> … | stack while held; releasing <kbd>⇧</kbd> files them all |
| tap <kbd>⇧</kbd> alone | latch the mode — tap again to leave, or file with <kbd>↵</kbd> |
| <kbd>↵</kbd> | file the stack |
| <kbd>esc</kbd> | drop the stack, file nothing |

A bare tap on Shift is a mode toggle; a Shift *used* as a modifier is not. The deck tells them
apart by remembering whether any key was pressed while it was down, which is the only way a
single physical key can be both without one meaning stealing the other.

## Focus, and doing without it

The stage is a `role="application"` with `tabindex="0"`: it takes focus, and the keys work
while it has it. `deck.focus()` puts it there.

But a sorter you must click before the keyboard works hides its fastest path behind a step
nobody is told about — so when **exactly one deck is on screen** (half of it visible, no other
deck alongside), it also answers keys pressed anywhere on the page. Two decks fall back to
focus, because the page cannot know which one you meant, and typing in a field always wins:

```js
new Deck(el, { keyboard: 'auto' });   // the default
new Deck(el, { keyboard: 'focus' });  // only when the stage has focus
new Deck(el, { keyboard: false });    // no shortcuts at all
```

Fullscreen (<kbd>esc</kbd> to leave) also locks the page scroll behind the modal, which is why
it is a modal and not the Fullscreen API: the API cannot be opened without a user gesture, and
half the ways into fullscreen here are not gestures.

## The pointer

| | |
|---|---|
| drag past `threshold` | file into the region under the card |
| a throw | file where the throw lands — the [flick plugin](/docs/throw/) |
| double tap | accept the suggestion, the touch equivalent of <kbd>↵</kbd> |
| press and hold a card | open the multi-zone stack, then sweep across zones |
| press and hold the stage | summon the round pad under the thumb (`multiPad: 'dynamic'`) |
| tap a zone | file into it, with `tapZones` — no drag at all |

The stage is carved into regions and **the drop aims at the region under the pointer**, not at
an approximate angle — what you see is what you hit. Where there is no carving
(`segments: false`), the direction of the drag decides.

## On a phone

A sorting swipe and a page scroll are the same gesture. Rather than fight the page for it, an
inline deck lets the page win: vertical swipes scroll, and the deck shows a **play button**.
Press it — or the card, or Expand — and the deck takes the gesture; **Stop**, beside Expand,
hands the swipe back. Set `touchPreview: false` where the deck already is the screen (an app
view, a phone-sized popup) and it takes the gesture inline from the start.

```js
new Deck(el, { touchPreview: false });
deck.play(true);   // or take it yourself, whenever you like
```

## Showing them

The site renders these with a `Kbd` component (Lucide glyphs for the modifiers, a keycap for
the rest) and a `Shortcuts` sheet the demos open from a button in the deck's own bar. Nothing
of that ships in the library — but the stylesheet does style `.tr kbd`, so a host that prints a
keycap of its own gets the same one the zones use.
