import type { Language, Strictness } from "./common.js";

export interface DeslopifyConfig {
  strictness: Strictness;
  transport: "stdio" | "sse";
  port: number;
  languages: Language[] | "all";
  anthropicApiKey?: string;
  customRulesDir?: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export const DEFAULT_CONFIG: DeslopifyConfig = {
  strictness: "medium",
  transport: "stdio",
  port: 3000,
  languages: "all",
  logLevel: "info",
};

export function loadConfig(): DeslopifyConfig {
  return {
    strictness: (process.env.DESLOPIFY_STRICTNESS as Strictness) ?? DEFAULT_CONFIG.strictness,
    transport: (process.env.DESLOPIFY_TRANSPORT as "stdio" | "sse") ?? DEFAULT_CONFIG.transport,
    port: parseInt(process.env.DESLOPIFY_PORT ?? String(DEFAULT_CONFIG.port), 10),
    languages: process.env.DESLOPIFY_LANGUAGES
      ? (process.env.DESLOPIFY_LANGUAGES.split(",").map((l) => l.trim()) as Language[])
      : DEFAULT_CONFIG.languages,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    logLevel: (process.env.DESLOPIFY_LOG_LEVEL as DeslopifyConfig["logLevel"]) ?? DEFAULT_CONFIG.logLevel,
  };
}
