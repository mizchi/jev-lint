import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export function formatDate(date: Date, locale: string): string {
  date.setHours(0, 0, 0, 0);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export interface Cart {
  id: string;
  lines: Array<{ price: number; qty: number }>;
  lastTotal?: number;
}

const metrics = { increment: (name: string) => void name };

export function computeTotal(cart: Cart): number {
  let total = 0;
  for (const line of cart.lines) total += line.price * line.qty;
  cart.lastTotal = total;
  metrics.increment("cart.total.computed");
  return total;
}

export interface Config {
  port: number;
  hosts: string[];
}

export function parseConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  return { port: raw.port ?? 3000, hosts: raw.hosts ?? [] };
}

export interface Account {
  id: string;
  keyVersion: number;
  secret: string;
}

export function deriveSessionKey(account: Account): string {
  account.keyVersion += 1;
  return createHash("sha256").update(`${account.secret}:${account.keyVersion}`).digest("hex");
}

const seenSlugs = new Set<string>();

export function toSlug(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let slug = base;
  for (let i = 2; seenSlugs.has(slug); i++) slug = `${base}-${i}`;
  seenSlugs.add(slug);
  return slug;
}

export class Money {
  constructor(
    public readonly amount: number,
    public readonly currency: string,
  ) {}

  toJSON(): { amount: number; currency: string } {
    return { amount: this.amount, currency: this.currency };
  }

  toString(): string {
    return `${this.amount.toFixed(2)} ${this.currency}`;
  }
}

export function computeChecksum(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string, locale: string): string {
  const key = `${locale}:${currency}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { style: "currency", currency });
    formatters.set(key, fmt);
  }
  return fmt.format(amount);
}

export function parseArgs(argv: readonly string[]): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=", 2);
      flags[key] = value ?? true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

export function toSorted<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  const copy = [...items];
  copy.sort(compare);
  return copy;
}

export interface Theme {
  primary: string;
  background: string;
  fontSize: number;
}

export function deriveTheme(overrides: Partial<Theme>, defaults: Theme): Theme {
  const theme = { ...defaults };
  for (const key of Object.keys(overrides) as Array<keyof Theme>) {
    const value = overrides[key];
    if (value !== undefined) (theme as Record<string, unknown>)[key] = value;
  }
  return theme;
}

export async function calculateShippingCost(order: { weightKg: number; destination: string }): Promise<number> {
  const res = await fetch(`https://rates.example.com/quote?to=${order.destination}&kg=${order.weightKg}`);
  const quote = (await res.json()) as { cents: number };
  return quote.cents / 100;
}

export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
  fields?: Record<string, unknown>;
}

export function formatLogLine(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toISOString();
  const fields = entry.fields ? " " + JSON.stringify(entry.fields) : "";
  return `${time} [${entry.level.toUpperCase()}] ${entry.message}${fields}`;
}

export interface DbSettings {
  host: string;
  port: number;
  ssl: boolean;
}

export function parseDbEnv(env: Readonly<Record<string, string | undefined>>): DbSettings {
  const port = Number(env.DB_PORT ?? "5432");
  if (!Number.isInteger(port)) throw new Error(`DB_PORT is not an integer: ${env.DB_PORT}`);
  return {
    host: env.DB_HOST ?? "localhost",
    port,
    ssl: env.DB_SSL === "true" || env.DB_SSL === "1",
  };
}

// ---------------------------------------------------------------------------
// Dependencies obtained lazily: a memoised module loader, a require-once
// native binding, a constant table built on first use, a shared backend
// resolved from a registry. Obtaining the dependency is not the function's
// effect; what it does with its inputs is.
// ---------------------------------------------------------------------------

type IcuCoreModule = typeof import("../../_build/js/release/build/icu/icu.js");
let icuCoreModule: IcuCoreModule | null = null;
async function getIcuCoreModule(): Promise<IcuCoreModule> {
  if (icuCoreModule === null) {
    icuCoreModule = await import("../../_build/js/release/build/icu/icu.js");
  }
  return icuCoreModule;
}

export interface MessageAst {
  ok: boolean;
  parts: Array<{ kind: "text" | "arg" | "plural"; value: string }>;
  error?: string;
}

export async function parseIcuMessage(pattern: string, locale: string): Promise<MessageAst> {
  const mod = await getIcuCoreModule();
  const raw = mod.icu_parse_message(pattern, locale);
  try {
    return JSON.parse(raw) as MessageAst;
  } catch {
    return { ok: false, parts: [], error: "icu parser returned invalid response" };
  }
}

export async function formatPluralLabel(count: number, locale: string, forms: Record<string, string>): Promise<string> {
  if (!Number.isFinite(count)) return forms.other ?? "";
  const mod = await getIcuCoreModule();
  const category = mod.icu_plural_category(count, locale);
  return (forms[category] ?? forms.other ?? "").replace("{n}", String(count));
}

interface NativeHasher {
  xxh64(input: Uint8Array, seed: number): bigint;
}

let nativeHasher: NativeHasher | undefined;
function loadNativeHasher(): NativeHasher {
  if (nativeHasher === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeHasher = require("../../native/build/Release/hasher.node") as NativeHasher;
  }
  return nativeHasher;
}

export function computeContentHash(bytes: Uint8Array, seed = 0): string {
  const hasher = loadNativeHasher();
  return hasher.xxh64(bytes, seed).toString(16).padStart(16, "0");
}

const COUNTRY_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ["JP", "JPN", "Japan"],
  ["US", "USA", "United States"],
  ["DE", "DEU", "Germany"],
  ["FR", "FRA", "France"],
];

