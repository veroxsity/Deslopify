# Deslopify

**Stop AI slop at the source.**

A universal [MCP](https://modelcontextprotocol.io) server that acts as a code quality gate for AI assistants. Deslopify gives AI coding tools pre-generation guidance, post-generation review, and root cause analysis — so the code you get is idiomatic, generic, tested, and actually fixes the right problem.

🌐 [deslopify.dev](https://deslopify.dev) · 📦 [npm](https://www.npmjs.com/package/deslopify) · 🐙 [GitHub](https://github.com/veroxsity/deslopify)

## The Problem

AI assistants generate code that technically works but is often:

- **Hyper-specific** — hardcoded to one type or use case instead of generic
- **Symptom-patching** — fixes the reported bug but ignores the root cause
- **Non-idiomatic** — uses patterns from the wrong language
- **Untested** — no error handling, no edge cases, no tests
- **Hallucinated** — references APIs that don't exist in the target version

There's no feedback loop telling the AI *"that's slop, do better."* Deslopify is that feedback loop.

## How It Works

Deslopify is an MCP server. Any MCP-compatible AI client connects to it and gets access to **tools**, **prompts**, and **resources** that enforce code quality.

```
┌──────────────────────────────┐
│  AI Client                   │
│  (Claude, Cursor, Windsurf)  │
└──────────┬───────────────────┘
           │ MCP
┌──────────▼───────────────────┐
│  Deslopify MCP Server        │
│                              │
│  ┌─────────┐ ┌────────────┐  │
│  │  Tools  │ │  Prompts   │  │
│  └─────────┘ └────────────┘  │
│  ┌─────────┐ ┌────────────┐  │
│  │ Rules   │ │ Resources  │  │
│  └─────────┘ └────────────┘  │
└──────────────────────────────┘
```

## Quick Start

```bash
npx deslopify
```

Or install globally:

```bash
npm install -g deslopify
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "deslopify": {
      "command": "npx",
      "args": ["-y", "deslopify"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add deslopify npx deslopify
```

## Tools

| Tool | When to Call | What It Does |
|------|-------------|--------------|
| `get_guidance` | Before writing code | Returns language idioms, pitfalls, and architecture notes |
| `review_code` | After writing code | Scores code quality, lists issues with severity and fix suggestions |
| `validate_approach` | Before fixing a bug | Detects symptom-only fixes and traces root causes |
| `suggest_tests` | After writing code | Generates test cases with framework-specific skeletons |
| `check_dependencies` | When adding packages | Flags abandoned, overkill, or deprecated dependencies |
| `check_api_exists` | When using unfamiliar APIs | Verifies APIs exist in the target language version |

## Supported Languages

- **C++** (C++17/20/23) — RAII, smart pointers, const correctness, ranges, move semantics
- **C#** (.NET 6/7/8+) — using/IDisposable, async/await, nullable refs, LINQ, DI, records
- **Python** (3.10+) — context managers, type hints, dataclasses, pathlib, generators
- **Java** (17/21+) — try-with-resources, records, Optional, Stream API, switch expressions
- **TypeScript** (5.x+) — strict mode, no any, discriminated unions, proper async, zod validation

## Prompts

Deslopify includes 4 prompt templates accessible via the MCP prompt menu:

- **Deslopify: Before Writing Code** — pre-generation guidance
- **Deslopify: After Writing Code** — post-generation review loop
- **Deslopify: Before Fixing a Bug** — root cause validation
- **Deslopify: Full Quality Workflow** — complete guidance → review → test pipeline

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DESLOPIFY_STRICTNESS` | `medium` | `low` / `medium` / `high` |
| `DESLOPIFY_TRANSPORT` | `stdio` | `stdio` / `sse` |
| `DESLOPIFY_PORT` | `3000` | Port for SSE transport |
| `ANTHROPIC_API_KEY` | — | Required for medium/high strictness AI layer |

## Docker

```bash
docker run -d --name deslopify \
  -e DESLOPIFY_TRANSPORT=sse \
  -e DESLOPIFY_PORT=3000 \
  -p 3000:3000 \
  ghcr.io/veroxsity/deslopify:latest
```

## Contributing

Rules are the heart of Deslopify. To add a new rule:

1. Fork the repo
2. Add your rule to the appropriate JSON file in `rules/`
3. Include: id, severity, description, detection, fix, bad example, good example
4. Open a PR

See [DESIGN.md](DESIGN.md) for the full architecture and rule schema.

## License

[MIT](LICENSE) © [veroxsity](https://github.com/veroxsity)
