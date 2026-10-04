import { parseLine } from './csv.ts';

export function toObjects(text: string): Record<string, string>[] {
  const lines = text.split('\n');
  const header = parseLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseLine(l);
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });
    return row;
  });
}
