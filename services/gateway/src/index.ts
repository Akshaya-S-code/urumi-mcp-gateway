import "dotenv/config";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  importExistingAdminKey,
  authenticateApiKey,
  createApiKey,
  revokeApiKey,
  listApiKeys,
  listAuditEvents,
  recordAuditEvent,
  type ApiRole,
} from "./database.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3002);

const UPSTREAMS = [
  { name: "woo", url: process.env.WOO_MCP_URL ?? "http://127.0.0.1:3001/mcp" },
  { name: "analytics", url: process.env.ANALYTICS_MCP_URL ?? "http://127.0.0.1:3003/mcp" },
  { name: "inventory", url: process.env.INVENTORY_MCP_URL ?? "http://127.0.0.1:3004/mcp" },
];

type AuthenticatedRequest = express.Request & {
  apiKeyId?: string;
  apiRole?: ApiRole;
};

const bootstrapKey = process.env.URUMI_GATEWAY_API_KEY;
if (bootstrapKey) {
  importExistingAdminKey(bootstrapKey);
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "urumi-gateway" });
});

app.use("/mcp", (req, res, next) => {
  const authReq = req as AuthenticatedRequest;
  const authorization = req.header("Authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(authorization);

  if (!match || !authenticateApiKey(match[1])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const identity = authenticateApiKey(match[1]);
  if (!identity) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  authReq.apiKeyId = identity.id;
  authReq.apiRole = identity.role;
  next();
});

app.get("/admin/api-keys", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const match = /^Bearer (.+)$/.exec(req.header("Authorization") ?? "");
  const identity = match ? authenticateApiKey(match[1]) : null;

  if (!identity || identity.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  res.json(listApiKeys());
});

app.post("/admin/api-keys", (req, res) => {
  const match = /^Bearer (.+)$/.exec(req.header("Authorization") ?? "");
  const identity = match ? authenticateApiKey(match[1]) : null;

  if (!identity || identity.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  const role = req.body?.role;

  if (!label || label.length > 100 || (role !== "admin" && role !== "member")) {
    res.status(400).json({ error: "Provide a label (1-100 characters) and role admin or member" });
    return;
  }

  const created = createApiKey(label, role);
  res.status(201).json({
    id: created.id,
    label: created.label,
    role: created.role,
    key: created.key,
    warning: "Save this key now. It will not be shown again.",
  });
});

app.delete("/admin/api-keys/:id", (req, res) => {
  const match = /^Bearer (.+)$/.exec(req.header("Authorization") ?? "");
  const identity = match ? authenticateApiKey(match[1]) : null;

  if (!identity || identity.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  if (req.params.id === identity.id) {
    res.status(400).json({ error: "You cannot revoke your own active key" });
    return;
  }

  if (!revokeApiKey(req.params.id)) {
    res.status(404).json({ error: "Active API key not found" });
    return;
  }

  res.json({ revoked: true });
});

app.get("/admin/audit-logs", (req, res) => {
  const match = /^Bearer (.+)$/.exec(req.header("Authorization") ?? "");
  const identity = match ? authenticateApiKey(match[1]) : null;

  if (!identity || identity.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const parsedLimit = Number(req.query.limit ?? 100);
  res.json(listAuditEvents(Number.isFinite(parsedLimit) ? parsedLimit : 100));
});

app.post("/mcp", async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const keyId = authReq.apiKeyId ?? null;
  const role = authReq.apiRole ?? null;
  const gateway = new McpServer({ name: "urumi-gateway", version: "1.0.0" });

  const clients: Array<{
    name: string;
    url: string;
    client: Client;
    tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
  }> = [];

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    for (const upstreamConfig of UPSTREAMS) {
      const client = new Client({
        name: `urumi-gateway-${upstreamConfig.name}-client`,
        version: "1.0.0",
      });

      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(upstreamConfig.url)));
        const discovered = await client.listTools();
        clients.push({
          name: upstreamConfig.name,
          url: upstreamConfig.url,
          client,
          tools: discovered.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
      } catch (error) {
        await client.close().catch(() => undefined);
        console.error(
          `Upstream ${upstreamConfig.name} unavailable:`,
          error instanceof Error ? error.message : "Unknown error",
        );
      }
    }

    for (const upstream of clients) {
      for (const tool of upstream.tools) {
        const upstreamName = tool.name;
        const gatewayName = `${upstream.name}__${upstreamName}`;

        gateway.registerTool(
          gatewayName,
          {
            description: tool.description ?? `${upstream.name} tool: ${upstreamName}`,
            inputSchema: (() => {
              if (upstream.name === "woo") {
                switch (upstreamName) {
                  case "list_products":
                    return z.object({
                      limit: z.number().int().min(1).max(100).optional(),
                    });
                  case "create_product":
                    return z.object({
                      name: z.string().min(1).max(200),
                      regular_price: z.string().regex(/^\d+(\.\d{1,2})?$/),
                      description: z.string().max(5000).optional(),
                    });
                  case "list_orders":
                    return z.object({
                      limit: z.number().int().min(1).max(100).optional(),
                      status: z.string().optional(),
                    });
                  case "get_order":
                    return z.object({
                      order_id: z.number().int().positive(),
                    });
                  case "update_order_status":
                    return z.object({
                      order_id: z.number().int().positive(),
                      status: z.enum([
                        "pending", "processing", "on-hold",
                        "completed", "cancelled", "refunded",
                      ]),
                    });
                }
              }

              if (upstream.name === "analytics" && upstreamName === "get_sales_summary") {
                return z.object({
                  after: z.string().optional(),
                  before: z.string().optional(),
                });
              }

              if (upstream.name === "inventory") {
                if (upstreamName === "get_stock") {
                  return z.object({
                    product_id: z.number().int().positive(),
                  });
                }
                if (upstreamName === "get_low_stock_products") {
                  return z.object({
                    threshold: z.number().int().min(0).max(1000).optional(),
                    limit: z.number().int().min(1).max(100).optional(),
                  });
                }
              }

              return z.object({}).passthrough();
            })(),
          },
          async (args: Record<string, unknown>) => {
            const startedAt = Date.now();

            // Members may read data, but only admins may mutate store data.
            const adminOnlyTools = ["create_product", "update_order_status"];
            if (role !== "admin" && adminOnlyTools.includes(upstreamName)) {
              recordAuditEvent({
                keyId,
                role,
                toolName: gatewayName,
                durationMs: Date.now() - startedAt,
                outcome: "error",
              });

              return {
                isError: true,
                content: [{
                  type: "text" as const,
                  text: "Forbidden: this tool requires an admin API key.",
                }],
              };
            }

            try {
              const result = await upstream.client.callTool({
                name: upstreamName,
                arguments: args as Record<string, unknown>,
              });

              recordAuditEvent({
                keyId,
                role,
                toolName: gatewayName,
                durationMs: Date.now() - startedAt,
                outcome: "success",
              });

              return result as {
                content: [{ type: "text"; text: string }];
                isError?: boolean;
              };
            } catch (error) {
              recordAuditEvent({
                keyId,
                role,
                toolName: gatewayName,
                durationMs: Date.now() - startedAt,
                outcome: "error",
              });

              return {
                isError: true,
                content: [{
                  type: "text" as const,
                  text: `Upstream tool call failed: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }`,
                }],
              };
            }
          },
        );
      }
    }

    gateway.registerTool(
      "gateway__list_upstreams",
      {
        description: "List configured MCP upstreams and their discovered tools.",
        inputSchema: z.object({}),
      },
      async () => {
        const startedAt = Date.now();
        const result = UPSTREAMS.map((configured) => {
          const connected = clients.find((item) => item.name === configured.name);
          return {
            name: configured.name,
            status: connected ? "connected" : "unavailable",
            tools: connected
              ? connected.tools.map((tool) => ({
                  name: `${connected.name}__${tool.name}`,
                  description: tool.description ?? "",
                }))
              : [],
          };
        });

        recordAuditEvent({
          keyId,
          role,
          toolName: "gateway__list_upstreams",
          durationMs: Date.now() - startedAt,
          outcome: "success",
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    );

    res.on("close", () => {
      for (const upstream of clients) {
        void upstream.client.close().catch(() => undefined);
      }
    });

    await gateway.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    for (const upstream of clients) {
      await upstream.client.close().catch(() => undefined);
    }

    if (!res.headersSent) {
      res.status(502).json({ error: "Gateway MCP request failed" });
    } else {
      res.end();
    }

    console.error(
      "Gateway request failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Urumi Gateway listening on port ${PORT}`);
  console.log(`Configured MCP upstreams: ${UPSTREAMS.map((item) => item.name).join(", ")}`);
});



