// Firebase init: Google sign-in + Firestore with offline (IndexedDB) persistence.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBZ5k7t7cn_ZtNsIBA1KTnb-ubGozu2_Dw',
  authDomain: 'vacation-planner-b5702.firebaseapp.com',
  projectId: 'vacation-planner-b5702',
  storageBucket: 'vacation-planner-b5702.firebasestorage.app',
  messagingSenderId: '301683277932',
  appId: '1:301683277932:web:393d91cc6167bce04a5849',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
});

export { onAuthStateChanged, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch };

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else {
      throw e;
    }
  }
}

export const signOut = () => fbSignOut(auth);
