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

const PORT = Number(process.env.INVENTORY_PORT ?? 3004);
const STORE_URL = process.env.WOOCOMMERCE_URL;
const STORE_CONNECT_URL = process.env.WOOCOMMERCE_CONNECT_URL;
const CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;

type WooProduct = {
  id: number;
  name: string;
  sku: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: string;
  low_stock_amount: number | null;
};

async function fetchProducts(limit: number): Promise<WooProduct[]> {
  if (!STORE_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error("WooCommerce environment variables are missing.");
  }

  const storeUrl = STORE_URL.replace(/\/+$/, "");
  const connectUrl = (STORE_CONNECT_URL || STORE_URL).replace(/\/+$/, "");
  const canonicalUrl = new URL(storeUrl);
  const url = new URL(connectUrl);
  url.searchParams.set("rest_route", "/wc/v3/products");
  url.searchParams.set("per_page", String(limit));

  const requestData = {
    rest_route: "/wc/v3/products",
    per_page: String(limit),
  };

  const oauth = new OAuth({
    consumer: {
      key: CONSUMER_KEY.trim(),
      secret: CONSUMER_SECRET.trim(),
    },
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
    throw new Error(`WooCommerce products request failed: HTTP ${response.status}`);
  }

  return await response.json() as WooProduct[];
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "urumi-inventory-mcp",
    version: "1.0.0",
  });

  server.registerTool(
  "get_stock",
  {
    description: "Look up stock status and quantity for a WooCommerce product by ID.",
    inputSchema: {
      product_id: z.number().int().positive(),
    },
  },
  async ({ product_id }) => {
    try {
      const products = await fetchProducts(100);
      const product = products.find((item) => item.id === product_id);

      if (!product) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Product ${product_id} was not found in the first 100 products.`,
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: product.id,
            name: product.name,
            sku: product.sku,
            manage_stock: product.manage_stock,
            stock_quantity: product.stock_quantity,
            stock_status: product.stock_status,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text" as const,
          text: error instanceof Error ? error.message : "Inventory lookup failed",
        }],
      };
    }
  },
  );

  server.registerTool(
  "get_low_stock_products",
  {
    description: "List managed-stock WooCommerce products whose quantity is at or below the specified threshold.",
    inputSchema: {
      threshold: z.number().int().min(0).max(1000).default(5),
      limit: z.number().int().min(1).max(100).default(100),
    },
  },
  async ({ threshold, limit }) => {
    try {
      const products = await fetchProducts(limit);
      const lowStock = products.filter((product) =>
        product.manage_stock &&
        product.stock_quantity !== null &&
        product.stock_quantity <= threshold
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            threshold,
            products_checked: products.length,
            low_stock_count: lowStock.length,
            products: lowStock.map((product) => ({
              id: product.id,
              name: product.name,
              sku: product.sku,
              stock_quantity: product.stock_quantity,
              stock_status: product.stock_status,
            })),
            note: "Only products with managed stock are included. At most 100 products are checked per request.",
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text" as const,
          text: error instanceof Error ? error.message : "Low-stock lookup failed",
        }],
      };
    }
  },
  );

  return server;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "urumi-inventory-mcp" });
});

app.post("/mcp", async (req, res) => {
  const requestServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close().catch(() => undefined);
    void requestServer.close().catch(() => undefined);
  });

  try {
    await requestServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Inventory MCP request failed:", error instanceof Error ? error.message : "Unknown error");
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Inventory MCP server listening on port ${PORT}`);
});
