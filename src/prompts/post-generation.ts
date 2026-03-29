import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPostGenerationPrompt(server: McpServer): void {
  server.registerPrompt(
    "post_generation",
    {
      title: "Deslopify: After Writing Code",
      description: "Submit generated code to Deslopify for review before presenting it to the user.",
      argsSchema: {
        language: z.string().describe("Language of the code"),
        code: z.string().describe("The generated code to review"),
      },
    },
    ({ language, code }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Before presenting this code to the user, call the Deslopify review_code tool with:`,
              `- language: ${language}`,
              `- code: (the generated code)`,
              ``,
              `If the verdict is "needs_improvement" or "fail":`,
              `1. Address every issue with severity "error".`,
              `2. Address "warning" issues unless they add significant complexity.`,
              `3. Regenerate the code with fixes applied.`,
              `4. Call review_code again to verify.`,
              `5. Do not present code until verdict is "pass" or all errors are resolved.`,
              ``,
              `Always include the suggested test cases in your response.`,
            ].join("\n"),
          },
        },
      ],
    })
  );
}
