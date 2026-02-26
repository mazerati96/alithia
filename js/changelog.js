// ============================================================
//  js/changelog.js  —  Alithia World Chronicle
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, getDocs, getDoc, deleteDoc, doc, query, orderBy }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Particle canvas ──────────────────────────────────────────
const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d");
let W, H, particles;
function resizeCanvas() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
function makeParticle() { return { x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1 + 0.2, speed: Math.random() * 0.2 + 0.03, drift: (Math.random() - 0.5) * 0.12, alpha: Math.random() * 0.35 + 0.06, pulse: Math.random() * Math.PI * 2 }; }
function initParticles() { particles = Array.from({ length: Math.floor((W * H) / 9000) }, makeParticle); }
function drawParticles() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
        p.pulse += 0.01; const a = p.alpha * (0.5 + 0.5 * Math.sin(p.pulse));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(61,255,143,${a})`; ctx.shadowColor = "#3dff8f"; ctx.shadowBlur = 3; ctx.fill();
        p.y -= p.speed; p.x += p.drift;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; } if (p.x < -4) { p.x = W + 4; } if (p.x > W + 4) { p.x = -4; }
    }
    requestAnimationFrame(drawParticles);
}
window.addEventListener("resize", () => { resizeCanvas(); initParticles(); });
resizeCanvas(); initParticles(); requestAnimationFrame(drawParticles);

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const clWrap = document.getElementById("changelogWrap");
const clList = document.getElementById("changelogList");
const clNoResults = document.getElementById("clNoResults");

// ── Auth state: fetch user + role, then load ─────────────────
let currentUser = null;
let isKeeper = false;

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }

    currentUser = user;

    // Check if this user is a Keeper (read their own user doc)
    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists() && userSnap.data().role === "keeper") {
            isKeeper = true;
        }
    } catch (_) { /* non-fatal — isKeeper stays false */ }

    authGuard.classList.add("fade-out");
    setTimeout(() => { authGuard.style.display = "none"; clWrap.classList.remove("hidden"); }, 500);

    await loadChangelog();
});

// ── Load changelog ───────────────────────────────────────────
async function loadChangelog() {
    try {
        const snap = await getDocs(query(collection(db, "changelog"), orderBy("createdAt", "desc")));
        clList.innerHTML = "";

        if (snap.empty) {
            clList.innerHTML = '<div class="cl-empty">The chronicle is empty. Start collaborating to fill it.</div>';
            return;
        }

        snap.docs.forEach((docSnap, i) => {
            const entry = buildEntry(docSnap.id, docSnap.data(), i);
            clList.appendChild(entry);
        });

    } catch (err) {
        clList.innerHTML = '<div class="cl-empty">Could not load the chronicle.</div>';
        console.error(err);
    }
}

// ── Build entry element ──────────────────────────────────────
function buildEntry(docId, data, index) {
    const entry = document.createElement("div");
    entry.className = "cl-entry";
    entry.dataset.type = data.type || "update_posted";
    entry.dataset.docId = docId;
    entry.dataset.authorUid = data.authorUid || "";
    entry.style.animationDelay = `${index * 40}ms`;

    const date = data.createdAt ? data.createdAt.toDate() : new Date();
    const timeMain = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const timeSub = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

    const typeLabels = {
        update_posted: "Update Posted",
        announcement: "Announcement",
        claim: "Lore Claimed",
        lore_edit: "Lore Edited",
    };
    const typeLabel = typeLabels[data.type] || data.type || "Event";

    // Store raw text for search
    entry.dataset.searchType = typeLabel;
    entry.dataset.searchSummary = data.summary || "";
    entry.dataset.searchPreview = data.preview || "";

    // Only show delete button if user is author or Keeper
    const canDelete = isKeeper || (currentUser && currentUser.uid === data.authorUid);

    entry.innerHTML = `
        <div class="cl-entry-time cl-entry-dot">
            <span class="cl-time-main">${timeMain}</span>
            <span class="cl-time-sub">${timeSub}</span>
        </div>
        <div class="cl-entry-content">
            <div class="cl-entry-type">
                ${escHtml(typeLabel)}${data.pageId ? `<span class="cl-entry-page-tag">${escHtml(data.pageId.charAt(0).toUpperCase() + data.pageId.slice(1))}</span>` : ""}
            </div>
            <div class="cl-entry-summary">${escHtml(data.summary || "")}</div>
            ${data.preview ? `<div class="cl-entry-preview">${escHtml(data.preview)}</div>` : ""}
        </div>
        ${canDelete ? `
        <button class="cl-delete-btn" aria-label="Delete entry" title="Erase this entry from the chronicle">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
        </button>` : ""}
    `;

    if (canDelete) {
        entry.querySelector(".cl-delete-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            openDeleteModal(entry, docId, data.summary || "this entry");
        });
    }

    return entry;
}

// ── Delete modal ─────────────────────────────────────────────
const deleteModal = document.getElementById("clDeleteModal");
const deleteModalSummary = document.getElementById("clDeleteSummary");
const deleteConfirmBtn = document.getElementById("clDeleteConfirm");
const deleteCancelBtn = document.getElementById("clDeleteCancel");
const deleteModalError = document.getElementById("clDeleteError");

let pendingDeleteEntry = null;
let pendingDeleteDocId = null;

function openDeleteModal(entryEl, docId, summary) {
    pendingDeleteEntry = entryEl;
    pendingDeleteDocId = docId;
    deleteModalSummary.textContent = summary.length > 80 ? summary.slice(0, 80) + "…" : summary;
    deleteModalError.classList.add("hidden");
    deleteModal.classList.remove("hidden");
    // Trigger transition on next frame
    requestAnimationFrame(() => deleteModal.classList.add("modal-visible"));
    deleteCancelBtn.focus();
}

function closeDeleteModal() {
    deleteModal.classList.remove("modal-visible");
    setTimeout(() => deleteModal.classList.add("hidden"), 300);
    pendingDeleteEntry = null;
    pendingDeleteDocId = null;
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = "Erase Entry";
}

deleteCancelBtn.addEventListener("click", closeDeleteModal);
deleteModal.addEventListener("click", (e) => { if (e.target === deleteModal) closeDeleteModal(); });

deleteConfirmBtn.addEventListener("click", async () => {
    if (!pendingDeleteDocId || !pendingDeleteEntry) return;

    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = "Erasing…";

    try {
        await deleteDoc(doc(db, "changelog", pendingDeleteDocId));

        const entryToRemove = pendingDeleteEntry;
        closeDeleteModal();

        // Animate out
        entryToRemove.classList.add("cl-entry-deleting");
        entryToRemove.addEventListener("animationend", () => {
            entryToRemove.remove();
            checkEmptyAfterDelete();
        }, { once: true });

    } catch (err) {
        console.error("Delete failed:", err);
        deleteConfirmBtn.disabled = false;
        deleteConfirmBtn.textContent = "Erase Entry";
        deleteModalError.textContent = "Could not erase. You may not have permission.";
        deleteModalError.classList.remove("hidden");
    }
});

function checkEmptyAfterDelete() {
    const remaining = clList.querySelectorAll(".cl-entry");
    if (remaining.length === 0) {
        clList.innerHTML = '<div class="cl-empty">The chronicle is empty. Start collaborating to fill it.</div>';
        clearSearch();
    } else {
        const q = clSearchInput.value.trim();
        if (q) applySearch(q);
    }
}

// ── Utility ──────────────────────────────────────────────────
function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ============================================================
//  SEARCH
// ============================================================

const clSearchBar = document.getElementById("clSearchBar");
const clSearchToggle = document.getElementById("clSearchToggle");
const clSearchInput = document.getElementById("clSearchInput");
const clSearchCount = document.getElementById("clSearchCount");
const clSearchClear = document.getElementById("clSearchClear");

function openSearch() {
    clSearchBar.classList.add("active");
    setTimeout(() => clSearchInput.focus(), 350);
}

function closeSearch() {
    clearSearch();
    clSearchBar.classList.remove("active", "has-query");
    clSearchInput.blur();
}

function clearSearch() {
    clSearchInput.value = "";
    clSearchBar.classList.remove("has-query");
    applySearch("");
}

clSearchToggle.addEventListener("click", openSearch);
clSearchClear.addEventListener("click", clearSearch);

document.addEventListener("keydown", (e) => {
    // Escape: close modal first if open, otherwise close search
    if (e.key === "Escape") {
        if (!deleteModal.classList.contains("hidden")) { closeDeleteModal(); return; }
        closeSearch();
        return;
    }
    if (e.key === "/" && document.activeElement !== clSearchInput) {
        e.preventDefault();
        openSearch();
    }
});

document.addEventListener("click", (e) => {
    if (clSearchBar.classList.contains("active") &&
        !clSearchBar.contains(e.target) &&
        clSearchInput.value === "") {
        closeSearch();
    }
});

clSearchInput.addEventListener("input", () => {
    const q = clSearchInput.value.trim();
    clSearchBar.classList.toggle("has-query", q.length > 0);
    applySearch(q);
});

function applySearch(rawQuery) {
    const entries = clList.querySelectorAll(".cl-entry");
    if (entries.length === 0) return;

    if (!rawQuery) {
        entries.forEach(entry => {
            entry.classList.remove("search-hidden", "search-match");
            restoreEntryText(entry);
        });
        clSearchCount.textContent = "";
        clNoResults.classList.add("hidden");
        return;
    }

    const q = rawQuery.toLowerCase();
    let matchCount = 0;

    entries.forEach(entry => {
        const typeText = (entry.dataset.searchType || "").toLowerCase();
        const summText = (entry.dataset.searchSummary || "").toLowerCase();
        const prevText = (entry.dataset.searchPreview || "").toLowerCase();
        const isMatch = typeText.includes(q) || summText.includes(q) || prevText.includes(q);

        if (isMatch) {
            matchCount++;
            entry.classList.remove("search-hidden");
            entry.classList.add("search-match");
            highlightEntryText(entry, rawQuery);
        } else {
            entry.classList.add("search-hidden");
            entry.classList.remove("search-match");
            restoreEntryText(entry);
        }
    });

    clSearchCount.textContent = matchCount > 0 ? `${matchCount} result${matchCount !== 1 ? "s" : ""}` : "";
    clNoResults.classList.toggle("hidden", matchCount > 0);
}

function highlightEntryText(entry, query) {
    const summaryEl = entry.querySelector(".cl-entry-summary");
    const previewEl = entry.querySelector(".cl-entry-preview");
    const typeEl = entry.querySelector(".cl-entry-type");
    if (summaryEl) summaryEl.innerHTML = highlightText(entry.dataset.searchSummary || "", query);
    if (previewEl) previewEl.innerHTML = highlightText(entry.dataset.searchPreview || "", query);
    if (typeEl) typeEl.innerHTML = highlightText(entry.dataset.searchType || "", query);
}

function restoreEntryText(entry) {
    const summaryEl = entry.querySelector(".cl-entry-summary");
    const previewEl = entry.querySelector(".cl-entry-preview");
    const typeEl = entry.querySelector(".cl-entry-type");
    if (summaryEl) summaryEl.textContent = entry.dataset.searchSummary || "";
    if (previewEl) previewEl.textContent = entry.dataset.searchPreview || "";
    if (typeEl) typeEl.textContent = entry.dataset.searchType || "";
}

function highlightText(text, query) {
    if (!query || !text) return escHtml(text);
    return escHtml(text).replace(
        new RegExp(`(${escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
        '<mark class="cl-highlight">$1</mark>'
    );
}