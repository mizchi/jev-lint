import { mkdirSync, writeFileSync } from "node:fs";

const billing = "The canManageBilling function must return true only for the owner role, and false for every other role.";
const expiry = "The sessionIsValid function accepts current time in milliseconds and expiry in seconds. It must return true only before expiry, converting seconds to milliseconds, and false at or after expiry.";
const cases: unknown[] = [], expected: unknown[] = [];
function add(id: string, statement: string, main: string, helpers: Record<string, string>, choice: string | null, resolution: string | null, options: Record<string, unknown> = {}) {
  cases.push({ id, statement, main, helpers, ...options });
  expected.push({ id, choice, resolution, targetPath: "src/main.ts", missingClaim: !!options.missingClaim, outsideScope: !!options.outsideScope });
}
add("billing-member", billing, 'export function canManageBilling(role) { return role === "owner" || role === "member"; }', {}, "contradicts", "implementation");
add("billing-owner", billing, 'export function canManageBilling(role) { return role === "owner"; }', {}, "supports", "none");
const session = 'import { convert as units } from "./conversion.js";\nexport function sessionIsValid(nowMs, expirySeconds) { return nowMs < units(expirySeconds); }';
add("expiry-correct", expiry, session, { "src/conversion.ts": "export function convert(seconds) { return seconds * 1000; }" }, "supports", "none");
add("expiry-units", expiry, session, { "src/conversion.ts": "export function convert(seconds) { return seconds; }" }, "contradicts", "implementation");
add("expiry-unavailable", expiry, session, {}, "insufficient_context", "needs_context");
add("expiry-ambiguous", expiry, session, { "src/conversion.ts": "export function convert(seconds) { return seconds * 1000; }", "src/conversion.js": "export function convert(seconds) { return seconds; }" }, "insufficient_context", "needs_context");
add("expiry-no-budget", expiry, session, { "src/conversion.ts": "export function convert(seconds) { return seconds * 1000; }" }, "insufficient_context", "needs_context", { context: { maxAddedChars: 0 } });
add("billing-chain", billing, 'import { permitted } from "./access.js";\nexport function canManageBilling(role) { return permitted(role); }', {
  "src/access.ts": 'import { allowed } from "./permission.js";\nexport function permitted(role) { return allowed(role); }',
  "src/permission.ts": 'export function allowed(role) { return role === "owner" || role === "member"; }',
}, "contradicts", "implementation");
add("retention-units", "The retainRaw function takes age in days and must return true through age 30 days inclusive and false for greater ages.",
  "const HOURS_PER_DAY = 24;\nexport function retainRaw(ageDays) { return ageDays <= 30 * HOURS_PER_DAY; }", {}, "contradicts", "implementation");
add("billing-refactored", billing, 'export function canManageBilling(role) { return ["owner"].includes(role); }', {}, "supports", "none");
add("registry-missing", billing, 'export function canManageBilling(role) { return role === "owner"; }', {}, null, null, { missingClaim: true });
add("registry-scope", billing, 'export function canManageBilling(role) { return role === "owner"; }', {}, null, null, { outsideScope: true });
const directory = "experiments/relations/workflow";
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/inputs.json`, `${JSON.stringify({ schema: "jev-lint-workflow-cases-1", cases }, null, 2)}\n`);
writeFileSync(`${directory}/expect.json`, `${JSON.stringify({ schema: "jev-lint-workflow-expect-1", cases: expected }, null, 2)}\n`);
