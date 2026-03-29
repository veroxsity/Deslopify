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
});