let countryTable: Map<string, { alpha3: string; name: string }> | null = null;
function getCountryTable(): Map<string, { alpha3: string; name: string }> {
  if (countryTable === null) {
    countryTable = new Map(COUNTRY_ROWS.map(([alpha2, alpha3, name]) => [alpha2, { alpha3, name }]));
  }
  return countryTable;
}

export function toCountryName(code: string): string | null {
  const entry = getCountryTable().get(code.trim().toUpperCase());
  return entry ? entry.name : null;
}

interface SignerBackend {
  publicKeyFromSeed(seed: Uint8Array): Uint8Array;
}

const backends = new Map<string, SignerBackend>();
export function resolveSignerBackend(algorithm: string): SignerBackend {
  const found = backends.get(algorithm);
  if (!found) throw new Error(`no signer backend registered for ${algorithm}`);
  return found;
}

export function derivePublicKey(seed: Uint8Array, algorithm = "ed25519"): string {
  const backend = resolveSignerBackend(algorithm);
  const raw = backend.publicKeyFromSeed(seed);
  return Buffer.from(raw).toString("base64url");
}

function readEnvString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readEnvInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

export interface WorkerLimits {
  maxJobs: number;
  queue: string;
  timeoutSec: number;
}

export function parseWorkerLimits(raw: Record<string, unknown>): WorkerLimits {
  return {
    maxJobs: readEnvInt(raw.max_jobs, 4, 1, 64),
    queue: readEnvString(raw.queue, "default"),
    timeoutSec: readEnvInt(raw.timeout_sec, 30, 1, 3600),
  };
}

interface HttpClient {
  get(url: string): Promise<{ status: number; text(): Promise<string> }>;
}

let httpClient: HttpClient | null = null;
async function getHttpClient(): Promise<HttpClient> {
  if (httpClient === null) {
    const { createClient } = await import("./http-client.js");
    httpClient = createClient({ timeoutMs: 5000 });
  }
  return httpClient;
}

export interface Manifest {
  name: string;
  version: string;
  files: string[];
}

export async function parseRemoteManifest(url: string): Promise<Manifest | null> {
  const client = await getHttpClient();
  const res = await client.get(url);
  if (res.status !== 200) return null;
  const body = JSON.parse(await res.text()) as Partial<Manifest>;
  return { name: body.name ?? "", version: body.version ?? "0.0.0", files: body.files ?? [] };
}

type RouterCoreModule = typeof import("../../_build/js/release/build/router/router.js");
let routerCoreModule: RouterCoreModule | null = null;
async function getRouterModule(): Promise<RouterCoreModule> {
  if (routerCoreModule === null) {
    routerCoreModule = await import("../../_build/js/release/build/router/router.js");
  }
  return routerCoreModule;
}

export interface Graph {
  edges: Array<{ from: string; to: string; weight: number }>;
}

const routeCache = new Map<string, string[]>();

export async function computeRoute(graph: Graph, from: string, to: string): Promise<string[]> {
  const key = `${from}->${to}`;
  const cached = routeCache.get(key);
  if (cached) return cached;
  const mod = await getRouterModule();
  const route = JSON.parse(mod.router_shortest_path(JSON.stringify(graph.edges), from, to)) as string[];
  routeCache.set(key, route);
  return route;
}

// ---------------------------------------------------------------------------
// An effect on a fallback path only: the clock, the environment or a random
// source consulted when a field is missing. The common path is pure; the
// function is not.
// ---------------------------------------------------------------------------

export interface Checkpoint {
  jobId: string;
  attempt: number;
  startedAt: string;
  updatedAt: string;
}

export function parseCheckpoint(raw: unknown): Checkpoint | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.job_id !== "string") return null;
  const attempt = Number(rec.attempt);
  if (!Number.isFinite(attempt)) return null;
  return {
    jobId: rec.job_id,
    attempt: Math.max(1, Math.trunc(attempt)),
    startedAt: typeof rec.started_at === "string" ? rec.started_at : new Date().toISOString(),
    updatedAt: typeof rec.updated_at === "string" ? rec.updated_at : new Date().toISOString(),
  };
}

export function toCheckpoint(raw: Record<string, unknown>, now: string): Checkpoint | null {
  if (typeof raw.job_id !== "string") return null;
  const attempt = Number(raw.attempt);
  if (!Number.isFinite(attempt)) return null;
  return {
    jobId: raw.job_id,
    attempt: Math.max(1, Math.trunc(attempt)),
    startedAt: typeof raw.started_at === "string" ? raw.started_at : now,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : now,
  };
}

export interface CliOptions {
  baseUrl: string;
  token: string;
  room: string;
  json: boolean;
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  let baseUrl = "";
  let token = process.env.CLUSTER_API_TOKEN ?? "";
  let room = "main";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-url") baseUrl = argv[++i] ?? "";
    else if (arg === "--token") token = argv[++i] ?? token;
    else if (arg === "--room") room = argv[++i] ?? room;
    else if (arg === "--json") json = true;
  }
  return { baseUrl, token, room, json };
}

export interface ReviewRecord {
  id: string;
  objectiveId: string;
  status: "open" | "merged";
}

export function toReviewRecord(contract: Record<string, unknown>, current: ReviewRecord | null): ReviewRecord {
  const objectiveId = typeof contract.objective_id === "string" ? contract.objective_id : "";
  return {
    id: current?.id ?? `rev_${crypto.randomUUID()}`,
    objectiveId: objectiveId.length > 0 ? objectiveId : current?.objectiveId ?? "",
    status: current?.status ?? "open",
  };
}
