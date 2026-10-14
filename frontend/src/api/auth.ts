import { ApiError } from "./errors";

/**
 * Anonymous Firebase sign-in. Each browser gets its own private identity with no sign-up step, which
 * is what keeps one student's notes and progress separate from another's.
 * The Firebase SDK is loaded on first use so the Home screen stays light.
 * These config values are public identifiers, not secrets.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

async function signIn() {
  if (!config.apiKey || !config.projectId || !config.appId) {
    throw new ApiError("auth_not_configured", "Sign-in isn't set up yet. Add the Firebase settings to .env.local.");
  }
  const [{ initializeApp }, { getAuth, signInAnonymously }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const auth = getAuth(initializeApp(config));
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth;
}

let pending: ReturnType<typeof signIn> | null = null;

export async function getIdToken(): Promise<string> {
  try {
    pending ??= signIn();
    const auth = await pending;
    const user = auth.currentUser;
    if (!user) throw new Error("no user");
    return await user.getIdToken(); // refreshes automatically when close to expiry
  } catch (e) {
    pending = null; // allow a retry on the next request
    if (e instanceof ApiError) throw e;
    throw new ApiError("auth_failed", "Couldn't sign you in. Check your connection and try again.", true);
  }
}
