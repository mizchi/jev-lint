interface Inventory {
  target: string;
  file: string;
  count: number;
  documented: number;
  aliases: number;
  bindings: string;
}

interface NameSurface {
  language: "go" | "typescript" | "rust";
  packageName?: string;
  entries: { name: string; typeOnly?: boolean; alias?: string }[];
}

interface Surface extends NameSurface {
  inventory: Inventory;
  entries: { name: string; row: string; signature: string; doc: string; typeOnly?: boolean; alias?: string }[];
  label: string;
  body: string;
  packageDoc?: string;
}

export function scanPublicSource(binary: string, language: string, source: string, rules: Record<string, unknown>): { text: string; ruleId: string; range: { start: { line: number }; end: { line: number } } }[];
export function collectPublicNames(targets: string[], binary: string): Promise<NameSurface[]>;
export function collectPublicApi(targets: string[], binary: string): Promise<Surface[]>;
export function writePublicApiInputs(out: string, surfaces: Surface[], guide?: string | null, workflows?: {file: string; text: string}[]): Inventory[];
export function publicApiInputs(out: string, targets: string[], binary: string, guide?: string | null): Promise<Inventory[]>;
