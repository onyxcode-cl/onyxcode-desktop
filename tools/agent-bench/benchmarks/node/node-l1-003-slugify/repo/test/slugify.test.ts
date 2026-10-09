import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.ts';

test('slug basico', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('Hello, World!'), 'hello-world');
});
