import { expect, test } from 'bun:test';
import { crosses, defaultFeatures, only, pipe, tokens } from './features.js';

test('tokens: arrays, short text, long text', () => {
  expect(tokens({ tag: ['react', 'CSS'], domain: 'github.com', title: 'A very complete guide to hooks' })).toEqual([
    'tag:react',
    'tag:css',
    'domain:github.com',
    'title:very',
    'title:complete',
    'title:guide',
    'title:hooks',
  ]);
  // neither numbers nor booleans discriminate a filing
  expect(tokens({ n: 42, ok: true, nothing: null })).toEqual([]);
});

test('crosses: the combination becomes a feature of its own', () => {
  const f = crosses([['domain', 'tag']])(['domain:github.com', 'tag:rust', 'tag:cli']);
  expect(f).toContain('domain:github.com×tag:rust');
  expect(f).toContain('domain:github.com×tag:cli');
  expect(f).toContain('domain:github.com'); // the original features stay
  expect(f).not.toContain('tag:rust×tag:cli'); // only the requested pair is crossed
});

test('crosses: stable order and a cap per key', () => {
  const a = crosses([['domain', 'tag']])(['domain:x.com', 'tag:a']);
  const b = crosses([['tag', 'domain']])(['tag:a', 'domain:x.com']);
  expect(a.filter((f) => f.includes('×'))).toEqual(b.filter((f) => f.includes('×')));

  const many = crosses([['domain', 'tag']], 2)(['domain:x.com', 'tag:a', 'tag:b', 'tag:c', 'tag:d']);
  expect(many.filter((f) => f.includes('×')).length).toBe(2); // at most 2 tag values
});

test('pipe and only', () => {
  const extract = pipe(tokens, only('domain'), crosses([['domain', 'tag']]));
  expect(extract({ domain: 'x.com', tag: ['a'] })).toEqual(['domain:x.com']);
});

test('defaultFeatures crosses domain and author with tags', () => {
  const f = defaultFeatures({ domain: 'github.com', author: 'tj', tag: ['rust'] });
  expect(f).toContain('domain:github.com×tag:rust');
  expect(f).toContain('author:tj×tag:rust');
});
