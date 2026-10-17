import type { CollectionReference, DocumentReference, Firestore } from "firebase-admin/firestore";

export function learnerDocument(db: Firestore, uid: string): DocumentReference {
  return db.collection("users").doc(uid);
}

export function learnerCollection(db: Firestore, uid: string, name: string): CollectionReference {
  return learnerDocument(db, uid).collection(name);
}
