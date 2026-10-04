export class NotFoundError extends Error {
  constructor(id: string) {
    super('user not found: ' + id);
    this.name = 'NotFoundError';
  }
}
