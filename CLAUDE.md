# trieur — notes for the agent

Bun monorepo. Three publishable packages with no runtime dependencies, plus an Astro site that
doubles as documentation **and** as a visual bench.

```bash
bun test                 # the three packages
bunx tsc -b packages/core packages/learn packages/server
bun run bench            # model bench (synthetic corpus)
bun run dev              # site + demos
```

## Rules

- **English everywhere.** Code, comments, docs, site, commit messages. The package name is
  French; nothing else is.
- **No runtime dependency.** If one seems necessary, the feature probably does not belong here.
  `typescript`, `astro` and `@happy-dom/global-registrator` are development tools, not
  dependencies.
- **Nothing domain-specific in `core` or `learn`.** No "bookmark", "folder" or "link" in the code
  or in the CSS class names. We sort opaque objects into opaque zones.
- **No bundler.** `tsc -b` only. Imports carry the `.js` extension in the source: that is what
  makes the output runnable as-is by Node and by browsers.
- **A number that is stated is a number that was measured.** Any performance claim in any doc has
  to be reproducible with `tools/bench.ts`. If the bench contradicts the docs, the docs are wrong.
- **The site points at the packages' *sources*** (Vite aliases in `astro.config.mjs`), not at
  `dist/`: a broken demo breaks immediately, not after a forgotten build.
- **Internal site links are relative or go through `url()`.** GitHub Pages serves the site from
  `/trieur/`; a root-absolute link would 404 there.

## Files

| File | Role |
|---|---|
| `packages/core/src/deck.ts` | the `Deck` class: pile, zones, rendering, actions, multi-zone stack |
| `packages/core/src/drag.ts` | the gesture, kept apart from the sorting (engagement, cancelled clicks) |
| `packages/core/src/voronoi.ts` | stage carving, `inPolygon` |
| `packages/core/src/layouts.ts` | `auto`, `circle`, `radial` (arcs, multi-ring), `voronoi` (Lloyd), `grid`, `dock` (wrapping) |
| `packages/core/src/anim.ts` | entrances, genie exit, tile bounce |
| `packages/core/src/element.ts` | `<trieur-deck>` / `<trieur-zone>` |
| `packages/learn/src/features.ts` | sparse features, crosses, `pipe` |
| `packages/learn/src/{bayes,linear,knn}.ts` | the three sparse models |
| `packages/learn/src/hedge.ts` | expert weights + blending — **one formula for the whole repo** |
| `packages/learn/src/recommender.ts` | light mode, full mode, offline queue |
| `packages/learn/src/protocol.ts` | wire types, imported by both sides |
| `packages/learn/src/bench.ts` | prequential `evaluate()` + synthetic corpus |
| `packages/server/src/api.ts` | routes, `Request → Response`, testable without a port |
| `packages/server/src/db.ts` | SQLite schema, `INSERT OR IGNORE` on the event id |
| `packages/server/src/embed.ts` | embeddings + vector index |
| `packages/server/src/serve.ts` | the executable (`index.ts` only exports the library) |

## Traps already paid for — do not reintroduce them

### On the model

- **Ignore features never seen, at prediction time.** Otherwise every unknown word of a title
  penalises the zone that has learned a lot (large denominator) and hands the win to an empty one.
- **Stay silent rather than invent**: not enough examples, or no recognised feature → `[]`.
- **The linear update is contrastive, not dense.** A textbook multinomial logistic touches every
  zone on every example: `|vocab| × |zones|` entries to serialise in a browser. Only the right
  zone and the best wrong one are touched.
- **Ensemble weights are measured before learning** (prequential). Measuring after means measuring
  on examples already seen.
- **The synthetic corpus must never carry the answer in the card title.** It happened: the bench
  displayed 95% and measured nothing.

### On the server

- **`INSERT OR IGNORE` on the event id.** An event learned twice skews the model permanently and
  silently. Check the order of the SQL bindings: an off-by-one turns a `NOT NULL` constraint into
  a silently ignored insert — that happened too.
- **Embeddings leave after the response.** Nobody waits on a third-party provider for a filing to
  be accepted.
