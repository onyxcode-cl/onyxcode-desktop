export function createMailer() {
  const host = process.env.SMTP_HOST ?? 'localhost';
  const port = Number(process.env.SMTP_PORT ?? 25);
  return { describe: () => host + ':' + port };
}
