// Version antigua, no se importa desde ningun lado.
export function isValidEmail(s: string): boolean {
  return /^[a-z0-9._-]+@[a-z0-9.-]+$/.test(s);
}
