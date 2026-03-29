import type {
  Language,
  Strictness,
  IssueSeverity,
  IssueCategory,
  Verdict,
  ApproachAssessment,
  DependencyVerdict,
} from "./common.js";

// ── get_guidance ──

export interface GuidanceParams {
  language: Language;
  task: string;
  context?: string;
  strictness?: Strictness;
}

export interface IdiomRule {
  rule: string;
  severity: IssueSeverity;
  context: string;
}

export interface Pitfall {
  pattern: string;
  description: string;
  alternative: string;
}
export interface GuidanceResponse {
  language: string;
  guidance: {
    idioms: IdiomRule[];
    pitfalls: Pitfall[];
    architecture_notes: string[];
    test_recommendations: {
      framework: string;
      patterns: string[];
    };
  };
  strictness_applied: string;
}

// ── review_code ──

export interface ReviewParams {
  language: Language;
  code: string;
  task_description?: string;
  strictness?: Strictness;
}

export interface CodeIssue {
  type: string;
  severity: IssueSeverity;
  line_range?: [number, number];
  description: string;
  suggestion: string;
  category: IssueCategory;
}

export interface TestSuggestion {
  case: string;
  description: string;
  category: string;
  priority: "high" | "medium" | "low";
}

export interface ReviewResponse {
  verdict: Verdict;
  score: number;
  issues: CodeIssue[];
  test_suggestions: TestSuggestion[];
  positive_notes: string[];
}

// ── validate_approach ──

export interface ValidateApproachParams {
  language: Language;
  problem_description: string;
  proposed_approach: string;
  affected_modules?: string[];
  call_chain?: string;
}

export interface ValidateApproachResponse {
  assessment: ApproachAssessment;
  confidence: number;
  reasoning: string;
  recommendation: string;
  questions_to_ask_user: string[];
  risk_if_ignored: string;
}

// ── suggest_tests ──

export interface SuggestTestsParams {
  language: Language;
  code: string;
  framework?: string;
}

export interface SuggestTestsResponse {
  framework: string;
  test_cases: TestSuggestion[];
  test_skeleton: string;
}

// ── check_dependencies ──

export interface CheckDependenciesParams {
  language: Language;
  dependencies: string[];
  usage_description?: string;
}

export interface DependencyEvaluation {
  package: string;
  verdict: DependencyVerdict;
  reason: string;
  alternative?: string;
  severity: IssueSeverity;
}

export interface CheckDependenciesResponse {
  evaluations: DependencyEvaluation[];
}

// ── check_api_exists ──

export interface CheckApiExistsParams {
  language: Language;
  api_reference: string;
  language_version?: string;
}

export interface CheckApiExistsResponse {
  exists: boolean;
  api_reference: string;
  checked_version: string;
  note: string;
  alternative?: string;
}
