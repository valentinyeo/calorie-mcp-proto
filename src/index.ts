import { requireMcpAuth } from "@better-auth/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as z from "zod";
import { createAuth, MCP_PATH, type Env } from "./auth";
import { consentPage, signInPage } from "./pages";

function buildServer(env: Env, userId: string) {
  const server = new McpServer({ name: "calorie-mcp-proto", version: "0.0.1" });
  server.registerTool(
    "list_entries",
    {
      description: "List the signed-in user's food log entries for one date (YYYY-MM-DD). Read-only.",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date, YYYY-MM-DD") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ date }) => {
      const { results } = await env.DB.prepare(
        "SELECT name, kcal, meal, date FROM entries WHERE user_id = ? AND date = ? ORDER BY id",
      ).bind(userId, date).all();
      return { content: [{ type: "text", text: JSON.stringify({ date, entries: results }) }] };
    },
  );
  return server;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/sign-in" && request.method === "GET") return signInPage();
    if (url.pathname === "/consent" && request.method === "GET") return consentPage();
    if (url.pathname === "/") return new Response("calorie-mcp-proto: throwaway prototype. MCP endpoint: " + MCP_PATH);

    const auth = createAuth(env);
    if (url.pathname === MCP_PATH) {
      const handler = requireMcpAuth(
        auth,
        async (req, claims) => {
          try {
          const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
          await buildServer(env, String(claims.sub)).connect(transport);
          return await transport.handleRequest(req, { authInfo: { token: "", clientId: String(claims.azp ?? ""), scopes: [] } });
          } catch (e) {
            console.error("mcp handler error", e instanceof Error ? e.stack : String(e));
            return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null }, { status: 500 });
          }
        },
        { resource: env.PUBLIC_URL + MCP_PATH, challengeScopes: ["mcp:read"] },
      );
      try {
        return await handler(request);
      } catch (e) {
        console.error("mcp auth error", e instanceof Error ? e.stack : String(e));
        return Response.json({ error: "server_error" }, { status: 500 });
      }
    }
    return auth.handler(request);
  },
};
