const ORDER = ['debug', 'info', 'warn', 'error'];

export function createLogger() {
  const level = process.env.LOG_LEVEL ?? 'info';
  return {
    level,
    enabled: (l: string) => ORDER.indexOf(l) >= ORDER.indexOf(level),
  };
}
