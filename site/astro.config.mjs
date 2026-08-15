import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

const src = (p) => fileURLToPath(new URL(p, import.meta.url));

// The site points at the packages' **sources**, not at their `dist/`. Two reasons: no build
// is needed to run the demos, and a broken demo breaks immediately rather than after a
// forgotten build.
//
// `base` comes from the environment so the same site can be served from the root of a domain
// or from `/<repo>/` on GitHub Pages. Every internal link is either relative or goes through
// `url()`, so both work.
export default defineConfig({
  site: process.env.ASTRO_SITE ?? 'https://trieur.dev',
  base: process.env.ASTRO_BASE ?? '/',
  trailingSlash: 'always',
  vite: {
    resolve: {
      alias: [
        { find: /^@trieur\/core\/trieur\.css$/, replacement: src('../packages/core/trieur.css') },
        { find: /^@trieur\/core\/element$/, replacement: src('../packages/core/src/element.ts') },
        { find: /^@trieur\/core\/flick$/, replacement: src('../packages/core/src/flick.ts') },
        { find: /^@trieur\/core$/, replacement: src('../packages/core/src/index.ts') },
        { find: /^@trieur\/learn\/bench$/, replacement: src('../packages/learn/src/bench.ts') },
        { find: /^@trieur\/learn$/, replacement: src('../packages/learn/src/index.ts') },
      ],
    },
  },
});
