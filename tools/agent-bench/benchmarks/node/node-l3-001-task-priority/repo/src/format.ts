import type { Task } from './model.ts';

export function formatTask(t: Task): string {
  return (t.done ? '[x] ' : '[ ] ') + t.id + ' ' + t.title;
}
