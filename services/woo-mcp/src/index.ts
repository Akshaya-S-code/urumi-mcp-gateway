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
dotenv.config({ path: path.resolve(currentDirectory, "../../../.env") });

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3001);
const STORE_URL = process.env.WOOCOMMERCE_URL;
const CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;

function getWooCredentials() {
  if (!STORE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error("WooCommerce environment variables are missing.");
  }
  return {
    storeUrl: STORE_URL.replace(/\/+$/, ""),
    consumerKey: CONSUMER_KEY.trim(),
    consumerSecret: CONSUMER_SECRET.trim(),
  };
}

async function wooRequest(
  resource: string,
  method: "GET" | "POST" | "PUT",
  params: Record<string, string> = {},
  payload?: Record<string, unknown>,
) {
  const { storeUrl, consumerKey, consumerSecret } = getWooCredentials();
  const url = new URL(storeUrl);
  const restRoute = `/wc/v3/${resource}`;
  url.searchParams.set("rest_route", restRoute);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const requestData: Record<string, string> = {
    rest_route: restRoute,
    ...params,
  };

  const oauth = new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, key) {
      return createHmac("sha1", key).update(baseString).digest("base64");
    },
  });

  const oauthParameters = oauth.authorize(
    { url: storeUrl, method, data: requestData },
  );

  for (const [key, value] of Object.entries(oauthParameters)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(15000),
  });

  const responseText = await response.text();
  let data: unknown;

  try {
    data = JSON.parse(responseText);
  } catch {
    data = responseText;
  }

  if (!response.ok) {
    throw new Error(`WooCommerce API request failed with HTTP ${response.status}.`);
  }

  return data;
}

function registerTools(server: McpServer) {
  server.registerTool(
    "list_products",
    {
      description: "List products from the connected WooCommerce store.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(10),
      },
    },
    async ({ limit }) => {
      const products = await wooRequest("products", "GET", {
        per_page: String(limit),
      });
      return { content: [{ type: "text", text: JSON.stringify(products, null, 2) }] };
    },
  );

  server.registerTool(
    "create_product",
    {
      description: "Create a simple WooCommerce product.",
      inputSchema: {
        name: z.string().trim().min(1).max(200),
        regular_price: z.string().regex(/^\d+(\.\d{1,2})?$/),
        description: z.string().max(5000).optional(),
      },
    },
    async ({ name, regular_price, description }) => {
      const product = await wooRequest("products", "POST", {}, {
        name,
        type: "simple",
        regular_price,
        ...(description ? { description } : {}),
      });
      return { content: [{ type: "text", text: JSON.stringify(product, null, 2) }] };
    },
  );

  server.registerTool(
    "list_orders",
    {
      description: "List recent WooCommerce orders.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(10),
        status: z.string().optional(),
      },
    },
    async ({ limit, status }) => {
      const orders = await wooRequest("orders", "GET", {
        per_page: String(limit),
        ...(status ? { status } : {}),
      });
      return { content: [{ type: "text", text: JSON.stringify(orders, null, 2) }] };
    },
  );

  server.registerTool(
    "get_order",
    {
      description: "Retrieve one WooCommerce order by its numeric ID.",
      inputSchema: {
        order_id: z.number().int().positive(),
      },
    },
    async ({ order_id }) => {
      const order = await wooRequest(`orders/${order_id}`, "GET");
      return { content: [{ type: "text", text: JSON.stringify(order, null, 2) }] };
    },
  );

  server.registerTool(
    "update_order_status",
    {
      description: "Update the status of a WooCommerce order.",
      inputSchema: {
        order_id: z.number().int().positive(),
        status: z.enum([
          "pending",
          "processing",
          "on-hold",
          "completed",
          "cancelled",
          "refunded",
        ]),
      },
    },
    async ({ order_id, status }) => {
      const order = await wooRequest(`orders/${order_id}`, "PUT", {}, { status });
      return { content: [{ type: "text", text: JSON.stringify(order, null, 2) }] };
    },
  );
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "urumi-woocommerce" });
});

app.post("/mcp", async (req, res) => {
  const server = new McpServer({ name: "urumi-woocommerce", version: "1.0.0" });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  registerTools(server);

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error instanceof Error ? error.message : "Unknown error");
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`WooCommerce MCP server listening on port ${PORT}`);
});
