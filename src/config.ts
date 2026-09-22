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

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const timeoutMs = Number(env.JEV_TIMEOUT_MS ?? 30000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error("JEV_TIMEOUT_MS must be an integer from 1 to 120000");
  }
  return {
    apiKey: env.TYPESAFE_API_KEY?.trim() || undefined,
    model: env.TYPESAFE_DEFAULT_MODEL?.trim() || "jev-latest",
    timeoutMs,
  };
}
export type Config = ReturnType<typeof readConfig>;
