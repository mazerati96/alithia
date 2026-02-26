// ============================================================
//  js/lore-codex.js  —  Alithia Lore Codex
//  Features: auth guard, category filter, entry grid, entry
//  viewer modal with Google Doc embed / placeholder, keeper
//  add/edit/delete, search overlay
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged, signOut }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    collection, addDoc, getDocs, getDoc, doc, deleteDoc,
    updateDoc, query, orderBy, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Particle canvas ──────────────────────────────────────────
const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d");
let W, H, particles;

function resizeCanvas() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
function makeParticle() {
    return {
        x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.1 + 0.2,
        speed: Math.random() * 0.22 + 0.03, drift: (Math.random() - 0.5) * 0.12,
        alpha: Math.random() * 0.4 + 0.06, pulse: Math.random() * Math.PI * 2
    };
}
function initParticles() { particles = Array.from({ length: Math.floor((W * H) / 9000) }, makeParticle); }
function drawParticles() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
        p.pulse += 0.01;
        const a = p.alpha * (0.5 + 0.5 * Math.sin(p.pulse));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(61,255,143,${a})`; ctx.shadowColor = "#3dff8f"; ctx.shadowBlur = 3; ctx.fill();
        p.y -= p.speed; p.x += p.drift;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        if (p.x < -4) p.x = W + 4;
        if (p.x > W + 4) p.x = -4;
    }
    requestAnimationFrame(drawParticles);
}
window.addEventListener("resize", () => { resizeCanvas(); initParticles(); });
resizeCanvas(); initParticles(); requestAnimationFrame(drawParticles);

// ── State ────────────────────────────────────────────────────
let currentUser = null;
let isKeeper = false;
let allEntries = [];       // full cache from Firestore
let activeCat = "all";
let editingId = null;     // null = new entry, string = editing existing

// ── Category meta ─────────────────────────────────────────────
const CAT_LABELS = {
    region: "🗺 Region",
    faction: "⚔ Faction",
    character: "👤 Character",
    history: "📜 History",
    magic: "✧ Magic & Arcana",
    misc: "◈ Miscellany",
};

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const loreWrap = document.getElementById("loreWrap");
const loreGrid = document.getElementById("loreGrid");
const loreLoading = document.getElementById("loreLoading");

// ── Auth guard ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    currentUser = user;

    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) isKeeper = userDoc.data().role === "keeper";

    // Show add button for keepers
    if (isKeeper) document.getElementById("loreAddBtn").classList.remove("hidden");

    authGuard.classList.add("fade-out");
    setTimeout(() => { authGuard.style.display = "none"; loreWrap.classList.remove("hidden"); }, 500);

    await loadEntries();
});

// ── Load all lore entries ─────────────────────────────────────
async function loadEntries() {
    loreLoading.style.display = "flex";
    loreGrid.querySelectorAll(".lore-card, .lore-empty").forEach(e => e.remove());

    try {
        const snap = await getDocs(query(collection(db, "lore"), orderBy("createdAt", "desc")));
        allEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("Lore load failed:", err);
        allEntries = [];
    }

    loreLoading.style.display = "none";
    updateCounts();
    renderGrid();
}

// ── Count badges ─────────────────────────────────────────────
function updateCounts() {
    const counts = { region: 0, faction: 0, character: 0, history: 0, magic: 0, misc: 0 };
    allEntries.forEach(e => { if (counts[e.category] !== undefined) counts[e.category]++; });

    document.getElementById("countAll").textContent = allEntries.length;
    document.getElementById("countRegion").textContent = counts.region;
    document.getElementById("countFaction").textContent = counts.faction;
    document.getElementById("countCharacter").textContent = counts.character;
    document.getElementById("countHistory").textContent = counts.history;
    document.getElementById("countMagic").textContent = counts.magic;
    document.getElementById("countMisc").textContent = counts.misc;
}

// ── Render grid ───────────────────────────────────────────────
function renderGrid() {
    loreGrid.querySelectorAll(".lore-card, .lore-empty").forEach(e => e.remove());

    const visible = activeCat === "all"
        ? allEntries
        : allEntries.filter(e => e.category === activeCat);

    const title = activeCat === "all" ? "All Entries" : (CAT_LABELS[activeCat] || activeCat);
    document.getElementById("loreMainTitle").textContent = title;
    document.getElementById("loreEntryCount").textContent = `${visible.length} entr${visible.length !== 1 ? "ies" : "y"}`;

    if (visible.length === 0) {
        const empty = document.createElement("div");
        empty.className = "lore-empty";
        empty.textContent = activeCat !== "all"
            ? "No entries in this category yet. Be the first to write one."
            : "The codex is empty. Add the first lore entry to begin.";
        loreGrid.appendChild(empty);
        return;
    }

    visible.forEach((entry, i) => {
        const card = buildCard(entry, i);
        loreGrid.appendChild(card);
    });
}

// ── Build entry card ──────────────────────────────────────────
function buildCard(entry, index) {
    const card = document.createElement("div");
    card.className = "lore-card";
    card.dataset.cat = entry.category || "misc";
    card.dataset.id = entry.id;
    card.style.animationDelay = `${index * 50}ms`;

    const catLabel = CAT_LABELS[entry.category] || entry.category || "Misc";
    const desc = entry.synopsis || entry.content || "";
    const hasDoc = !!(entry.docUrl && entry.docUrl.trim());

    card.innerHTML = `
        <div class="lore-card-inner">
            <div class="lore-card-top">
                <span class="lore-card-cat">${catLabel}</span>
                ${hasDoc ? '<span class="lore-card-doc-badge">📋 doc linked</span>' : ""}
            </div>
            <div class="lore-card-title">${escHtml(entry.title || "Untitled Entry")}</div>
            <div class="lore-card-desc">${escHtml(desc) || "<em>No synopsis yet.</em>"}</div>
            <div class="lore-card-footer">
                <span class="lore-card-author">${escHtml(entry.authorName || "—")}</span>
                <span class="lore-card-arrow">→</span>
            </div>
        </div>
    `;

    card.addEventListener("click", () => openEntryModal(entry));
    return card;
}

// ── Category nav ──────────────────────────────────────────────
document.querySelectorAll(".lore-nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
        activeCat = btn.dataset.cat;
        document.querySelectorAll(".lore-nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderGrid();
    });
});

// ── Entry viewer modal ────────────────────────────────────────
function openEntryModal(entry) {
    const backdrop = document.getElementById("entryModalBackdrop");

    document.getElementById("modalCatTag").textContent = CAT_LABELS[entry.category] || entry.category || "Entry";
    document.getElementById("modalTitle").textContent = entry.title || "Untitled Entry";
    document.getElementById("modalAuthor").textContent = `by ${entry.authorName || "Unknown"}`;
    document.getElementById("modalUpdated").textContent = entry.updatedAt
        ? `Updated ${formatTime(entry.updatedAt.toDate())}`
        : (entry.createdAt ? `Added ${formatTime(entry.createdAt.toDate())}` : "—");

    document.getElementById("modalDesc").textContent = entry.synopsis || entry.content || "";

    // Google Doc embed or placeholder
    const frameEl = document.getElementById("modalDocFrame");
    frameEl.innerHTML = "";

    if (entry.docUrl && entry.docUrl.trim()) {
        // Convert regular Google Doc URL to embed URL
        const embedUrl = toEmbedUrl(entry.docUrl.trim());
        const iframe = document.createElement("iframe");
        iframe.className = "lore-doc-iframe";
        iframe.src = embedUrl;
        iframe.setAttribute("allowfullscreen", "");
        iframe.setAttribute("loading", "lazy");
        frameEl.appendChild(iframe);
    } else {
        frameEl.innerHTML = `
            <div class="lore-doc-placeholder">
                <div class="lore-doc-placeholder-rune">ᚦ</div>
                <div class="lore-doc-placeholder-title">Document Pending</div>
                <div class="lore-doc-placeholder-body">
                    The full lore document for this entry has not yet been linked.
                    When a Google Doc is ready, a Keeper can attach it via
                    <code>Edit Entry → Google Doc URL</code> and it will appear here automatically.
                </div>
            </div>
        `;
    }

    // Keeper controls
    const keeperActions = document.getElementById("modalKeeperActions");
    if (isKeeper) {
        keeperActions.classList.remove("hidden");
        document.getElementById("modalEditBtn").onclick = () => { closeEntryModal(); openEntryForm(entry); };
        document.getElementById("modalDeleteBtn").onclick = () => deleteEntry(entry.id);
    } else {
        keeperActions.classList.add("hidden");
    }

    backdrop.classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function closeEntryModal() {
    document.getElementById("entryModalBackdrop").classList.add("hidden");
    document.body.style.overflow = "";
}

document.getElementById("entryModalClose").addEventListener("click", closeEntryModal);
document.getElementById("entryModalBackdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeEntryModal();
});

// Convert a regular Google Docs share URL to an embed URL
function toEmbedUrl(url) {
    // Already an embed URL — return as-is
    if (url.includes("/pub") || url.includes("embedded=true")) return url;

    // Typical pattern: https://docs.google.com/document/d/DOC_ID/edit
    // becomes:         https://docs.google.com/document/d/DOC_ID/pub?embedded=true
    return url.replace(/\/(edit|view|preview).*$/, "/pub?embedded=true");
}

// ── Add / Edit form modal ─────────────────────────────────────
function openEntryForm(existingEntry = null) {
    editingId = existingEntry ? existingEntry.id : null;

    document.getElementById("formModalTitle").textContent = editingId ? "Edit Lore Entry" : "Add Lore Entry";
    document.getElementById("formTitle").value = existingEntry?.title || "";
    document.getElementById("formCategory").value = existingEntry?.category || "region";
    document.getElementById("formDesc").value = existingEntry?.synopsis || existingEntry?.content || "";
    document.getElementById("formDocUrl").value = existingEntry?.docUrl || "";
    document.getElementById("formMsg").textContent = "";
    document.getElementById("formMsg").className = "lore-form-msg";
    document.getElementById("formSubmitBtn").disabled = false;
    document.getElementById("formSubmitBtn").textContent = "Save Entry";

    document.getElementById("entryFormBackdrop").classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function closeEntryForm() {
    document.getElementById("entryFormBackdrop").classList.add("hidden");
    document.body.style.overflow = "";
    editingId = null;
}

document.getElementById("loreAddBtn").addEventListener("click", () => openEntryForm());
document.getElementById("entryFormClose").addEventListener("click", closeEntryForm);
document.getElementById("formCancelBtn").addEventListener("click", closeEntryForm);
document.getElementById("entryFormBackdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeEntryForm();
});

document.getElementById("formSubmitBtn").addEventListener("click", async () => {
    const title = document.getElementById("formTitle").value.trim();
    const category = document.getElementById("formCategory").value;
    const synopsis = document.getElementById("formDesc").value.trim();
    const docUrl = document.getElementById("formDocUrl").value.trim();
    const msgEl = document.getElementById("formMsg");
    const btn = document.getElementById("formSubmitBtn");

    if (!title) {
        msgEl.textContent = "Please enter a title for this entry.";
        msgEl.className = "lore-form-msg error";
        return;
    }

    btn.disabled = true;
    btn.textContent = editingId ? "Saving…" : "Adding…";

    try {
        if (editingId) {
            // Update existing
            await updateDoc(doc(db, "lore", editingId), {
                title, category, synopsis, docUrl,
                updatedAt: serverTimestamp()
            });
            // Update local cache
            const idx = allEntries.findIndex(e => e.id === editingId);
            if (idx !== -1) Object.assign(allEntries[idx], { title, category, synopsis, docUrl });

            msgEl.textContent = "Entry updated!";
            msgEl.className = "lore-form-msg success";

        } else {
            // Create new
            const docRef = await addDoc(collection(db, "lore"), {
                title, category, synopsis, docUrl,
                authorUid: currentUser.uid,
                authorName: currentUser.displayName || currentUser.email,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            allEntries.unshift({
                id: docRef.id, title, category, synopsis, docUrl,
                authorUid: currentUser.uid,
                authorName: currentUser.displayName || currentUser.email
            });

            msgEl.textContent = "Entry added to the codex!";
            msgEl.className = "lore-form-msg success";
        }

        updateCounts();
        renderGrid();
        setTimeout(closeEntryForm, 900);

    } catch (err) {
        msgEl.textContent = "Failed to save. Check your connection and try again.";
        msgEl.className = "lore-form-msg error";
        console.error("Lore save failed:", err);
    }

    btn.disabled = false;
    btn.textContent = "Save Entry";
});

// ── Delete entry ──────────────────────────────────────────────
async function deleteEntry(id) {
    if (!confirm("Permanently remove this lore entry from the codex?")) return;
    try {
        await deleteDoc(doc(db, "lore", id));
        allEntries = allEntries.filter(e => e.id !== id);
        closeEntryModal();
        updateCounts();
        renderGrid();
    } catch (err) { console.error("Lore delete failed:", err); }
}

// ── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeEntryModal();
        closeEntryForm();
        closeLoreSearch();
    }
});

// ── Search overlay ────────────────────────────────────────────
const loreSearchOverlay = document.getElementById("loreSearchOverlay");
const loreSearchInput = document.getElementById("loreSearchInput");
const loreSearchResults = document.getElementById("loreSearchResults");

document.getElementById("loreSearchBtn").addEventListener("click", () => {
    loreSearchOverlay.classList.remove("hidden");
    loreSearchInput.focus();
});

document.getElementById("loreSearchClose").addEventListener("click", closeLoreSearch);
document.getElementById("loreSearchOverlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeLoreSearch();
});

function closeLoreSearch() {
    loreSearchOverlay.classList.add("hidden");
    loreSearchInput.value = "";
    loreSearchResults.innerHTML = '<div class="lore-search-hint">Start typing to search the codex…</div>';
}

let searchDebounce;
loreSearchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 180);
});

function runSearch() {
    const q = loreSearchInput.value.trim().toLowerCase();
    if (q.length < 2) {
        loreSearchResults.innerHTML = '<div class="lore-search-hint">Start typing to search the codex…</div>';
        return;
    }

    const hits = allEntries.filter(e =>
        (e.title || "").toLowerCase().includes(q) ||
        (e.synopsis || "").toLowerCase().includes(q) ||
        (e.category || "").toLowerCase().includes(q) ||
        (e.authorName || "").toLowerCase().includes(q)
    );

    loreSearchResults.innerHTML = "";

    if (hits.length === 0) {
        loreSearchResults.innerHTML = '<div class="lore-search-no-results">No entries found in the codex.</div>';
        return;
    }

    hits.slice(0, 15).forEach(entry => {
        const item = document.createElement("div");
        item.className = "lore-search-result";
        item.innerHTML = `
            <div class="lore-search-result-cat">${CAT_LABELS[entry.category] || entry.category}</div>
            <div class="lore-search-result-title">${highlight(escHtml(entry.title || "Untitled"), q)}</div>
            <div class="lore-search-result-desc">${escHtml(entry.synopsis || "")}</div>
        `;
        item.addEventListener("click", () => {
            closeLoreSearch();
            openEntryModal(entry);
        });
        loreSearchResults.appendChild(item);
    });
}

function highlight(text, q) {
    const rx = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return text.replace(rx, '<span class="search-highlight">$1</span>');
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatTime(date) {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}