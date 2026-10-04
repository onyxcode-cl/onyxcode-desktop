import { normalizeEmail } from './normalize.ts';
import { isValidEmail } from './validate.ts';

export function register(raw: string): { email: string } {
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) throw new Error('invalid email');
  return { email };
}
