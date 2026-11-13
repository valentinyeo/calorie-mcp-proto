// Pure helpers for the Home screen: number and date formatting, the day label and the
// progress percentage. Kept free of DOM so they can be tested with plain node.
import type { Entry } from "./model.ts";

export const sourceLabel = (entry: Pick<Entry, "source" | "client_name">): string => {
  if (entry.source === "mcp" || entry.source === "cli") {
    return entry.client_name ? `Added from ${entry.client_name}` : "Added from an AI chat";
  }
  if (entry.source === "photo") return "Added from a photo";
  if (entry.source === "barcode") return "Added by barcode";
  return "Added in the app";
};

// "Today, Thu 30 Oct" from a YYYY-MM-DD day string.
export const dayLabel = (date: string): string => {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return `Today, ${label}`;
};

// 07:40 in the profile's timezone, the same timezone the server used for local_date.
export const entryTime = (eatenAt: string, timezone: string): string => {
  const instant = new Date(eatenAt);
  if (Number.isNaN(instant.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      timeZone: timezone,
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, minute: "2-digit" }).format(instant);
  }
};

export const groupThousands = (value: number): string =>
  new Intl.NumberFormat("en-GB").format(Math.round(value));

export const progressPercent = (consumed: number, goal: number): number => {
  if (!Number.isFinite(goal) || goal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((consumed / goal) * 100)));
};

export const parseKcal = (value: string): number | null => {
  const kcal = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > 20000) return null;
  return kcal;
};

export const remainingLabel = (remainder: number): string => {
  const abs = groupThousands(Math.abs(remainder));
  return remainder < 0 ? `${abs} over` : `${abs} left`;
};
