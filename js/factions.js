// ============================================================
//  js/factions.js  —  Alithia Factions
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    collection, addDoc, getDocs, getDoc, doc, deleteDoc,
    updateDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Particle canvas ──────────────────────────────────────────
const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d");
let W, H, particles;

function resizeCanvas() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
function makeParticle() {
    return {
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 1.1 + 0.2,
        speed: Math.random() * 0.2 + 0.03,
        drift: (Math.random() - 0.5) * 0.12,
        alpha: Math.random() * 0.35 + 0.05,
        pulse: Math.random() * Math.PI * 2
    };
}
function initParticles() { particles = Array.from({ length: Math.floor((W * H) / 9000) }, makeParticle); }
function drawParticles() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
        p.pulse += 0.01;
        const a = p.alpha * (0.5 + 0.5 * Math.sin(p.pulse));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        // Factions use a warm orange tint for particles
        ctx.fillStyle = `rgba(255,159,67,${a * 0.5})`;
        ctx.shadowColor = "#ff9f43"; ctx.shadowBlur = 3; ctx.fill();
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
let allFactions = [];
let activeType = "all";
let activeStatus = "all";
let editingId = null;

// ── Type meta ────────────────────────────────────────────────
const TYPE_LABELS = {
    military: "⚔ Military",
    political: "♟ Political",
    religious: "✧ Religious",
    criminal: "◈ Criminal",
    mercantile: "◆ Mercantile",
    arcane: "⬡ Arcane",
    other: "▸ Other",
};

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const factionsWrap = document.getElementById("factionsWrap");
const factionsGrid = document.getElementById("factionsGrid");
const factionsLoading = document.getElementById("factionsLoading");

// ── Auth guard ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    currentUser = user;

    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) isKeeper = userDoc.data().role === "keeper";

    if (isKeeper) document.getElementById("factionsAddBtn").classList.remove("hidden");

    authGuard.classList.add("fade-out");
    setTimeout(() => { authGuard.style.display = "none"; factionsWrap.classList.remove("hidden"); }, 500);

    await loadFactions();
});

// ── Load all factions ─────────────────────────────────────────
async function loadFactions() {
    factionsLoading.style.display = "flex";
    factionsGrid.querySelectorAll(".faction-card, .factions-empty").forEach(e => e.remove());

    try {
        const snap = await getDocs(query(collection(db, "factions"), orderBy("createdAt", "desc")));
        allFactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("Factions load failed:", err);
        allFactions = [];
    }

    factionsLoading.style.display = "none";
    updateCounts();
    renderGrid();
}

// ── Count badges ─────────────────────────────────────────────
function updateCounts() {
    const counts = { military: 0, political: 0, religious: 0, criminal: 0, mercantile: 0, arcane: 0, other: 0 };
    allFactions.forEach(f => { if (counts[f.type] !== undefined) counts[f.type]++; else counts.other++; });

    document.getElementById("countAll").textContent = allFactions.length;
    document.getElementById("countMilitary").textContent = counts.military;
    document.getElementById("countPolitical").textContent = counts.political;
    document.getElementById("countReligious").textContent = counts.religious;
    document.getElementById("countCriminal").textContent = counts.criminal;
    document.getElementById("countMercantile").textContent = counts.mercantile;
    document.getElementById("countArcane").textContent = counts.arcane;
    document.getElementById("countOther").textContent = counts.other;
}

// ── Render grid ───────────────────────────────────────────────
function renderGrid() {
    factionsGrid.querySelectorAll(".faction-card, .factions-empty").forEach(e => e.remove());

    let visible = allFactions;
    if (activeType !== "all") visible = visible.filter(f => (f.type || "other") === activeType);
    if (activeStatus !== "all") visible = visible.filter(f => (f.status || "active") === activeStatus);

    const typeLabel = activeType === "all" ? "All Factions" : (TYPE_LABELS[activeType] || activeType);
    document.getElementById("factionsMainTitle").textContent = typeLabel;
    document.getElementById("factionsEntryCount").textContent = `${visible.length} faction${visible.length !== 1 ? "s" : ""}`;

    if (visible.length === 0) {
        const empty = document.createElement("div");
        empty.className = "factions-empty";
        empty.textContent = activeType !== "all" || activeStatus !== "all"
            ? "No factions match this filter."
            : "No factions recorded yet. Add the first faction to begin.";
        factionsGrid.appendChild(empty);
        return;
    }

    visible.forEach((faction, i) => factionsGrid.appendChild(buildCard(faction, i)));
}

