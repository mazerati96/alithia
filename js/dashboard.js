// ============================================================
//  js/dashboard.js  —  Alithia Collaborator Dashboard
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    collection, addDoc, getDocs, getDoc, doc, deleteDoc,
    updateDoc, setDoc, query, orderBy, serverTimestamp,
    where, getCountFromServer, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Particle canvas ──────────────────────────────────────────
const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d");
let W, H, particles;
function resizeCanvas() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
function makeParticle() { return { x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.2 + 0.2, speed: Math.random() * 0.25 + 0.04, drift: (Math.random() - 0.5) * 0.15, alpha: Math.random() * 0.45 + 0.08, pulse: Math.random() * Math.PI * 2 }; }
function initParticles() { particles = Array.from({ length: Math.floor((W * H) / 8000) }, makeParticle); }
function drawParticles() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
        p.pulse += 0.01;
        const a = p.alpha * (0.5 + 0.5 * Math.sin(p.pulse));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(61,255,143,${a})`; ctx.shadowColor = "#3dff8f"; ctx.shadowBlur = 4; ctx.fill();
        p.y -= p.speed; p.x += p.drift;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; } if (p.x < -4) { p.x = W + 4; } if (p.x > W + 4) { p.x = -4; }
    }
    requestAnimationFrame(drawParticles);
}
window.addEventListener("resize", () => { resizeCanvas(); initParticles(); });
resizeCanvas(); initParticles(); requestAnimationFrame(drawParticles);

// ── State ────────────────────────────────────────────────────
let currentUser = null;
let isKeeper = false;
let allUpdates = [];
let allUsers = [];
let announcements = [];
let allClaims = [];
let activeFilter = "all";   // uid or "all"
let activeCat = "all";   // category or "all"

const REACTION_RUNES = ["ᚠ", "ᚢ", "ᚦ", "✦", "⚔", "📜"];

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const dashWrap = document.getElementById("dashboardWrap");
const topbarUsername = document.getElementById("topbarUsername");
const notifDot = document.getElementById("notifDot");
const signOutBtn = document.getElementById("signOutBtn");
const composerAvatar = document.getElementById("composerAvatar");
const composerName = document.getElementById("composerName");
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileRole = document.getElementById("profileRole");
const profileSince = document.getElementById("profileSince");
const statPosts = document.getElementById("statPosts");
const statDays = document.getElementById("statDays");
const postContent = document.getElementById("postContent");
const charCount = document.getElementById("charCount");
const postBtn = document.getElementById("postBtn");
const feedList = document.getElementById("feedList");
const feedLoading = document.getElementById("feedLoading");

// ── Auth guard ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    currentUser = user;

    // Load user doc to check keeper role
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
        isKeeper = userDoc.data().role === "keeper";
    }

    revealDashboard(user);
    await Promise.all([loadAllUpdates(), loadAnnouncements(), loadAllUsers(), loadClaims()]);
    checkNotifications();
    await loadStats(user.uid);
    updateLastVisited(user.uid);
});

function revealDashboard(user) {
    const name = user.displayName || user.email;
    const initials = getInitials(name);

    topbarUsername.textContent = name;
    composerAvatar.textContent = initials;
    composerName.textContent = name;
    profileAvatar.textContent = initials;
    profileName.textContent = name;
    profileSince.textContent = `Joined ${formatJoinDate(user.metadata.creationTime)}`;

    if (isKeeper) {
        profileRole.textContent = "Keeper of Alithia";
        profileRole.style.color = "var(--green)";
        const badge = document.createElement("div");
        badge.className = "keeper-badge";
        badge.textContent = "✦ Keeper ✦";
        profileRole.insertAdjacentElement("afterend", badge);
        document.getElementById("announceAddBtn").classList.remove("hidden");
    }

    document.getElementById("editProfileBtn").addEventListener("click", openEditProfileModal);

    authGuard.classList.add("fade-out");
    setTimeout(() => { authGuard.style.display = "none"; dashWrap.classList.remove("hidden"); }, 500);
}

// ── Sign out ─────────────────────────────────────────────────
signOutBtn.addEventListener("click", async () => { await signOut(auth); window.location.href = "login.html"; });

// ── Notifications ─────────────────────────────────────────────
async function checkNotifications() {
    try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        const lastVisited = userDoc.data()?.lastVisited?.toDate?.() || new Date(0);
        const hasNew = allUpdates.some(u => u.createdAt && u.createdAt.toDate() > lastVisited && u.authorUid !== currentUser.uid);
        if (hasNew) notifDot.classList.remove("hidden");
    } catch (e) { /* silent */ }
}

async function updateLastVisited(uid) {
    try { await updateDoc(doc(db, "users", uid), { lastVisited: serverTimestamp() }); } catch (e) { /* silent */ }
}

// ── Char counter ─────────────────────────────────────────────
postContent.addEventListener("input", () => {
    const len = postContent.value.length;
    charCount.textContent = `${len} / 1000`;
    charCount.className = "char-count" + (len >= 1000 ? " at-limit" : len >= 950 ? " near-limit" : "");
});

// ── Post update ──────────────────────────────────────────────
postBtn.addEventListener("click", async () => {
    const text = postContent.value.trim();
    const category = document.getElementById("postCategory").value;
    if (!text || !currentUser) return;

    postBtn.disabled = true;
    postBtn.textContent = "Posting…";

    try {
        const docRef = await addDoc(collection(db, "updates"), {
            content: text,
            category: category,
            authorUid: currentUser.uid,
            authorName: currentUser.displayName || currentUser.email,
            createdAt: serverTimestamp(),
            edited: false,
            reactions: {}
        });

        // Write to changelog
        await logChange("update_posted", `New update by ${currentUser.displayName || currentUser.email}`, text.slice(0, 120));

        postContent.value = "";
        charCount.textContent = "0 / 1000";
        charCount.className = "char-count";
        notifDot.classList.add("hidden");

        await loadAllUpdates();
        await loadStats(currentUser.uid);

    } catch (err) { console.error("Post failed:", err); }

    postBtn.disabled = false;
    postBtn.textContent = "Post Update";
});

// ── Load ALL updates ──────────────────────────────────────────
async function loadAllUpdates() {
    feedLoading.style.display = "flex";
    feedList.querySelectorAll(".update-card,.feed-empty").forEach(e => e.remove());

    try {
        const snap = await getDocs(query(collection(db, "updates"), orderBy("createdAt", "desc")));
        allUpdates = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        feedLoading.style.display = "none";
        buildFilterBar();
        buildCategoryBar();
        renderFeed();
    } catch (err) {
        feedLoading.style.display = "none";
        console.error("Feed load failed:", err);
    }
}

// ── Render feed from cache ────────────────────────────────────
function renderFeed() {
    feedList.querySelectorAll(".update-card,.feed-empty").forEach(e => e.remove());

    let visible = allUpdates;
    if (activeFilter !== "all") visible = visible.filter(u => u.authorUid === activeFilter);
    if (activeCat !== "all") visible = visible.filter(u => (u.category || "misc") === activeCat);

    if (visible.length === 0) {
        const empty = document.createElement("div");
        empty.className = "feed-empty";
        empty.textContent = activeFilter !== "all" || activeCat !== "all"
            ? "No updates match this filter."
            : "No updates yet. Be the first to chronicle the world.";
        feedList.appendChild(empty);
        return;
    }

    visible.forEach(data => feedList.appendChild(buildCard(data)));
}

// ── Author filter bar ─────────────────────────────────────────
function buildFilterBar() {
    const bar = document.getElementById("filterBar");
    bar.querySelectorAll(".filter-chip:not([data-uid='all'])").forEach(c => c.remove());

    const authors = getUniqueAuthors();
    authors.forEach(({ uid, name }) => {
        const chip = document.createElement("button");
        chip.className = "filter-chip";
        chip.dataset.uid = uid;
        chip.textContent = name.split(" ")[0];
        if (uid === activeFilter) chip.classList.add("active");
        chip.addEventListener("click", () => setFilter(uid));
        bar.appendChild(chip);
    });

    const allChip = bar.querySelector("[data-uid='all']");
    allChip.classList.toggle("active", activeFilter === "all");
    allChip.onclick = () => setFilter("all");
}

function setFilter(uid) { activeFilter = uid; buildFilterBar(); renderFeed(); }

// ── Category filter bar ───────────────────────────────────────
function buildCategoryBar() {
    document.querySelectorAll(".cat-chip").forEach(chip => {
        chip.classList.toggle("active", chip.dataset.cat === activeCat);
        chip.onclick = () => { activeCat = chip.dataset.cat; buildCategoryBar(); renderFeed(); };
    });
}

// ── Build update card ─────────────────────────────────────────
function buildCard(data) {
    const id = data.id;
    const isOwn = currentUser && data.authorUid === currentUser.uid;
    const canDelete = isOwn || isKeeper;
    const cat = data.category || "misc";
    const catLabels = { lore: "📜 Lore", character: "👤 Character", map: "🗺 Map", mechanics: "⚙ Mechanics", misc: "✦ Misc" };

    const card = document.createElement("div");
    card.className = "update-card";
    card.dataset.id = id;

    const timeStr = data.createdAt ? formatTime(data.createdAt.toDate()) : "just now";
    const editedTag = data.edited ? '<span class="card-edited-tag">(edited)</span>' : "";

    card.innerHTML = `
        <div class="card-meta">
            <div class="card-avatar">${getInitials(data.authorName)}</div>
            <span class="card-author">${escHtml(data.authorName)}</span>
            <span class="card-category-tag">${catLabels[cat] || cat}</span>
            ${editedTag}
            <span class="card-time">${timeStr}</span>
        </div>
        <div class="card-body" data-display>${escHtml(data.content)}</div>
        <div class="card-reactions" data-reactions></div>
        ${canDelete ? `<div class="card-actions" data-actions>
            ${isOwn ? `<button class="card-action-btn edit-btn">Edit</button>` : ""}
            <button class="card-action-btn delete-btn${!isOwn && isKeeper ? " keeper-delete-btn" : ""}">
                ${!isOwn && isKeeper ? "✦ Remove" : "Delete"}
            </button>
        </div>` : ""}
    `;

    buildReactions(card, data);

    if (isOwn) {
        card.querySelector(".edit-btn").addEventListener("click", () => enterEditMode(card, data));
    }
    if (canDelete) {
        card.querySelector(".delete-btn").addEventListener("click", () => deleteCard(card, id));
    }

    return card;
}

// ── Reactions ─────────────────────────────────────────────────
function buildReactions(card, data) {
    const reactionsEl = card.querySelector("[data-reactions]");
    reactionsEl.innerHTML = "";

    const reactions = data.reactions || {};

    REACTION_RUNES.forEach(rune => {
        const users = reactions[rune] || [];
        if (users.length === 0) return;
        const hasReacted = currentUser && users.includes(currentUser.uid);

        const btn = document.createElement("button");
        btn.className = "reaction-btn" + (hasReacted ? " reacted" : "");
        btn.innerHTML = `${rune} <span class="reaction-count">${users.length}</span>`;
        btn.addEventListener("click", () => toggleReaction(card, data, rune));
        reactionsEl.appendChild(btn);
    });

    // Add reaction button
    const addBtn = document.createElement("button");
    addBtn.className = "reaction-add-btn";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showReactionPicker(card, data, addBtn);
    });
    reactionsEl.appendChild(addBtn);
}

function showReactionPicker(card, data, anchor) {
    // Remove any existing picker
    document.querySelectorAll(".reaction-picker").forEach(p => p.remove());

    const picker = document.createElement("div");
    picker.className = "reaction-picker";
    REACTION_RUNES.forEach(rune => {
        const btn = document.createElement("button");
        btn.textContent = rune;
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            picker.remove();
            toggleReaction(card, data, rune);
        });
        picker.appendChild(btn);
    });
    anchor.insertAdjacentElement("afterend", picker);

    // Close on outside click
    setTimeout(() => {
        document.addEventListener("click", () => picker.remove(), { once: true });
    }, 10);
}

async function toggleReaction(card, data, rune) {
    if (!currentUser) return;
    const reactions = data.reactions || {};
    const users = reactions[rune] || [];
    const hasReacted = users.includes(currentUser.uid);

    try {
        const field = `reactions.${rune}`;
        await updateDoc(doc(db, "updates", data.id), {
            [field]: hasReacted ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid)
        });

        // Update cache
        if (!data.reactions) data.reactions = {};
        if (!data.reactions[rune]) data.reactions[rune] = [];
        if (hasReacted) {
            data.reactions[rune] = data.reactions[rune].filter(u => u !== currentUser.uid);
        } else {
            data.reactions[rune].push(currentUser.uid);
        }

        buildReactions(card, data);
    } catch (err) { console.error("Reaction failed:", err); }
}

// ── Edit mode ─────────────────────────────────────────────────
function enterEditMode(card, data) {
    const display = card.querySelector("[data-display]");
    const actions = card.querySelector("[data-actions]");

    const ta = document.createElement("textarea");
    ta.className = "card-edit-textarea";
    ta.value = data.content;
    display.replaceWith(ta);
    ta.focus();

    actions.innerHTML = `
        <button class="card-action-btn save-btn">Save</button>
        <button class="card-action-btn cancel-btn">Cancel</button>
    `;

    actions.querySelector(".save-btn").addEventListener("click", async () => {
        const newText = ta.value.trim();
        if (!newText) return;
        try {
            await updateDoc(doc(db, "updates", card.dataset.id), { content: newText, edited: true });
            const cached = allUpdates.find(u => u.id === card.dataset.id);
            if (cached) { cached.content = newText; cached.edited = true; }
            renderFeed();
        } catch (err) { console.error("Edit failed:", err); }
    });
    actions.querySelector(".cancel-btn").addEventListener("click", () => renderFeed());
}

// ── Delete ────────────────────────────────────────────────────
async function deleteCard(card, id) {
    if (!confirm("Remove this update from the chronicle?")) return;
    try {
        await deleteDoc(doc(db, "updates", id));
        allUpdates = allUpdates.filter(u => u.id !== id);
        card.style.opacity = "0"; card.style.transform = "translateY(-6px)"; card.style.transition = "all 0.3s ease";
        setTimeout(() => { renderFeed(); buildCollabList(); buildFilterBar(); loadStats(currentUser.uid); }, 300);
    } catch (err) { console.error("Delete failed:", err); }
}

// ── Announcements ─────────────────────────────────────────────
async function loadAnnouncements() {
    try {
        const snap = await getDocs(query(collection(db, "announcements"), orderBy("createdAt", "desc")));
        announcements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAnnouncements();
    } catch (err) { console.error("Announcements load failed:", err); }
}

function renderAnnouncements() {
    const list = document.getElementById("announceList");
    list.innerHTML = "";

    if (announcements.length === 0) {
        list.innerHTML = '<div class="announce-empty">No announcements yet.</div>';
        return;
    }

    announcements.forEach(a => {
        const card = document.createElement("div");
        card.className = "announce-card";
        const timeStr = a.createdAt ? formatTime(a.createdAt.toDate()) : "—";
        card.innerHTML = `
            <div class="announce-card-body">${escHtml(a.content)}</div>
            <div class="announce-card-meta">
                <span>Keeper · ${timeStr}</span>
                ${isKeeper ? `<button class="announce-delete-btn" data-id="${a.id}">✕ Remove</button>` : ""}
            </div>
        `;
        if (isKeeper) {
            card.querySelector(".announce-delete-btn").addEventListener("click", () => deleteAnnouncement(a.id));
        }
        list.appendChild(card);
    });
}

document.getElementById("announceAddBtn").addEventListener("click", () => {
    document.getElementById("announceComposer").classList.remove("hidden");
    document.getElementById("announceAddBtn").classList.add("hidden");
});
document.getElementById("announceCancelBtn").addEventListener("click", () => {
    document.getElementById("announceComposer").classList.add("hidden");
    document.getElementById("announceAddBtn").classList.remove("hidden");
    document.getElementById("announceContent").value = "";
});
document.getElementById("announcePostBtn").addEventListener("click", async () => {
    const text = document.getElementById("announceContent").value.trim();
    if (!text || !isKeeper) return;
    try {
        await addDoc(collection(db, "announcements"), {
            content: text, authorUid: currentUser.uid, createdAt: serverTimestamp()
        });
        await logChange("announcement", "Keeper pinned an announcement", text.slice(0, 120));
        document.getElementById("announceContent").value = "";
        document.getElementById("announceComposer").classList.add("hidden");
        document.getElementById("announceAddBtn").classList.remove("hidden");
        await loadAnnouncements();
    } catch (err) { console.error("Announce failed:", err); }
});

async function deleteAnnouncement(id) {
    if (!confirm("Remove this announcement?")) return;
    try {
        await deleteDoc(doc(db, "announcements", id));
        announcements = announcements.filter(a => a.id !== id);
        renderAnnouncements();
    } catch (err) { console.error("Delete announce failed:", err); }
}

// ── Load ALL users from users collection (fixes collab bug) ───
async function loadAllUsers() {
    try {
        // Users collection: only reads own doc by default rules.
        // We need to allow all-auth reads for the collab list.
        // For now derive from updates + supplement with current user.
        const snap = await getDocs(collection(db, "users"));
        allUsers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    } catch (err) {
        // Fallback: derive from posts if rules block collection read
        allUsers = [];
    }
    buildCollabList();
}

function buildCollabList() {
    const list = document.getElementById("collabList");
    const countEl = document.getElementById("collabCount");

    // Merge allUsers with post-derived authors so we always see everyone
    const fromPosts = getUniqueAuthors();
    const merged = new Map();

    allUsers.forEach(u => merged.set(u.uid, { uid: u.uid, name: u.username || u.email || "Unknown", role: u.role || "collaborator", count: 0 }));
    fromPosts.forEach(a => {
        if (merged.has(a.uid)) merged.get(a.uid).count = a.count;
        else merged.set(a.uid, { ...a, role: "collaborator" });
    });

    const all = [...merged.values()];
    countEl.textContent = all.length;
    list.innerHTML = "";

    if (all.length === 0) { list.innerHTML = '<div class="collab-loading">No collaborators yet.</div>'; return; }

    // Separate into keepers and collaborators
    const keepers = all.filter(u => u.role === "keeper").sort((a, b) => b.count - a.count);
    const collabs = all.filter(u => u.role !== "keeper").sort((a, b) => b.count - a.count);

    function renderCollabItem({ uid, name, count, role }) {
        const isYou = currentUser && uid === currentUser.uid;
        const item = document.createElement("div");
        item.className = "collab-item" + (isYou ? " is-you" : "");
        item.innerHTML = `
            <div class="collab-item-avatar${role === "keeper" ? " keeper-avatar" : ""}">${getInitials(name)}</div>
            <div class="collab-item-info">
                <div class="collab-item-name">${escHtml(name)}${isYou ? ' <span class="collab-you-tag">you</span>' : ""}</div>
                <div class="collab-item-count">${count} update${count !== 1 ? "s" : ""}</div>
            </div>
            <span class="collab-item-arrow">›</span>
        `;
        item.addEventListener("click", () => openProfileModal(uid, name, count));
        return item;
    }

    if (keepers.length > 0) {
        const header = document.createElement("div");
        header.className = "collab-section-header";
        header.innerHTML = `<span class="collab-section-icon">✦</span> Keeper${keepers.length > 1 ? "s" : ""}`;
        list.appendChild(header);
        keepers.forEach(u => list.appendChild(renderCollabItem(u)));
    }

    if (collabs.length > 0) {
        const header = document.createElement("div");
        header.className = "collab-section-header";
        header.innerHTML = `<span class="collab-section-icon">⚔</span> Collaborators`;
        list.appendChild(header);
        collabs.forEach(u => list.appendChild(renderCollabItem(u)));
    }
}

function getUniqueAuthors() {
    const map = new Map();
    allUpdates.forEach(u => {
        if (!map.has(u.authorUid)) map.set(u.authorUid, { uid: u.authorUid, name: u.authorName, count: 0 });
        map.get(u.authorUid).count++;
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
}

// ── Stats ─────────────────────────────────────────────────────
async function loadStats(uid) {
    try {
        const q = query(collection(db, "updates"), where("authorUid", "==", uid));
        const snap = await getCountFromServer(q);
        statPosts.textContent = snap.data().count;

        const created = new Date(currentUser.metadata.creationTime);
        statDays.textContent = Math.max(1, Math.floor((Date.now() - created) / 86400000));
    } catch (err) { statPosts.textContent = "—"; statDays.textContent = "—"; }
}

// ── Profile modal (other users) ───────────────────────────────
function openProfileModal(uid, name, postCount) {
    const backdrop = document.getElementById("profileModalBackdrop");
    document.getElementById("modalAvatar").textContent = getInitials(name);
    document.getElementById("modalName").textContent = name;
    document.getElementById("modalRoleDisplay").textContent = "Collaborator";
    document.getElementById("modalPosts").textContent = `${postCount} update${postCount !== 1 ? "s" : ""}`;
    document.getElementById("modalJoined").textContent = "Active collaborator";

    const recentList = document.getElementById("modalRecentList");
    recentList.innerHTML = "";
    const userPosts = allUpdates.filter(u => u.authorUid === uid).slice(0, 3);

    if (userPosts.length === 0) {
        recentList.innerHTML = '<div class="modal-loading">No updates yet.</div>';
    } else {
        userPosts.forEach(u => {
            const snippet = document.createElement("div");
            snippet.className = "modal-post-snippet";
            snippet.innerHTML = `<div class="modal-post-text">${escHtml(u.content)}</div><div class="modal-post-time">${u.createdAt ? formatTime(u.createdAt.toDate()) : "—"}</div>`;
            recentList.appendChild(snippet);
        });
    }

    document.getElementById("modalFilterBtn").onclick = () => {
        setFilter(uid); closeProfileModal();
        document.querySelector(".dash-feed").scrollIntoView({ behavior: "smooth" });
    };

    backdrop.classList.remove("hidden");
}

function closeProfileModal() { document.getElementById("profileModalBackdrop").classList.add("hidden"); }
document.getElementById("modalClose").addEventListener("click", closeProfileModal);
document.getElementById("profileModalBackdrop").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeProfileModal(); });

// ── Edit profile modal ────────────────────────────────────────
function openEditProfileModal() {
    const backdrop = document.getElementById("editProfileBackdrop");
    document.getElementById("editProfileAvatar").textContent = getInitials(currentUser.displayName || currentUser.email);
    document.getElementById("editNameInput").value = currentUser.displayName || "";
    document.getElementById("editProfileMsg").textContent = "";
    document.getElementById("editProfileMsg").className = "form-message";
    backdrop.classList.remove("hidden");
}

document.getElementById("editProfileClose").addEventListener("click", () => {
    document.getElementById("editProfileBackdrop").classList.add("hidden");
});
document.getElementById("editProfileBackdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) document.getElementById("editProfileBackdrop").classList.add("hidden");
});

document.getElementById("editProfileSave").addEventListener("click", async () => {
    const newName = document.getElementById("editNameInput").value.trim();
    const msgEl = document.getElementById("editProfileMsg");
    if (!newName) { msgEl.textContent = "Name cannot be empty."; msgEl.className = "form-message error"; return; }
    if (newName.length < 2) { msgEl.textContent = "Name must be at least 2 characters."; msgEl.className = "form-message error"; return; }

    const btn = document.getElementById("editProfileSave");
    btn.disabled = true; btn.textContent = "Saving…";

    try {
        // Update Firebase Auth
        await updateProfile(currentUser, { displayName: newName });
        // Update Firestore user doc
        await updateDoc(doc(db, "users", currentUser.uid), { username: newName });

        // Update all visible names in the UI
        topbarUsername.textContent = newName;
        composerName.textContent = newName;
        profileName.textContent = newName;
        composerAvatar.textContent = getInitials(newName);
        profileAvatar.textContent = getInitials(newName);
        document.getElementById("editProfileAvatar").textContent = getInitials(newName);

        // Update cache
        allUpdates.filter(u => u.authorUid === currentUser.uid).forEach(u => u.authorName = newName);
        allUsers.filter(u => u.uid === currentUser.uid).forEach(u => u.name = newName);
        buildCollabList(); buildFilterBar(); renderFeed();

        msgEl.textContent = "Profile updated!"; msgEl.className = "form-message success";
        setTimeout(() => document.getElementById("editProfileBackdrop").classList.add("hidden"), 1200);

    } catch (err) {
        msgEl.textContent = "Update failed. Try again."; msgEl.className = "form-message error";
        console.error(err);
    }

    btn.disabled = false; btn.textContent = "Save Changes";
});

// ── Lore Claims ───────────────────────────────────────────────
async function loadClaims() {
    try {
        const snap = await getDocs(query(collection(db, "claims"), orderBy("claimedAt", "desc")));
        allClaims = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderClaims();
    } catch (err) { console.error("Claims load failed:", err); }
}

function renderClaims() {
    const list = document.getElementById("claimsList");
    list.innerHTML = "";

    if (allClaims.length === 0) {
        list.innerHTML = '<div class="claims-empty">No topics claimed yet.</div>';
        return;
    }

    allClaims.forEach(claim => {
        const isOwn = currentUser && claim.claimedByUid === currentUser.uid;
        const item = document.createElement("div");
        item.className = "claim-item";
        item.innerHTML = `
            <div class="claim-topic">${escHtml(claim.topic)}</div>
            <div class="claim-meta">
                <span class="claim-type-tag">${claim.category || "other"}</span>
                <span>by ${escHtml(claim.claimedByName)}</span>
                ${isOwn ? `<button class="claim-release-btn" title="Release claim">✕</button>` : ""}
            </div>
        `;
        if (isOwn) {
            item.querySelector(".claim-release-btn").addEventListener("click", () => releaseClaim(claim.id));
        }
        list.appendChild(item);
    });
}

document.getElementById("claimsAddBtn").addEventListener("click", () => {
    document.getElementById("claimTopicInput").value = "";
    document.getElementById("claimMsg").textContent = "";
    document.getElementById("claimMsg").className = "form-message";
    document.getElementById("claimModalBackdrop").classList.remove("hidden");
});
document.getElementById("claimModalClose").addEventListener("click", () => {
    document.getElementById("claimModalBackdrop").classList.add("hidden");
});
document.getElementById("claimModalBackdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) document.getElementById("claimModalBackdrop").classList.add("hidden");
});

document.getElementById("claimSubmitBtn").addEventListener("click", async () => {
    const topic = document.getElementById("claimTopicInput").value.trim();
    const category = document.getElementById("claimCategorySelect").value;
    const msgEl = document.getElementById("claimMsg");

    if (!topic) { msgEl.textContent = "Please enter a topic name."; msgEl.className = "form-message error"; return; }

    // Check if already claimed
    const existing = allClaims.find(c => c.topic.toLowerCase() === topic.toLowerCase());
    if (existing) {
        msgEl.textContent = `Already claimed by ${existing.claimedByName}.`;
        msgEl.className = "form-message error";
        return;
    }

    const btn = document.getElementById("claimSubmitBtn");
    btn.disabled = true; btn.textContent = "Claiming…";

    try {
        const docRef = await addDoc(collection(db, "claims"), {
            topic: topic,
            category: category,
            claimedByUid: currentUser.uid,
            claimedByName: currentUser.displayName || currentUser.email,
            claimedAt: serverTimestamp()
        });
        await logChange("claim", `${currentUser.displayName || currentUser.email} claimed "${topic}"`, "");

        allClaims.unshift({ id: docRef.id, topic, category, claimedByUid: currentUser.uid, claimedByName: currentUser.displayName || currentUser.email });
        renderClaims();
        document.getElementById("claimModalBackdrop").classList.add("hidden");

    } catch (err) { msgEl.textContent = "Failed to claim topic."; msgEl.className = "form-message error"; console.error(err); }

    btn.disabled = false; btn.textContent = "Claim Topic";
});

async function releaseClaim(id) {
    if (!confirm("Release your claim on this topic?")) return;
    try {
        await deleteDoc(doc(db, "claims", id));
        allClaims = allClaims.filter(c => c.id !== id);
        renderClaims();
    } catch (err) { console.error("Release claim failed:", err); }
}

// ── Changelog ─────────────────────────────────────────────────
async function logChange(type, summary, preview) {
    try {
        await addDoc(collection(db, "changelog"), {
            type, summary, preview,
            authorUid: currentUser.uid,
            authorName: currentUser.displayName || currentUser.email,
            createdAt: serverTimestamp()
        });
    } catch (e) { /* non-critical, silent fail */ }
}

// ── Global search ─────────────────────────────────────────────
const searchBtn = document.getElementById("searchBtn");
const searchOverlay = document.getElementById("searchOverlay");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");

searchBtn.addEventListener("click", () => {
    searchOverlay.classList.remove("hidden");
    searchInput.focus();
});
document.getElementById("searchClose").addEventListener("click", () => {
    searchOverlay.classList.add("hidden");
    searchInput.value = ""; searchResults.innerHTML = '<div class="search-hint">Start typing to search the chronicle…</div>';
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        searchOverlay.classList.add("hidden");
        document.getElementById("profileModalBackdrop").classList.add("hidden");
        document.getElementById("editProfileBackdrop").classList.add("hidden");
        document.getElementById("claimModalBackdrop").classList.add("hidden");
    }
});

let searchDebounce;
searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 200);
});

function runSearch() {
    const query = searchInput.value.trim().toLowerCase();
    if (query.length < 2) {
        searchResults.innerHTML = '<div class="search-hint">Start typing to search the chronicle…</div>';
        return;
    }

    const results = [];

    // Search updates
    allUpdates.forEach(u => {
        if (u.content.toLowerCase().includes(query) || u.authorName.toLowerCase().includes(query)) {
            results.push({ type: "Update", id: u.id, authorUid: u.authorUid, text: u.content, meta: `by ${u.authorName} · ${u.createdAt ? formatTime(u.createdAt.toDate()) : "—"}`, query });
        }
    });

    // Search announcements
    announcements.forEach(a => {
        if (a.content.toLowerCase().includes(query)) {
            results.push({ type: "Announcement", id: null, text: a.content, meta: `Keeper · ${a.createdAt ? formatTime(a.createdAt.toDate()) : "—"}`, query });
        }
    });

    // Search claims
    allClaims.forEach(c => {
        if (c.topic.toLowerCase().includes(query) || c.claimedByName.toLowerCase().includes(query)) {
            results.push({ type: "Lore Claim", id: null, text: `${c.topic} (${c.category})`, meta: `claimed by ${c.claimedByName}`, query });
        }
    });

    searchResults.innerHTML = "";

    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-no-results">No results found in the chronicle.</div>';
        return;
    }

    results.slice(0, 20).forEach(r => {
        const item = document.createElement("div");
        item.className = "search-result-item";
        item.innerHTML = `
            <div class="search-result-type">${r.type}${r.id ? ' <span class="search-result-goto">↵ jump to post</span>' : ""}</div>
            <div class="search-result-text">${highlightMatch(escHtml(r.text), r.query)}</div>
            <div class="search-result-meta">${r.meta}</div>
        `;
        if (r.id) {
            item.addEventListener("click", () => jumpToPost(r.id, r.authorUid));
        }
        searchResults.appendChild(item);
    });
}

function highlightMatch(text, query) {
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return text.replace(regex, '<span class="search-highlight">$1</span>');
}

function jumpToPost(id, authorUid) {
    // Close search overlay
    searchOverlay.classList.add("hidden");
    searchInput.value = "";
    searchResults.innerHTML = '<div class="search-hint">Start typing to search the chronicle…</div>';

    // Clear any filters that might hide the post, then re-render
    const needsFilterReset = (activeFilter !== "all" && activeFilter !== authorUid) || activeCat !== "all";
    if (needsFilterReset) {
        activeFilter = "all";
        activeCat = "all";
        buildFilterBar();
        buildCategoryBar();
        renderFeed();
    }

    // Wait a tick for the DOM to settle, then find and scroll to the card
    requestAnimationFrame(() => {
        const card = feedList.querySelector(`.update-card[data-id="${id}"]`);
        if (!card) return;
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("card-flash");
        setTimeout(() => card.classList.remove("card-flash"), 1800);
    });
}

// ── Helpers ───────────────────────────────────────────────────
function getInitials(name) {
    if (!name) return "?";
    return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}
function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function formatTime(date) {
    const diff = Date.now() - date.getTime(), mins = Math.floor(diff / 60000), hours = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000);
    if (mins < 1) return "just now"; if (mins < 60) return `${mins}m ago`; if (hours < 24) return `${hours}h ago`; if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function formatJoinDate(timeStr) {
    if (!timeStr) return "—";
    return new Date(timeStr).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}