import type { Task } from './model.ts';
import type { TaskRepo } from './repo.ts';

export class TaskService {
  private repo: TaskRepo;

  constructor(repo: TaskRepo) {
    this.repo = repo;
  }

  add(title: string): Task {
    if (!title.trim()) throw new Error('title required');
    return this.repo.insert({ title: title.trim() });
  }

  complete(id: number): Task {
    const t = this.repo.get(id);
    if (!t) throw new Error('not found');
    t.done = true;
    return t;
  }

  list(): Task[] {
    return this.repo.all();
  }
}
