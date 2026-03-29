import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StaticAnalyser } from "../engine/static-analyser.js";
import { scoreCode } from "../engine/scorer.js";
import type { Language, Strictness } from "../types/common.js";

const LANGUAGE_VALUES = ["cpp", "csharp", "python", "java", "typescript"] as const;
const STRICTNESS_VALUES = ["low", "medium", "high"] as const;

export function registerReviewCode(server: McpServer, analyser: StaticAnalyser): void {
  server.registerTool(
    "review_code",
    {
      title: "Review Code",
      description:
        "Review generated code for quality issues AFTER writing it. " +
        "Returns structured issues with severity, suggestions, and a quality score.",
      inputSchema: {
        language: z.enum(LANGUAGE_VALUES).describe("Language of the submitted code"),
        code: z.string().describe("The generated code to review"),
        task_description: z.string().optional().describe("What the code is supposed to do"),
        strictness: z.enum(STRICTNESS_VALUES).optional().describe("Strictness level (default: medium)"),
      },
    },
    async ({ language, code, task_description, strictness }) => {
      const lang = language as Language;
      const level = (strictness ?? "medium") as Strictness;

      // Run static analysis
      const issues = analyser.analyseCode(lang, code);

      // Filter by strictness
      const filtered =
        level === "low"
          ? issues.filter((i) => i.severity === "error")
          : level === "medium"
            ? issues.filter((i) => i.severity !== "info")
            : issues;

      // Score the code
      const { score, verdict, positiveNotes } = scoreCode(code, filtered);

      // Generate test suggestions based on code analysis
      const testSuggestions = generateTestSuggestions(code);

      const response = {
        verdict,
        score,
        issues: filtered,
        test_suggestions: testSuggestions,
        positive_notes: positiveNotes,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}

function generateTestSuggestions(code: string) {
  const suggestions: { case: string; description: string; category: string; priority: "high" | "medium" | "low" }[] = [
    { case: "empty_input", description: "Pass empty/zero-length input", category: "edge_case", priority: "high" },
    { case: "null_input", description: "Pass null/undefined/None input", category: "edge_case", priority: "high" },
    { case: "typical_usage", description: "Standard happy path with representative data", category: "functional", priority: "high" },
  ];

  if (/(?:array|list|vector|collection|map|set)/i.test(code)) {
    suggestions.push({ case: "single_element", description: "Container with exactly one item", category: "edge_case", priority: "medium" });
    suggestions.push({ case: "large_input", description: "Performance test with 10k+ elements", category: "performance", priority: "medium" });
  }

  if (/(?:string|str|text|char)/i.test(code)) {
    suggestions.push({ case: "empty_string", description: "Pass empty string input", category: "edge_case", priority: "high" });
    suggestions.push({ case: "unicode_input", description: "Test with unicode/emoji characters", category: "edge_case", priority: "medium" });
  }

  if (/(?:number|int|float|double|decimal)/i.test(code)) {
    suggestions.push({ case: "zero_value", description: "Pass zero as numeric input", category: "edge_case", priority: "high" });
    suggestions.push({ case: "negative_value", description: "Pass negative numbers", category: "edge_case", priority: "medium" });
    suggestions.push({ case: "boundary_values", description: "Test with MAX_VALUE / MIN_VALUE", category: "edge_case", priority: "medium" });
  }

  if (/(?:async|await|promise|future|task)/i.test(code)) {
    suggestions.push({ case: "concurrent_access", description: "Test with concurrent/parallel calls", category: "concurrency", priority: "medium" });
    suggestions.push({ case: "timeout_handling", description: "Verify timeout and cancellation behaviour", category: "robustness", priority: "medium" });
  }

  return suggestions;
}
