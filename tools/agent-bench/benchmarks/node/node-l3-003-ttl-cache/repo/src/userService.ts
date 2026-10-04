import { NotFoundError } from './errors.ts';
import type { User, UserRepo } from './userRepo.ts';

export class UserService {
  private repo: UserRepo;

  constructor(repo: UserRepo) {
    this.repo = repo;
  }

  async get(id: string): Promise<User> {
    const u = await this.repo.find(id);
    if (!u) throw new NotFoundError(id);
    return u;
  }
}
