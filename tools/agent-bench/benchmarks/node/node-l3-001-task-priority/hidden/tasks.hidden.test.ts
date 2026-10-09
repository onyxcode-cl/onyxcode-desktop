import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskRepo } from '../src/repo.ts';
import { TaskService } from '../src/service.ts';
import { formatTask } from '../src/format.ts';

function svc() {
  return new TaskService(new TaskRepo());
}

test('prioridad por defecto normal', () => {
  assert.equal(svc().add('x').priority, 'normal');
});

test('prioridad invalida', () => {
  assert.throws(() => svc().add('x', 'urgent' as never), /invalid priority/);
});

test('orden high > normal > low y estable por id', () => {
  const s = svc();
  s.add('l1', 'low');
  s.add('n1');
  s.add('h1', 'high');
  s.add('n2', 'normal');
  s.add('h2', 'high');
  assert.deepEqual(s.list().map((t) => t.title), ['h1', 'h2', 'n1', 'n2', 'l1']);
});

test('formato de tareas', () => {
  const s = svc();
  const h = s.add('urgente', 'high');
  const n = s.add('normal');
  assert.equal(formatTask(h), '[ ] 1 ! urgente');
  assert.equal(formatTask(n), '[ ] 2 normal');
});

test('completar conserva prioridad', () => {
  const s = svc();
  const t = s.add('x', 'low');
  assert.equal(s.complete(t.id).priority, 'low');
});
