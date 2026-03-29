import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StaticAnalyser } from "./engine/static-analyser.js";
import { registerGetGuidance } from "./tools/get-guidance.js";
import { registerReviewCode } from "./tools/review-code.js";
import { registerValidateApproach } from "./tools/validate-approach.js";
import { registerSuggestTests } from "./tools/suggest-tests.js";
import { registerCheckDependencies } from "./tools/check-dependencies.js";
import { registerCheckApiExists } from "./tools/check-api-exists.js";
import { registerReviewCodebase } from "./tools/review-codebase.js";
import { registerPreGenerationPrompt } from "./prompts/pre-generation.js";
import { registerPostGenerationPrompt } from "./prompts/post-generation.js";
import { registerBugFixPrompt } from "./prompts/bug-fix-validation.js";
import { registerFullWorkflowPrompt } from "./prompts/full-workflow.js";
import { registerResources } from "./resources/rules-provider.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "deslopify",
    version: "0.1.0",
  });

  const analyser = new StaticAnalyser();

  // Register all 7 tools
  registerGetGuidance(server, analyser);
  registerReviewCode(server, analyser);
  registerValidateApproach(server);
  registerSuggestTests(server);
  registerCheckDependencies(server);
  registerCheckApiExists(server);
  registerReviewCodebase(server, analyser);

  // Register all 4 prompts
  registerPreGenerationPrompt(server);
  registerPostGenerationPrompt(server);
  registerBugFixPrompt(server);
  registerFullWorkflowPrompt(server);

  // Register resources
  registerResources(server);

  return server;
}
