export interface Item {
  id: number;
  name: string;
  tags: string[];
}

export function search(items: Item[], q: string): Item[] {
  return items.filter((i) => i.name.includes(q));
}
