// ============================================================
//  js/dashboard.js  —  Alithia Collaborator Dashboard
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged, signOut }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    collection, addDoc, getDocs, doc, deleteDoc,
    updateDoc, query, orderBy, serverTimestamp, where, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Particle canvas ──────────────────────────────────────────
const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d");
let W, H, particles;

function resizeCanvas() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
}

function makeParticle() {
    return {
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.2 + 0.2,
        speed: Math.random() * 0.25 + 0.04,
        drift: (Math.random() - 0.5) * 0.15,
        alpha: Math.random() * 0.45 + 0.08,
        pulse: Math.random() * Math.PI * 2,
    };
}

function initParticles() {
    particles = Array.from({ length: Math.floor((W * H) / 8000) }, makeParticle);
}

function drawParticles() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
        p.pulse += 0.01;
        const a = p.alpha * (0.5 + 0.5 * Math.sin(p.pulse));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(61,255,143,${a})`;
        ctx.shadowColor = "#3dff8f";
        ctx.shadowBlur = 4;
        ctx.fill();
        p.y -= p.speed;
        p.x += p.drift;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        if (p.x < -4) { p.x = W + 4; }
        if (p.x > W + 4) { p.x = -4; }
    }
    requestAnimationFrame(drawParticles);
}

window.addEventListener("resize", () => { resizeCanvas(); initParticles(); });
resizeCanvas(); initParticles(); requestAnimationFrame(drawParticles);

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const dashWrap = document.getElementById("dashboardWrap");
const topbarUsername = document.getElementById("topbarUsername");
const signOutBtn = document.getElementById("signOutBtn");
const composerAvatar = document.getElementById("composerAvatar");
const composerName = document.getElementById("composerName");
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileSince = document.getElementById("profileSince");
const statPosts = document.getElementById("statPosts");
const statDays = document.getElementById("statDays");
const postContent = document.getElementById("postContent");
const charCount = document.getElementById("charCount");
const postBtn = document.getElementById("postBtn");
const feedList = document.getElementById("feedList");
const feedLoading = document.getElementById("feedLoading");

// ── Current user state ───────────────────────────────────────
let currentUser = null;

// ── Auth guard ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        // Not logged in — hard redirect
        window.location.href = "login.html";
        return;
    }

    currentUser = user;
    revealDashboard(user);
    await loadFeed();
    await loadStats(user.uid);
});

function revealDashboard(user) {
    const name = user.displayName || user.email;
    const initials = getInitials(name);

    // Topbar
    topbarUsername.textContent = name;

    // Composer
    composerAvatar.textContent = initials;
    composerName.textContent = name;

    // Sidebar profile
    profileAvatar.textContent = initials;
    profileName.textContent = name;
    profileSince.textContent = `Joined ${formatJoinDate(user.metadata.creationTime)}`;

    // Fade out auth guard, reveal dashboard
    authGuard.classList.add("fade-out");
    setTimeout(() => {
        authGuard.style.display = "none";
        dashWrap.classList.remove("hidden");
    }, 500);
}

// ── Sign out ─────────────────────────────────────────────────
signOutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
});

// ── Char counter ─────────────────────────────────────────────
postContent.addEventListener("input", () => {
    const len = postContent.value.length;
    charCount.textContent = `${len} / 1000`;
    charCount.className = "char-count";
    if (len >= 950) charCount.classList.add("near-limit");
    if (len >= 1000) charCount.classList.add("at-limit");
});

// ── Post update ──────────────────────────────────────────────
postBtn.addEventListener("click", async () => {
    const text = postContent.value.trim();
    if (!text || !currentUser) return;

    postBtn.disabled = true;
    postBtn.textContent = "Posting…";

    try {
        await addDoc(collection(db, "updates"), {
            content: text,
            authorUid: currentUser.uid,
            authorName: currentUser.displayName || currentUser.email,
            createdAt: serverTimestamp(),
            edited: false,
        });

        postContent.value = "";
        charCount.textContent = "0 / 1000";
        charCount.className = "char-count";

        await loadFeed();
        await loadStats(currentUser.uid);

    } catch (err) {
        console.error("Post failed:", err);
    }

    postBtn.disabled = false;
    postBtn.textContent = "Post Update";
});

// ── Load feed ────────────────────────────────────────────────
async function loadFeed() {
    feedLoading.style.display = "flex";

    // Remove all cards but keep the loading indicator
    feedList.querySelectorAll(".update-card").forEach(c => c.remove());
    const emptyEl = feedList.querySelector(".feed-empty");
    if (emptyEl) emptyEl.remove();

    try {
        const q = query(
            collection(db, "updates"),
            orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);

        feedLoading.style.display = "none";

        if (snap.empty) {
            const empty = document.createElement("div");
            empty.className = "feed-empty";
            empty.textContent = "No updates yet. Be the first to chronicle the world.";
            feedList.appendChild(empty);
            return;
        }

        snap.forEach(docSnap => {
            feedList.appendChild(buildCard(docSnap));
        });

    } catch (err) {
        feedLoading.style.display = "none";
        console.error("Feed load failed:", err);
    }
}

// ── Build update card ─────────────────────────────────────────
function buildCard(docSnap) {
    const data = docSnap.data();
    const id = docSnap.id;
    const isOwn = currentUser && data.authorUid === currentUser.uid;

    const card = document.createElement("div");
    card.className = "update-card";
    card.dataset.id = id;

    const timeStr = data.createdAt ? formatTime(data.createdAt.toDate()) : "just now";
    const editedTag = data.edited ? '<span class="card-edited-tag">(edited)</span>' : "";

    card.innerHTML = `
        <div class="card-meta">
            <div class="card-avatar">${getInitials(data.authorName)}</div>
            <span class="card-author">${escHtml(data.authorName)}</span>
            ${editedTag}
            <span class="card-time">${timeStr}</span>
        </div>
        <div class="card-body" data-display>${escHtml(data.content)}</div>
        ${isOwn ? `
        <div class="card-actions" data-actions>
            <button class="card-action-btn edit-btn">Edit</button>
            <button class="card-action-btn delete-btn">Delete</button>
        </div>` : ""}
    `;

    if (isOwn) {
        card.querySelector(".edit-btn").addEventListener("click", () => enterEditMode(card, data));
        card.querySelector(".delete-btn").addEventListener("click", () => deleteCard(card, id));
    }

    return card;
}

// ── Edit mode ────────────────────────────────────────────────
function enterEditMode(card, data) {
    const display = card.querySelector("[data-display]");
    const actions = card.querySelector("[data-actions]");

    // Swap body for textarea
    const ta = document.createElement("textarea");
    ta.className = "card-edit-textarea";
    ta.value = data.content;
    display.replaceWith(ta);
    ta.focus();

    // Swap actions for save/cancel
    actions.innerHTML = `
        <button class="card-action-btn save-btn">Save</button>
        <button class="card-action-btn cancel-btn">Cancel</button>
    `;

    actions.querySelector(".save-btn").addEventListener("click", async () => {
        const newText = ta.value.trim();
        if (!newText) return;

        try {
            await updateDoc(doc(db, "updates", card.dataset.id), {
                content: newText,
                edited: true,
            });
            await loadFeed();
        } catch (err) { console.error("Edit failed:", err); }
    });

    actions.querySelector(".cancel-btn").addEventListener("click", () => loadFeed());
}

// ── Delete ───────────────────────────────────────────────────
async function deleteCard(card, id) {
    if (!confirm("Remove this update from the chronicle?")) return;
    try {
        await deleteDoc(doc(db, "updates", id));
        card.style.animation = "none";
        card.style.opacity = "0";
        card.style.transform = "translateY(-6px)";
        card.style.transition = "all 0.3s ease";
        setTimeout(() => {
            card.remove();
            loadStats(currentUser.uid);
            if (!feedList.querySelector(".update-card")) {
                const empty = document.createElement("div");
                empty.className = "feed-empty";
                empty.textContent = "No updates yet. Be the first to chronicle the world.";
                feedList.appendChild(empty);
            }
        }, 300);
    } catch (err) { console.error("Delete failed:", err); }
}

// ── Load stats ───────────────────────────────────────────────
async function loadStats(uid) {
    try {
        const q = query(collection(db, "updates"), where("authorUid", "==", uid));
        const snap = await getCountFromServer(q);
        statPosts.textContent = snap.data().count;

        // Days since account creation
        const created = new Date(currentUser.metadata.creationTime);
        const daysSince = Math.max(1, Math.floor((Date.now() - created) / 86400000));
        statDays.textContent = daysSince;

    } catch (err) {
        statPosts.textContent = "—";
        statDays.textContent = "—";
    }
}

// ── Helpers ──────────────────────────────────────────────────
function getInitials(name) {
    if (!name) return "?";
    return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatTime(date) {
    const now = Date.now();
    const diff = now - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatJoinDate(timeStr) {
    if (!timeStr) return "—";
    const d = new Date(timeStr);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}