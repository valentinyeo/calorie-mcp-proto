import { Schema } from "effect";

import { Day, Entry } from "./model.ts";
import type { Day as DayType, Entry as EntryType } from "./model.ts";

// The live food log server. VITE_API_BASE overrides it for local runs and CI.
export const apiBase = (): string =>
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ??
  "https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev";

const decodeDay = Schema.decodeUnknownSync(Day);
const decodeEntry = Schema.decodeUnknownSync(Entry);

const errorText = async (response: Response): Promise<string> => {
  const body = await response.json().catch(() => ({}));
  const message = (body as { message?: string; error?: string }).message ??
    (body as { error?: string }).error;
  if (response.status === 401 || response.status === 403) {
    return "Your sign-in expired. Sign in again.";
  }
  return message ?? `The server refused the request (${response.status}).`;
};

export interface Reply {
  day: DayType;
  entry?: EntryType;
}

const body = async (response: Response): Promise<Reply> => {
  if (!response.ok) throw new Error(await errorText(response));
  const json = (await response.json()) as { day?: unknown; entry?: unknown };
  try {
    return {
      day: decodeDay(json.day),
      entry: json.entry === undefined || json.entry === null ? undefined : decodeEntry(json.entry),
    };
  } catch {
    throw new Error("The server sent a day the app could not read. Try again.");
  }
};

export interface EntryInput {
  name: string;
  kcal: number;
  portion_text?: string;
}

const appHeaders = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

export const signIn = async (email: string, password: string): Promise<string> => {
  const response = await fetch(`${apiBase()}/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const json = await response.json().catch(() => ({})) as { token?: string; message?: string };
  if (!response.ok) {
    throw new Error(json.message ?? "That email and password did not work.");
  }
  const token = response.headers.get("set-auth-token") ?? json.token;
  if (!token) throw new Error("The server did not return a session. Try again.");
  return token;
};

export const fetchDay = async (token: string) => {
  const response = await fetch(`${apiBase()}/api/app/day`, {
    headers: { authorization: `Bearer ${token}` },
    method: "GET",
  });
  return body(response);
};

export const addEntry = async (token: string, input: EntryInput) => {
  const response = await fetch(`${apiBase()}/api/app/entries`, {
    body: JSON.stringify(input),
    headers: appHeaders(token),
    method: "POST",
  });
  return body(response);
};

export const updateEntry = async (token: string, id: number, input: EntryInput) => {
  const response = await fetch(`${apiBase()}/api/app/entries/${id}`, {
    body: JSON.stringify(input),
    headers: appHeaders(token),
    method: "PATCH",
  });
  return body(response);
};

export const deleteEntry = async (token: string, id: number) => {
  const response = await fetch(`${apiBase()}/api/app/entries/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    method: "DELETE",
  });
  return body(response);
};

export const restoreEntry = async (token: string, id: number) => {
  const response = await fetch(`${apiBase()}/api/app/entries/${id}/restore`, {
    headers: { authorization: `Bearer ${token}` },
    method: "POST",
  });
  return body(response);
};
