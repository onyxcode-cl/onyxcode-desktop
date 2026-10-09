export function formatReportDate(d: Date): string {
  return d.toLocaleDateString('en-US');
}

export function buildHeader(title: string, d: Date): string {
  return 'Informe: ' + title + ' (' + formatReportDate(d) + ')';
}
