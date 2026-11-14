import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { relationDigest, type RelationInput } from "../src/relation-contract.ts";
import type { RelationCase, RelationExpectation } from "../src/relation-eval.ts";

interface Vector { id: string; args: unknown[]; expected: unknown }
interface Pair { id: string; requirement: string; exportName: string; broken: string; clean: string; tests: Vector[]; failedTests: string[] }
const pairs: Pair[] = [
  { id: "period-end-inclusive", requirement: "The canAudit function allows access only for active subscriptions when now is strictly less than periodEnd. Access at periodEnd is denied.", exportName: "canAudit",
    broken: "export function canAudit(input) { return input.status === 'active' && input.now <= input.periodEnd; }",
    clean: "export function canAudit(input) { return input.status === 'active' && input.now < input.periodEnd; }",
    failedTests: ["exact-end-denied"], tests: [{ id: "exact-end-denied", args: [{ status: "active", now: 100, periodEnd: 100 }], expected: false }, { id: "before-end-allowed", args: [{ status: "active", now: 99, periodEnd: 100 }], expected: true }] },
  { id: "period-start-early", requirement: "The canAudit function allows access only when status is active and periodStart <= now < periodEnd. It denies access before the period starts.", exportName: "canAudit",
    broken: "export function canAudit(input) { return input.status === 'active' && input.now < input.periodEnd; }",
    clean: "export function canAudit(input) { return input.status === 'active' && input.periodStart <= input.now && input.now < input.periodEnd; }",
    failedTests: ["before-start-denied"], tests: [{ id: "before-start-denied", args: [{ status: "active", now: 49, periodStart: 50, periodEnd: 100 }], expected: false }, { id: "exact-start-allowed", args: [{ status: "active", now: 50, periodStart: 50, periodEnd: 100 }], expected: true }] },
  { id: "retention-hours-days", requirement: "For valid raw payloads, retainRawPayload returns true until age reaches 30 days and false at or after 30 days. ageHours is expressed in hours.", exportName: "retainRawPayload",
    broken: "export function retainRawPayload(input) { return input.ageHours < 30; }",
    clean: "export function retainRawPayload(input) { return input.ageHours < 30 * 24; }",
    failedTests: ["thirty-one-hours-retained"], tests: [{ id: "thirty-one-hours-retained", args: [{ ageHours: 31 }], expected: true }, { id: "thirty-days-expired", args: [{ ageHours: 720 }], expected: false }] },
  { id: "tenant-null-identity", requirement: "lookupInvoice must return null unless authenticatedAccountId is a nonempty string. With valid authentication it returns only the requested invoice owned by that account. An invoice with no accountId does not grant anonymous access.", exportName: "lookupInvoice",
    broken: "export function lookupInvoice(input) { return input.invoices.find(row => row.id === input.invoiceId && row.accountId === input.authenticatedAccountId) ?? null; }",
    clean: "export function lookupInvoice(input) { if (typeof input.authenticatedAccountId !== 'string' || !input.authenticatedAccountId) return null; return input.invoices.find(row => row.id === input.invoiceId && row.accountId === input.authenticatedAccountId) ?? null; }",
    failedTests: ["missing-auth-denied"], tests: [{ id: "missing-auth-denied", args: [{ invoiceId: "x", invoices: [{ id: "x" }] }], expected: null }, { id: "own-invoice-allowed", args: [{ authenticatedAccountId: "a", invoiceId: "x", invoices: [{ id: "x", accountId: "a" }] }], expected: { id: "x", accountId: "a" } }] },
  { id: "tenant-auth-source", requirement: "lookupInvoice must use the server supplied authenticatedAccountId to enforce invoice ownership. requestedAccountId is customer-controlled and must not authorize access. Return null for another account's invoice.", exportName: "lookupInvoice",
    broken: "export function lookupInvoice(input) { return input.invoices.find(row => row.id === input.invoiceId && row.accountId === input.requestedAccountId) ?? null; }",
    clean: "export function lookupInvoice(input) { return input.invoices.find(row => row.id === input.invoiceId && row.accountId === input.authenticatedAccountId) ?? null; }",
    failedTests: ["requested-account-not-authority"], tests: [{ id: "requested-account-not-authority", args: [{ authenticatedAccountId: "a", requestedAccountId: "b", invoiceId: "x", invoices: [{ id: "x", accountId: "b" }] }], expected: null }, { id: "own-invoice-allowed", args: [{ authenticatedAccountId: "a", requestedAccountId: "a", invoiceId: "x", invoices: [{ id: "x", accountId: "a" }] }], expected: { id: "x", accountId: "a" } }] },
  { id: "credit-zero-balance", requirement: "canReserve returns true if and only if the remaining audit-credit balance is at least one. A zero balance cannot reserve an audit.", exportName: "canReserve",
    broken: "export function canReserve(input) { return input.remaining >= 0; }", clean: "export function canReserve(input) { return input.remaining >= 1; }",
    failedTests: ["zero-denied"], tests: [{ id: "zero-denied", args: [{ remaining: 0 }], expected: false }, { id: "one-allowed", args: [{ remaining: 1 }], expected: true }] },
  { id: "credit-exact-balance", requirement: "canReserve allows a positive requestedUnits count when remaining is greater than or equal to requestedUnits. Spending the exact remaining balance is allowed. Zero requested units are denied.", exportName: "canReserve",
    broken: "export function canReserve(input) { return input.requestedUnits > 0 && input.remaining > input.requestedUnits; }",
    clean: "export function canReserve(input) { return input.requestedUnits > 0 && input.remaining >= input.requestedUnits; }",
    failedTests: ["exact-balance-allowed"], tests: [{ id: "exact-balance-allowed", args: [{ remaining: 1, requestedUnits: 1 }], expected: true }, { id: "zero-request-denied", args: [{ remaining: 1, requestedUnits: 0 }], expected: false }] },
  { id: "credit-negative-request", requirement: "reserveCredits returns the remaining balance after subtracting requestedUnits only if requestedUnits is a positive integer not exceeding the balance. Invalid requests return null and cannot increase the balance.", exportName: "reserveCredits",
    broken: "export function reserveCredits(input) { return input.requestedUnits <= input.remaining ? input.remaining - input.requestedUnits : null; }",
    clean: "export function reserveCredits(input) { return Number.isInteger(input.requestedUnits) && input.requestedUnits > 0 && input.requestedUnits <= input.remaining ? input.remaining - input.requestedUnits : null; }",
    failedTests: ["negative-denied", "fraction-denied"], tests: [{ id: "negative-denied", args: [{ remaining: 5, requestedUnits: -2 }], expected: null }, { id: "fraction-denied", args: [{ remaining: 5, requestedUnits: 0.5 }], expected: null }, { id: "positive-reserved", args: [{ remaining: 5, requestedUnits: 2 }], expected: 3 }] },
  { id: "credit-release-idempotency", requirement: "releaseCredit changes a reserved reservation to released and returns one credit. Calling it on an already released reservation leaves state and balance unchanged.", exportName: "releaseCredit",
    broken: "export function releaseCredit(input) { return { ...input, state: 'released', remaining: input.remaining + 1 }; }",
    clean: "export function releaseCredit(input) { return input.state === 'reserved' ? { ...input, state: 'released', remaining: input.remaining + 1 } : input; }",
    failedTests: ["released-not-refunded-twice"], tests: [{ id: "released-not-refunded-twice", args: [{ state: "released", remaining: 5 }], expected: { state: "released", remaining: 5 } }, { id: "reserved-refunded", args: [{ state: "reserved", remaining: 4 }], expected: { state: "released", remaining: 5 } }] },
  { id: "payment-amount-floor", requirement: "checkoutCredit grants one credit only when the Checkout is complete, its payment status is paid, and amountReceived is at least amountDue. A positive but insufficient amount grants zero credits.", exportName: "checkoutCredit",
    broken: "export function checkoutCredit(input) { return input.status === 'complete' && input.paymentStatus === 'paid' && input.amountReceived > 0 ? 1 : 0; }",
    clean: "export function checkoutCredit(input) { return input.status === 'complete' && input.paymentStatus === 'paid' && input.amountReceived >= input.amountDue ? 1 : 0; }",
    failedTests: ["partial-amount-denied"], tests: [{ id: "partial-amount-denied", args: [{ status: "complete", paymentStatus: "paid", amountReceived: 1, amountDue: 100 }], expected: 0 }, { id: "full-amount-granted", args: [{ status: "complete", paymentStatus: "paid", amountReceived: 100, amountDue: 100 }], expected: 1 }] },
  { id: "payment-wrong-currency", requirement: "checkoutCredit grants one credit for a complete paid Checkout only when its settlement currency is USD. Other currencies grant zero credits; this unit does not perform currency conversion.", exportName: "checkoutCredit",
    broken: "export function checkoutCredit(input) { return input.status === 'complete' && input.paymentStatus === 'paid' ? 1 : 0; }",
    clean: "export function checkoutCredit(input) { return input.status === 'complete' && input.paymentStatus === 'paid' && input.currency === 'USD' ? 1 : 0; }",
    failedTests: ["foreign-currency-denied"], tests: [{ id: "foreign-currency-denied", args: [{ status: "complete", paymentStatus: "paid", currency: "EUR" }], expected: 0 }, { id: "usd-granted", args: [{ status: "complete", paymentStatus: "paid", currency: "USD" }], expected: 1 }] },
  { id: "idempotency-delivery-id", requirement: "applyPayment must deduplicate by eventId, which is stable across redelivery. deliveryId changes with each attempt and cannot serve as the idempotency key. A new event increments credits once and records its eventId.", exportName: "applyPayment",
    broken: "export function applyPayment(input) { if (input.seenEventIds.includes(input.deliveryId)) return input; return { ...input, credits: input.credits + 1, seenEventIds: [...input.seenEventIds, input.deliveryId] }; }",
    clean: "export function applyPayment(input) { if (input.seenEventIds.includes(input.eventId)) return input; return { ...input, credits: input.credits + 1, seenEventIds: [...input.seenEventIds, input.eventId] }; }",
    failedTests: ["redelivery-not-granted", "new-event-records-stable-id"], tests: [{ id: "redelivery-not-granted", args: [{ credits: 1, seenEventIds: ["e1"], eventId: "e1", deliveryId: "d2" }], expected: { credits: 1, seenEventIds: ["e1"], eventId: "e1", deliveryId: "d2" } }, { id: "new-event-records-stable-id", args: [{ credits: 1, seenEventIds: [], eventId: "e2", deliveryId: "d3" }], expected: { credits: 2, seenEventIds: ["e2"], eventId: "e2", deliveryId: "d3" } }] },
  { id: "subscription-trial-access", requirement: "canAudit allows active or trialing subscriptions strictly before periodEnd. Other statuses, including paused, are denied.", exportName: "canAudit",
    broken: "export function canAudit(input) { return input.status === 'active' && input.now < input.periodEnd; }",
    clean: "export function canAudit(input) { return ['active', 'trialing'].includes(input.status) && input.now < input.periodEnd; }",
    failedTests: ["trial-allowed"], tests: [{ id: "trial-allowed", args: [{ status: "trialing", now: 1, periodEnd: 2 }], expected: true }, { id: "paused-denied", args: [{ status: "paused", now: 1, periodEnd: 2 }], expected: false }] },
  { id: "role-deny-overrides", requirement: "canManageBilling allows only an owner or admin who is not suspended. Suspension denies access even to owners and admins. Unsuspended members cannot manage billing.", exportName: "canManageBilling",
    broken: "export function canManageBilling(input) { return ['owner', 'admin'].includes(input.role) || !input.suspended; }",
    clean: "export function canManageBilling(input) { return ['owner', 'admin'].includes(input.role) && !input.suspended; }",
    failedTests: ["suspended-owner-denied", "member-denied"], tests: [{ id: "suspended-owner-denied", args: [{ role: "owner", suspended: true }], expected: false }, { id: "member-denied", args: [{ role: "member", suspended: false }], expected: false }, { id: "owner-allowed", args: [{ role: "owner", suspended: false }], expected: true }] },
  { id: "refund-terminal-state", requirement: "canUseCredit returns true only while the payment status is paid and creditActive is true. Refunded or failed payments cannot authorize credit use even when creditActive is still true.", exportName: "canUseCredit",
    broken: "export function canUseCredit(input) { return input.status !== 'failed' && input.creditActive; }",
    clean: "export function canUseCredit(input) { return input.status === 'paid' && input.creditActive; }",
    failedTests: ["refunded-denied"], tests: [{ id: "refunded-denied", args: [{ status: "refunded", creditActive: true }], expected: false }, { id: "paid-allowed", args: [{ status: "paid", creditActive: true }], expected: true }] },
  { id: "session-clock-units", requirement: "canUseSession compares nowMilliseconds against expiresAtSeconds converted to milliseconds. It returns true strictly before expiry and false at or after expiry.", exportName: "canUseSession",
    broken: "export function canUseSession(input) { return input.nowMilliseconds < input.expiresAtSeconds; }",
    clean: "export function canUseSession(input) { return input.nowMilliseconds < input.expiresAtSeconds * 1000; }",
    failedTests: ["before-expiry-allowed"], tests: [{ id: "before-expiry-allowed", args: [{ nowMilliseconds: 99999, expiresAtSeconds: 100 }], expected: true }, { id: "expiry-denied", args: [{ nowMilliseconds: 100000, expiresAtSeconds: 100 }], expected: false }] },
  { id: "pagination-before-filter", requirement: "listInvoices must filter to the authenticated account before applying the requested limit. Other accounts' rows must not consume that account's page slots.", exportName: "listInvoices",
    broken: "export function listInvoices(input) { return input.rows.slice(0, input.limit).filter(row => row.accountId === input.authenticatedAccountId); }",
    clean: "export function listInvoices(input) { return input.rows.filter(row => row.accountId === input.authenticatedAccountId).slice(0, input.limit); }",
    failedTests: ["foreign-row-not-a-page-slot"], tests: [{ id: "foreign-row-not-a-page-slot", args: [{ authenticatedAccountId: "a", limit: 1, rows: [{ id: "foreign", accountId: "b" }, { id: "own", accountId: "a" }] }], expected: [{ id: "own", accountId: "a" }] }, { id: "empty-page", args: [{ authenticatedAccountId: "a", limit: 1, rows: [] }], expected: [] }] },
  { id: "deleted-invoice-visible", requirement: "lookupInvoice returns a matching owned invoice only when deletedAt is null, which denotes a live invoice. Soft-deleted invoices must not be returned.", exportName: "lookupInvoice",
    broken: "export function lookupInvoice(input) { return input.rows.find(row => row.id === input.invoiceId && row.accountId === input.authenticatedAccountId) ?? null; }",
    clean: "export function lookupInvoice(input) { return input.rows.find(row => row.id === input.invoiceId && row.accountId === input.authenticatedAccountId && row.deletedAt === null) ?? null; }",
    failedTests: ["deleted-denied"], tests: [{ id: "deleted-denied", args: [{ invoiceId: "x", authenticatedAccountId: "a", rows: [{ id: "x", accountId: "a", deletedAt: 5 }] }], expected: null }, { id: "live-allowed", args: [{ invoiceId: "x", authenticatedAccountId: "a", rows: [{ id: "x", accountId: "a", deletedAt: null }] }], expected: { id: "x", accountId: "a", deletedAt: null } }] },
];

