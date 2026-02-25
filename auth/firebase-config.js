// ============================================================
//  auth/firebase-config.js
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
//get from firebase console, under project settings > general > your apps > firebase SDK snippet > config
const firebaseConfig = {
    apiKey: "AIzaSyBX0cEHFSOSMXJLzuXiNnJSMTfto7Y7aKc",
    authDomain: "alithia-4a23c.firebaseapp.com",
    projectId: "alithia-4a23c",
    storageBucket: "alithia-4a23c.firebasestorage.app",
    messagingSenderId: "223234178919",
    appId: "1:223234178919:web:ff36d7005a6a3e86f339c2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };