import { requireMcpAuth } from "@better-auth/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAuth, MCP_PATH, MCP_SCOPES, type Env } from "./auth";
import { consentPage, signInPage } from "./pages";
import { registerTools } from "./tools";
import { appApi } from "./app-api";

const TOOL_NAMES = [
  "get_day",
  "list_entries",
  "add_entry",
  "update_entry",
  "delete_entry",
  "set_goal",
];

function buildServer(env: Env, userId: string, clientName: string | null) {
  const server = new McpServer({ name: "calorie-tracker", version: "1.0.0" });
  registerTools(server, env.DB, userId, clientName);
  return server;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/sign-in" && request.method === "GET") return signInPage(!!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET));
    if (url.pathname === "/consent" && request.method === "GET") return consentPage();
    if (url.pathname === "/health") return Response.json({ ok: true, tools: TOOL_NAMES });

    const auth = createAuth(env);
    if (url.pathname === "/mcp" || url.pathname.startsWith("/api/app/")) {
      // Stateless transport: initialize and tools/call are separate requests, so the SDK's
      // clientInfo does not survive. The client label comes from the request user agent
      // (Claude Code sends "claude-code/..."); it is a display label only, never a trust input.
      const clientName =
        request.headers.get("user-agent")?.split(/[ /]/)[0]?.slice(0, 60) || null;
      const handler = requireMcpAuth(
        auth,
        async (req, claims) => {
          try {
            if (url.pathname.startsWith("/api/app/")) return await appApi(req, env.DB, String(claims.sub));
            const transport = new WebStandardStreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
              enableJsonResponse: true,
            });
            const server = buildServer(env, String(claims.sub), clientName);
            await server.connect(transport);
            return await transport.handleRequest(req, {
              authInfo: { token: "", clientId: String(claims.azp ?? ""), scopes: [] },
            });
          } catch (e) {
            console.error("mcp handler error", e instanceof Error ? e.stack : String(e));
            return Response.json(
              { jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null },
              { status: 500 },
            );
          }
        },
        {
          resource: env.PUBLIC_URL + MCP_PATH,
          challengeScopes: MCP_SCOPES.filter((s) => s !== "offline_access"),
          ...(url.pathname.startsWith("/api/app/")
            ? { requiredScopes: [request.method === "GET" ? "mcp:read" : "mcp:write"] }
            : {}),
        },
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
