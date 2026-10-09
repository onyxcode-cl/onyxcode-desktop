import { withTax } from './tax.ts';

export interface Line {
  price: number;
  qty: number;
}

export function cartTotal(lines: Line[]): number {
  let sum = 0;
  for (const l of lines) sum += l.price;
  return withTax(sum);
}
