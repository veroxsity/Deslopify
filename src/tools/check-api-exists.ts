import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Language } from "../types/common.js";

const LANGUAGE_VALUES = ["cpp", "csharp", "python", "java", "typescript"] as const;

// Known APIs per language version — this is a starter set, expanded over time
const API_REGISTRY: Record<string, Record<string, { since: string; note?: string }>> = {
  cpp: {
    "std::ranges::to": { since: "c++23", note: "Not available in C++20. Use manual construction." },
    "std::format": { since: "c++20", note: "Not available in C++17. Use fmt::format or printf." },
    "std::jthread": { since: "c++20", note: "Not in C++17. Use std::thread with manual stop." },
    "std::expected": { since: "c++23", note: "Not in C++20. Use std::optional or tl::expected." },
    "std::print": { since: "c++23", note: "Not in C++20. Use std::format + std::cout." },
    "std::flat_map": { since: "c++23", note: "Not in C++20. Use std::map or sorted vector." },
    "std::generator": { since: "c++23", note: "Coroutine generator. Not in C++20 standard." },
    "std::stacktrace": { since: "c++23", note: "Not in C++20. Use platform-specific APIs." },
  },
  csharp: {
    "System.Text.Json.JsonNode": { since: ".net6" },
    "System.Threading.PeriodicTimer": { since: ".net6" },
    "required keyword": { since: ".net7", note: "required modifier for properties." },
    "primary constructors": { since: ".net8", note: "Primary constructors for non-record classes." },
    "collection expressions": { since: ".net8", note: "[1, 2, 3] syntax for collections." },
    "FrozenDictionary": { since: ".net8" },
    "SearchValues": { since: ".net8" },
  },
  python: {
    "match statement": { since: "3.10", note: "Structural pattern matching." },
    "tomllib": { since: "3.11", note: "Built-in TOML parser. Use tomli for <3.11." },
    "StrEnum": { since: "3.11" },
    "ExceptionGroup": { since: "3.11" },
    "TaskGroup": { since: "3.11", note: "asyncio.TaskGroup for structured concurrency." },
    "type statement": { since: "3.12", note: "type X = int | str syntax." },
    "typing.override": { since: "3.12" },
  },
  java: {
    "Records": { since: "16" },
    "Sealed classes": { since: "17" },
    "Pattern matching instanceof": { since: "16" },
    "Text blocks": { since: "15", note: "Triple-quote strings." },
    "SequencedCollection": { since: "21" },
    "Virtual threads": { since: "21", note: "Project Loom lightweight threads." },
    "String templates": { since: "21", note: "Preview feature in Java 21." },
    "Scoped values": { since: "21", note: "Preview replacement for ThreadLocal." },
  },
  typescript: {
    "satisfies operator": { since: "4.9" },
    "const type parameters": { since: "5.0" },
    "decorators": { since: "5.0", note: "TC39 Stage 3 decorators (not experimental)." },
    "using keyword": { since: "5.2", note: "Explicit resource management." },
    "import attributes": { since: "5.3", note: "import ... with { type: 'json' }" },
    "NoInfer<T>": { since: "5.4" },
  },
};

export function registerCheckApiExists(server: McpServer): void {
  server.registerTool(
    "check_api_exists",
    {
      title: "Check API Exists",
      description:
        "Verify whether a specific API (function, method, class) exists in the target language and version. " +
        "The anti-hallucination tool — catches fabricated APIs before they reach the user.",
      inputSchema: {
        language: z.enum(LANGUAGE_VALUES).describe("Target programming language"),
        api_reference: z.string().describe("The API being referenced (e.g. std::ranges::to, System.Text.Json.JsonNode)"),
        language_version: z.string().optional().describe("Target version (e.g. c++20, .net8, python3.12, 21, 5.4)"),
      },
    },
    async ({ language, api_reference, language_version }) => {
      const lang = language as Language;
      const registry = API_REGISTRY[lang] ?? {};
      const entry = registry[api_reference];
      const version = language_version ?? "latest";

      let response;

      if (entry) {
        // We know about this API
        const exists = version === "latest" || versionSatisfies(version, entry.since, lang);
        response = {
          exists,
          api_reference,
          checked_version: version,
          note: exists
            ? `${api_reference} is available since ${entry.since}.${entry.note ? " " + entry.note : ""}`
            : `${api_reference} was introduced in ${entry.since} and is not available in ${version}.${entry.note ? " " + entry.note : ""}`,
          alternative: exists ? undefined : entry.note,
        };
      } else {
        // Not in our registry — can't confirm or deny
        response = {
          exists: true,
          api_reference,
          checked_version: version,
          note: `${api_reference} is not in Deslopify's API registry for ${lang}. It may exist but could not be verified. Double-check official documentation.`,
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}

function versionSatisfies(target: string, since: string, lang: Language): boolean {
  // Normalize versions to comparable numbers
  const normalize = (v: string): number => {
    const cleaned = v
      .replace(/^c\+\+/i, "")
      .replace(/^\.net/i, "")
      .replace(/^python/i, "")
      .replace(/^ts/i, "")
      .replace(/^v/i, "");
    return parseFloat(cleaned) || 0;
  };

  return normalize(target) >= normalize(since);
}
