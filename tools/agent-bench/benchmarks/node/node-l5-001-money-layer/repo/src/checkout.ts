import { formatMoney } from './money.ts';

export function receiptLine(name: string, priceCents: number): string {
  return name + ': ' + formatMoney(priceCents);
}
