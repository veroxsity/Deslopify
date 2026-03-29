import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StaticAnalyser } from "../engine/static-analyser.js";
import type { Language, Strictness } from "../types/common.js";

const LANGUAGE_VALUES = ["cpp", "csharp", "python", "java", "typescript"] as const;
const STRICTNESS_VALUES = ["low", "medium", "high"] as const;

export function registerGetGuidance(server: McpServer, analyser: StaticAnalyser): void {
  server.registerTool(
    "get_guidance",
    {
      title: "Get Guidance",
      description:
        "Get language-specific guidance, idioms, and pitfalls BEFORE writing code. " +
        "Call this before generating any code to avoid common AI mistakes.",
      inputSchema: {
        language: z.enum(LANGUAGE_VALUES).describe("Target programming language"),
        task: z.string().describe("Description of what you intend to build or fix"),
        context: z.string().optional().describe("Additional context about codebase, frameworks, runtime version"),
        strictness: z.enum(STRICTNESS_VALUES).optional().describe("Strictness level (default: medium)"),
      },
    },
    async ({ language, task, context, strictness }) => {
      const lang = language as Language;
      const level = (strictness ?? "medium") as Strictness;
      const guidance = analyser.getGuidance(lang, task);

      const response = {
        language: lang,
        guidance: {
          idioms: guidance.idioms.map((r) => ({
            rule: r.description,
            severity: r.severity,
            context: r.category,
          })),
          pitfalls: guidance.pitfalls.map((r) => ({
            pattern: r.name,
            description: r.description,
            alternative: r.fix,
          })),
          architecture_notes: guidance.architectureNotes,
          test_recommendations: {
            framework: guidance.testFramework,
            patterns: [
              "Test pure functions first",
              "Mock external dependencies",
              "Cover edge cases: empty input, null, boundary values",
              "Test error paths, not just happy paths",
            ],
          },
        },
        strictness_applied: level,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}