// ── Build faction card ────────────────────────────────────────
function buildCard(faction, index) {
    const card = document.createElement("div");
    card.className = "faction-card";
    card.dataset.id = faction.id;
    card.style.animationDelay = `${index * 50}ms`;

    const typeLabel = TYPE_LABELS[faction.type] || faction.type || "Other";
    const status = faction.status || "active";
    const alignment = faction.alignment || "unknown";
    const alignClass = alignment.includes("good") ? "good" : alignment.includes("evil") ? "evil" : alignment === "unknown" ? "" : "neutral";
    const hasDoc = !!(faction.docUrl && faction.docUrl.trim());
    const region = faction.region || "";
    const members = faction.members || "";

    card.innerHTML = `
        <div class="faction-card-inner">
            <div class="faction-card-top">
                <span class="faction-tag type-tag">${typeLabel}</span>
                <span class="faction-tag status-tag" data-status="${status}">${capitalize(status)}</span>
                ${hasDoc ? '<span class="lore-card-doc-badge">📋 doc</span>' : ""}
            </div>
            <div class="faction-card-title">${escHtml(faction.title || "Unnamed Faction")}</div>
            <div class="faction-card-desc">${escHtml(faction.synopsis || "No synopsis recorded yet.")}</div>
            <div class="faction-card-meta">
                ${region ? `<span class="faction-card-meta-item"><strong>Region:</strong> ${escHtml(region)}</span>` : ""}
                ${alignment !== "unknown" ? `<span class="faction-card-meta-item"><strong>Alignment:</strong> ${escHtml(capitalize(alignment))}</span>` : ""}
            </div>
            <div class="faction-card-footer">
                <span class="faction-card-author">${escHtml(faction.authorName || "—")}</span>
                <span class="faction-card-arrow">→</span>
            </div>
        </div>
    `;

    card.addEventListener("click", () => openEntryModal(faction));
    return card;
}

// ── Type nav filter ───────────────────────────────────────────
document.querySelectorAll(".factions-nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
        activeType = btn.dataset.type;
        document.querySelectorAll(".factions-nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderGrid();
    });
});

