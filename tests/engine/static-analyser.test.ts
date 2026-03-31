import { describe, it, expect } from "vitest";
import { StaticAnalyser } from "../../src/engine/static-analyser.js";

describe("StaticAnalyser", () => {
  const analyser = new StaticAnalyser();

  describe("getRulesForLanguage", () => {
    it("returns global rules for any language", () => {
      const rules = analyser.getRulesForLanguage("typescript");
      const globalIds = rules.filter((r) => r.id?.startsWith("G"));
      expect(globalIds.length).toBeGreaterThan(0);
    });

    it("returns language-specific rules", () => {
      const tsRules = analyser.getRulesForLanguage("typescript");
      const tsIds = tsRules.filter((r) => r.id?.startsWith("TS"));
      expect(tsIds.length).toBeGreaterThan(0);
    });

    it("includes cpp rules for cpp language", () => {
      const rules = analyser.getRulesForLanguage("cpp");
      const cppIds = rules.filter((r) => r.id?.startsWith("CPP"));
      expect(cppIds.length).toBeGreaterThan(0);
    });

    it("does not mix language rules", () => {
      const pyRules = analyser.getRulesForLanguage("python");
      const cppIds = pyRules.filter((r) => r.id?.startsWith("CPP"));
      expect(cppIds.length).toBe(0);
    });
  });

  describe("analyseCode", () => {
    it("detects empty catch blocks", () => {
      const code = `try { doSomething(); } catch (e) { }`;
      const issues = analyser.analyseCode("typescript", code);
      const swallowing = issues.find((i) => i.type === "exception_swallowing");
      expect(swallowing).toBeDefined();
    });

    it("detects any type in TypeScript", () => {
      const code = `function parse(data: any) { return data.name; }`;
      const issues = analyser.analyseCode("typescript", code);
      const anyLeak = issues.find((i) => i.type === "no_any_leakage");
      expect(anyLeak).toBeDefined();
    });

    it("detects raw new/delete in C++", () => {
      const code = `Widget* w = new Widget();`;
      const issues = analyser.analyseCode("cpp", code);
      const rawNew = issues.find((i) => i.type === "use_smart_pointers");
      expect(rawNew).toBeDefined();
    });

    it("detects mutable defaults in Python", () => {
      const code = `def add_item(item, items=[]):\n    items.append(item)`;
      const issues = analyser.analyseCode("python", code);
      const mutable = issues.find((i) => i.type === "no_mutable_defaults");
      expect(mutable).toBeDefined();
    });

    it("detects .Result in C#", () => {
      const code = `var data = GetDataAsync().Result;`;
      const issues = analyser.analyseCode("csharp", code);
      const blocking = issues.find((i) => i.type === "async_await_properly");
      expect(blocking).toBeDefined();
    });

    it("returns no issues for clean code", () => {
      const code = `const x: number = 42;\nconst y: string = "hello";`;
      const issues = analyser.analyseCode("typescript", code);
      // Clean code should have few or no issues
      const errors = issues.filter((i) => i.severity === "error");
      expect(errors.length).toBe(0);
    });
  });

  describe("getGuidance", () => {
    it("returns a test framework recommendation", () => {
      const guidance = analyser.getGuidance("python", "build a REST API");
      expect(guidance.testFramework).toBe("pytest");
    });

    it("returns idioms for the language", () => {
      const guidance = analyser.getGuidance("cpp", "implement a data structure");
      expect(guidance.idioms.length).toBeGreaterThan(0);
    });
  });

  describe("language-aware patterns", () => {
    it("does not flag semicolons in TypeScript as convention violation", () => {
      const code = `const x: number = 42;\nconst y: string = "hello";`;
      const issues = analyser.analyseCode("typescript", code);
      const conv = issues.find((i) => i.type === "ignoring_language_conventions");
      expect(conv).toBeUndefined();
    });

    it("flags semicolons in Python as convention violation", () => {
      const code = `x = 42;\ny = "hello";`;
      const issues = analyser.analyseCode("python", code);
      const conv = issues.find((i) => i.type === "ignoring_language_conventions");
      expect(conv).toBeDefined();
    });

    it("flags camelCase functions in Python", () => {
      const code = `def getUserName(self):\n    return self.name`;
      const issues = analyser.analyseCode("python", code);
      const conv = issues.find((i) => i.type === "ignoring_language_conventions");
      expect(conv).toBeDefined();
    });
  });

  describe("expanded detections", () => {
    it("detects lodash as dependency bloat", () => {
      const code = `import _ from "lodash";\nconst result = _.map(items, fn);`;
      const issues = analyser.analyseCode("typescript", code);
      const bloat = issues.find((i) => i.type === "dependency_bloat");
      expect(bloat).toBeDefined();
    });

    it("detects hardcoded secrets", () => {
      const code = `const key = "sk_live_abc123_secret_key";`;
      const issues = analyser.analyseCode("typescript", code);
      const hardcoded = issues.find((i) => i.type === "hardcoded_configuration");
      expect(hardcoded).toBeDefined();
    });

    it("detects goto in C++", () => {
      const code = `if (err) goto cleanup;\ncleanup:\n  free(ptr);`;
      const issues = analyser.analyseCode("cpp", code);
      const gotoIssue = issues.find((i) => i.type === "goto_usage");
      expect(gotoIssue).toBeDefined();
    });

    it("detects macro overuse in C++", () => {
      const code = `#define MAX_SIZE 1024\n#define SQUARE(x) ((x) * (x))`;
      const issues = analyser.analyseCode("cpp", code);
      const macro = issues.find((i) => i.type === "macro_overuse");
      expect(macro).toBeDefined();
    });

    it("detects len comparison in Python", () => {
      const code = `if len(items) == 0:\n    print("empty")`;
      const issues = analyser.analyseCode("python", code);
      const lenCheck = issues.find((i) => i.type === "len_comparison");
      expect(lenCheck).toBeDefined();
    });

    it("detects type() comparison in Python", () => {
      const code = `if type(x) == int:\n    process(x)`;
      const issues = analyser.analyseCode("python", code);
      const typeCheck = issues.find((i) => i.type === "type_comparison");
      expect(typeCheck).toBeDefined();
    });

    it("detects typeof without null check in TypeScript", () => {
      const code = `if (typeof x === "object") { x.prop; }`;
      const issues = analyser.analyseCode("typescript", code);
      const guard = issues.find((i) => i.type === "typeof_guard_misuse");
      expect(guard).toBeDefined();
    });

    it("detects string.equals order in Java", () => {
      const code = `if (name.equals("admin")) { grant(); }`;
      const issues = analyser.analyseCode("java", code);
      const order = issues.find((i) => i.type === "string_equals_order");
      expect(order).toBeDefined();
    });

    it("detects field injection in Java", () => {
      const code = `@Autowired\nprivate UserService userService;`;
      const issues = analyser.analyseCode("java", code);
      const injection = issues.find((i) => i.type === "field_injection");
      expect(injection).toBeDefined();
    });

    it("detects LINQ misuse in C#", () => {
      const code = `var count = items.Count() > 0;`;
      const issues = analyser.analyseCode("csharp", code);
      const linq = issues.find((i) => i.type === "linq_misuse");
      expect(linq).toBeDefined();
    });

    it("detects console.log in TypeScript", () => {
      const code = `console.log("debug:", userData);`;
      const issues = analyser.analyseCode("typescript", code);
      const log = issues.find((i) => i.type === "console_log_in_production");
      expect(log).toBeDefined();
    });

    it("detects non-null assertion in TypeScript", () => {
      const code = `const name = user!.profile!.name;`;
      const issues = analyser.analyseCode("typescript", code);
      const assertion = issues.find((i) => i.type === "non_null_assertion");
      expect(assertion).toBeDefined();
    });
  });

  describe("security detections", () => {
    it("detects SQL injection via string concatenation", () => {
      const code = `db.query("SELECT * FROM users WHERE id = " + userId);`;
      const issues = analyser.analyseCode("typescript", code);
      const sql = issues.find((i) => i.type === "sql_injection");
      expect(sql).toBeDefined();
    });

    it("detects innerHTML XSS vulnerability", () => {
      const code = `element.innerHTML = userInput;`;
      const issues = analyser.analyseCode("typescript", code);
      const xss = issues.find((i) => i.type === "xss_vulnerability");
      expect(xss).toBeDefined();
    });

    it("detects dangerouslySetInnerHTML", () => {
      const code = `<div dangerouslySetInnerHTML={{ __html: content }} />`;
      const issues = analyser.analyseCode("typescript", code);
      const xss = issues.find((i) => i.type === "xss_vulnerability");
      expect(xss).toBeDefined();
    });

    it("detects SQL injection via template literal", () => {
      const code = "db.query(`SELECT * FROM users WHERE name = ${name}`);";
      const issues = analyser.analyseCode("typescript", code);
      const sql = issues.find((i) => i.type === "sql_injection");
      expect(sql).toBeDefined();
    });

    it("detects database connection string hardcoded", () => {
      const code = `const url = "postgresql://admin:pass@prod.db.com:5432/mydb";`;
      const issues = analyser.analyseCode("typescript", code);
      const hardcoded = issues.find((i) => i.type === "hardcoded_configuration");
      expect(hardcoded).toBeDefined();
    });
  });
});
