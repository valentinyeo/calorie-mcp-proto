import { betterAuth } from "better-auth";
import { bearer, jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";

export interface Env {
  DB: D1Database;
  PUBLIC_URL: string;
  SIGNUP_OPEN: string;
  AUTH_SIGNING_SECRET: string;
  // Google sign-in stays off until both are set as Worker secrets. Email and password
  // remains as the fallback for a user who has no Google account (spec: Auth flow).
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export const MCP_PATH = "/mcp";
export const MCP_SCOPES = ["mcp:read", "mcp:write", "offline_access"];

// The Android WebView serves the app from https://localhost and calls the Worker with a
// Bearer session token, so those origins are trusted and allowed through CORS.
export const APP_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost:5173"];

// Workers Free allows ~10 ms CPU per request. Better Auth's default scrypt hash is
// pure JS and far over that. Web Crypto PBKDF2 runs natively, so use it instead.
const ITER = 100_000; // Workers Web Crypto caps PBKDF2 at 100k iterations
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2(pw: string, salt: Uint8Array<ArrayBuffer>) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, k, 256));
}
async function hash(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  return `${b64(salt)}:${b64(await pbkdf2(pw, salt))}`;
}
async function verify({ hash: stored, password }: { hash: string; password: string }) {
  const [s, h] = stored.split(":");
  const got = await pbkdf2(password, unb64(s));
  const want = unb64(h);
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= got[i] ^ want[i];
  return d === 0;
}

export function createAuth(env: Env) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: "select_account" as const }
      : undefined;

  return betterAuth({
    database: env.DB,
    secret: env.AUTH_SIGNING_SECRET,
    baseURL: env.PUBLIC_URL,
    basePath: "/",
    trustedOrigins: APP_ORIGINS,
    ...(google ? { socialProviders: { google } } : {}),
    emailAndPassword: {
      enabled: true,
      disableSignUp: env.SIGNUP_OPEN !== "1",
      password: { hash, verify },
    },
    plugins: [
      jwt(),
      // Issues a session token in set-auth-token on sign-in and accepts it as a Bearer
      // token afterwards, which is what the Android WebView stores and sends.
      bearer(),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource: env.PUBLIC_URL + MCP_PATH,
        scopes: MCP_SCOPES,
        // DCR fallback: Claude (when CIMD is not advertised) and ChatGPT both support it.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
