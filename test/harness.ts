/**
 * The suite's harness: `test` / `testAsync` count passes and failures,
 * `report()` prints the total and sets the exit code, and `test/test.ts`
 * calls it once every file has run. An argument on the command line runs
 * only the tests whose name contains it.
 */


let passCount = 0;
let failCount = 0;
const only = process.argv[2] ?? null;

/**
 * How much of a failure is printed. `assert.equal` on two long strings
 * appends Node's own diff to the message, and the RULES.md check compares a
 * 45,000-character generated page: the real report was the custom message
 * ("run `npm run rules:md`") followed by tens of thousands of characters of
 * context, which buries the one line that says what to do -- and does it in
 * every test that compares anything large, not only that one. The head is
 * what carries the message and the first difference, so the head is kept and
 * the rest is counted rather than pasted.
 */
export const MAX_FAIL_LINES = 24;
/** A single line of it; Node prints whole file contents on one line. */
export const MAX_FAIL_LINE = 200;

/** A failure, as the terminal gets it. Pure, so it can be tested. */
export function formatFailure(name: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lines = message.split("\n");
  const kept = lines
    .slice(0, MAX_FAIL_LINES)
    .map((l) => (l.length > MAX_FAIL_LINE ? `${l.slice(0, MAX_FAIL_LINE)} ... +${l.length - MAX_FAIL_LINE} chars` : l));
  const dropped = lines.length - kept.length;
  if (dropped > 0) kept.push(`... ${dropped} more line(s); run this file alone for all of it`);
  return `FAIL  ${name}\n      ${kept.join("\n      ")}\n`;
}

export function test(name: string, fn: () => void): void {
  if (only && !name.includes(only)) return;
  try {
    fn();
    passCount += 1;
  } catch (err: unknown) {
    failCount += 1;
    process.stdout.write(formatFailure(name, err));
  }
}

export async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  if (only && !name.includes(only)) return;
  try {
    await fn();
    passCount += 1;
  } catch (err: unknown) {
    failCount += 1;
    process.stdout.write(formatFailure(name, err));
  }
}

/** The total, and the exit code: 1 when anything failed. */
export function report(): never {
  process.stdout.write(`\n${passCount} passed, ${failCount} failed\n`);
  process.exit(failCount > 0 ? 1 : 0);
}
