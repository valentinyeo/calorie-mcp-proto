// Shared scripted OAuth 2.1 client for the proof scripts: dynamic client registration,
// PKCE, consent and a real MCP tool call. Tokens, passwords and codes are collected by the
// caller for redaction before anything is written to proof/.
import { createHash, randomBytes } from "node:crypto";

const json = (b) => ({ "content-type": "application/json", ...b });

function session() {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const absorb = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
  };
  const http = async (url, init = {}) => {
    const res = await fetch(url, {
      redirect: "manual",
      ...init,
      headers: { cookie: cookieHeader(), ...(init.headers ?? {}) },
    });
    absorb(res);
    return res;
  };
  return { jar, http, clear: () => jar.clear() };
}

const nextLoc = async (res) => res.headers.get("location") ?? (await res.json()).url;

export const makeConnector = ({
  base,
  check,
  log,
  secrets,
  redirect = "dev.calorie.tracker://oauth/callback",
  userAgent = "e2e-script",
}) => {
  const resource = base + "/mcp";

  // Creates the user (sign-up must be open), runs the real OAuth dance and returns a token.
  return async function connect(tag, scope = "mcp:read mcp:write offline_access") {
    const email = `v1-${tag}-${randomBytes(3).toString("hex")}@example.com`;
    const password = randomBytes(18).toString("base64url");
    secrets.add(password);
    const s = session();

    log(`\n== ${tag}: sign up ${email}`);
    let r = await s.http(base + "/sign-up/email", {
      method: "POST",
      headers: json({ origin: base }),
      body: JSON.stringify({ email, password, name: `Tester ${tag}` }),
    });
    check(r.status === 200, `${tag} sign-up`, r.status);
    s.clear();

    r = await s.http(base + "/oauth2/register", {
      method: "POST",
      headers: json({}),
      body: JSON.stringify({
        client_name: "e2e-script",
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "native",
      }),
    });
    const client = await r.json();
    check(
      (r.status === 200 || r.status === 201) && !!client.client_id,
      `${tag} dynamic client registration`,
      r.status,
    );

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(8).toString("hex");
    const authUrl = base + "/oauth2/authorize?" + new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirect,
      response_type: "code",
      scope,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    }).toString();

    r = await s.http(authUrl);
    let loc = await nextLoc(r);
    check(
      !!loc && loc.includes("/sign-in"),
      `${tag} authorize sends an anonymous caller to the sign-in page`,
      loc?.split("?")[0],
    );

    r = await s.http(base + "/sign-in/email", {
      method: "POST",
      headers: json({ origin: base }),
      body: JSON.stringify({ email, password, oauth_query: new URL(loc, base).search.slice(1) }),
    });
    let body = await r.json();
    check(r.status === 200 && !!body.url, `${tag} sign-in`, { status: r.status, url: body.url?.split("?")[0] });
    loc = body.url;

    if (!new URL(loc, base).pathname.startsWith("/consent")) {
      r = await s.http(new URL(loc, base).toString());
      loc = await nextLoc(r);
    }
    let code;
    if (loc.startsWith(redirect)) code = new URL(loc).searchParams.get("code");
    else {
      r = await s.http(base + "/oauth2/consent", {
        method: "POST",
        headers: json({ origin: base }),
        body: JSON.stringify({ accept: true, oauth_query: new URL(loc, base).search.slice(1) }),
      });
      body = await r.json();
      const cb = new URL(body.url);
      check(
        cb.searchParams.get("state") === state,
        `${tag} consent returns the right state`,
        cb.searchParams.get("state") === state,
      );
      code = cb.searchParams.get("code");
    }
    secrets.add(code);

    r = await fetch(base + "/oauth2/token", {
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
    const tok = await r.json();
    check(r.status === 200 && !!tok.access_token, `${tag} token exchange with PKCE`, {
      status: r.status,
      err: tok.error_description,
    });
    secrets.add(tok.access_token);
    if (tok.refresh_token) secrets.add(tok.refresh_token);

    const rpc = async (method, params, id) => {
      const res = await fetch(resource, {
        method: "POST",
        headers: {
          authorization: "Bearer " + tok.access_token,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          "user-agent": `${userAgent}/${tag}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    await rpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e-proof", version: "1" } },
      0,
    );
    return { email, password, token: tok.access_token, rpc };
  };
};