const directory = "experiments/relations";
const cases = JSON.parse(readFileSync(directory + "/inputs.json", "utf8")).cases as RelationCase[];
const expected = JSON.parse(readFileSync(directory + "/expect.json", "utf8")).cases as RelationExpectation[];
function add(id: string, requirement: string, target: string, choices: RelationExpectation["choices"], resolution: RelationExpectation["resolution"], options: { documentation?: boolean; proposal?: boolean; targetApproved?: boolean; statement?: string; context?: string } = {}) {
  const sourceSha = "a".repeat(40);
  const input: RelationInput = { schema: "jev-lint-relations-input-1", repository: "evaluation/service", sourceSha, runId: "sample",
    sources: [
      { id: "specification", path: options.proposal ? "docs/discussion.md" : "docs/contract.md", ref: options.proposal ? sourceSha : "b".repeat(40), kind: "documentation",
        authority: options.proposal ? "proposal" : "approved", content: requirement, contentHash: relationDigest(requirement), scope: ["src", "docs"],
        approval: options.proposal ? null : { id: "approval-001", revision: 1, digest: "c".repeat(64) } },
      { id: "target", path: options.documentation ? "docs/guide.md" : "src/service.ts", ref: options.targetApproved ? "d".repeat(40) : sourceSha,
        kind: options.documentation ? "documentation" : "code", authority: options.targetApproved ? "approved" : options.documentation ? "reference" : "observed",
        content: target, contentHash: relationDigest(target), scope: options.targetApproved ? ["src", "docs"] : [],
        approval: options.targetApproved ? { id: "approval-002", revision: 1, digest: "e".repeat(64) } : null },
    ],
    claims: [{ id: "requirement", statement: options.statement ?? requirement, evidence: [{ sourceId: "specification", startLine: 1, endLine: requirement.split("\n").length, quote: requirement }] }],
    expectedClaimIds: ["requirement"], relations: [{ id: "comparison", subject: "relation", claimId: "requirement",
      targets: [{ sourceId: "target", startLine: 1, endLine: target.split("\n").length, quote: target }], context: [] }] };
  if (options.context) {
    input.sources.push({ id: "context", path: "src/context.ts", ref: sourceSha, kind: "code", authority: "observed", content: options.context, contentHash: relationDigest(options.context), scope: [], approval: null });
    input.relations[0].context.push({ sourceId: "context", startLine: 1, endLine: options.context.split("\n").length, quote: options.context });
  }
  cases.push({ id, input });
  expected.push({ id, choices, resolution, statuses: options.proposal ? ["complete", "partial"] : resolution === "needs_context" ? ["partial"] : ["complete"] });
}
for (const pair of pairs) {
  add(pair.id + "-drift", pair.requirement, pair.broken, ["contradicts"], "implementation");
  add(pair.id + "-control", pair.requirement, pair.clean, ["supports"], "none");
}
const docPairs = [
  ["guide-role-exclusion", "Only owners and admins can manage billing. Members and viewers cannot manage billing.", "Members can manage billing too.", "Members and viewers are denied; owners and admins can manage billing."],
  ["guide-unpaid-credit", "A Checkout grants credit only when it is complete AND paid. Complete but unpaid Checkouts grant zero credits.", "A complete but unpaid Checkout still grants one credit.", "Only a Checkout that is both complete and paid grants credit."],
  ["guide-retention-units", "Raw payloads are retained until they reach exactly 30 days of age and are deleted at that point.", "Raw payload retention lasts 30 hours.", "Raw payload retention lasts 30 days, then they are deleted."],
];
for (const [id, requirement, broken, clean] of docPairs) {
  add(id + "-drift", requirement, broken, ["contradicts"], "documentation", { documentation: true });
  add(id + "-control", requirement, clean, ["supports"], "none", { documentation: true });
}
for (const [id, pairId, statement] of [
  ["summary-expiry-includes-boundary", "period-end-inclusive", "Access is allowed at the exact periodEnd boundary."],
  ["summary-partial-payment-authorizes", "payment-amount-floor", "Any positive received amount authorizes a credit for a complete paid Checkout."],
  ["summary-suspension-exception", "role-deny-overrides", "Owners can manage billing even when suspended."],
]) {
  const pair = pairs.find((item) => item.id === pairId)!;
  add(id, pair.requirement, pair.clean, ["supports", "contradicts", "insufficient_context"], "needs_context", { statement });
}
add("missing-expiry-conversion", "canUseSession compares nowMilliseconds with expiresAtSeconds converted into milliseconds and allows access strictly before expiry.",
  "export function canUseSession(input) { return input.nowMilliseconds < normalizeExpiry(input.expiresAtSeconds); }", ["insufficient_context"], "needs_context");
