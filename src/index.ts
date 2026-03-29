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

    // CORS for MCP Inspector and remote clients
    app.use((_req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Accept");
      if (_req.method === "OPTIONS") {
        res.sendStatus(200);
        return;
      }
      next();
    });

    const transports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (req, res) => {
      console.error(`[SSE] New connection from ${req.ip}`);
      try {
        const server = createServer();
        const transport = new SSEServerTransport("/messages", res);
        console.error(`[SSE] Session created: ${transport.sessionId}`);
        transports.set(transport.sessionId, transport);

        res.on("close", () => {
          console.error(`[SSE] Session closed: ${transport.sessionId}`);
          transports.delete(transport.sessionId);
        });

        await server.connect(transport);
        console.error(`[SSE] Server connected for session: ${transport.sessionId}`);
      } catch (err) {
        console.error(`[SSE] Error:`, err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to establish SSE connection" });
        }
      }
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      console.error(`[POST] Message for session: ${sessionId}`);
      const transport = transports.get(sessionId);
      if (!transport) {
        console.error(`[POST] No transport found for session: ${sessionId}`);
        res.status(400).json({ error: "No SSE connection found for this session" });
        return;
      }
      try {
        await transport.handlePostMessage(req, res);
      } catch (err) {
        console.error(`[POST] Error handling message:`, err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to handle message" });
        }
      }
    });

    app.get("/", (_req, res) => {
      res.json({
        name: "deslopify",
        version: "0.1.0",
        status: "running",
        description: "Universal MCP code quality gate for AI assistants",
        connections: transports.size,
        endpoints: { sse: "/sse", messages: "/messages" },
      });
    });

    app.listen(config.port, "0.0.0.0", () => {
      console.error(`Deslopify running on http://0.0.0.0:${config.port}`);
      console.error(`Health: http://0.0.0.0:${config.port}/`);
      console.error(`SSE:    http://0.0.0.0:${config.port}/sse`);
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
