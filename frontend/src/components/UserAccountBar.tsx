import { useState } from "react";
import { useAuth } from "../auth/firebase";

export function UserAccountBar() {
  const { isAnonymous, displayName, photoURL, signInWithGoogle, signOut, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    try {
      setSigningIn(true);
      setError(null);
      await signInWithGoogle();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Sign-in failed";
      // Ignore user popup closed by user
      if (!msg.includes("popup-closed-by-user")) {
        setError("Sign-in failed. Please try again.");
      }
    } finally {
      setSigningIn(false);
    }
  };

  if (loading) {
    return <div className="account-bar account-bar--loading">Connecting...</div>;
  }

  return (
    <div className="account-bar" role="region" aria-label="Account information">
      {error && <span className="account-bar__error" role="alert">{error}</span>}

      {isAnonymous ? (
        <div className="account-bar__guest">
          <span className="account-bar__label">Guest</span>
          <button
            type="button"
            className="account-bar__google-btn"
            onClick={handleSignIn}
            disabled={signingIn}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            {signingIn ? "Connecting..." : "Save with Google"}
          </button>
        </div>
      ) : (
        <div className="account-bar__user">
          {photoURL ? (
            <img src={photoURL} alt="" className="account-bar__avatar" />
          ) : (
            <div className="account-bar__avatar-fallback">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="account-bar__name">{displayName}</span>
          <button
            type="button"
            className="btn btn--subtle btn--sm"
            onClick={signOut}
            title="Sign out of Google"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
