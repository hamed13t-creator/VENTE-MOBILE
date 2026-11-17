// Initialisation Firebase (une seule fois) + fonctions réexportées
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, query, where, orderBy, limit, writeBatch,
  increment, Timestamp, arrayUnion, getDoc, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

export const configured = !!firebaseConfig.apiKey;
export let auth = null, db = null;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
}
export {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  collection, doc, onSnapshot, query, where, orderBy, limit, writeBatch,
  increment, Timestamp, arrayUnion, getDoc, getDocs, serverTimestamp
};
