export function line(severity: string, text: string): string {
  return `[${severity}] ${text}`;
}
