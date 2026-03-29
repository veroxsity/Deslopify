import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Language } from "../types/common.js";

const LANGUAGE_VALUES = ["cpp", "csharp", "python", "java", "typescript"] as const;

const FRAMEWORK_MAP: Record<Language, string> = {
  cpp: "GoogleTest",
  csharp: "xUnit",
  python: "pytest",
  java: "JUnit 5",
  typescript: "vitest",
};

export function registerSuggestTests(server: McpServer): void {
  server.registerTool(
    "suggest_tests",
    {
      title: "Suggest Tests",
      description:
        "Given code, generate a structured list of test cases with skeletons. " +
        "Ensures edge cases, error paths, and performance scenarios are covered.",
      inputSchema: {
        language: z.enum(LANGUAGE_VALUES).describe("Target programming language"),
        code: z.string().describe("The function or class to generate tests for"),
        framework: z.string().optional().describe("Preferred test framework (auto-detected if omitted)"),
      },
    },
    async ({ language, code, framework }) => {
      const lang = language as Language;
      const fw = framework ?? FRAMEWORK_MAP[lang];

      // Extract function/class names from code
      const funcMatch = code.match(/(?:function|def|fun|void|int|string|auto|public\s+\w+)\s+(\w+)\s*\(/);
      const funcName = funcMatch?.[1] ?? "function_under_test";

      const testCases: { name: string; description: string; category: string; priority: "high" | "medium" | "low" }[] = [
        { name: `test_${funcName}_empty_input`, description: "Verify behaviour with empty input", category: "edge_case", priority: "high" },
        { name: `test_${funcName}_null_input`, description: "Verify null/None/nullptr input handling", category: "edge_case", priority: "high" },
        { name: `test_${funcName}_typical_usage`, description: "Standard happy path with representative data", category: "functional", priority: "high" },
        { name: `test_${funcName}_error_path`, description: "Verify error/exception handling on invalid input", category: "robustness", priority: "high" },
      ];

      if (/(?:list|array|vector|collection|map)/i.test(code)) {
        testCases.push({ name: `test_${funcName}_single_element`, description: "Single-element collection", category: "edge_case", priority: "medium" });
        testCases.push({ name: `test_${funcName}_large_input`, description: "Performance with 10k+ elements", category: "performance", priority: "medium" });
      }

      if (/(?:async|await|promise|future|task)/i.test(code)) {
        testCases.push({ name: `test_${funcName}_concurrent`, description: "Concurrent/parallel execution", category: "concurrency", priority: "medium" });
      }

      // Generate skeleton based on language
      const skeleton = generateSkeleton(lang, fw, funcName, testCases);

      const response = { framework: fw, test_cases: testCases, test_skeleton: skeleton };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}

function generateSkeleton(lang: Language, fw: string, funcName: string, cases: { name: string }[]): string {
  const skeletons: Record<Language, (fn: string, cases: { name: string }[]) => string> = {
    python: (fn, cs) =>
      cs.map((c) => `def ${c.name}():\n    result = ${fn}(...)\n    assert result == expected\n`).join("\n"),
    typescript: (fn, cs) =>
      `import { describe, it, expect } from 'vitest';\n\ndescribe('${fn}', () => {\n` +
      cs.map((c) => `  it('${c.name}', () => {\n    const result = ${fn}(...);\n    expect(result).toBe(expected);\n  });`).join("\n") +
      "\n});",
    java: (fn, cs) =>
      cs.map((c) => `@Test\nvoid ${c.name}() {\n    var result = ${fn}(...);\n    assertEquals(expected, result);\n}`).join("\n\n"),
    csharp: (fn, cs) =>
      cs.map((c) => `[Fact]\npublic void ${c.name}()\n{\n    var result = ${fn}(...);\n    Assert.Equal(expected, result);\n}`).join("\n\n"),
    cpp: (fn, cs) =>
      cs.map((c) => `TEST(${fn}Test, ${c.name}) {\n    auto result = ${fn}(...);\n    EXPECT_EQ(result, expected);\n}`).join("\n\n"),
  };

  return skeletons[lang](funcName, cases);
}
