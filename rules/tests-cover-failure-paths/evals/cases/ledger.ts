export interface Entry {
  date: string;
  amountCents: number;
  memo: string;
}

export interface Ledger {
  closedThrough: string;
  entries: Entry[];
}

export type PostResult = { ok: true; ledger: Ledger } | { ok: false; reason: string };

export function postEntry(ledger: Ledger, entry: Entry): PostResult {
  if (!Number.isInteger(entry.amountCents)) {
    throw new TypeError(`amount must be an integer number of cents, got ${entry.amountCents}`);
  }
  if (entry.date <= ledger.closedThrough) {
    return { ok: false, reason: `period through ${ledger.closedThrough} is closed` };
  }
  return { ok: true, ledger: { ...ledger, entries: [...ledger.entries, entry] } };
}

export function parseAmount(raw: string): number {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(raw.trim());
  if (match === null) {
    throw new Error(`amount ${JSON.stringify(raw)} is not in 0.00 form`);
  }
  const cents = Number(match[2]) * 100 + Number(match[3]);
  return match[1] === "-" ? -cents : cents;
}

export function parseEntryLine(line: string): Entry {
  const [date, amount, ...memo] = line.split(/\s+/);
  if (date === undefined || amount === undefined) {
    throw new Error(`entry line needs a date and an amount: ${JSON.stringify(line)}`);
  }
  return { date, amountCents: parseAmount(amount), memo: memo.join(" ") };
}
