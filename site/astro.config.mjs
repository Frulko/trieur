import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

const src = (p) => fileURLToPath(new URL(p, import.meta.url));

// Le site pointe sur les **sources** des paquets, pas sur leur `dist/`. Deux raisons :
// on n'a pas à builder pour lancer les démos, et une démo qui casse casse tout de suite —
// pas après un build oublié.
export default defineConfig({
  site: 'https://trieur.dev',
  vite: {
    resolve: {
      alias: [
        { find: /^@trieur\/core\/trieur\.css$/, replacement: src('../packages/core/trieur.css') },
        { find: /^@trieur\/core\/element$/, replacement: src('../packages/core/src/element.ts') },
        { find: /^@trieur\/core$/, replacement: src('../packages/core/src/index.ts') },
        { find: /^@trieur\/learn\/bench$/, replacement: src('../packages/learn/src/bench.ts') },
        { find: /^@trieur\/learn$/, replacement: src('../packages/learn/src/index.ts') },
      ],
    },
  },
});
