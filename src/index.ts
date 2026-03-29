#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { createServer } from "./server.js";
import { loadConfig } from "./types/config.js";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.transport === "sse") {
    const app = express();
    const server = createServer();
    let transport: SSEServerTransport | null = null;

    app.get("/sse", async (req, res) => {
      transport = new SSEServerTransport("/messages", res);
      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      if (!transport) {
        res.status(400).json({ error: "No SSE connection established" });
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    app.get("/", (_req, res) => {
      res.json({
        name: "deslopify",
        version: "0.1.0",
        status: "running",
        description: "Universal MCP code quality gate for AI assistants",
        endpoints: { sse: "/sse", messages: "/messages" },
      });
    });

    app.listen(config.port, () => {
      console.error(`Deslopify running on port ${config.port}`);
    });
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Deslopify running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
