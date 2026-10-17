import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export function loadProjectEnv(): void {
  try {
    // Resolve beside the project, even when an MCP host starts us in another cwd.
    // Existing process environment variables take precedence.
    loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

/** A startup configuration failure. Messages are static and never echo environment values. */
export class ConfigError extends Error {}

/**
 * Generic decision-API configuration. Only API_KEY, BASE_URL, MODEL and
 * JEV_TIMEOUT_MS are read; there is no provider table, allowlist or legacy
 * variable fallback. BASE_URL and MODEL are explicit startup configuration and
 * never default to SDK or vendor values.
 */
export interface Config {
  /** Trimmed credential from API_KEY, or undefined for discovery without a key. */
  readonly apiKey: string | undefined;
  /** Normalized absolute http(s) API root, trailing slashes removed. */
  readonly baseURL: string;
  /** Trimmed model name from MODEL; a per-call override may replace it per request. */
  readonly model: string;
  /** Total deadline in milliseconds, including automatic retries. */
  readonly timeoutMs: number;
}

/**
 * Validate BASE_URL as an absolute http(s) URL of any host and path prefix
 * (remote or localhost for self-hosting). Credentials, query and fragment are
 * rejected so secrets cannot leak and path composition cannot break. Returns
 * the trimmed URL with trailing slashes removed, keeping any path prefix.
 */
function readBaseURL(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") throw new ConfigError("BASE_URL must be set to an absolute http(s) URL");
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ConfigError("BASE_URL must be an absolute http(s) URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("BASE_URL must be an absolute http(s) URL");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || /[?#]/.test(value)) {
    throw new ConfigError("BASE_URL must not include credentials, a query or a fragment");
  }
  return value.replace(/\/+$/, "");
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const timeoutMs = Number(env.JEV_TIMEOUT_MS ?? 30000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new ConfigError("JEV_TIMEOUT_MS must be an integer from 1 to 120000");
  }
  // The credential is optional: discovery works without it and calls fail with
  // MISSING_API_KEY. Whitespace-only values count as unset. No legacy
  // provider-specific variable is ever read as a fallback.
  const apiKey = env.API_KEY?.trim() || undefined;
  const baseURL = readBaseURL(env.BASE_URL);
  const model = (env.MODEL ?? "").trim();
  if (model === "") throw new ConfigError("MODEL must be set to a nonblank model name");
  return { apiKey, baseURL, model, timeoutMs };
}
