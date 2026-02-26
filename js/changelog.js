// ============================================================
//  js/changelog.js  —  Alithia World Chronicle
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, getDocs, query, orderBy }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Particle canvas (minimal — reuse pattern)
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

const authGuard = document.getElementById("authGuard");
const clWrap = document.getElementById("changelogWrap");
const clList = document.getElementById("changelogList");

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }

    authGuard.classList.add("fade-out");
    setTimeout(() => { authGuard.style.display = "none"; clWrap.classList.remove("hidden"); }, 500);

    await loadChangelog();
});

async function loadChangelog() {
    try {
        const snap = await getDocs(query(collection(db, "changelog"), orderBy("createdAt", "desc")));
        clList.innerHTML = "";

        if (snap.empty) {
            clList.innerHTML = '<div class="cl-empty">The chronicle is empty. Start collaborating to fill it.</div>';
            return;
        }

        snap.docs.forEach((docSnap, i) => {
            const data = docSnap.data();
            const entry = buildEntry(data, i);
            clList.appendChild(entry);
        });

    } catch (err) {
        clList.innerHTML = '<div class="cl-empty">Could not load the chronicle.</div>';
        console.error(err);
    }
}

function buildEntry(data, index) {
    const entry = document.createElement("div");
    entry.className = "cl-entry";
    entry.dataset.type = data.type || "update_posted";
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

    // Store raw text in dataset so search can match & restore without re-querying Firestore
    entry.dataset.searchType = typeLabel;
    entry.dataset.searchSummary = data.summary || "";
    entry.dataset.searchPreview = data.preview || "";

    entry.innerHTML = `
        <div class="cl-entry-time cl-entry-dot">
            <span class="cl-time-main">${timeMain}</span>
            <span class="cl-time-sub">${timeSub}</span>
        </div>
        <div class="cl-entry-content">
            <div class="cl-entry-type">${escHtml(typeLabel)}</div>
            <div class="cl-entry-summary">${escHtml(data.summary || "")}</div>
            ${data.preview ? `<div class="cl-entry-preview">${escHtml(data.preview)}</div>` : ""}
        </div>
    `;

    return entry;
}

function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ============================================================
//  SEARCH
// ============================================================

const clSearchBar = document.getElementById("clSearchBar");
const clSearchToggle = document.getElementById("clSearchToggle");
const clSearchInputWrap = document.getElementById("clSearchInputWrap");
const clSearchInput = document.getElementById("clSearchInput");
const clSearchCount = document.getElementById("clSearchCount");
const clSearchClear = document.getElementById("clSearchClear");
const clNoResults = document.getElementById("clNoResults");

// Open search bar
function openSearch() {
    clSearchBar.classList.add("active");
    setTimeout(() => clSearchInput.focus(), 350);
}

// Close & reset search bar
function closeSearch() {
    clearSearch();
    clSearchBar.classList.remove("active", "has-query");
    clSearchInput.blur();
}

// Clear query only (keep bar open)
function clearSearch() {
    clSearchInput.value = "";
    clSearchBar.classList.remove("has-query");
    applySearch("");
}

clSearchToggle.addEventListener("click", openSearch);
clSearchClear.addEventListener("click", clearSearch);

// Press "/" anywhere to open search (Discord-style)
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeSearch(); return; }
    if (e.key === "/" && document.activeElement !== clSearchInput) {
        e.preventDefault();
        openSearch();
    }
});

// Close search when clicking outside
document.addEventListener("click", (e) => {
    if (clSearchBar.classList.contains("active") &&
        !clSearchBar.contains(e.target) &&
        clSearchInput.value === "") {
        closeSearch();
    }
});

// Live search on input
clSearchInput.addEventListener("input", () => {
    const q = clSearchInput.value.trim();
    clSearchBar.classList.toggle("has-query", q.length > 0);
    applySearch(q);
});

function applySearch(rawQuery) {
    const entries = clList.querySelectorAll(".cl-entry");
    if (entries.length === 0) return;

    if (!rawQuery) {
        // Reset all entries to original text, show all
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
        // Build searchable text from stored raw data
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

    // Update count badge
    clSearchCount.textContent = matchCount > 0 ? `${matchCount} result${matchCount !== 1 ? "s" : ""}` : "";

    // Show/hide no-results message
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

// Wraps matching substrings with <mark class="cl-highlight">…</mark>
function highlightText(text, query) {
    if (!query || !text) return escHtml(text);
    const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${safeQ})`, "gi");
    return escHtml(text).replace(
        new RegExp(`(${escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
        '<mark class="cl-highlight">$1</mark>'
    );
}