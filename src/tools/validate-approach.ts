import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApproachAssessment } from "../types/common.js";

const LANGUAGE_VALUES = ["cpp", "csharp", "python", "java", "typescript"] as const;

export function registerValidateApproach(server: McpServer): void {
  server.registerTool(
    "validate_approach",
    {
      title: "Validate Approach",
      description:
        "Validate whether a proposed bug fix targets the root cause or just patches a symptom. " +
        "Call BEFORE implementing any fix. Traces call chains to find the real source of bugs.",
      inputSchema: {
        language: z.enum(LANGUAGE_VALUES).describe("Target programming language"),
        problem_description: z.string().describe("The bug or feature request as described by the user"),
        proposed_approach: z.string().describe("What you intend to do to fix/implement this"),
        affected_modules: z.array(z.string()).optional().describe("List of files/classes/modules involved"),
        call_chain: z.string().optional().describe("Call chain from entry point to bug location"),
      },
    },
    async ({ problem_description, proposed_approach, affected_modules, call_chain }) => {
      // Heuristic root-cause analysis
      const problemLower = problem_description.toLowerCase();
      const approachLower = proposed_approach.toLowerCase();

      let assessment: ApproachAssessment = "likely_root_cause";
      let confidence = 0.6;
      const questions: string[] = [];
      let reasoning = "";
      let recommendation = "";
      let risk = "";

      // Check for symptom-fix signals
      const symptomSignals: string[] = [];

      // Signal: problem mentions broad impact but fix is narrow
      const broadImpactWords = ["all", "every", "multiple", "various", "many", "other", "general", "broadly"];
      const hasBroadImpact = broadImpactWords.some((w) => problemLower.includes(w));

      if (hasBroadImpact) {
        // Check if approach targets a single specific thing
        const narrowFixWords = ["specific", "only", "just", "this one", "particular"];
        const isNarrowFix = narrowFixWords.some((w) => approachLower.includes(w));
        if (isNarrowFix) {
          symptomSignals.push("Problem has broad impact but proposed fix is narrow");
        }
      }

      // Signal: call chain provided and fix is at the leaf
      if (call_chain) {
        const chain = call_chain.split(/\s*->\s*|\s*→\s*|\s*>\s*/);
        if (chain.length >= 2) {
          const leaf = chain[chain.length - 1].toLowerCase();
          if (approachLower.includes(leaf)) {
            symptomSignals.push(
              `Fix targets the leaf of the call chain (${chain[chain.length - 1]}). ` +
              `Consider whether the issue originates earlier in: ${call_chain}`
            );
          }
        }
      }

      // Signal: fixing a handler when the dispatcher might be the issue
      const handlerPattern = /(?:handler|listener|callback|hook|subscriber)/i;
      const dispatcherPattern = /(?:dispatch|route|forward|delegate|invoke|caller|base|parent|manager)/i;
      if (handlerPattern.test(proposed_approach) && !dispatcherPattern.test(proposed_approach)) {
        if (dispatcherPattern.test(problem_description) || (affected_modules?.some((m) => dispatcherPattern.test(m)))) {
          symptomSignals.push("Fix targets a handler but a dispatcher/caller in the affected modules may be the root cause");
        }
      }

      // Signal: modifying one module when multiple are mentioned in the problem
      if (affected_modules && affected_modules.length > 2) {
        const moduleMentions = affected_modules.filter((m) => approachLower.includes(m.toLowerCase()));
        if (moduleMentions.length === 1) {
          symptomSignals.push(`Fix only touches ${moduleMentions[0]} but ${affected_modules.length} modules are involved`);
        }
      }

      // Determine assessment
      if (symptomSignals.length >= 2) {
        assessment = "symptom_fix";
        confidence = 0.85;
        reasoning = `Multiple signals suggest this is a symptom-only fix:\n- ${symptomSignals.join("\n- ")}`;
        recommendation = "Trace the issue from the entry point downward. Identify the shared code path where the bug originates and fix at that level.";
        risk = "Other code paths through the same shared component will remain broken. Future additions will inherit the same bug.";
        questions.push("Are there other features/modules experiencing similar issues?");
        questions.push("Was this working before a recent change to a shared module?");
      } else if (symptomSignals.length === 1) {
        assessment = "unclear_needs_investigation";
        confidence = 0.5;
        reasoning = `One potential concern: ${symptomSignals[0]}. This may or may not be a symptom fix — more investigation needed.`;
        recommendation = "Verify that the proposed fix point is actually the root cause before implementing. Check adjacent modules.";
        risk = "If this is a symptom fix, the underlying issue remains and may manifest elsewhere.";
        questions.push("Can you verify this is the root cause by checking the caller/dispatcher?");
      } else {
        assessment = "likely_root_cause";
        confidence = 0.7;
        reasoning = "The proposed approach appears to target the appropriate level. No obvious symptom-fix signals detected.";
        recommendation = "Proceed with the fix but verify with tests that cover related code paths.";
        risk = "Low risk if tests confirm the fix addresses the underlying issue.";
      }

      const response = { assessment, confidence, reasoning, recommendation, questions_to_ask_user: questions, risk_if_ignored: risk };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}
