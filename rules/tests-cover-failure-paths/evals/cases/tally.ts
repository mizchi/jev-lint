export interface ReportRow {
  label: string;
  value: number;
}

export interface Report {
  title: string;
  rows: ReportRow[];
}

export type RenderResult = { ok: true; text: string } | { ok: false; error: string };

export async function renderReport(title: string, fetchRows: () => Promise<ReportRow[]>): Promise<RenderResult> {
  let rows: ReportRow[];
  try {
    rows = await fetchRows();
  } catch (err) {
    return { ok: false, error: `could not load rows for ${title}: ${(err as Error).message}` };
  }
  const width = Math.max(...rows.map((r) => r.label.length), 0);
  const lines = rows.map((r) => `${r.label.padEnd(width)}  ${r.value}`);
  return { ok: true, text: [title, "".padEnd(title.length, "="), ...lines].join("\n") };
}

export function assertReportShape(value: unknown): asserts value is Report {
  const v = value as Partial<Report> | null;
  if (v === null || typeof v !== "object" || typeof v.title !== "string" || !Array.isArray(v.rows)) {
    throw new TypeError("a report needs a string title and a rows array");
  }
}
