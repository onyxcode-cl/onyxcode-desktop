import { formatMoney } from './money.ts';

export function invoiceTotal(linesDollars: number[]): string {
  return formatMoney(linesDollars.reduce((a, b) => a + b, 0));
}
