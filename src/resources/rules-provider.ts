import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Language } from "../types/common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RULES_DIR = join(__dirname, "..", "..", "rules");

const LANGUAGES: Language[] = ["cpp", "csharp", "python", "java", "typescript"];

export function registerResources(server: McpServer): void {
  // Register per-language rule databases
  for (const lang of LANGUAGES) {
    const langDir = join(RULES_DIR, lang);
    if (!existsSync(langDir)) continue;

    server.registerResource(
      `rules-${lang}`,
      `deslopify://rules/${lang}`,
      {
        title: `${lang} Rules`,
        description: `Complete idiom rules, anti-patterns, and best practices for ${lang}`,
        mimeType: "application/json",
      },
      async (uri) => {
        const allRules: Record<string, unknown> = { language: lang, version: "1.0.0" };
        for (const file of readdirSync(langDir).filter((f) => f.endsWith(".json"))) {
          const key = file.replace(".json", "");
          allRules[key] = JSON.parse(readFileSync(join(langDir, file), "utf-8"));
        }
        return {
          contents: [{ uri: uri.href, text: JSON.stringify(allRules, null, 2) }],
        };
      }
    );
  }

  // Register global anti-patterns
  const globalDir = join(RULES_DIR, "global");
  if (existsSync(globalDir)) {
    server.registerResource(
      "anti-patterns-global",
      "deslopify://anti-patterns/global",
      {
        title: "Global Anti-Patterns",
        description: "Language-agnostic anti-patterns that apply to all code generation",
        mimeType: "application/json",
      },
      async (uri) => {
        const allRules: Record<string, unknown> = {};
        for (const file of readdirSync(globalDir).filter((f) => f.endsWith(".json"))) {
          const key = file.replace(".json", "");
          allRules[key] = JSON.parse(readFileSync(join(globalDir, file), "utf-8"));
        }
        return {
          contents: [{ uri: uri.href, text: JSON.stringify(allRules, null, 2) }],
        };
      }
    );
  }
}
