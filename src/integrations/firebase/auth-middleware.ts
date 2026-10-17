import { createMiddleware } from "@tanstack/react-start";

// Server-only code lives in auth-user.server.ts and is imported lazily so it never reaches the browser bundle.
export const requireFirebaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { optionalFirebaseUserId, FirebaseAuthenticationError } = await import("./auth-user.server");
  const userId = await optionalFirebaseUserId();
  if (!userId) throw new FirebaseAuthenticationError("Unauthorized: Firebase sign-in is required.");
  return next({ context: { userId } });
});