add("unapproved-immediate-deletion", "A proposal says failed audits should delete all raw payloads immediately. Retaining them for 30 days is another proposal. Neither has been approved.",
  "export function retainRawPayload(input) { return input.ageDays < 30; }", ["contradicts", "insufficient_context"], "needs_decision",
  { proposal: true, statement: "Failed audits must delete all raw payloads immediately." });
add("conflicting-paid-approval", "A complete but unpaid Checkout must grant zero credits.", "A complete but unpaid Checkout must grant one credit.",
  ["contradicts"], "needs_decision", { documentation: true, targetApproved: true });

mkdirSync(directory + "/extended", { recursive: true });
writeFileSync(directory + "/extended/inputs.json", JSON.stringify({ schema: "jev-lint-relation-corpus-1", revision: "extended-1", cases }, null, 2) + "\n");
writeFileSync(directory + "/extended/expect.json", JSON.stringify({ schema: "jev-lint-relation-expect-1", revision: "extended-1", cases: expected }, null, 2) + "\n");
const dependencyCases: RelationCase[] = [], dependencyExpected: RelationExpectation[] = [];
for (const [id, definition, choice, resolution] of [
  ["missing-expiry-helper", null, "insufficient_context", "needs_context"],
  ["provided-expiry-helper", "export function normalizeExpiry(seconds) { return seconds * 1000; }", "supports", "none"],
  ["misleading-expiry-helper", "export function normalizeExpiry(seconds) { return seconds; }", "contradicts", "implementation"],
] as const) {
  const sample = structuredClone(cases.find((item) => item.id === "missing-expiry-conversion")!); sample.id = id;
  if (definition) {
    sample.input.sources.push({ id: "helper", path: "src/helpers.ts", ref: sample.input.sourceSha, kind: "code", authority: "observed", content: definition, contentHash: relationDigest(definition), scope: [], approval: null });
    sample.input.relations[0].context.push({ sourceId: "helper", startLine: 1, endLine: 1, quote: definition });
  }
  dependencyCases.push(sample); dependencyExpected.push({ id, choices: [choice], resolution, statuses: choice === "insufficient_context" ? ["partial"] : ["complete"] });
}
mkdirSync(directory + "/extended/dependencies", { recursive: true });
writeFileSync(directory + "/extended/dependencies/inputs.json", JSON.stringify({ schema: "jev-lint-relation-corpus-1", cases: dependencyCases }, null, 2) + "\n");
writeFileSync(directory + "/extended/dependencies/expect.json", JSON.stringify({ schema: "jev-lint-relation-expect-1", cases: dependencyExpected }, null, 2) + "\n");
const controls = JSON.parse(readFileSync(directory + "/negative-controls.json", "utf8"));
const newIds = new Set(pairs.map((pair) => pair.id));
controls.contracts = controls.contracts.filter((control: { id: string }) => !newIds.has(control.id));
controls.contracts.push(...pairs.map(({ id, exportName, failedTests, tests }) => ({ id, broken: id + "-drift", control: id + "-control", exportName, failedTests, tests })));
controls.contractCorpus = "extended/inputs.json";
writeFileSync(directory + "/negative-controls.json", JSON.stringify(controls, null, 2) + "\n");
process.stdout.write(cases.length + " model cases; " + controls.contracts.length + " executable contract pairs.\n");
