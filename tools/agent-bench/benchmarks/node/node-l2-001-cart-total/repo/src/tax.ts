import { roundCents } from './money.ts';

export const TAX_PCT = 19;

export function withTax(net: number): number {
  return roundCents(net * (1 + TAX_PCT / 100));
}
