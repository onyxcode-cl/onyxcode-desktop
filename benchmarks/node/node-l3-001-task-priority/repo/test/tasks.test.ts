import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskRepo } from '../src/repo.ts';
import { TaskService } from '../src/service.ts';

test('agrega y lista', () => {
  const s = new TaskService(new TaskRepo());
  s.add('uno');
  s.add('dos');
  assert.deepEqual(s.list().map((t) => t.title), ['uno', 'dos']);
});

test('prioridad alta primero', () => {
  const s = new TaskService(new TaskRepo());
  s.add('a');
  s.add('b', 'high');
  assert.deepEqual(s.list().map((t) => t.title), ['b', 'a']);
});
