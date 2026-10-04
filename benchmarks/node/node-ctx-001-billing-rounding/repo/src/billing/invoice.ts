import { roundCents } from './rounding.ts';

export interface InvoiceLine {
  unitPrice: number;
  qty: number;
  taxPct: number;
}

export function lineTotal(l: InvoiceLine): number {
  return roundCents(l.unitPrice * l.qty * (1 + l.taxPct / 100));
}

export function invoiceTotal(lines: InvoiceLine[]): number {
  return lines.reduce((s, l) => s + lineTotal(l), 0);
}
