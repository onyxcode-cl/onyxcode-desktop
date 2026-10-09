export function createClient() {
  const base = process.env.API_URL ?? 'http://localhost:3000';
  const timeout = Number(process.env.API_TIMEOUT_MS ?? 5000);
  return {
    timeout,
    url: (p: string) => base.replace(/\/$/, '') + '/' + p.replace(/^\//, ''),
  };
}