// ── Status chip filter ────────────────────────────────────────
document.querySelectorAll(".status-chip").forEach(chip => {
    chip.addEventListener("click", () => {
        activeStatus = chip.dataset.status;
        document.querySelectorAll(".status-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        renderGrid();
    });
});

// ── Entry viewer modal ────────────────────────────────────────
function openEntryModal(faction) {
    const backdrop = document.getElementById("entryModalBackdrop");
    const status = faction.status || "active";
    const alignment = faction.alignment || "unknown";
    const alignClass = alignment.includes("good") ? "good" : alignment.includes("evil") ? "evil" : alignment === "unknown" ? "" : "neutral";

    document.getElementById("modalTypeTag").textContent = TYPE_LABELS[faction.type] || faction.type || "Other";
    const statusEl = document.getElementById("modalStatusTag");
    statusEl.textContent = capitalize(status);
    statusEl.dataset.status = status;
    const alignEl = document.getElementById("modalAlignTag");
    alignEl.textContent = capitalize(alignment);
    alignEl.className = `faction-tag align-tag ${alignClass}`;
    document.getElementById("modalTitle").textContent = faction.title || "Unnamed Faction";
    document.getElementById("modalAuthor").textContent = `by ${faction.authorName || "Unknown"}`;
    document.getElementById("modalUpdated").textContent = faction.updatedAt
        ? `Updated ${formatTime(faction.updatedAt.toDate())}`
        : (faction.createdAt ? `Added ${formatTime(faction.createdAt.toDate())}` : "—");
    document.getElementById("modalDesc").textContent = faction.synopsis || "";
    document.getElementById("modalRegion").textContent = faction.region || "Unknown";
    document.getElementById("modalMembers").textContent = faction.members || "Unknown";

    // Google Doc link button or placeholder
    const frameEl = document.getElementById("modalDocFrame");
    frameEl.innerHTML = "";
    if (faction.docUrl && faction.docUrl.trim()) {
        frameEl.innerHTML = `
            <div class="factions-doc-linked">
                <div class="factions-doc-linked-info">
                    <span class="factions-doc-linked-icon">📄</span>
                    <div class="factions-doc-linked-text">
                        <span class="factions-doc-linked-title">Full Document Available</span>
                        <span class="factions-doc-linked-hint">Opens in Google Docs — sign-in may be required</span>
                    </div>
                </div>
                <a class="factions-doc-open-btn"
                   href="${escHtml(faction.docUrl.trim())}"
                   target="_blank"
                   rel="noopener noreferrer">
                    Open in Google Docs →
                </a>
            </div>
        `;
    } else {
        frameEl.innerHTML = `
            <div class="factions-doc-placeholder">
                <div class="factions-doc-placeholder-rune">⚔</div>
                <div class="factions-doc-placeholder-title">Document Pending</div>
                <div class="factions-doc-placeholder-body">
                    The full faction document has not yet been linked.
                    When a Google Doc is ready, anyone can attach it via
                    <code>Edit Faction → Google Doc URL</code> and it will appear here automatically.
                </div>
            </div>
        `;
    }

    // Keeper actions
    const keeperActions = document.getElementById("modalKeeperActions");
    if (isKeeper) {
        keeperActions.classList.remove("hidden");
        document.getElementById("modalEditBtn").onclick = () => { closeEntryModal(); openEntryForm(faction); };
        document.getElementById("modalDeleteBtn").onclick = () => deleteFaction(faction.id);
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

// ── Add / Edit form modal ─────────────────────────────────────
function openEntryForm(existing = null) {
    editingId = existing ? existing.id : null;

    document.getElementById("formModalTitle").textContent = editingId ? "Edit Faction" : "Add Faction";
    document.getElementById("formTitle").value = existing?.title || "";
    document.getElementById("formType").value = existing?.type || "military";
    document.getElementById("formStatus").value = existing?.status || "active";
    document.getElementById("formAlignment").value = existing?.alignment || "true neutral";
    document.getElementById("formRegion").value = existing?.region || "";
    document.getElementById("formMembers").value = existing?.members || "";
    document.getElementById("formDesc").value = existing?.synopsis || "";
    document.getElementById("formDocUrl").value = existing?.docUrl || "";
    document.getElementById("formMsg").textContent = "";
    document.getElementById("formMsg").className = "factions-form-msg";
    document.getElementById("formSubmitBtn").disabled = false;
    document.getElementById("formSubmitBtn").textContent = "Save Faction";

    document.getElementById("entryFormBackdrop").classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function closeEntryForm() {
    document.getElementById("entryFormBackdrop").classList.add("hidden");
    document.body.style.overflow = "";
    editingId = null;
}

document.getElementById("factionsAddBtn").addEventListener("click", () => openEntryForm());
document.getElementById("entryFormClose").addEventListener("click", closeEntryForm);
document.getElementById("formCancelBtn").addEventListener("click", closeEntryForm);
document.getElementById("entryFormBackdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeEntryForm();
});

document.getElementById("formSubmitBtn").addEventListener("click", async () => {
    const title = document.getElementById("formTitle").value.trim();
    const type = document.getElementById("formType").value;
    const status = document.getElementById("formStatus").value;
    const alignment = document.getElementById("formAlignment").value;
    const region = document.getElementById("formRegion").value.trim();
    const members = document.getElementById("formMembers").value.trim();
    const synopsis = document.getElementById("formDesc").value.trim();
    const docUrl = document.getElementById("formDocUrl").value.trim();
    const msgEl = document.getElementById("formMsg");
    const btn = document.getElementById("formSubmitBtn");

    if (!title) {
        msgEl.textContent = "Please enter a faction name.";
        msgEl.className = "factions-form-msg error";
        return;
    }

    btn.disabled = true;
    btn.textContent = editingId ? "Saving…" : "Adding…";

    try {
        if (editingId) {
            await updateDoc(doc(db, "factions", editingId), {
                title, type, status, alignment, region, members, synopsis, docUrl,
                updatedAt: serverTimestamp()
            });
            const idx = allFactions.findIndex(f => f.id === editingId);
            if (idx !== -1) Object.assign(allFactions[idx], { title, type, status, alignment, region, members, synopsis, docUrl });

            await logChange("faction_edited", `Faction updated: ${title}`, synopsis.slice(0, 120));
            msgEl.textContent = "Faction updated!";
            msgEl.className = "factions-form-msg success";

        } else {
            const docRef = await addDoc(collection(db, "factions"), {
                title, type, status, alignment, region, members, synopsis, docUrl,
                authorUid: currentUser.uid,
                authorName: currentUser.displayName || currentUser.email,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            allFactions.unshift({
                id: docRef.id, title, type, status, alignment, region, members, synopsis, docUrl,
                authorUid: currentUser.uid,
                authorName: currentUser.displayName || currentUser.email
            });

            await logChange("faction_added", `New faction added: ${title}`, synopsis.slice(0, 120));
            msgEl.textContent = "Faction added to the records!";
            msgEl.className = "factions-form-msg success";
        }

        updateCounts();
        renderGrid();
        setTimeout(closeEntryForm, 900);

    } catch (err) {
        msgEl.textContent = "Failed to save. Check your connection and try again.";
        msgEl.className = "factions-form-msg error";
        console.error("Faction save failed:", err);
    }

    btn.disabled = false;
    btn.textContent = "Save Faction";
});

// ── Delete faction ────────────────────────────────────────────
async function deleteFaction(id) {
    if (!confirm("Permanently remove this faction from the records?")) return;
    try {
        await deleteDoc(doc(db, "factions", id));
        allFactions = allFactions.filter(f => f.id !== id);
        closeEntryModal();
        updateCounts();
        renderGrid();
    } catch (err) { console.error("Faction delete failed:", err); }
}

// ── Changelog logger ──────────────────────────────────────────
async function logChange(type, summary, preview) {
    try {
        await addDoc(collection(db, "changelog"), {
            type, summary, preview,
            authorUid: currentUser.uid,
            authorName: currentUser.displayName || currentUser.email,
            createdAt: serverTimestamp()
        });
    } catch (e) { /* non-critical */ }
}

// ── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeEntryModal();
        closeEntryForm();
        closeSearch();
    }
});

// ── Search overlay ────────────────────────────────────────────
const searchOverlay = document.getElementById("factionsSearchOverlay");
const searchInput = document.getElementById("factionsSearchInput");
const searchResults = document.getElementById("factionsSearchResults");

document.getElementById("factionsSearchBtn").addEventListener("click", () => {
    searchOverlay.classList.remove("hidden");
    searchInput.focus();
});
document.getElementById("factionsSearchClose").addEventListener("click", closeSearch);
searchOverlay.addEventListener("click", (e) => { if (e.target === e.currentTarget) closeSearch(); });

function closeSearch() {
    searchOverlay.classList.add("hidden");
    searchInput.value = "";
    searchResults.innerHTML = '<div class="factions-search-hint">Start typing to search factions…</div>';
}

let debounce;
searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 180);
});

function runSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (q.length < 2) {
        searchResults.innerHTML = '<div class="factions-search-hint">Start typing to search factions…</div>';
        return;
    }

    const hits = allFactions.filter(f =>
        (f.title || "").toLowerCase().includes(q) ||
        (f.synopsis || "").toLowerCase().includes(q) ||
        (f.type || "").toLowerCase().includes(q) ||
        (f.region || "").toLowerCase().includes(q) ||
        (f.members || "").toLowerCase().includes(q) ||
        (f.alignment || "").toLowerCase().includes(q) ||
        (f.authorName || "").toLowerCase().includes(q)
    );

    searchResults.innerHTML = "";

    if (hits.length === 0) {
        searchResults.innerHTML = '<div class="factions-search-no-results">No factions found.</div>';
        return;
    }

    hits.slice(0, 15).forEach(faction => {
        const item = document.createElement("div");
        item.className = "factions-search-result";
        item.innerHTML = `
            <div class="factions-search-result-type">${TYPE_LABELS[faction.type] || faction.type} · ${capitalize(faction.status || "active")}</div>
            <div class="factions-search-result-title">${highlight(escHtml(faction.title || "Unnamed"), q)}</div>
            <div class="factions-search-result-desc">${escHtml(faction.synopsis || "")}</div>
        `;
        item.addEventListener("click", () => { closeSearch(); openEntryModal(faction); });
        searchResults.appendChild(item);
    });
}

function highlight(text, q) {
    const rx = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return text.replace(rx, '<span class="search-highlight">$1</span>');
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
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