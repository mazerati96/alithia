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
let allUpdates = [];   // full cache — only fetched once per load
let activeFilter = "all"; // uid or "all"

// ── Auth guard ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    currentUser = user;
    revealDashboard(user);
    await loadAllUpdates();
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

        await loadAllUpdates();
        await loadStats(currentUser.uid);

    } catch (err) {
        console.error("Post failed:", err);
    }

    postBtn.disabled = false;
    postBtn.textContent = "Post Update";
});

// ── Load ALL updates once, then derive everything from cache ──
async function loadAllUpdates() {
    feedLoading.style.display = "flex";
    feedList.querySelectorAll(".update-card, .feed-empty").forEach(e => e.remove());

    try {
        const q = query(collection(db, "updates"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        allUpdates = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        feedLoading.style.display = "none";
        buildCollabList();
        buildFilterBar();
        renderFeed();

    } catch (err) {
        feedLoading.style.display = "none";
        console.error("Feed load failed:", err);
    }
}

// ── Render feed from cache applying active filter ─────────────
function renderFeed() {
    feedList.querySelectorAll(".update-card, .feed-empty").forEach(e => e.remove());

    const visible = activeFilter === "all"
        ? allUpdates
        : allUpdates.filter(u => u.authorUid === activeFilter);

    if (visible.length === 0) {
        const empty = document.createElement("div");
        empty.className = "feed-empty";
        empty.textContent = activeFilter === "all"
            ? "No updates yet. Be the first to chronicle the world."
            : "This collaborator hasn't posted yet.";
        feedList.appendChild(empty);
        return;
    }

    visible.forEach(data => feedList.appendChild(buildCard(data)));
}

// ── Build filter bar chips from unique authors ────────────────
function buildFilterBar() {
    const bar = document.getElementById("filterBar");
    // Keep the "All" chip, remove old author chips
    bar.querySelectorAll(".filter-chip:not([data-uid='all'])").forEach(c => c.remove());

    const authors = getUniqueAuthors();
    authors.forEach(({ uid, name }) => {
        const chip = document.createElement("button");
        chip.className = "filter-chip";
        chip.dataset.uid = uid;
        chip.textContent = name.split(" ")[0]; // first name only for brevity
        if (uid === activeFilter) chip.classList.add("active");
        chip.addEventListener("click", () => setFilter(uid));
        bar.appendChild(chip);
    });

    // Wire up "All" chip
    const allChip = bar.querySelector("[data-uid='all']");
    allChip.classList.toggle("active", activeFilter === "all");
    allChip.onclick = () => setFilter("all");
}

function setFilter(uid) {
    activeFilter = uid;
    buildFilterBar();
    renderFeed();
}

// ── Build collaborator list in sidebar ────────────────────────
function buildCollabList() {
    const list = document.getElementById("collabList");
    const countEl = document.getElementById("collabCount");
    const authors = getUniqueAuthors();

    countEl.textContent = authors.length;
    list.innerHTML = "";

    if (authors.length === 0) {
        list.innerHTML = '<div class="collab-loading">No collaborators yet.</div>';
        return;
    }

    authors.forEach(({ uid, name, count }) => {
        const isYou = currentUser && uid === currentUser.uid;
        const item = document.createElement("div");
        item.className = "collab-item" + (isYou ? " is-you" : "");

        item.innerHTML = `
            <div class="collab-item-avatar">${getInitials(name)}</div>
            <div class="collab-item-info">
                <div class="collab-item-name">${escHtml(name)}</div>
                <div class="collab-item-count">${count} update${count !== 1 ? "s" : ""}</div>
            </div>
            <span class="collab-item-arrow">›</span>
        `;

        item.addEventListener("click", () => openProfileModal(uid, name, count));
        list.appendChild(item);
    });
}

// ── Get unique authors sorted by post count ───────────────────
function getUniqueAuthors() {
    const map = new Map();
    allUpdates.forEach(u => {
        if (!map.has(u.authorUid)) {
            map.set(u.authorUid, { uid: u.authorUid, name: u.authorName, count: 0 });
        }
        map.get(u.authorUid).count++;
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
}

// ── Profile modal ─────────────────────────────────────────────
function openProfileModal(uid, name, postCount) {
    const backdrop = document.getElementById("profileModalBackdrop");
    const modalAvatar = document.getElementById("modalAvatar");
    const modalName = document.getElementById("modalName");
    const modalPosts = document.getElementById("modalPosts");
    const modalJoined = document.getElementById("modalJoined");
    const recentList = document.getElementById("modalRecentList");
    const filterBtn = document.getElementById("modalFilterBtn");

    modalAvatar.textContent = getInitials(name);
    modalName.textContent = name;
    modalPosts.textContent = `${postCount} update${postCount !== 1 ? "s" : ""}`;
    modalJoined.textContent = "Active collaborator";

    // Recent posts from cache
    recentList.innerHTML = "";
    const userPosts = allUpdates.filter(u => u.authorUid === uid).slice(0, 3);

    if (userPosts.length === 0) {
        recentList.innerHTML = '<div class="modal-loading">No updates yet.</div>';
    } else {
        userPosts.forEach(u => {
            const snippet = document.createElement("div");
            snippet.className = "modal-post-snippet";
            const timeStr = u.createdAt ? formatTime(u.createdAt.toDate()) : "—";
            snippet.innerHTML = `
                <div class="modal-post-text">${escHtml(u.content)}</div>
                <div class="modal-post-time">${timeStr}</div>
            `;
            recentList.appendChild(snippet);
        });
    }

    // "View all" button filters feed and closes modal
    filterBtn.onclick = () => {
        setFilter(uid);
        closeProfileModal();
        // Scroll to feed
        document.querySelector(".dash-feed").scrollIntoView({ behavior: "smooth" });
    };

    backdrop.classList.remove("hidden");
}

function closeProfileModal() {
    document.getElementById("profileModalBackdrop").classList.add("hidden");
}

document.getElementById("modalClose").addEventListener("click", closeProfileModal);
document.getElementById("profileModalBackdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeProfileModal();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeProfileModal();
});

// ── Build update card ─────────────────────────────────────────
function buildCard(data) {
    const id = data.id;
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
            // Update cache
            const cached = allUpdates.find(u => u.id === card.dataset.id);
            if (cached) { cached.content = newText; cached.edited = true; }
            renderFeed();
        } catch (err) { console.error("Edit failed:", err); }
    });

    actions.querySelector(".cancel-btn").addEventListener("click", () => renderFeed());
}

// ── Delete ───────────────────────────────────────────────────
async function deleteCard(card, id) {
    if (!confirm("Remove this update from the chronicle?")) return;
    try {
        await deleteDoc(doc(db, "updates", id));
        // Remove from cache
        allUpdates = allUpdates.filter(u => u.id !== id);
        card.style.opacity = "0";
        card.style.transform = "translateY(-6px)";
        card.style.transition = "all 0.3s ease";
        setTimeout(() => {
            renderFeed();
            buildCollabList();
            buildFilterBar();
            loadStats(currentUser.uid);
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