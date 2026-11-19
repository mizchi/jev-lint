import { createHash } from "node:crypto";
import { extname } from "node:path";
import { Jev, API_KEY_VARS, API_KEY_SETUP, DEFAULT_MODEL, USD_PER_MTOK, fromEnv, type JevOptions, type AskClient } from "./jev.ts";
import { OpenRouter, OPENROUTER_MODELS, OPENROUTER_JEV, OPENROUTER_ENDPOINT, OPENROUTER_KEY_SETUP, type OpenRouterModel } from "./openrouter.ts";

export interface ModelSpec { provider: "jev" | "openrouter"; model: string; implicitOpenRouter: boolean; inputUsdPerMillion: number; keyAvailable: boolean; setup: string }
export function modelSpec(requested: string | null = null, baseUrl: string | null = null): ModelSpec {
  const model = requested ?? process.env.JEV_LINT_MODEL ?? DEFAULT_MODEL;
  const routerKey = fromEnv(["OPENROUTER_API_KEY"]);
  const id = model.startsWith("openrouter:") ? model.slice("openrouter:".length)
    : model === DEFAULT_MODEL && routerKey ? OPENROUTER_JEV : null;
  if (id === null) return { provider: "jev", model, implicitOpenRouter: false, inputUsdPerMillion: USD_PER_MTOK, keyAvailable: !!fromEnv(API_KEY_VARS), setup: API_KEY_SETUP };
  if (!Object.hasOwn(OPENROUTER_MODELS, id)) throw new Error(`unknown OpenRouter decisions model: ${id}`);
  if (baseUrl && baseUrl.replace(/\/+$/, "") !== OPENROUTER_ENDPOINT) throw new Error("--base-url cannot override the OpenRouter endpoint");
  return { provider: "openrouter", model: id, implicitOpenRouter: !model.startsWith("openrouter:"), inputUsdPerMillion: OPENROUTER_MODELS[id as OpenRouterModel].inputUsdPerMillion,
    keyAvailable: !!routerKey, setup: OPENROUTER_KEY_SETUP };
}
export function createModelClient(options: JevOptions = {}): AskClient {
  const requested = options.model ?? process.env.JEV_LINT_MODEL ?? DEFAULT_MODEL;
  // An explicit direct-client credential must never follow an ambient OpenRouter key.
  if (options.apiKey != null && !options.model?.startsWith("openrouter:")) {
    return new Jev({ ...options, model: requested.startsWith("openrouter:") ? DEFAULT_MODEL : requested });
  }
  const spec = modelSpec(requested, options.baseUrl);
  if (spec.provider === "jev") return new Jev({ ...options, model: spec.model });
  const { model: _model, baseUrl, ...rest } = options;
  return new OpenRouter({ ...rest, model: spec.model as OpenRouterModel });
}
/** Keep all existing Jev cache locations; native backends use a separate model-scoped file. */
export function modelCachePath(path: string | null, model: string | null = null): string | null {
  const spec = modelSpec(model);
  if (!path || spec.provider === "jev") return path;
  const suffix = createHash("sha256").update(`native-v1\0${OPENROUTER_ENDPOINT}\0${spec.model}`).digest("hex").slice(0, 12);
  const extension = extname(path);
  return `${extension ? path.slice(0, -extension.length) : path}.openrouter-${suffix}${extension}`;
}
