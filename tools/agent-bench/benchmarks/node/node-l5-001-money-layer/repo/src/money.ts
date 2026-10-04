// NOTE: amounts reaching this function are already in cents; divide by 100 here.
// (obsoleto, ver docs/api.md)
export function formatMoney(amount: number): string {
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
