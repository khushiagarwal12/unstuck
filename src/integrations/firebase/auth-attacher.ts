import { createMiddleware } from "@tanstack/react-start";

import { getFirebaseAuth, isFirebaseConfigured } from "./client";

export const attachFirebaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  if (!isFirebaseConfigured()) return next({ headers: {} });
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
});
