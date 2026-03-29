import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerFullWorkflowPrompt(server: McpServer): void {
  server.registerPrompt(
    "full_workflow",
    {
      title: "Deslopify: Full Quality Workflow",
      description: "The complete Deslopify workflow: guidance → validation → generation → review → tests.",
      argsSchema: {
        language: z.string().describe("Target language"),
        task: z.string().describe("What you need to build or fix"),
      },
    },
    ({ language, task }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Follow the complete Deslopify workflow for: ${task}`,
              ``,
              `STEP 1 — GUIDANCE: Call get_guidance(language="${language}", task="${task}")`,
              `STEP 2 — APPROACH (if fixing a bug): Call validate_approach to confirm root cause`,
              `STEP 3 — GENERATE: Write code following Step 1 guidance`,
              `STEP 4 — REVIEW: Call review_code. Iterate until "pass" or all errors resolved`,
              `STEP 5 — TESTS: Call suggest_tests and include test cases`,
              `STEP 6 — DEPS (if adding packages): Call check_dependencies`,
              ``,
              `Present final code, review results, and tests together.`,
            ].join("\n"),
          },
        },
      ],
    })
  );
}
