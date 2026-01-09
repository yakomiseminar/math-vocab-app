import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB8SVOSNaMDGRHJ3Iz3J1BOslnKGxrfqEQ",
  authDomain: "math-vocab-log.firebaseapp.com",
  projectId: "math-vocab-log",
  storageBucket: "math-vocab-log.firebasestorage.app",
  messagingSenderId: "1045780693120",
  appId: "1:1045780693120:web:4c98697980588fbf67e665",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
