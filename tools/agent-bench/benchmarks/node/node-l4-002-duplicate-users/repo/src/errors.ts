export class DuplicateUserError extends Error {
  constructor(name: string) {
    super('duplicate user: ' + name);
    this.name = 'DuplicateUserError';
  }
}
