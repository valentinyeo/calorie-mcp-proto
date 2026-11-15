// Scripted OAuth 2.1 for the local seed account: dynamic client registration, PKCE,
// email sign-in, consent and the token exchange, then JSON-RPC calls to /mcp.
// Local only. It talks to 127.0.0.1 and nothing else, and it never prints a token.
import { createHash, randomBytes } from "node:crypto";

const jsonHeaders = (extra = {}) => ({ "content-type": "application/json", ...extra });

const cookies = () => {
  const jar = new Map();
  const header = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  const absorb = (response) => {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const http = async (url, init = {}) => {
    const response = await fetch(url, {
      redirect: "manual",
      ...init,
      headers: { cookie: header(), ...(init.headers ?? {}) },
    });
    absorb(response);
    return response;
  };
  return { clear: () => jar.clear(), http };
};

const nextUrl = async (response) =>
  response.headers.get("location") ?? (await response.json().catch(() => ({}))).url;

const fail = (step, detail) => {
  throw new Error(`MCP ${step} failed: ${detail}`);
};

// Returns { rpc } where rpc(method, params, id) posts one JSON-RPC call with the access
// token. The MCP transport is stateless, so initialize and tools/call are separate requests.
export async function connectMcp({ base, email, password, userAgent = "pstack-verifier-drive", redirect = "dev.calorie.tracker://oauth/callback" }) {
  const resource = `${base}/mcp`;
  const session = cookies();

  let response = await session.http(`${base}/oauth2/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      client_name: "pstack-verifier",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "native",
    }),
  });
  const client = await response.json().catch(() => ({}));
  if (!client.client_id) fail("client registration", response.status);

  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(8).toString("hex");
  const authorize = `${base}/oauth2/authorize?${new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirect,
    response_type: "code",
    scope: "mcp:read mcp:write offline_access",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
  })}`;

  response = await session.http(authorize);
  let location = await nextUrl(response);
  if (!location) fail("authorize", response.status);

  response = await session.http(`${base}/sign-in/email`, {
    method: "POST",
    headers: jsonHeaders({ origin: base }),
    body: JSON.stringify({ email, password, oauth_query: new URL(location, base).search.slice(1) }),
  });
  const signedIn = await response.json().catch(() => ({}));
  if (!signedIn.url) fail("sign-in", `${response.status} ${signedIn.message ?? ""}`.trim());
  location = signedIn.url;

  let code;
  if (location.startsWith(redirect)) {
    code = new URL(location).searchParams.get("code");
  } else {
    if (!new URL(location, base).pathname.startsWith("/consent")) {
      response = await session.http(new URL(location, base).toString());
      location = await nextUrl(response);
    }
    response = await session.http(`${base}/oauth2/consent`, {
      method: "POST",
      headers: jsonHeaders({ origin: base }),
      body: JSON.stringify({ accept: true, oauth_query: new URL(location, base).search.slice(1) }),
    });
    const consented = await response.json().catch(() => ({}));
    if (!consented.url) fail("consent", response.status);
    const callback = new URL(consented.url);
    if (callback.searchParams.get("state") !== state) fail("consent", "state mismatch");
    code = callback.searchParams.get("code");
  }

  response = await fetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: client.client_id,
      code_verifier: verifier,
      resource,
    }),
  });
  const token = await response.json().catch(() => ({}));
  if (!token.access_token) {
    fail("token exchange", `${response.status} ${token.error_description ?? ""}`.trim());
  }

  const rpc = async (method, params, id = 1) => {
    const call = await fetch(resource, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        "user-agent": userAgent,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const body = await call.json().catch(() => null);
    return { status: call.status, body };
  };

  await rpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pstack-verifier", version: "1" } },
    0,
  );

  const tool = async (name, args, id = 2) => {
    const reply = await rpc("tools/call", { name, arguments: args }, id);
    const text = reply.body?.result?.content?.[0]?.text;
    if (typeof text !== "string") {
      throw new Error(`MCP tools/call ${name} failed: ${reply.status} ${JSON.stringify(reply.body)?.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      // A refusal is a plain sentence, not JSON. Return it so the caller can read it.
      return { text, is_error: reply.body?.result?.isError === true };
    }
  };

  return { rpc, tool };
}
