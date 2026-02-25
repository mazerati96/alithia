// ============================================================
//  js/login.js  —  Alithia Collaborator Auth
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Particle canvas (matches splash aesthetic) ──────────────
const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d");
let W, H, particles;

function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
}

function randomParticle() {
    return {
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.4 + 0.2,
        speed: Math.random() * 0.3 + 0.05,
        drift: (Math.random() - 0.5) * 0.2,
        alpha: Math.random() * 0.5 + 0.1,
        pulse: Math.random() * Math.PI * 2,
    };
}

function initParticles() {
    const count = Math.floor((W * H) / 7000);
    particles = Array.from({ length: count }, randomParticle);
}

function drawParticles() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
        p.pulse += 0.011;
        const a = p.alpha * (0.55 + 0.45 * Math.sin(p.pulse));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(61, 255, 143, ${a})`;
        ctx.shadowColor = "#3dff8f";
        ctx.shadowBlur = 5;
        ctx.fill();
        p.y -= p.speed;
        p.x += p.drift;
        if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
        if (p.x < -5) { p.x = W + 5; }
        if (p.x > W + 5) { p.x = -5; }
    }
    requestAnimationFrame(drawParticles);
}

window.addEventListener("resize", () => { resize(); initParticles(); });
resize();
initParticles();
requestAnimationFrame(drawParticles);

// ── Tab switching ────────────────────────────────────────────
const tabBtns = document.querySelectorAll(".tab-btn");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");

tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        tabBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        clearMessages();

        if (btn.dataset.tab === "login") {
            loginForm.classList.remove("hidden");
            registerForm.classList.add("hidden");
        } else {
            registerForm.classList.remove("hidden");
            loginForm.classList.add("hidden");
        }
    });
});

// ── Eye / password toggle ────────────────────────────────────
document.querySelectorAll(".eye-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        const isHidden = input.type === "password";
        input.type = isHidden ? "text" : "password";

        const open = btn.querySelector(".eye-open");
        const closed = btn.querySelector(".eye-closed");
        open.style.display = isHidden ? "none" : "";
        closed.style.display = isHidden ? "" : "none";
    });
});

// ── Helpers ──────────────────────────────────────────────────
function setMessage(elId, text, type) {
    const el = document.getElementById(elId);
    el.textContent = text;
    el.className = `form-message ${type}`;
}

function clearMessages() {
    ["loginMessage", "registerMessage"].forEach(id => {
        const el = document.getElementById(id);
        el.textContent = "";
        el.className = "form-message";
    });
}

function setLoading(btnId, spinnerId, loading) {
    const btn = document.getElementById(btnId);
    const spinner = btn.querySelector(".btn-spinner");
    const text = btn.querySelector(".btn-text");
    btn.disabled = loading;
    spinner.style.display = loading ? "" : "none";
    text.style.display = loading ? "none" : "";
}

// Friendly Firebase error messages
function friendlyError(code) {
    const map = {
        "auth/invalid-email": "That email address doesn't look right.",
        "auth/user-not-found": "No collaborator found with that email.",
        "auth/wrong-password": "Incorrect password. Try again.",
        "auth/email-already-in-use": "That email is already registered.",
        "auth/weak-password": "Password must be at least 6 characters.",
        "auth/too-many-requests": "Too many attempts. Please wait a moment.",
        "auth/network-request-failed": "Network error. Check your connection.",
    };
    return map[code] || "Something went wrong. Please try again.";
}

// ── LOGIN ────────────────────────────────────────────────────
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessages();

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!email || !password) {
        setMessage("loginMessage", "Please fill in all fields.", "error");
        return;
    }

    setLoading("loginSubmit", "loginSpinner", true);

    try {
        await signInWithEmailAndPassword(auth, email, password);
        if (isKeeper = true) { setMessage("loginMessage", "Welcome back, Keeper. Entering Alithia…", "success"); }  
        setMessage("loginMessage", "Welcome back, collaborator. Entering Alithia…", "success");
        setTimeout(() => {
            window.location.href = "dashboard.html";
        }, 1200);
    } catch (err) {
        setMessage("loginMessage", friendlyError(err.code), "error");
        setLoading("loginSubmit", "loginSpinner", false);
    }
});

// ── REGISTER ─────────────────────────────────────────────────
registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessages();

    const username = document.getElementById("regUsername").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    const confirm = document.getElementById("regConfirm").value;
    const magicKey = document.getElementById("regMagicKey").value.trim();

    // Basic validation
    if (!username || !email || !password || !confirm || !magicKey) {
        setMessage("registerMessage", "All fields are required.", "error");
        return;
    }

    if (password !== confirm) {
        setMessage("registerMessage", "Passwords do not match.", "error");
        return;
    }

    if (password.length < 6) {
        setMessage("registerMessage", "Password must be at least 6 characters.", "error");
        return;
    }

    setLoading("registerSubmit", "registerSpinner", true);

    try {
        // ── Validate magic key against Firestore ──
        // Firestore doc: config/invite  →  { key: "your-secret-phrase" }
        const inviteDoc = await getDoc(doc(db, "config", "invite"));

        if (!inviteDoc.exists()) {
            setMessage("registerMessage", "Invite configuration not found. Contact the keeper.", "error");
            setLoading("registerSubmit", "registerSpinner", false);
            return;
        }

        const storedKey = inviteDoc.data().key;

        if (magicKey !== storedKey) {
            setMessage("registerMessage", "That key doesn't open this door. Check with the keeper of Alithia.", "error");
            setLoading("registerSubmit", "registerSpinner", false);
            return;
        }

        // ── Create Firebase Auth account ──
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // ── Set display name ──
        await updateProfile(user, { displayName: username });

        // ── Create Firestore user profile ──
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            username: username,
            email: email,
            role: "collaborator",
            createdAt: serverTimestamp(),
        });

        setMessage("registerMessage", `Welcome, ${username}. The gates of Alithia open for you…`, "success");
        setTimeout(() => {
            window.location.href = "dashboard.html";
        }, 1500);

    } catch (err) {
        setMessage("registerMessage", friendlyError(err.code), "error");
        setLoading("registerSubmit", "registerSpinner", false);
    }
});