- **`api.flush()` on SIGINT/SIGTERM**, otherwise it is lost sorting work.

### On the deck

- **A card in flight survives the next render.** `render()` keeps the `.tr-genie` nodes and does
  not *touch* them: reinserting them cancels the transition and snaps the card to the end state.
- **Entrances go through `animateFrom()`**: inline start state, forced reflow, release. Without
  the `void el.offsetWidth` the browser only sees one state and animates nothing.
- **The carving is the truth of the drop.** `zoneAt()` tests cell membership; angular aiming is
  only a fallback when `segments: false`. Do not let them drift apart.
- **Changing zones does not remount the library** (`setZones`), otherwise already-filed cards come
  back and the undo history is wiped. A pick pointing at a removed zone is dropped there too.
- **JS wins over markup**, never the other way round.
- **A link inside a card does not block the drag**: six pixels of movement decide, and the click
  that would follow is cancelled in the capture phase.
- **`best()` may be asynchronous.** The `#ask` token drops a late answer: a slow server must not
  make a suggestion appear on the next card.
- **Fullscreen is not the Fullscreen API**: it makes the page inert and breaks links inside cards.
  After toggling, call `layout()` again.

### On multi-zone mode

- **`multi` is off by default.** Stacking only makes sense when zones are not mutually exclusive,
  and only the host knows that.
- **Four ways in, one state.** `#multi` records *how* the mode was opened (`shift`, `latch`,
  `hold`, `pad`), because that decides how it closes: a `⇧` release only files a stack that `⇧`
  itself opened, and the pad's release only files a stack the pad opened.
- **A bare `⇧` tap is the shortcut.** `#shiftUsed` is set by any key pressed while `⇧` is down, so
  "tap" means what it says. Do not set it on the `⇧` keydown itself, and do not reset it on
  key-repeat.
- **Sweeping adds, never removes.** `#stack()` is add-only; toggling belongs to taps and keys. An
  accidental second pass over a zone must not undo a deliberate first one.
- **One example per zone** for the model, and undo unlearns every one of them.
- **Without `onSortMany`**, several zones fall back to sequential `onSort` calls — documented, with
  its partial-failure ceiling stated. A stack of one still goes through `onSort`.

### On the feel (a 2015 iPad is the judge)

- **One `onMove` per frame.** `pointermove` outruns the display and arrives coalesced; the
  handler is `requestAnimationFrame`-throttled. Never add `pointermove` to the window net — that
  doubles the very work this avoids.
- **No `getBoundingClientRect()` during a drag.** The stage rect is cached at `pointerdown`
  (`#rect`) and cleared at the end. Hit-testing against a fresh rect is a forced layout per frame.
- **`#lit` guards highlighting**, `#layoutKey` guards re-layout. `render()` runs while a card is
  in flight; rebuilding the region SVG at that moment is the hitch you feel.
- **Transform and opacity only** on anything that moves. No filter on the genie, no animated
  box-shadow for the multi ring — both repaint every frame. `will-change` only on `.tr-dragging`
  and `.tr-genie`, never on `.tr-card`.
- **Every `color-mix()` has a plain fallback in front of it.** Safari only shipped it in 16.2 and
  these tablets stop around there; without the fallback every border renders as nothing.
- **A release always resolves.** `pointercancel` returns the card instead of filing it, `window`
  carries the `pointerup` net for iOS, and `lostpointercapture` closes the last gap. `commit()`
  reports whether the card *left*: a free zone, a busy deck and a refused filing all answer
  `false`, and the gesture brings the card home. Without that it froze between origin and zone.
- **Pointer capture is taken on engagement, never on pointerdown.** A captured pointer retargets
  its events, so the browser dispatches `click` to the card instead of to the link inside it —
  capturing early killed every link and button in a card.
