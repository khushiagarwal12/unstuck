import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  signInWithPopup,
  GoogleAuthProvider,
  linkWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from "firebase/auth";
import { useEffect, useState } from "react";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

if (isConfigured) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(app);
  } catch (err) {
    console.warn("Failed to initialize Firebase:", err);
  }
}

/**
 * Get the authorization token for backend requests.
 * Uses real Firebase ID token for authenticated requests.
 */
export async function getAuthToken(): Promise<string> {
  if (!auth) {
    throw new Error("Firebase Authentication is not configured.");
  }

  // Ensure an auth session exists
  let user = auth.currentUser;
  if (!user) {
    const cred = await signInAnonymously(auth);
    user = cred.user;
  }

  return await user.getIdToken();
}

/**
 * Sign in with Google or link current anonymous guest session to Google.
 */
export async function linkOrSignInWithGoogle(): Promise<User> {
  if (!auth) {
    throw new Error("Firebase Auth is not configured. Check environment variables.");
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const currentUser = auth.currentUser;

  if (currentUser && currentUser.isAnonymous) {
    try {
      // Try to link the anonymous session so student keeps all progress
      const result = await linkWithPopup(currentUser, provider);
      return result.user;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/credential-already-in-use" || code === "auth/email-already-in-use") {
        // Account already exists: sign into that Google account directly
        const result = await signInWithPopup(auth, provider);
        return result.user;
      }
      throw err;
    }
  }

  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  if (!auth) return;
  await fbSignOut(auth);
  // Re-sign in anonymously so the user can immediately continue exploring
  try {
    await signInAnonymously(auth);
  } catch {
    /* ignore */
  }
}

export interface AuthState {
  user: User | null;
  loading: boolean;
  isAnonymous: boolean;
  displayName: string;
  photoURL: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [loading, setLoading] = useState<boolean>(Boolean(auth));

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        // Automatically start an anonymous session if no user is signed in
        try {
          const cred = await signInAnonymously(auth!);
          setUser(cred.user);
        } catch (e) {
          console.warn("Anonymous sign-in failed:", e);
          setUser(null);
        }
      } else {
        setUser(u);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      await linkOrSignInWithGoogle();
    } catch (err) {
      console.error("Google sign in failed:", err);
      throw err;
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
    } catch (err) {
      console.error("Sign out failed:", err);
    }
  };

  const isAnonymous = user ? user.isAnonymous : true;
  const displayName = user?.displayName || (isAnonymous ? "Guest Learner" : user?.email?.split("@")[0] || "Learner");
  const photoURL = user?.photoURL || null;

  return {
    user,
    loading,
    isAnonymous,
    displayName,
    photoURL,
    signInWithGoogle: handleGoogleSignIn,
    signOut: handleSignOut,
  };
}
