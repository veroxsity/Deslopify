import type { IssueSeverity, IssueCategory, Language } from "./common.js";

export interface Rule {
  id: string;
  language: Language | "global";
  severity: IssueSeverity;
  category: IssueCategory;
  name: string;
  description: string;
  detection: string;
  fix: string;
  bad_example?: string;
  good_example?: string;
}

export interface LanguageRuleSet {
  language: string;
  version: string;
  idioms: Rule[];
  anti_patterns: Rule[];
  best_practices: Rule[];
  common_ai_mistakes: Rule[];
}
