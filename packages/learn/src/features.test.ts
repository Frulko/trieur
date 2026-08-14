import { expect, test } from 'bun:test';
import { crosses, defaultFeatures, only, pipe, tokens } from './features.js';

test('tokens : tableaux, textes courts, textes longs', () => {
  expect(tokens({ tag: ['react', 'CSS'], domain: 'github.com', title: 'Un guide très complet des hooks' })).toEqual([
    'tag:react',
    'tag:css',
    'domain:github.com',
    'title:guide',
    'title:très',
    'title:complet',
    'title:hooks',
  ]);
  // ni les nombres ni les booléens ne discriminent un rangement
  expect(tokens({ n: 42, ok: true, rien: null })).toEqual([]);
});

test('crosses : la combinaison devient un trait à part entière', () => {
  const f = crosses([['domain', 'tag']])(['domain:github.com', 'tag:rust', 'tag:cli']);
  expect(f).toContain('domain:github.com×tag:rust');
  expect(f).toContain('domain:github.com×tag:cli');
  expect(f).toContain('domain:github.com'); // les traits d'origine restent
  expect(f).not.toContain('tag:rust×tag:cli'); // seule la paire demandée est croisée
});

test('crosses : ordre stable et plafond par clé', () => {
  const a = crosses([['domain', 'tag']])(['domain:x.com', 'tag:a']);
  const b = crosses([['tag', 'domain']])(['tag:a', 'domain:x.com']);
  expect(a.filter((f) => f.includes('×'))).toEqual(b.filter((f) => f.includes('×')));

  const many = crosses([['domain', 'tag']], 2)(['domain:x.com', 'tag:a', 'tag:b', 'tag:c', 'tag:d']);
  expect(many.filter((f) => f.includes('×')).length).toBe(2); // 2 valeurs de tag au plus
});

test('pipe et only', () => {
  const extract = pipe(tokens, only('domain'), crosses([['domain', 'tag']]));
  expect(extract({ domain: 'x.com', tag: ['a'] })).toEqual(['domain:x.com']);
});

test('defaultFeatures croise domaine et auteur avec les tags', () => {
  const f = defaultFeatures({ domain: 'github.com', author: 'tj', tag: ['rust'] });
  expect(f).toContain('domain:github.com×tag:rust');
  expect(f).toContain('author:tj×tag:rust');
});
