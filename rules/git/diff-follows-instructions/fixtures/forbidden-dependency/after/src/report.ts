import chalk from "chalk";

export function line(severity: string, text: string): string {
  const colour = severity === "error" ? chalk.red : severity === "warn" ? chalk.yellow : chalk.dim;
  return colour(`[${severity}] ${text}`);
}
