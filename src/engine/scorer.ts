import type { CodeIssue } from "../types/tools.js";
import type { Verdict } from "../types/common.js";

interface ScoreResult {
  score: number;
  verdict: Verdict;
  positiveNotes: string[];
}

const CATEGORY_WEIGHTS: Record<string, number> = {
  robustness: 0.25,
  idiom: 0.20,
  generality: 0.20,
  architecture: 0.15,
  testability: 0.10,
  performance: 0.10,
};

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  error: 15,
  warning: 8,
  info: 2,
};

export function scoreCode(code: string, issues: CodeIssue[]): ScoreResult {
  let score = 100;
  const positiveNotes: string[] = [];

  // Deduct points for issues
  for (const issue of issues) {
    const deduction = SEVERITY_DEDUCTIONS[issue.severity] ?? 5;
    const weight = CATEGORY_WEIGHTS[issue.category] ?? 0.15;
    score -= deduction * (1 + weight);
  }

  // Positive signals
  if (code.includes("const ") || code.includes("readonly ") || code.includes("final ")) {
    positiveNotes.push("Good use of immutability (const/readonly/final)");
    score += 2;
  }

  if (/(?:throws|throw new|raise |except |catch\s*\()/.test(code)) {
    positiveNotes.push("Includes error handling");
    score += 2;
  }

  if (/(?:interface |protocol |abstract |trait )/.test(code)) {
    positiveNotes.push("Uses abstractions for flexibility");
    score += 2;
  }

  if (/(?:template\s*<|<T>|<T,|\[T\]|Generic\[)/.test(code)) {
    positiveNotes.push("Uses generics/templates for reusability");
    score += 3;
  }

  if (/(?:\/\/|#|\/\*|\*\/|"""|''')\s*\S/.test(code)) {
    positiveNotes.push("Includes code comments");
    score += 1;
  }

  // Clamp score
  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict: Verdict;
  if (score >= 80) verdict = "pass";
  else if (score >= 50) verdict = "needs_improvement";
  else verdict = "fail";

  return { score, verdict, positiveNotes };
}
