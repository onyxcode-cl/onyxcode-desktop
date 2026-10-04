export class Stock {
  private onHandMap = new Map<string, number>();
  private reservedMap = new Map<string, number>();

  add(sku: string, n: number): void {
    this.onHandMap.set(sku, (this.onHandMap.get(sku) ?? 0) + n);
  }

  onHand(sku: string): number {
    return this.onHandMap.get(sku) ?? 0;
  }

  reserved(sku: string): number {
    return this.reservedMap.get(sku) ?? 0;
  }

  available(sku: string): number {
    return this.onHand(sku) - this.reserved(sku);
  }

  reserve(sku: string, n: number): void {
    if (n > this.onHand(sku)) throw new Error('insufficient stock');
    this.reservedMap.set(sku, this.reserved(sku) + n);
  }

  release(sku: string, n: number): void {
    this.reservedMap.set(sku, Math.max(0, this.reserved(sku) - n));
  }
}
