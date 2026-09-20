/**
 * The suite's harness: `test` / `testAsync` count passes and failures,
 * `report()` prints the total and sets the exit code, and `test/test.ts`
 * calls it once every file has run. An argument on the command line runs
 * only the tests whose name contains it.
 */


let passCount = 0;
let failCount = 0;
const only = process.argv[2] ?? null;

export function test(name: string, fn: () => void): void {
  if (only && !name.includes(only)) return;
  try {
    fn();
    passCount += 1;
  } catch (err: unknown) {
    failCount += 1;
    process.stdout.write(
      `FAIL  ${name}\n      ${String((err as Error).message).split("\n").join("\n      ")}\n`,
    );
  }
}

export async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  if (only && !name.includes(only)) return;
  try {
    await fn();
    passCount += 1;
  } catch (err: unknown) {
    failCount += 1;
    process.stdout.write(
      `FAIL  ${name}\n      ${String((err as Error).message).split("\n").join("\n      ")}\n`,
    );
  }
}

/** The total, and the exit code: 1 when anything failed. */
export function report(): never {
  process.stdout.write(`\n${passCount} passed, ${failCount} failed\n`);
  process.exit(failCount > 0 ? 1 : 0);
}
