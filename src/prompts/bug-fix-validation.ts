import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerBugFixPrompt(server: McpServer): void {
  server.registerPrompt(
    "bug_fix_validation",
    {
      title: "Deslopify: Before Fixing a Bug",
      description: "Validate that a proposed bug fix addresses the root cause, not just the symptom.",
      argsSchema: {
        language: z.string().describe("Target language"),
        problem: z.string().describe("The user's bug report"),
        approach: z.string().describe("Your intended fix"),
      },
    },
    ({ language, problem, approach }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Before implementing a fix, call the Deslopify validate_approach tool with:`,
              `- language: ${language}`,
              `- problem_description: ${problem}`,
              `- proposed_approach: ${approach}`,
              ``,
              `If assessment is "symptom_fix":`,
              `1. Do NOT proceed with the proposed fix.`,
              `2. Follow Deslopify's recommendation to trace the root cause.`,
              `3. Ask the user any clarifying questions Deslopify suggests.`,
              `4. Reformulate targeting the root cause.`,
              `5. Call validate_approach again with the revised approach.`,
              ``,
              `Only implement when assessment is "root_cause_fix" or "likely_root_cause".`,
            ].join("\n"),
          },
        },
      ],
    })
  );
}
