import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StaticAnalyser } from "../engine/static-analyser.js";
import { scoreCode } from "../engine/scorer.js";
import type { Language } from "../types/common.js";
import type { CodeIssue } from "../types/tools.js";

const STRICTNESS_VALUES = ["low", "medium", "high"] as const;

const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".py": "python",
  ".pyw": "python",
  ".java": "java",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".h": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
};

interface FileReport {
  path: string;
  language: Language;
  score: number;
  verdict: string;
  issue_count: { errors: number; warnings: number; info: number };
  issues: CodeIssue[];
  positive_notes: string[];
}

interface CodebaseReport {
  overall_score: number;
  overall_verdict: string;
  total_files: number;
  files_reviewed: number;
  files_skipped: string[];
  total_issues: { errors: number; warnings: number; info: number };
  worst_files: FileReport[];
  best_files: FileReport[];
  file_reports: FileReport[];
  common_issues: { type: string; count: number; severity: string; description: string }[];
}

function detectLanguage(filePath: string): Language | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? null;
}

export function registerReviewCodebase(server: McpServer, analyser: StaticAnalyser): void {
  server.registerTool(
    "review_codebase",
    {
      title: "Review Codebase",
      description:
        "Review an entire codebase for quality issues. Pass an array of files with their paths and contents. " +
        "Returns per-file scores, an overall codebase score, worst/best files, and the most common issues found. " +
        "Supports C++, C#, Python, Java, and TypeScript files.",
      inputSchema: {
        files: z.array(z.object({
          path: z.string().describe("File path (used for language detection and reporting)"),
          content: z.string().describe("The file's source code content"),
        })).describe("Array of files to review, each with path and content"),
        strictness: z.enum(STRICTNESS_VALUES).optional().describe("Strictness level (default: medium)"),
      },
    },
    async ({ files, strictness }) => {
      if (!files || files.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            error: "No files provided. Pass an array of { path, content } objects.",
          }) }],
        };
      }

      const level = strictness ?? "medium";
      const fileReports: FileReport[] = [];
      const skipped: string[] = [];
      const issueFrequency = new Map<string, { count: number; severity: string; description: string }>();
      // Build a lookup map for file content to avoid repeated .find() calls
      const contentByPath = new Map(files.map((f) => [f.path, f.content]));

      for (const file of files) {
        const lang = detectLanguage(file.path);
        if (!lang) {
          skipped.push(file.path);
          continue;
        }

        if (!file.content || file.content.trim().length === 0) {
          skipped.push(file.path);
          continue;
        }

        // Run static analysis
        const issues = analyser.analyseCode(lang, file.content);

        // Filter by strictness
        const filtered =
          level === "low"
            ? issues.filter((i) => i.severity === "error")
            : level === "medium"
              ? issues.filter((i) => i.severity !== "info")
              : issues;

        // Score the file
        const { score, verdict, positiveNotes } = scoreCode(file.content, filtered);

        // Count issues by severity
        const issueCounts = {
          errors: filtered.filter((i) => i.severity === "error").length,
          warnings: filtered.filter((i) => i.severity === "warning").length,
          info: filtered.filter((i) => i.severity === "info").length,
        };

        // Track issue frequency across codebase
        for (const issue of filtered) {
          const existing = issueFrequency.get(issue.type);
          if (existing) {
            existing.count++;
          } else {
            issueFrequency.set(issue.type, {
              count: 1,
              severity: issue.severity,
              description: issue.description,
            });
          }
        }

        fileReports.push({
          path: file.path,
          language: lang,
          score,
          verdict,
          issue_count: issueCounts,
          issues: filtered,
          positive_notes: positiveNotes,
        });
      }

      // Calculate overall score (weighted average by file length)
      const totalLines = fileReports.reduce((sum, r) => {
        const content = contentByPath.get(r.path) ?? "";
        return sum + content.split("\n").length;
      }, 0);

      const overallScore = fileReports.length > 0
        ? Math.round(
            fileReports.reduce((sum, r) => {
              const content = contentByPath.get(r.path) ?? "";
              const fileLines = content.split("\n").length;
              return sum + r.score * (fileLines / totalLines);
            }, 0)
          )
        : 0;

      const overallVerdict =
        overallScore >= 80 ? "pass" : overallScore >= 50 ? "needs_improvement" : "fail";

      // Sort for worst and best files
      const sorted = [...fileReports].sort((a, b) => a.score - b.score);
      const worstFiles = sorted.slice(0, Math.min(5, sorted.length));
      const bestFiles = sorted.slice(-Math.min(3, sorted.length)).reverse();

      // Total issue counts
      const totalIssues = {
        errors: fileReports.reduce((sum, r) => sum + r.issue_count.errors, 0),
        warnings: fileReports.reduce((sum, r) => sum + r.issue_count.warnings, 0),
        info: fileReports.reduce((sum, r) => sum + r.issue_count.info, 0),
      };

      // Most common issues across the codebase
      const commonIssues = [...issueFrequency.entries()]
        .map(([type, data]) => ({ type, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const report: CodebaseReport = {
        overall_score: overallScore,
        overall_verdict: overallVerdict,
        total_files: files.length,
        files_reviewed: fileReports.length,
        files_skipped: skipped,
        total_issues: totalIssues,
        worst_files: worstFiles,
        best_files: bestFiles,
        file_reports: fileReports,
        common_issues: commonIssues,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
      };
    }
  );
}
