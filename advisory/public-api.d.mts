interface Inventory {
  target: string;
  file: string;
  count: number;
  documented: number;
  aliases: number;
  bindings: string;
}

interface Surface {
  language: "go" | "typescript";
  inventory: Inventory;
  entries: { name: string; row: string; signature: string; doc: string; typeOnly?: boolean; alias?: string }[];
  label: string;
  body: string;
  packageDoc?: string;
}

export function collectPublicApi(targets: string[], binary: string): Promise<Surface[]>;
export function writePublicApiInputs(out: string, surfaces: Surface[], guide?: string | null, workflows?: {file: string; text: string}[]): Inventory[];
export function publicApiInputs(out: string, targets: string[], binary: string, guide?: string | null): Promise<Inventory[]>;
