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
    const seenRules = new Set<string>();

    for (const rule of rules) {
      // Only report each rule once, but pick the best (first) match
      if (seenRules.has(rule.name)) continue;
      const detected = this.checkRule(rule, code, language);
      if (detected.length > 0) {
        seenRules.add(rule.name);
        issues.push(detected[0]); // Report first occurrence with count
        if (detected.length > 1) {
          issues[issues.length - 1].description += ` (${detected.length} occurrences found)`;
        }
      }
    }

    return issues;
  }

  private checkRule(rule: Rule, code: string, language: Language): CodeIssue[] {
    const results: CodeIssue[] = [];
    const patterns = this.getPatterns(rule, language);

    for (const pattern of patterns) {
      // Reset lastIndex for global regexes
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(code)) !== null) {
        const lineNum = code.substring(0, match.index).split("\n").length;
        results.push({
          type: rule.name,
          severity: rule.severity,
          line_range: [lineNum, lineNum],
          description: rule.description,
          suggestion: rule.fix,
          category: rule.category,
        });
        // Prevent infinite loops on zero-length matches
        if (match[0].length === 0) pattern.regex.lastIndex++;
      }
    }

    return results;
  }

  private getPatterns(rule: Rule, language: Language): { regex: RegExp; }[] {
    const patternMap: Record<string, { regex: RegExp }[]> = {
      // ── Global patterns ──

      exception_swallowing: [
        // Empty catch block: catch(e) { }
        { regex: /catch\s*\([^)]*\)\s*\{\s*\}/g },
        // Catch with only a log statement
        { regex: /catch\s*\([^)]*\)\s*\{[\s\n]*(?:console\.(?:log|warn|error)|print|logger\.\w+|System\.out\.print)\s*\([^)]*\)\s*;?\s*\}/gm },
        // Catch that logs then returns null/undefined/default
        { regex: /catch\s*\([^)]*\)\s*\{[^}]*(?:console\.(?:log|warn|error)|print)\s*\([^)]*\)\s*;?\s*\n?\s*return\s+(?:null|undefined|false|0|-1|"")\s*;?\s*\}/gm },
        // Catch that just returns null with no handling
        { regex: /catch\s*\([^)]*\)\s*\{[\s\n]*return\s+(?:null|undefined|false|0)\s*;?\s*\}/gm },
        // Python: except ... pass
        { regex: /except\s*.*:\s*\n\s*pass/g },
        // Python: except with bare pass or just a print
        { regex: /except\s*.*:\s*\n\s*print\s*\([^)]*\)\s*$/gm },
        // C++: catch(...) { } or catch(...) with just a comment
        { regex: /catch\s*\(\s*\.\.\.\s*\)\s*\{[\s\n]*(?:\/\/[^\n]*)?\s*\}/gm },
      ],

      missing_error_paths: [
        // JSON.parse without surrounding try/catch
        { regex: /JSON\.parse\s*\([^)]*\)(?![\s\S]{0,50}catch)/g },
        // parseInt/parseFloat without NaN check nearby
        { regex: /(?:const|let|var)\s+\w+\s*=\s*(?:parseInt|parseFloat)\s*\([^)]*\)\s*;(?![\s\S]{0,80}(?:isNaN|Number\.isNaN))/g },
        // fetch/axios without try/catch or .catch
        { regex: /(?:fetch|axios\.\w+)\s*\([^)]*\)(?![\s\S]{0,60}(?:\.catch|catch\s*\())/g },
        // File read/write without error handling
        { regex: /(?:readFileSync|writeFileSync)\s*\([^)]*\)(?![\s\S]{0,60}catch)/g },
        // Python: open() without with or try
        { regex: /^\s*\w+\s*=\s*open\s*\([^)]*\)$/gm },
        // C++: std::stoi/stof/stod without try/catch
        { regex: /std::(?:stoi|stof|stod|stol|stoul)\s*\(/g },
        // Unchecked .get() on map/dict that could throw or return undefined
        { regex: /\.get\s*\(\s*\w+\s*\)\s*\.\w+/g },
      ],

      hardcoded_configuration: [
        // localhost or IP with port
        { regex: /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/g },
        // Hardcoded credentials in strings
        { regex: /(?:password|secret|api_key|apiKey|api_secret|token|auth)\s*[:=]\s*["'][^"']{3,}["']/gi },
        // Hardcoded URLs with protocol
        { regex: /["']https?:\/\/(?!(?:example\.com|localhost))[a-zA-Z0-9.-]+\.[a-z]{2,}\/[^"']*["']/g },
        // Common secret patterns (sk_live, pk_test, etc.)
        { regex: /["'](?:sk_live|pk_live|sk_test|pk_test|sk-proj|ghp_|gho_|AKIA)[A-Za-z0-9_-]+["']/g },
        // Hardcoded port numbers in code
        { regex: /(?:port|PORT)\s*[:=]\s*\d{4,5}\b/g },
        // Database connection strings
        { regex: /["'](?:mongodb|postgresql|mysql|redis|amqp):\/\/[^"']+["']/g },
        // Email addresses hardcoded
        { regex: /["'][a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}["']/g },
        // Hardcoded file paths (Windows or Unix absolute paths)
        { regex: /["'](?:\/(?:usr|etc|var|home|opt)\/|[A-Z]:\\)[^"']+["']/g },
      ],

      copy_paste_duplication: [
        // Two functions with near-identical structure (same method calls in same order)
        // Heuristic: detect two function bodies that both call the same 3+ methods
        { regex: /function\s+\w+\s*\([^)]*\)\s*\{[^}]*?(\w+\([^)]*\))[^}]*?(\w+\([^)]*\))[^}]*?(\w+\([^)]*\))[^}]*\}[\s\S]{0,200}function\s+\w+\s*\([^)]*\)\s*\{[^}]*?\1[^}]*?\2[^}]*?\3[^}]*\}/gm },
      ],

      narrow_solution: [
        // Function parameter typed to a specific concrete class where an interface/generic would work
        // Heuristic: function that takes string[] when T[] would generalize
        { regex: /function\s+\w+\s*\(\s*\w+\s*:\s*string\s*\[\s*\]\s*\)/g },
        // Hardcoded type in generic-capable position
        { regex: /function\s+\w+\s*\(\s*\w+\s*:\s*(?:number|string|boolean)\s*\[\s*\]\s*\)\s*:\s*(?:number|string|boolean)\s*\[\s*\]/g },
        // Python: function that operates on list but specifies type in name
        { regex: /def\s+\w+(?:_str|_int|_string|_number)\s*\(/g },
      ],

      dependency_bloat: [
        // Importing lodash
        { regex: /import\s+(?:_|\w+)\s+from\s+['"]lodash['"]/g },
        { regex: /require\s*\(\s*['"]lodash['"]\s*\)/g },
        // Importing moment (deprecated)
        { regex: /import\s+\w+\s+from\s+['"]moment['"]/g },
        { regex: /require\s*\(\s*['"]moment['"]\s*\)/g },
        // Importing jquery
        { regex: /import\s+(?:\$|\w+)\s+from\s+['"]jquery['"]/g },
        // Importing left-pad, is-odd, is-even, is-number type micro-packages
        { regex: /import\s+\w+\s+from\s+['"](?:left-pad|is-odd|is-even|is-number|is-string|is-boolean|is-array)['"]/g },
        // Python: importing deprecated/heavy packages
        { regex: /import\s+(?:urllib2|optparse)\b/g },
      ],

      over_engineering: [
        // Abstract factory pattern for simple cases (AbstractFactory in class name)
        { regex: /class\s+\w*(?:Abstract|Base)\w*Factory\w*/g },
        // Strategy pattern with only one implementation
        { regex: /interface\s+\w+Strategy\b/g },
        // Singleton pattern
        { regex: /(?:getInstance|get_instance|INSTANCE)\s*\(\s*\)/g },
        // Visitor pattern (usually overkill)
        { regex: /interface\s+\w+Visitor\b/g },
        // Builder for classes with < 4 fields
        { regex: /class\s+\w+Builder\b/g },
        // Multiple layers of abstraction (Manager of a Manager)
        { regex: /class\s+\w+(?:Manager|Service|Handler|Controller)(?:Manager|Service|Handler|Controller)\b/g },
      ],

      repetitive_boilerplate: [
        // 3+ consecutive similar function signatures
        { regex: /(?:function\s+\w+\s*\([^)]*\)\s*\{[^}]{0,100}\}\s*\n?\s*){3,}/gm },
        // 3+ consecutive similar method signatures in a class
        { regex: /(?:(?:public|private|protected)\s+\w+\s+\w+\s*\([^)]*\)\s*\{[^}]{0,100}\}\s*\n?\s*){3,}/gm },
        // Python: 3+ consecutive similar def statements
        { regex: /(?:def\s+\w+\s*\([^)]*\)\s*:.*\n(?:\s+.*\n){0,3}){3,}/gm },
      ],

      ignoring_language_conventions: [
        // camelCase in Python (should be snake_case)
        ...(language === "python" ? [
          { regex: /def\s+[a-z]+[A-Z]\w+\s*\(/g },
          // Java-style getters in Python
          { regex: /def\s+get[A-Z]\w+\s*\(\s*self\s*\)/g },
          // Semicolons at end of lines in Python
          { regex: /^\s*[a-zA-Z]\w*[^#\n]*;\s*$/gm },
        ] : []),
        // snake_case in Java/C#/TypeScript (should be camelCase for methods)
        ...(language === "java" || language === "csharp" || language === "typescript" ? [
          { regex: /(?:public|private|protected)\s+\w+\s+[a-z]+_[a-z]+\w*\s*\(/g },
        ] : []),
        // ALL_CAPS for non-constants (let/var but not const)
        ...(language === "typescript" || language === "csharp" || language === "java" ? [
          { regex: /(?:let|var)\s+[A-Z][A-Z_]{2,}\s*=/g },
        ] : []),
      ],

      untestable_structure: [
        // new in the middle of business logic (should be injected)
        { regex: /(?:if|else|for|while|switch)\s*[({][\s\S]{0,200}new\s+\w+\s*\(/gm },
        // Hard-coded file paths in logic
        { regex: /(?:readFile|writeFile|open|fopen)\s*\(\s*["'][^"']+["']\s*\)/g },
        // Direct static class method calls on concrete dependencies
        { regex: /(?:Database|HttpClient|FileSystem|Cache|Redis|Mongo)\.\w+\s*\(/g },
        // Global/singleton access patterns
        { regex: /(?:getInstance|getDefault|shared|current)\s*\(\s*\)\.\w+/g },
      ],

      magic_numbers: [
        // Timeout/delay with hardcoded ms values
        { regex: /(?:setTimeout|setInterval|delay|sleep|wait)\s*\([^,]*,\s*\d{3,}\s*\)/g },
        // Hardcoded retry counts / limits in conditions
        { regex: /(?:retries?|attempts?|maxRetries|max_retries)\s*[<>=!]+\s*\d+/gi },
        // Hardcoded port numbers in assignments
        { regex: /(?:port|PORT)\s*[:=]\s*\d{4,5}\b/g },
        // Hardcoded HTTP status codes in comparisons
        { regex: /===?\s*(?:200|201|301|302|400|401|403|404|500|503)\b/g },
        // Numeric literal in multiplication/division (likely a conversion factor)
        { regex: /\*\s*(?:60|24|1000|1024|3600|86400)\b/g },
      ],

      missing_return_type: [
        // TypeScript function without return type
        ...(language === "typescript" ? [
          { regex: /(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{/g },
          // Arrow function without return type
          { regex: /const\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g },
        ] : []),
        // Python function without type hints on return
        ...(language === "python" ? [
          { regex: /def\s+\w+\s*\([^)]*\)\s*:/g },
        ] : []),
      ],

      // ── C++ patterns ──

      use_smart_pointers: [
        // new Type(...) or new Type[...]
        { regex: /\bnew\s+\w+\s*[(<\[]/g },
        // delete or delete[]
        { regex: /\bdelete\s*\[?\]?\s*\w+/g },
        // Raw pointer declarations for owned resources
        { regex: /\w+\s*\*\s*\w+\s*=\s*new\b/g },
      ],

      use_raii: [
        // Manual lock/unlock pairs
        { regex: /\.lock\s*\(\s*\)[\s\S]*?\.unlock\s*\(\)/g },
        // Manual fopen/fclose pairs
        { regex: /\bfopen\s*\([\s\S]*?fclose\s*\(/g },
        // Manual malloc/free pairs
        { regex: /\bmalloc\s*\(/g },
        { regex: /\bfree\s*\(/g },
      ],

      const_correctness: [
        // Non-const method that could be const (heuristic: getter-like pattern)
        { regex: /\b(?:int|float|double|bool|string|size_t|auto)\s+get\w+\s*\(\s*\)\s*(?!const)\s*\{/g },
        // Pass by value for large types (vector, string, map) — should be const&
        { regex: /\b(?:std::)?(?:vector|string|map|unordered_map|set|list|deque)\s*<[^>]*>\s+\w+\s*[,)]/g },
      ],

      prefer_algorithms: [
        // Manual for loop with index that looks like a search
        { regex: /for\s*\(\s*(?:int|size_t|auto)\s+\w+\s*=\s*0\s*;[^;]*;\s*\w+\+\+\s*\)\s*\{[\s\S]*?if\s*\(/gm },
      ],

      move_semantics: [
        // String parameter by const ref that gets copied into member
        { regex: /\(\s*const\s+std::string\s*&\s*\w+\s*\)[\s\S]{0,100}\w+_\s*=\s*\w+\s*;/gm },
      ],

      use_string_view: [
        // const string& param that's only read
        { regex: /\(\s*const\s+std::string\s*&\s*\w+\s*\)/g },
      ],

      c_style_casts: [
        // (Type)expr — but not sizeof(Type) or function calls
        { regex: /(?<!\w)\(\s*(?:int|float|double|long|char|unsigned|short|void\s*\*)\s*\)\s*\w+/g },
      ],

      using_namespace_std: [
        { regex: /using\s+namespace\s+std\s*;/g },
      ],

      raw_c_arrays: [
        // int arr[N] style declarations
        { regex: /\b(?:int|float|double|char|long|short|unsigned)\s+\w+\s*\[\s*\d+\s*\]/g },
      ],

      raw_c_strings: [
        // const char* parameters
        { regex: /\bconst\s+char\s*\*\s*\w+/g },
      ],

      endl_overuse: [
        { regex: /<<\s*std::endl/g },
        { regex: /<<\s*endl/g },
      ],

      macro_overuse: [
        // #define for constants (should use constexpr)
        { regex: /#define\s+[A-Z_]+\s+\d+/g },
        // #define for simple functions (should use inline/constexpr)
        { regex: /#define\s+\w+\s*\([^)]*\)\s+/g },
      ],

      goto_usage: [
        { regex: /\bgoto\s+\w+/g },
      ],

      printf_usage: [
        // printf/sprintf/fprintf in C++ (use std::format or streams)
        { regex: /\b(?:printf|sprintf|fprintf|snprintf)\s*\(/g },
      ],
      // ── C# patterns ──

      use_using_disposable: [
        // Common disposable types created without using
        { regex: /(?:var|(?:File|Stream|Sql|Http)\w+)\s+\w+\s*=\s*new\s+(?:FileStream|StreamReader|StreamWriter|SqlConnection|SqlCommand|HttpClient|MemoryStream|BinaryReader|BinaryWriter)\s*\(/g },
      ],

      async_await_properly: [
        // .Result blocking
        { regex: /\.Result\b/g },
        // .Wait() blocking
        { regex: /\.Wait\s*\(\s*\)/g },
        // .GetAwaiter().GetResult() blocking
        { regex: /\.GetAwaiter\s*\(\s*\)\s*\.GetResult\s*\(\s*\)/g },
        // async void (except event handlers)
        { regex: /async\s+void\s+(?!On\w+|Handle\w+)\w+/g },
      ],

      nullable_reference_types: [
        // Dereferencing without null check (basic heuristic)
        { regex: /\?\.\w+\.\w+(?!\?)/g },
      ],

      use_pattern_matching: [
        // Old-style cast after is check
        { regex: /if\s*\(\s*\w+\s+is\s+\w+\s*\)[\s\S]{0,50}\(\w+\)\s*\w+/gm },
      ],

      use_records_for_data: [
        // Class with only get/set properties and no methods (heuristic)
        { regex: /class\s+\w+\s*\{[\s\n]*(?:\s*public\s+\w+\s+\w+\s*\{\s*get;\s*set;\s*\}\s*\n?){3,}\s*\}/gm },
      ],

      string_concatenation_loop: [
        // += on string inside a loop
        { regex: /(?:for|foreach|while)\s*\([^)]*\)\s*\{[\s\S]*?\w+\s*\+=\s*["'`]/gm },
      ],

      empty_catch_rethrow: [
        // catch (Exception ex) { throw ex; } — loses stack trace
        { regex: /catch\s*\(\s*\w+\s+(\w+)\s*\)\s*\{[\s\n]*throw\s+\1\s*;[\s\n]*\}/gm },
      ],

      god_class_csharp: [
        // Class with too many methods (heuristic: 10+ public methods)
        { regex: /class\s+\w+[\s\S]*?(?:public\s+\w+\s+\w+\s*\([\s\S]*?\{[\s\S]*?\}[\s\S]*?){10,}/gm },
      ],

      linq_misuse: [
        // Multiple .Where().Where() chains (should combine predicates)
        { regex: /\.Where\s*\([^)]*\)\s*\.Where\s*\(/g },
        // .Count() > 0 instead of .Any()
        { regex: /\.Count\s*\(\s*\)\s*>\s*0/g },
        // .ToList() in the middle of a chain
        { regex: /\.ToList\s*\(\s*\)\s*\.\w+\s*\(/g },
      ],

      new_list_add_range: [
        // new List<T>() followed by AddRange or loop
        { regex: /new\s+List\s*<[^>]+>\s*\(\s*\)[\s\S]{0,50}\.AddRange\s*\(/gm },
      ],
      // ── Python patterns ──

      no_mutable_defaults: [
        // def f(x=[])
        { regex: /def\s+\w+\s*\([^)]*=\s*\[\s*\]/g },
        // def f(x={})
        { regex: /def\s+\w+\s*\([^)]*=\s*\{\s*\}/g },
        // def f(x=set())
        { regex: /def\s+\w+\s*\([^)]*=\s*set\s*\(\s*\)/g },
      ],

      use_context_managers: [
        // open() not in a with statement
        { regex: /^\s*\w+\s*=\s*open\s*\(/gm },
        // Manual .close() calls
        { regex: /\.\s*close\s*\(\s*\)/g },
      ],

      use_type_hints: [
        // def with no type annotations at all
        { regex: /def\s+\w+\s*\(\s*(?:self\s*,\s*)?\w+\s*(?:,\s*\w+\s*)*\)\s*:/g },
      ],

      use_dataclasses: [
        // __init__ that only assigns self.x = x
        { regex: /def\s+__init__\s*\(\s*self\s*(?:,\s*\w+\s*)+\)\s*:[\s\n]*(?:\s*self\.\w+\s*=\s*\w+\s*\n?){3,}/gm },
      ],

      use_pathlib: [
        // os.path.join, os.path.exists, etc.
        { regex: /os\.path\.\w+/g },
      ],

      use_properties: [
        // get_x / set_x method pairs (Java-style)
        { regex: /def\s+(?:get|set)_\w+\s*\(\s*self/g },
      ],

      use_generators: [
        // Building a list just to return it (append in loop then return)
        { regex: /\w+\s*=\s*\[\s*\][\s\S]*?\.append\s*\([\s\S]*?return\s+\w+/gm },
      ],

      bare_except: [
        // except: without exception type
        { regex: /except\s*:\s*$/gm },
      ],

      star_import: [
        // from X import *
        { regex: /from\s+\w+(?:\.\w+)*\s+import\s+\*/g },
      ],

      global_variable: [
        // global keyword in function
        { regex: /^\s+global\s+\w+/gm },
      ],

      string_format_percent: [
        // '%s' % or '%d' % formatting
        { regex: /['"][^'"]*%[sdfrx][^'"]*['"]\s*%\s*/g },
      ],

      // Python AI mistakes
      unnecessary_list_comprehension: [
        { regex: /\[\s*\w+\s+for\s+\w+\s+in\s+\w+\s*\]/g },
      ],

      manual_string_building: [
        { regex: /(?:for|while)\s.*:\s*\n(?:\s+.*\n)*?\s+\w+\s*\+=\s*(?:"|'|f")/gm },
      ],

      dict_get_with_none_default: [
        { regex: /\.get\s*\(\s*\w+\s*,\s*None\s*\)/g },
      ],

      assert_in_production: [
        // assert used for input validation (not testing)
        { regex: /^\s*assert\s+\w+/gm },
      ],

      mutable_class_variable: [
        // Class-level list/dict/set (shared across instances)
        { regex: /class\s+\w+[^:]*:\s*\n(?:\s+(?:"""[\s\S]*?"""|#[^\n]*)?\n)*\s+\w+\s*(?::\s*(?:list|dict|List|Dict))?\s*=\s*(?:\[\s*\]|\{\s*\}|set\s*\(\s*\))/gm },
      ],

      len_comparison: [
        // if len(x) == 0 instead of if not x
        { regex: /if\s+len\s*\(\s*\w+\s*\)\s*==\s*0/g },
        // if len(x) > 0 instead of if x
        { regex: /if\s+len\s*\(\s*\w+\s*\)\s*>\s*0/g },
        // if len(x) != 0 instead of if x
        { regex: /if\s+len\s*\(\s*\w+\s*\)\s*!=\s*0/g },
      ],

      manual_dict_check: [
        // if key in dict: value = dict[key] instead of dict.get(key)
        { regex: /if\s+\w+\s+in\s+\w+\s*:[\s\n]+\w+\s*=\s*\w+\[\w+\]/gm },
      ],

      type_comparison: [
        // type(x) == instead of isinstance
        { regex: /type\s*\(\s*\w+\s*\)\s*==\s*/g },
        // type(x) is instead of isinstance
        { regex: /type\s*\(\s*\w+\s*\)\s+is\s+/g },
      ],

      // ── TypeScript patterns ──

      no_any_leakage: [
        // Explicit any annotation
        { regex: /:\s*any\b/g },
        // as any cast
        { regex: /\bas\s+any\b/g },
        // Function parameter with any
        { regex: /\(\s*\w+\s*:\s*any\b/g },
        // Array of any
        { regex: /:\s*any\s*\[\s*\]/g },
        // Promise<any>
        { regex: /Promise\s*<\s*any\s*>/g },
      ],

      no_as_casts: [
        // as Type (but not as const)
        { regex: /\bas\s+(?!const\b)[A-Z]\w+/g },
        // Double assertion: as unknown as Type
        { regex: /as\s+unknown\s+as\s+\w+/g },
      ],

      async_error_handling: [
        // await without surrounding try/catch (heuristic — bare await in function body)
        { regex: /async\s+function\s+\w+[^{]*\{(?:(?!try)[\s\S])*?await\s+/gm },
        // .then() without .catch()
        { regex: /\.then\s*\([^)]*\)(?!\s*\.catch)/g },
      ],

      use_strict_mode: [
        // strict: false in tsconfig
        { regex: /"strict"\s*:\s*false/g },
        // noImplicitAny: false
        { regex: /"noImplicitAny"\s*:\s*false/g },
      ],

      use_discriminated_unions: [
        // Interface with many optional fields (4+ optional ? properties)
        { regex: /interface\s+\w+\s*\{(?:\s*\w+\?:\s*\w+\s*;?\s*){4,}\}/gm },
      ],

      prefer_readonly: [
        // Class properties assigned only in constructor (heuristic)
        { regex: /(?:private|protected|public)\s+(?!readonly)\w+\s*:\s*\w+/g },
      ],

      non_null_assertion: [
        // x! non-null assertion (but not !== or !=)
        { regex: /\w+\s*!\s*\./g },
        { regex: /\w+\s*!\s*\[/g },
      ],

      console_log_in_production: [
        { regex: /console\.log\s*\(/g },
      ],

      callback_hell: [
        // 3+ levels of nested function callbacks
        { regex: /function\s*\([^)]*\)\s*\{[\s\S]*?function\s*\([^)]*\)\s*\{[\s\S]*?function\s*\([^)]*\)\s*\{/gm },
        { regex: /=>\s*\{[\s\S]*?=>\s*\{[\s\S]*?=>\s*\{/gm },
      ],

      enum_antipattern: [
        { regex: /\benum\s+\w+\s*\{/g },
      ],

      index_signature_overuse: [
        // [key: string]: any
        { regex: /\[\s*\w+\s*:\s*string\s*\]\s*:\s*any/g },
        // [key: string]: unknown (still suspect)
        { regex: /\[\s*\w+\s*:\s*string\s*\]\s*:\s*unknown/g },
      ],

      promise_constructor_antipattern: [
        // new Promise wrapping an already-async operation
        { regex: /new\s+Promise\s*\(\s*(?:async\s+)?\(\s*resolve\s*,?\s*reject?\s*\)\s*=>\s*\{[\s\S]{0,200}await\s+/gm },
        // new Promise wrapping a .then chain
        { regex: /new\s+Promise\s*\(\s*\(\s*resolve[\s\S]{0,200}\.then\s*\(/gm },
      ],

      object_spread_mutation: [
        // Spreading then immediately overwriting all properties
        { regex: /\{\s*\.\.\.\w+\s*,(?:\s*\w+\s*:\s*[^,}]+\s*,?){5,}\s*\}/gm },
      ],

      implicit_any_return: [
        // Function that sometimes returns undefined implicitly
        { regex: /function\s+\w+\s*\([^)]*\)(?::\s*\w+)?\s*\{[\s\S]*?return\s+\w[\s\S]*?^\s*\}$/gm },
      ],

      typeof_guard_misuse: [
        // typeof x === "object" without null check
        { regex: /typeof\s+\w+\s*===?\s*["']object["'](?!\s*&&\s*\w+\s*!==?\s*null)/g },
      ],
      // ── Java patterns ──

      use_try_with_resources: [
        // AutoCloseable types created without try-with-resources
        { regex: /(?:InputStream|OutputStream|Connection|Reader|Writer|Socket|Channel|ResultSet|PreparedStatement)\s+\w+\s*=\s*new\b/g },
      ],

      use_optional_properly: [
        // Return null where Optional should be used
        { regex: /return\s+null\s*;/g },
        // Optional used as parameter type
        { regex: /\(\s*(?:final\s+)?Optional\s*<[^>]+>\s+\w+/g },
      ],

      use_records: [
        // Class with only private final fields and getters (data carrier)
        { regex: /class\s+\w+\s*\{[\s\n]*(?:\s*private\s+final\s+\w+\s+\w+\s*;\s*\n?){3,}/gm },
      ],

      use_stream_api: [
        // for loop building a new list with add()
        { regex: /for\s*\([^)]*\)\s*\{[\s\S]*?\.add\s*\(/gm },
      ],

      use_switch_expressions: [
        // Old-style switch with break
        { regex: /switch\s*\([^)]*\)\s*\{[\s\S]*?break\s*;/gm },
      ],

      no_checked_exception_abuse: [
        // throws Exception (too broad)
        { regex: /throws\s+Exception\b(?!\w)/g },
        // throws multiple exceptions
        { regex: /throws\s+\w+\s*,\s*\w+\s*,\s*\w+/g },
      ],

      string_concatenation_loop_java: [
        // += on String inside loop
        { regex: /(?:for|while)\s*\([^)]*\)\s*\{[\s\S]*?\w+\s*\+=\s*"/gm },
      ],

      raw_types: [
        // Raw List, Map, Set without type parameter
        { regex: /\b(?:List|Map|Set|Collection|ArrayList|HashMap|HashSet)\s+\w+\s*=/g },
      ],

      catching_throwable: [
        { regex: /catch\s*\(\s*(?:Throwable|Error)\s+\w+\s*\)/g },
      ],

      system_exit_in_library: [
        { regex: /System\.exit\s*\(/g },
      ],

      synchronized_method: [
        // synchronized on whole method (usually too coarse)
        { regex: /public\s+synchronized\s+\w+\s+\w+\s*\(/g },
      ],

      string_equals_order: [
        // variable.equals("literal") — risk of NPE, should be "literal".equals(variable)
        { regex: /\w+\.equals\s*\(\s*["'][^"']*["']\s*\)/g },
      ],

      concatenation_in_logger: [
        // logger.info("msg" + var) instead of logger.info("msg {}", var)
        { regex: /logger\.\w+\s*\(\s*"[^"]*"\s*\+\s*\w+/g },
        { regex: /log\.\w+\s*\(\s*"[^"]*"\s*\+\s*\w+/g },
      ],

      field_injection: [
        // @Autowired on field (prefer constructor injection)
        { regex: /@Autowired\s*\n\s*(?:private|protected)\s+\w+/g },
        // @Inject on field
        { regex: /@Inject\s*\n\s*(?:private|protected)\s+\w+/g },
      ],

      // ── C++ AI mistakes ──

      unnecessary_this: [
        { regex: /this\s*->\s*\w+/g },
      ],

      iostream_for_logging: [
        // std::cout for what looks like logging
        { regex: /std::cout\s*<<\s*["'](?:Error|Warning|Info|Debug|Log)/g },
      ],

      // ── C# AI mistakes ──

      string_interpolation_over_format: [
        { regex: /String\.Format\s*\(/g },
        { regex: /string\.Format\s*\(/g },
      ],

      task_run_for_async: [
        { regex: /Task\.Run\s*\(\s*(?:async\s*)?\(\s*\)\s*=>/g },
      ],

      // ── Python AI mistakes ──

      unnecessary_else_after_return: [
        { regex: /return\s+\w[^;\n]*\n\s*else\s*:/gm },
      ],

      // ── TypeScript AI mistakes ──

      unnecessary_type_assertion: [
        // as Type on JSON.parse result
        { regex: /JSON\.parse\s*\([^)]*\)\s*as\s+\w+/g },
        // as Type on fetch response
        { regex: /\.json\s*\(\s*\)\s*(?:as\s+\w+|then)/g },
      ],

      empty_interface: [
        { regex: /interface\s+\w+\s*(?:extends\s+\w+\s*)?\{\s*\}/g },
      ],

      unnecessary_async: [
        // async function with no await inside (heuristic: small function body)
        { regex: /async\s+(?:function\s+\w+|(?:\w+\s*=\s*async))\s*\([^)]*\)\s*(?::\s*\w+[^{]*)?\{[^}]{0,200}\}(?![\s\S]{0,5}await)/gm },
      ],

      relative_import_hell: [
        // 3+ levels of ../
        { regex: /from\s+['"](?:\.\.\/){3,}/g },
        { regex: /import\s+.*['"](?:\.\.\/){3,}/g },
        { regex: /require\s*\(\s*['"](?:\.\.\/){3,}/g },
      ],

      // ── Java AI mistakes ──

      unnecessary_boxing: [
        // Integer x = instead of int x =
        { regex: /\b(?:Integer|Long|Double|Float|Boolean|Character)\s+\w+\s*=\s*(?!\s*null)/g },
      ],

      verbose_null_checks: [
        // Nested null checks
        { regex: /if\s*\(\s*\w+\s*!=\s*null\s*\)\s*\{[\s\n]*if\s*\(\s*\w+\.\w+\s*!=\s*null\s*\)/gm },
      ],

      mutable_collections_exposed: [
        // return this.list or return list (field)
        { regex: /return\s+(?:this\.)?\w+(?:List|Set|Map|Items|Collection|Elements)\s*;/g },
      ],
    };

    return patternMap[rule.name] ?? [];
  }
}
