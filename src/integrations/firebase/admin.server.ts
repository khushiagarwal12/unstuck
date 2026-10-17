import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function firebaseApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("Firebase server configuration is missing FIREBASE_PROJECT_ID.");
  return getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId });
}

export const firebaseAdminAuth = () => getAuth(firebaseApp());
export const firestore = () => getFirestore(firebaseApp());
