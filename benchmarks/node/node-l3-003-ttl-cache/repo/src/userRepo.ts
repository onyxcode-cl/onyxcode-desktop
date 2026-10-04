export interface User {
  id: string;
  name: string;
}

export interface UserRepo {
  find(id: string): Promise<User | undefined>;
}
