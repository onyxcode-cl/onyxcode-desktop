export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
}
