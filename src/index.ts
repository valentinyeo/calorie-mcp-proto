import { requireMcpAuth } from "@better-auth/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { appApi } from "./app-api";
import { APP_ORIGINS, createAuth, MCP_PATH, MCP_SCOPES, type Env } from "./auth";
import { consentPage, signInPage } from "./pages";
import { registerTools } from "./tools";

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

// The Android WebView is served from https://localhost, so its requests to the API and the
// sign-in endpoint are cross-origin. Only the app's own origins are allowed.
const corsHeaders = (origin: string): Record<string, string> => ({
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-origin": origin,
  "access-control-expose-headers": "set-auth-token",
  "access-control-max-age": "600",
  vary: "origin",
});

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const allowedOrigin = origin !== null && APP_ORIGINS.includes(origin) ? origin : null;
    const cors = allowedOrigin === null ? null : corsHeaders(allowedOrigin);

    if (request.method === "OPTIONS" && cors !== null) {
      return new Response(null, { headers: cors, status: 204 });
    }

    const response = await route(request, url, env);
    if (cors === null) return response;

    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  },
};

async function route(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === "/sign-in" && request.method === "GET") {
    return signInPage(!!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET));
  }
  if (url.pathname === "/consent" && request.method === "GET") return consentPage();
  if (url.pathname === "/health") return Response.json({ ok: true, tools: TOOL_NAMES });

  const auth = createAuth(env);
  if (url.pathname.startsWith("/api/app/")) {
    try {
      return await appApi(request, auth, env.DB);
    } catch (e) {
      console.error("app api error", e instanceof Error ? e.stack : String(e));
      return Response.json({ error: "server_error" }, { status: 500 });
    }
  }
  if (url.pathname === "/mcp") {
    // Stateless transport: initialize and tools/call are separate requests, so the SDK's
    // clientInfo does not survive. The client label comes from the request user agent
    // (Claude Code sends "claude-code/..."); it is a display label only, never a trust input.
    const clientName =
      request.headers.get("user-agent")?.split(/[ /]/)[0]?.slice(0, 60) || null;
    const handler = requireMcpAuth(
      auth,
      async (req, claims) => {
        try {
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
      { resource: env.PUBLIC_URL + MCP_PATH, challengeScopes: MCP_SCOPES.filter((s) => s !== "offline_access") },
    );
    try {
      return await handler(request);
    } catch (e) {
      console.error("mcp auth error", e instanceof Error ? e.stack : String(e));
      return Response.json({ error: "server_error" }, { status: 500 });
    }
  }
  return auth.handler(request);
}
