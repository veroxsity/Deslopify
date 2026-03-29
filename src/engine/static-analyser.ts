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
        { regex: /JSON\.parse\s*\([^)]*\)(?!\s*(?:catch|\.catch))/g },
        // parseInt/parseFloat without NaN check
        { regex: /(?:parseInt|parseFloat)\s*\([^)]*\)(?!\s*(?:if|&&|\|\||isNaN|Number\.isNaN))/g },
        // Division without zero check (basic)
        { regex: /\w+\s*\/\s*\w+(?!\s*(?:if|&&|\?|:|\|\|))/g },
        // Array index access without bounds check
        { regex: /\w+\[\s*\w+\s*\](?!\s*(?:\?\.|if|&&|\|\|))/g },
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
      ],

      repetitive_boilerplate: [
        // 3+ consecutive similar function signatures
        { regex: /(?:function\s+\w+\s*\([^)]*\)\s*\{[^}]{0,100}\}\s*\n?\s*){3,}/gm },
      ],

      ignoring_language_conventions: [
        // Java-style getters in Python
        { regex: /def\s+get[A-Z]\w+\s*\(\s*self\s*\)/g },
        // Semicolons at end of lines in Python
        { regex: /^\s*\w[^#\n]*;\s*$/gm },
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
