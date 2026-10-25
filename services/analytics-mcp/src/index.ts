import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import express from "express";
import OAuth from "oauth-1.0a";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(currentDirectory, "../../../.env"),
});

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.ANALYTICS_PORT ?? 3003);
const STORE_URL = process.env.WOOCOMMERCE_URL;
const STORE_CONNECT_URL = process.env.WOOCOMMERCE_CONNECT_URL;
const CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;

function getWooCredentials() {
  if (!STORE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error("WooCommerce environment variables are missing.");
  }

  return {
    storeUrl: STORE_URL.replace(/\/+$/, ""),
    connectUrl: (STORE_CONNECT_URL || STORE_URL).replace(/\/+$/, ""),
    consumerKey: CONSUMER_KEY.trim(),
    consumerSecret: CONSUMER_SECRET.trim(),
  };
}

async function fetchOrders(after?: string, before?: string) {
  const { storeUrl, connectUrl, consumerKey, consumerSecret } = getWooCredentials();
  const canonicalUrl = new URL(storeUrl);
  const url = new URL(connectUrl);
  url.searchParams.set("rest_route", "/wc/v3/orders");
  url.searchParams.set("per_page", "100");
  if (after) url.searchParams.set("after", after);
  if (before) url.searchParams.set("before", before);

  const requestData: Record<string, string> = {
    rest_route: "/wc/v3/orders",
    per_page: "100",
  };
  if (after) requestData.after = after;
  if (before) requestData.before = before;

  const oauth = new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, key) {
      return createHmac("sha1", key).update(baseString).digest("base64");
    },
  });

  const parameters = oauth.authorize(
    { url: storeUrl, method: "GET", data: requestData },
  );
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Host: canonicalUrl.host,
      "X-Forwarded-Proto": canonicalUrl.protocol.slice(0, -1),
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`WooCommerce orders request failed: HTTP ${response.status}`);
  }

  return await response.json() as Array<{
    id: number;
    status: string;
    total: string;
    currency: string;
    date_created: string;
  }>;
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "urumi-analytics-mcp",
    version: "1.0.0",
  });

  server.registerTool(
  "get_sales_summary",
  {
    description: "Summarize WooCommerce orders and sales for an optional date range. Reads up to 100 matching orders.",
    inputSchema: {
      after: z.string().optional().describe("Start timestamp in ISO 8601 format"),
      before: z.string().optional().describe("End timestamp in ISO 8601 format"),
    },
  },
  async ({ after, before }) => {
    try {
      const orders = await fetchOrders(after, before);
      const salesOrders = orders.filter(
        (order) => ["processing", "completed"].includes(order.status),
      );
      const totalSales = salesOrders.reduce(
        (sum, order) => sum + Number(order.total || 0),
        0,
      );
      const currency = salesOrders[0]?.currency ?? "store currency";

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            order_count: orders.length,
            sales_order_count: salesOrders.length,
            total_sales: Number(totalSales.toFixed(2)),
            currency,
            included_statuses: ["processing", "completed"],
            limit_note: "Summary covers at most 100 orders per request.",
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text" as const,
          text: error instanceof Error ? error.message : "Analytics request failed",
        }],
      };
    }
  },
  );

  return server;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "urumi-analytics-mcp" });
});

app.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Analytics MCP request failed:", error instanceof Error ? error.message : "Unknown error");
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Analytics MCP server listening on port ${PORT}`);
});
