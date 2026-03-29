import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Language, DependencyVerdict, IssueSeverity } from "../types/common.js";

const LANGUAGE_VALUES = ["cpp", "csharp", "python", "java", "typescript"] as const;

// Known overkill/problematic packages
const KNOWN_ISSUES: Record<string, { verdict: DependencyVerdict; reason: string; alternative?: string; severity: IssueSeverity }> = {
  lodash: { verdict: "consider_alternative", reason: "Most lodash utilities have native ES2020+ equivalents. Only justified if using >10 utilities.", alternative: "Use native array methods, optional chaining (?.), nullish coalescing (??)", severity: "warning" },
  underscore: { verdict: "consider_alternative", reason: "Superseded by lodash and native JS. No reason to use in modern code.", alternative: "Native ES2020+ methods", severity: "warning" },
  moment: { verdict: "deprecated", reason: "Moment.js is in maintenance mode. The team recommends alternatives.", alternative: "Use date-fns, luxon, or Temporal API (Stage 3)", severity: "warning" },
  request: { verdict: "abandoned", reason: "Request has been deprecated since 2020.", alternative: "Use fetch (built-in), axios, or got", severity: "error" },
  "node-fetch": { verdict: "consider_alternative", reason: "Node 18+ has built-in fetch. Only needed for Node <18.", alternative: "Built-in fetch (Node 18+)", severity: "info" },
  jquery: { verdict: "consider_alternative", reason: "Modern DOM APIs cover most jQuery use cases.", alternative: "Native querySelector, fetch, classList APIs", severity: "warning" },
  "left-pad": { verdict: "overkill", reason: "String.prototype.padStart() is built-in since ES2017.", alternative: "str.padStart(length, char)", severity: "warning" },
  "is-odd": { verdict: "overkill", reason: "This is a one-liner: n % 2 !== 0", alternative: "n % 2 !== 0", severity: "warning" },
  "is-even": { verdict: "overkill", reason: "This is a one-liner: n % 2 === 0", alternative: "n % 2 === 0", severity: "warning" },
};

export function registerCheckDependencies(server: McpServer): void {
  server.registerTool(
    "check_dependencies",
    {
      title: "Check Dependencies",
      description:
        "Evaluate whether proposed dependencies are appropriate. " +
        "Flags abandoned packages, overkill imports, and suggests lighter alternatives.",
      inputSchema: {
        language: z.enum(LANGUAGE_VALUES).describe("Target programming language"),
        dependencies: z.array(z.string()).describe("List of package names being imported or installed"),
        usage_description: z.string().optional().describe("What the dependencies are being used for"),
      },
    },
    async ({ language, dependencies, usage_description }) => {
      const evaluations = dependencies.map((pkg) => {
        const known = KNOWN_ISSUES[pkg.toLowerCase()];
        if (known) {
          return { package: pkg, ...known };
        }
        return {
          package: pkg,
          verdict: "appropriate" as DependencyVerdict,
          reason: "No known issues with this package.",
          severity: "info" as IssueSeverity,
        };
      });

      const response = { evaluations };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}
