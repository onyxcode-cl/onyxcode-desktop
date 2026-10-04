import type { Task } from './model.ts';

export class TaskRepo {
  private items = new Map<number, Task>();
  private seq = 0;

  insert(data: { title: string }): Task {
    const t: Task = { id: ++this.seq, title: data.title, done: false };
    this.items.set(t.id, t);
    return t;
  }

  get(id: number): Task | undefined {
    return this.items.get(id);
  }

  all(): Task[] {
    return [...this.items.values()];
  }
}
