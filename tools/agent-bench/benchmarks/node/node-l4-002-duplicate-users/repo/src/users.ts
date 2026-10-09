export class Users {
  private names: string[] = [];

  register(name: string): string {
    this.names.push(name);
    return name;
  }

  list(): string[] {
    return [...this.names];
  }
}
