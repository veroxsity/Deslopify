export type Language = "cpp" | "csharp" | "python" | "java" | "typescript";

export type Strictness = "low" | "medium" | "high";

export type IssueSeverity = "error" | "warning" | "info";

export type IssueCategory =
  | "robustness"
  | "idiom"
  | "generality"
  | "architecture"
  | "testability"
  | "performance";

export type Verdict = "pass" | "needs_improvement" | "fail";

export type ApproachAssessment =
  | "root_cause_fix"
  | "likely_root_cause"
  | "symptom_fix"
  | "unclear_needs_investigation";

export type DependencyVerdict =
  | "appropriate"
  | "consider_alternative"
  | "deprecated"
  | "abandoned"
  | "overkill"
  | "security_concern";
