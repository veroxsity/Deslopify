import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Rule } from "../types/rules.js";
import type { Language, IssueSeverity, IssueCategory } from "../types/common.js";
import type { CodeIssue } from "../types/tools.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RULES_DIR = join(__dirname, "..", "..", "rules");

interface RuleFile {
  rules?: Rule[];
  idioms?: Rule[];
  anti_patterns?: Rule[];
  best_practices?: Rule[];
  common_ai_mistakes?: Rule[];
}

export class StaticAnalyser {
  private globalRules: Rule[] = [];
  private languageRules: Map<Language, Rule[]> = new Map();

  constructor() {
    this.loadRules();
  }

  private loadRules(): void {
    // Load global rules
    const globalDir = join(RULES_DIR, "global");
    if (existsSync(globalDir)) {
      for (const file of readdirSync(globalDir).filter((f) => f.endsWith(".json"))) {
        const data: RuleFile = JSON.parse(readFileSync(join(globalDir, file), "utf-8"));
        if (data.rules) this.globalRules.push(...data.rules);
      }
    }

    // Load language-specific rules
    const languages: Language[] = ["cpp", "csharp", "python", "java", "typescript"];
    for (const lang of languages) {
      const langDir = join(RULES_DIR, lang);
      const rules: Rule[] = [];
      if (existsSync(langDir)) {
        for (const file of readdirSync(langDir).filter((f) => f.endsWith(".json"))) {
          const data: RuleFile = JSON.parse(readFileSync(join(langDir, file), "utf-8"));
          const allRules = [
            ...(data.rules ?? []),
            ...(data.idioms ?? []),
            ...(data.anti_patterns ?? []),
            ...(data.best_practices ?? []),
            ...(data.common_ai_mistakes ?? []),
          ];
          rules.push(...allRules);
        }
      }
      this.languageRules.set(lang, rules);
    }
  }

  getRulesForLanguage(language: Language): Rule[] {
    return [...this.globalRules, ...(this.languageRules.get(language) ?? [])];
  }

  getGuidance(language: Language, task: string): {
    idioms: Rule[];
    pitfalls: Rule[];
    architectureNotes: string[];
    testFramework: string;
  } {
    const rules = this.getRulesForLanguage(language);
    const taskLower = task.toLowerCase();

    // Filter rules relevant to the task
    const relevant = rules.filter((r) => {
      const desc = r.description.toLowerCase();
      const name = r.name.toLowerCase();
      return (
        taskLower.includes(name) ||
        desc.split(" ").some((word) => taskLower.includes(word) && word.length > 4)
      );
    });

    // If few specific matches, return top rules for the language
    const idioms = relevant.length > 2
      ? relevant.filter((r) => r.category === "idiom" || r.category === "robustness")
      : rules.filter((r) => r.category === "idiom" || r.category === "robustness").slice(0, 5);

    const pitfalls = rules.filter(
      (r) => r.severity === "error" || r.severity === "warning"
    ).slice(0, 8);

    const architectureNotes = rules
      .filter((r) => r.category === "architecture")
      .map((r) => r.description)
      .slice(0, 4);

    const frameworkMap: Record<Language, string> = {
      cpp: "GoogleTest",
      csharp: "xUnit",
      python: "pytest",
      java: "JUnit 5",
      typescript: "vitest",
    };

    return {
      idioms,
      pitfalls,
      architectureNotes,
      testFramework: frameworkMap[language],
    };
  }

  analyseCode(language: Language, code: string): CodeIssue[] {
    const issues: CodeIssue[] = [];
    const rules = this.getRulesForLanguage(language);
    const lines = code.split("\n");

    for (const rule of rules) {
      const detected = this.checkRule(rule, code, lines, language);
      if (detected) {
        issues.push(detected);
      }
    }

    return issues;
  }

  private checkRule(rule: Rule, code: string, lines: string[], language: Language): CodeIssue | null {
    // Pattern-based detection for common anti-patterns
    const patterns = this.getPatterns(rule, language);
    for (const pattern of patterns) {
      const match = code.match(pattern.regex);
      if (match) {
        const lineNum = code.substring(0, match.index ?? 0).split("\n").length;
        return {
          type: rule.name,
          severity: rule.severity,
          line_range: [lineNum, lineNum],
          description: rule.description,
          suggestion: rule.fix,
          category: rule.category,
        };
      }
    }
    return null;
  }

  private getPatterns(rule: Rule, language: Language): { regex: RegExp; }[] {
    const patternMap: Record<string, { regex: RegExp }[]> = {
      // Global patterns
      exception_swallowing: [
        { regex: /catch\s*\([^)]*\)\s*\{\s*\}/g },
        { regex: /catch\s*\([^)]*\)\s*\{\s*(console\.log|print|logger\.\w+)\([^)]*\);\s*\}/g },
        { regex: /except\s*.*:\s*\n\s*pass/g },
      ],
      missing_error_paths: [
        { regex: /JSON\.parse\s*\([^)]*\)(?!\s*(?:catch|\.catch))/g },
        { regex: /parseInt\s*\([^)]*\)(?!\s*(?:if|&&|\|\|))/g },
      ],
      hardcoded_configuration: [
        { regex: /(?:localhost|127\.0\.0\.1):\d+/g },
        { regex: /(?:password|secret|api_key|apiKey)\s*[:=]\s*["'][^"']+["']/gi },
      ],
      // C++ patterns
      use_smart_pointers: [
        { regex: /\bnew\s+\w+\s*[(<]/g },
        { regex: /\bdelete\s+\w+/g },
      ],
      use_raii: [
        { regex: /\.lock\s*\(\s*\)[\s\S]*?\.unlock\s*\(\)/g },
      ],
      // C# patterns
      use_using_disposable: [
        { regex: /new\s+(?:FileStream|StreamReader|StreamWriter|SqlConnection|HttpClient)\s*\([^)]*\)(?!\s*;?\s*\n?\s*using)/g },
      ],
      async_await_properly: [
        { regex: /\.Result\b/g },
        { regex: /\.Wait\s*\(\s*\)/g },
        { regex: /\.GetAwaiter\s*\(\s*\)\s*\.GetResult\s*\(\s*\)/g },
      ],
      // Python patterns
      no_mutable_defaults: [
        { regex: /def\s+\w+\s*\([^)]*=\s*\[\s*\]/g },
        { regex: /def\s+\w+\s*\([^)]*=\s*\{\s*\}/g },
      ],
      use_context_managers: [
        { regex: /(?:open|connect)\s*\([^)]*\)\s*\n(?!\s*with\b)/g },
      ],
      // TypeScript patterns
      no_any_leakage: [
        { regex: /:\s*any\b/g },
        { regex: /as\s+any\b/g },
      ],
      no_as_casts: [
        { regex: /\bas\s+(?!const\b)\w+/g },
      ],
      // Java patterns
      use_try_with_resources: [
        { regex: /(?:InputStream|OutputStream|Connection|Reader|Writer)\s+\w+\s*=\s*new\b(?!.*try\s*\()/g },
      ],
    };

    return patternMap[rule.name] ?? [];
  }
}
