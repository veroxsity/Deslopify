#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "./server.js";
import { loadConfig } from "./types/config.js";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.transport === "sse") {
    const app = express();

    // CORS for remote clients
    app.use((_req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");
      if (_req.method === "OPTIONS") {
        res.sendStatus(200);
        return;
      }
      next();
    });

    // JSON body parsing only for /mcp (SSE /messages needs raw stream)
    app.use("/mcp", express.json());

    // ── Streamable HTTP transport (modern) ──
    // Single /mcp endpoint for all MCP communication
    const streamableSessions = new Map<string, { server: ReturnType<typeof createServer>; transport: StreamableHTTPServerTransport }>();

    app.all("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        // Check if this is an initialize request (new session)
        if (!sessionId || !streamableSessions.has(sessionId)) {
          if (isInitializeRequest(req.body)) {
            const newSessionId = randomUUID();
            const server = createServer();
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => newSessionId,
            });

            streamableSessions.set(newSessionId, { server, transport });
            console.error(`[MCP] New session: ${newSessionId}`);

            res.on("close", () => {
              console.error(`[MCP] Connection closed for: ${newSessionId}`);
            });

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
          } else {
            res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Bad Request: No valid session and not an initialize request" }, id: null });
          }
          return;
        }

        // Existing session
        const session = streamableSessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
      } else if (req.method === "GET") {
        // SSE stream for server-initiated notifications
        if (!sessionId || !streamableSessions.has(sessionId)) {
          res.status(400).json({ error: "Invalid or missing session ID" });
          return;
        }
        const session = streamableSessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
      } else if (req.method === "DELETE") {
        // Session termination
        if (sessionId && streamableSessions.has(sessionId)) {
          const session = streamableSessions.get(sessionId)!;
          await session.transport.close();
          await session.server.close();
          streamableSessions.delete(sessionId);
          console.error(`[MCP] Session terminated: ${sessionId}`);
          res.status(200).end();
        } else {
          res.status(404).json({ error: "Session not found" });
        }
      } else {
        res.status(405).json({ error: "Method not allowed" });
      }
    });

    // ── Legacy SSE transport (backwards compat) ──
    const sseTransports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (req, res) => {
      console.error(`[SSE] New connection from ${req.ip}`);
      try {
        const server = createServer();
        const transport = new SSEServerTransport("/messages", res);
        console.error(`[SSE] Session created: ${transport.sessionId}`);
        sseTransports.set(transport.sessionId, transport);

        res.on("close", () => {
          console.error(`[SSE] Session closed: ${transport.sessionId}`);
          sseTransports.delete(transport.sessionId);
        });

        await server.connect(transport);
      } catch (err) {
        console.error(`[SSE] Error:`, err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to establish SSE connection" });
        }
      }
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      console.error(`[SSE POST] Message for session: ${sessionId}`);
      const transport = sseTransports.get(sessionId);
      if (!transport) {
        res.status(400).json({ error: "No SSE connection found for this session" });
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    // ── Health check (moved to /api/health) ──
    app.get("/api/health", (_req, res) => {
      res.json({
        name: "deslopify",
        version: "0.1.0",
        status: "running",
        sessions: { streamable: streamableSessions.size, sse: sseTransports.size },
        endpoints: { streamableHttp: "/mcp", sse: "/sse", health: "/api/health" },
      });
    });

    // ── Static landing page ──
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    app.use(express.static(join(__dirname, "..", "public")));

    app.listen(config.port, "0.0.0.0", () => {
      console.error(`Deslopify running on http://0.0.0.0:${config.port}`);
      console.error(`Streamable HTTP: http://0.0.0.0:${config.port}/mcp`);
      console.error(`Legacy SSE:      http://0.0.0.0:${config.port}/sse`);
      console.error(`Health:          http://0.0.0.0:${config.port}/`);
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
