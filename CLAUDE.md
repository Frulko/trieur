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
| `packages/core/src/layouts.ts` | `circle`, `voronoi` (golden spiral), `grid` |
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
- **Two ways in, one state.** `#multi` records *how* the mode was opened: a `⇧` release only files
  a stack that `⇧` itself opened, so a stray release cannot fire a latched stack.
- **One example per zone** for the model, and undo unlearns every one of them.
- **Without `onSortMany`**, several zones fall back to sequential `onSort` calls — documented, with
  its partial-failure ceiling stated.

## Deliberately absent

- No virtualisation: two cards are rendered, the pile can hold ten thousand.
- No multi-select of cards, no sub-zones — one card, one move.
- No merging of two diverging models: the server *replaces* the local one at warm start, nothing
  more. The day two devices really sort in parallel, the answer is to have the server replay.
- No approximate vector index: exhaustive comparison as long as the corpus fits in memory.
- No suggestion of a *set* of zones: that would need a confidence per subset.