- **`[hidden]` loses to `display`.** Every element the deck hides (`.tr-nothing`, `.tr-pad`,
  the bar's multi button) needs its own `[hidden] { display: none }` rule.
- **The clearance is an invariant, not a suggestion.** `resolveLayout()` runs `clearCentre()` over
  every layout, custom ones included — a grid with an odd cell count puts a tile under the card
  every time.
- **`render()` reconciles, it does not rebuild.** The card that was second is promoted by removing
  a class, not by being recreated: rebuilding refetches every image it holds, and an image that
  reloads blinks. Elements are matched to items through `#shown`.
- **The card is not always at the centre of the stage.** A layout may return a `centre` (arc
  menus do), and the deck writes `--tr-card-x/y`; zone angles and the genie target are measured
  from *that* point, not from the stage centre.
- **`.tr-*` classes land on the element the host passed in.** `.host .tr { … }` matches nothing:
  the two are the same node, so it is `.host.tr`. Written as a descendant, a card-size override
  silently loses to the stylesheet's own defaults — and the layout is then placed around a card
  that is not the one on screen.
- **`.tr-full` *is* `.tr`.** Any later rule on the bare `.tr` selector — `@media (pointer:
  coarse) { .tr { position: relative } }`, for one — beats `.tr-full { position: fixed }` at
  equal specificity and silently kills fullscreen on exactly the devices that need it. Write
  `.tr:not(.tr-full)`.
- **The layout is placed around the card's *declared* size, never its content.** Measuring
  `offsetHeight` made a card with one more line of text nudge every zone and repaint the
  carving — a flicker with no visible cause. `--tr-card-w` / `--tr-card-h` are what the zones
  are placed around.
- **Nothing that marks a zone may change its box.** The suggestion glyph, the pick badge: all
  out of flow. A tile is centred on its point, so a tile that grows by 8px moves by 4 — and the
  measured tile size feeds the layout's own margins.
- **A region only wins the aim when the drag is not heading away from its tile.** A dock puts
  the card *inside* one of its columns, so without that check the one zone in line with the
  card swallowed drags pointing anywhere, including straight up, away from every tile.
- **The responsive scale is measured, not guessed.** `.tr-sm` / `.tr-xs` come from the stage's
  own width, set at the top of `layout()` before anything else is measured. A viewport media
  query is wrong twice over: a deck in a narrow panel on a wide screen never gets the small
  scale, and a full-width deck on a phone gets it even in fullscreen where the room is there.
- **An absolutely positioned card ignores its container's padding.** The zone tray shortens
  `.tr-cards` with `bottom: var(--tr-tray)`, never with padding — padding is exactly what the
  card's own layout skips.
- **On touch, the page owns the vertical swipe until the deck is fullscreen.** `touch-action:
  pan-y` inline, `none` expanded, and a tap opens it. A widget that takes the scroll gesture
  turns the page into a trap.
- **The release is not a velocity sample.** It carries the position of the last move, so a fit
  centred on it reads "no movement in the last few ms" and calls a fast flick a standstill. What
  the release contributes is *how long ago* the last real movement was.
- **A throw aims at the ray, not at the landing point.** A projection that overshoots by 400px
  still points at the same tile; nearest-to-point picks whatever sits near the end of the line.
- **`flickMin` is a floor on intent, not on noise.** At 0.25 px/ms an ordinary careful drag is a
  throw and the deck feels possessed. 0.6 is a flick.
- **Never freeze the page with `overflow: hidden` on the root.** It relayouts the document twice
  per drag and drops the scroll position. A non-passive `touchmove` listener costs nothing — and
  do not add a non-passive `wheel` one, which taxes every scroll for the life of the page.
- **Velocity is sampled on the raw pointer move, not the throttled one.** A flick is over in
  three frames; averaging it across a frame boundary flattens the peak that made it a flick.

## Deliberately absent

- No virtualisation: two cards are rendered, the pile can hold ten thousand.
- No multi-select of cards, no sub-zones — one card, one move.
- No merging of two diverging models: the server *replaces* the local one at warm start, nothing
  more. The day two devices really sort in parallel, the answer is to have the server replay.
- No approximate vector index: exhaustive comparison as long as the corpus fits in memory.
- No suggestion of a *set* of zones: that would need a confidence per subset.
