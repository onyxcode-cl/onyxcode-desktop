import type { Stock } from './stock.ts';

export interface Row {
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
}

export function summary(stock: Stock, skus: string[]): Row[] {
  return skus.map((sku) => ({
    sku,
    onHand: stock.onHand(sku),
    reserved: stock.reserved(sku),
    available: stock.onHand(sku),
  }));
}
