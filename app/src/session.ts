import { Preferences } from "@capacitor/preferences";

const KEY = "calorie-tracker-session";

// Capacitor Preferences keeps the token in the app's private storage on the phone and
// falls back to localStorage in the browser. Only the token is stored, never the password.
export const loadToken = async (): Promise<string | null> => {
  const { value } = await Preferences.get({ key: KEY });
  return value && value.length > 0 ? value : null;
};

export const saveToken = async (token: string): Promise<void> => {
  await Preferences.set({ key: KEY, value: token });
};

export const clearToken = async (): Promise<void> => {
  await Preferences.remove({ key: KEY });
};
