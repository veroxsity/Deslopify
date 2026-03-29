import { describe, it, expect } from "vitest";
import { scoreCode } from "../../src/engine/scorer.js";
import type { CodeIssue } from "../../src/types/tools.js";

describe("scoreCode", () => {
  it("returns pass for code with no issues", () => {
    const code = `const x: number = 42;`;
    const result = scoreCode(code, []);
    expect(result.verdict).toBe("pass");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("deducts points for errors", () => {
    const code = `const x = 1;`;
    const issues: CodeIssue[] = [
      {
        type: "missing_error_handling",
        severity: "error",
        description: "No error handling",
        suggestion: "Add try/catch",
        category: "robustness",
      },
    ];
    const result = scoreCode(code, issues);
    expect(result.score).toBeLessThan(100);
  });

  it("returns fail for many errors", () => {
    const code = `const x = 1;`;
    const issues: CodeIssue[] = Array.from({ length: 5 }, (_, i) => ({
      type: `issue_${i}`,
      severity: "error" as const,
      description: `Error ${i}`,
      suggestion: `Fix ${i}`,
      category: "robustness" as const,
    }));
    const result = scoreCode(code, issues);
    expect(result.verdict).toBe("fail");
    expect(result.score).toBeLessThan(50);
  });

  it("awards positive notes for good patterns", () => {
    const code = `interface IService { execute(): void; }\nconst readonly x = 42;`;
    const result = scoreCode(code, []);
    expect(result.positiveNotes.length).toBeGreaterThan(0);
  });

  it("clamps score between 0 and 100", () => {
    const code = `x`;
    const issues: CodeIssue[] = Array.from({ length: 20 }, (_, i) => ({
      type: `issue_${i}`,
      severity: "error" as const,
      description: `Error ${i}`,
      suggestion: `Fix ${i}`,
      category: "robustness" as const,
    }));
    const result = scoreCode(code, issues);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
