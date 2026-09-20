import { collectReport } from "../report/collect.ts";
import type { Report } from "../report/types.ts";

function renderText(report: Report): string {
  const lines = [`${report.project}: ${report.findings.length} finding(s)`];
  for (const f of report.findings) lines.push(`  ${f.file}:${f.line}  ${f.rule}  ${f.message}`);
  return lines.join("\n");
}

function renderJson(report: Report): string {
  return JSON.stringify({ project: report.project, findings: report.findings }, null, 2);
}

export async function reportCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const report = await collectReport(root);
  process.stdout.write(`${json ? renderJson(report) : renderText(report)}\n`);
  return report.findings.length === 0 ? 0 : 1;
}
