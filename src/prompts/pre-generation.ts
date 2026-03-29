import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPreGenerationPrompt(server: McpServer): void {
  server.registerPrompt(
    "pre_generation",
    {
      title: "Deslopify: Before Writing Code",
      description: "Consult Deslopify before generating any code to get language-specific guidance and avoid common mistakes.",
      argsSchema: {
        language: z.string().describe("Target language: cpp, csharp, python, java, or typescript"),
        task: z.string().describe("What you are about to build or fix"),
      },
    },
    ({ language, task }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Before writing any code for this task, call the Deslopify get_guidance tool with:`,
              `- language: ${language}`,
              `- task: ${task}`,
              ``,
              `Follow the returned guidance strictly. Pay particular attention to:`,
              `1. Language idioms — use the patterns Deslopify recommends.`,
              `2. Generality — make the solution generic, not hardcoded to one case.`,
              `3. Error handling — implement every error path before happy-path logic.`,
              `4. Testability — structure code so every function can be tested in isolation.`,
              ``,
              `Do not proceed with code generation until you have reviewed the guidance.`,
            ].join("\n"),
          },
        },
      ],
    })
  );
}
