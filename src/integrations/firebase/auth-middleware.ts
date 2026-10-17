import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { firebaseAdminAuth } from "./admin.server";

class FirebaseAuthenticationError extends Error {
  readonly statusCode = 401;
}

export const requireFirebaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const userId = await optionalFirebaseUserId();
  if (!userId) throw new FirebaseAuthenticationError("Unauthorized: Firebase sign-in is required.");
  return next({ context: { userId } });
});

export async function optionalFirebaseUserId(): Promise<string | null> {
  const authorization = getRequest()?.headers.get("authorization");
  if (!authorization) return null;
  if (!authorization.startsWith("Bearer ")) throw new FirebaseAuthenticationError("Unauthorized: Firebase sign-in is required.");
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new FirebaseAuthenticationError("Unauthorized: Firebase sign-in is required.");
  return verifyFirebaseIdToken(token, (value) => firebaseAdminAuth().verifyIdToken(value, true));
}

export async function verifyFirebaseIdToken(
  token: string,
  verify: (token: string) => Promise<{ uid: string }>,
): Promise<string> {
  try {
    const decoded = await verify(token);
    if (!decoded.uid) throw new FirebaseAuthenticationError("Missing Firebase UID.");
    return decoded.uid;
  } catch {
    throw new FirebaseAuthenticationError("Unauthorized: Firebase ID token is invalid or expired.");
  }
}
