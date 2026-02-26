// ============================================================
//  js/characters.js  —  Alithia Characters
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
        ctx.fillStyle = `rgba(61,255,143,${a})`;
        ctx.shadowColor = "#3dff8f"; ctx.shadowBlur = 3; ctx.fill();
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
let allCharacters = [];
let activeStatus = "all";
let activeAffil = "all";
let editingId = null;

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const charactersWrap = document.getElementById("charactersWrap");
const charactersGrid = document.getElementById("charactersGrid");
const charactersLoading = document.getElementById("charactersLoading");

// ── Auth guard ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    currentUser = user;

    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) isKeeper = userDoc.data().role === "keeper";

    if (isKeeper) document.getElementById("charactersAddBtn").classList.remove("hidden");

    authGuard.classList.add("fade-out");
    setTimeout(() => { authGuard.style.display = "none"; charactersWrap.classList.remove("hidden"); }, 500);

    await loadCharacters();
});

// ── Load all characters ───────────────────────────────────────
async function loadCharacters() {
    charactersLoading.style.display = "flex";
    charactersGrid.querySelectorAll(".character-card, .characters-empty").forEach(e => e.remove());

    try {
        const snap = await getDocs(query(collection(db, "characters"), orderBy("createdAt", "desc")));
        allCharacters = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("Characters load failed:", err);
        allCharacters = [];
    }

    charactersLoading.style.display = "none";
    updateCounts();
    buildAffilChips();
    renderGrid();
}

// ── Count badges ─────────────────────────────────────────────
function updateCounts() {
    const counts = { alive: 0, deceased: 0, missing: 0, unknown: 0 };
    allCharacters.forEach(c => {
        const s = c.status || "unknown";
        if (counts[s] !== undefined) counts[s]++;
        else counts.unknown++;
    });

    document.getElementById("countAll").textContent = allCharacters.length;
    document.getElementById("countAlive").textContent = counts.alive;
    document.getElementById("countDeceased").textContent = counts.deceased;
    document.getElementById("countMissing").textContent = counts.missing;
    document.getElementById("countUnknown").textContent = counts.unknown;
}

// ── Affiliation chips (built from data) ───────────────────────
function buildAffilChips() {
    const container = document.getElementById("affilChips");

    // Collect unique affiliations
    const affils = new Set();
    allCharacters.forEach(c => { if (c.affiliation && c.affiliation.trim()) affils.add(c.affiliation.trim()); });

    // Keep "All" chip, remove the rest, rebuild
    container.querySelectorAll(".affil-chip:not([data-affil='all'])").forEach(c => c.remove());

    affils.forEach(affil => {
        const chip = document.createElement("button");
        chip.className = "affil-chip";
        chip.dataset.affil = affil;
        chip.textContent = affil;
        if (affil === activeAffil) chip.classList.add("active");
        chip.addEventListener("click", () => setAffilFilter(affil));
        container.appendChild(chip);
    });

    const allChip = container.querySelector("[data-affil='all']");
    allChip.classList.toggle("active", activeAffil === "all");
    allChip.onclick = () => setAffilFilter("all");
}

function setAffilFilter(affil) {
    activeAffil = affil;
    buildAffilChips();
    renderGrid();
}

// ── Render grid ───────────────────────────────────────────────
function renderGrid() {
    charactersGrid.querySelectorAll(".character-card, .characters-empty").forEach(e => e.remove());

    let visible = allCharacters;
    if (activeStatus !== "all") visible = visible.filter(c => (c.status || "unknown") === activeStatus);
    if (activeAffil !== "all") visible = visible.filter(c => (c.affiliation || "") === activeAffil);

    const statusLabels = { all: "All Characters", alive: "Alive", deceased: "Deceased", missing: "Missing", unknown: "Unknown" };
    const title = activeAffil !== "all" ? activeAffil : (statusLabels[activeStatus] || "All Characters");
    document.getElementById("charactersMainTitle").textContent = title;
    document.getElementById("charactersEntryCount").textContent = `${visible.length} character${visible.length !== 1 ? "s" : ""}`;

    if (visible.length === 0) {
        const empty = document.createElement("div");
        empty.className = "characters-empty";
        empty.textContent = activeStatus !== "all" || activeAffil !== "all"
            ? "No characters match this filter."
            : "No characters recorded yet. Add the first soul to the roster.";
        charactersGrid.appendChild(empty);
        return;
    }

    visible.forEach((character, i) => charactersGrid.appendChild(buildCard(character, i)));
}

// ── Build character card ──────────────────────────────────────
function buildCard(character, index) {
    const card = document.createElement("div");
    card.className = "character-card";
    card.dataset.id = character.id;
    card.dataset.status = character.status || "unknown";
    card.style.animationDelay = `${index * 50}ms`;

    const status = character.status || "unknown";
    const charClass = character.charClass || "";
    const race = character.race || "";
    const affiliation = character.affiliation || "";
    const region = character.region || "";
    const hasDoc = !!(character.docUrl && character.docUrl.trim());

    card.innerHTML = `
        <div class="character-card-inner">
            <div class="character-card-top">
                <span class="char-tag status-tag" data-status="${status}">${capitalize(status)}</span>
                ${charClass ? `<span class="char-tag class-tag">${escHtml(charClass)}</span>` : ""}
                ${race ? `<span class="char-tag race-tag">${escHtml(race)}</span>` : ""}
                ${hasDoc ? '<span class="char-doc-badge">📋 doc</span>' : ""}
            </div>
            <div class="character-card-title">${escHtml(character.title || "Unnamed Character")}</div>
            <div class="character-card-desc">${escHtml(character.synopsis || "No synopsis recorded yet.")}</div>
            <div class="character-card-meta">
                ${affiliation ? `<span class="character-card-meta-item"><strong>Faction:</strong> ${escHtml(affiliation)}</span>` : ""}
                ${region ? `<span class="character-card-meta-item"><strong>Region:</strong> ${escHtml(region)}</span>` : ""}
            </div>
            <div class="character-card-footer">
                <span class="character-card-author">${escHtml(character.writtenBy || character.authorName || "—")}</span>
                <span class="character-card-arrow">→</span>
            </div>
        </div>
    `;

    card.addEventListener("click", () => openEntryModal(character));
    return card;
}

// ── Status nav filter ─────────────────────────────────────────
document.querySelectorAll(".characters-nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
        activeStatus = btn.dataset.status;
        document.querySelectorAll(".characters-nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderGrid();
    });
});

// ── Entry viewer modal ────────────────────────────────────────
function openEntryModal(character) {
    const backdrop = document.getElementById("entryModalBackdrop");
    const status = character.status || "unknown";

    // Tags
    const statusEl = document.getElementById("modalStatusTag");
    statusEl.textContent = capitalize(status);
    statusEl.dataset.status = status;

    const classEl = document.getElementById("modalClassTag");
    if (character.charClass) {
        classEl.textContent = character.charClass;
        classEl.style.display = "";
    } else {
        classEl.style.display = "none";
    }

    const raceEl = document.getElementById("modalRaceTag");
    if (character.race) {
        raceEl.textContent = character.race;
        raceEl.style.display = "";
    } else {
        raceEl.style.display = "none";
    }

    document.getElementById("modalTitle").textContent = character.title || "Unnamed Character";
    document.getElementById("modalWrittenBy").textContent = `by ${character.writtenBy || character.authorName || "Unknown"}`;
    document.getElementById("modalUpdated").textContent = character.updatedAt
        ? `Updated ${formatTime(character.updatedAt.toDate())}`
        : (character.createdAt ? `Added ${formatTime(character.createdAt.toDate())}` : "—");
    document.getElementById("modalDesc").textContent = character.synopsis || "";
    document.getElementById("modalAffiliation").textContent = character.affiliation || "None";
    document.getElementById("modalRegion").textContent = character.region || "Unknown";
    document.getElementById("modalRace").textContent = character.race || "Unknown";
    document.getElementById("modalWrittenByDetail").textContent = character.writtenBy || character.authorName || "Unknown";

    // Doc embed or placeholder
    const frameEl = document.getElementById("modalDocFrame");
    frameEl.innerHTML = "";
    if (character.docUrl && character.docUrl.trim()) {
        const iframe = document.createElement("iframe");
        iframe.className = "characters-doc-iframe";
        iframe.src = toEmbedUrl(character.docUrl.trim());
        iframe.setAttribute("allowfullscreen", "");
        iframe.setAttribute("loading", "lazy");
        frameEl.appendChild(iframe);
    } else {
        frameEl.innerHTML = `
            <div class="characters-doc-placeholder">
                <div class="characters-doc-placeholder-rune">👤</div>
                <div class="characters-doc-placeholder-title">Document Pending</div>
                <div class="characters-doc-placeholder-body">
                    The full character document has not yet been linked.
                    When a Google Doc is ready, a Keeper can attach it via
                    <code>Edit Character → Google Doc URL</code> and it will appear here automatically.
                </div>
            </div>
        `;
    }

    // Keeper actions
    const keeperActions = document.getElementById("modalKeeperActions");
    if (isKeeper) {
        keeperActions.classList.remove("hidden");
        document.getElementById("modalEditBtn").onclick = () => { closeEntryModal(); openEntryForm(character); };
        document.getElementById("modalDeleteBtn").onclick = () => deleteCharacter(character.id);
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

function toEmbedUrl(url) {
    if (url.includes("/pub") || url.includes("embedded=true")) return url;
    return url.replace(/\/(edit|view|preview).*$/, "/pub?embedded=true");
}

// ── Add / Edit form modal ─────────────────────────────────────
function openEntryForm(existing = null) {
    editingId = existing ? existing.id : null;

    document.getElementById("formModalTitle").textContent = editingId ? "Edit Character" : "Add Character";
    document.getElementById("formTitle").value = existing?.title || "";
    document.getElementById("formStatus").value = existing?.status || "alive";
    document.getElementById("formClass").value = existing?.charClass || "";
    document.getElementById("formRace").value = existing?.race || "";
    document.getElementById("formRegion").value = existing?.region || "";
    document.getElementById("formAffiliation").value = existing?.affiliation || "";
    document.getElementById("formWrittenBy").value = existing?.writtenBy || "";
    document.getElementById("formDesc").value = existing?.synopsis || "";
    document.getElementById("formDocUrl").value = existing?.docUrl || "";
    document.getElementById("formMsg").textContent = "";
    document.getElementById("formMsg").className = "characters-form-msg";
    document.getElementById("formSubmitBtn").disabled = false;
    document.getElementById("formSubmitBtn").textContent = "Save Character";

    document.getElementById("entryFormBackdrop").classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function closeEntryForm() {
    document.getElementById("entryFormBackdrop").classList.add("hidden");
    document.body.style.overflow = "";
    editingId = null;
}

document.getElementById("charactersAddBtn").addEventListener("click", () => openEntryForm());
document.getElementById("entryFormClose").addEventListener("click", closeEntryForm);
document.getElementById("formCancelBtn").addEventListener("click", closeEntryForm);
document.getElementById("entryFormBackdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeEntryForm();
});

document.getElementById("formSubmitBtn").addEventListener("click", async () => {
    const title = document.getElementById("formTitle").value.trim();
    const status = document.getElementById("formStatus").value;
    const charClass = document.getElementById("formClass").value.trim();
    const race = document.getElementById("formRace").value.trim();
    const region = document.getElementById("formRegion").value.trim();
    const affiliation = document.getElementById("formAffiliation").value.trim();
    const writtenBy = document.getElementById("formWrittenBy").value.trim();
    const synopsis = document.getElementById("formDesc").value.trim();
    const docUrl = document.getElementById("formDocUrl").value.trim();
    const msgEl = document.getElementById("formMsg");
    const btn = document.getElementById("formSubmitBtn");

    if (!title) {
        msgEl.textContent = "Please enter a character name.";
        msgEl.className = "characters-form-msg error";
        return;
    }

    btn.disabled = true;
    btn.textContent = editingId ? "Saving…" : "Adding…";

    try {
        if (editingId) {
            await updateDoc(doc(db, "characters", editingId), {
                title, status, charClass, race, region, affiliation, writtenBy, synopsis, docUrl,
                updatedAt: serverTimestamp()
            });
            const idx = allCharacters.findIndex(c => c.id === editingId);
            if (idx !== -1) Object.assign(allCharacters[idx], { title, status, charClass, race, region, affiliation, writtenBy, synopsis, docUrl });

            await logChange("character_edited", `Character updated: ${title}`, synopsis.slice(0, 120));
            msgEl.textContent = "Character updated!";
            msgEl.className = "characters-form-msg success";

        } else {
            const docRef = await addDoc(collection(db, "characters"), {
                title, status, charClass, race, region, affiliation, writtenBy, synopsis, docUrl,
                authorUid: currentUser.uid,
                authorName: currentUser.displayName || currentUser.email,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            allCharacters.unshift({
                id: docRef.id, title, status, charClass, race, region, affiliation, writtenBy, synopsis, docUrl,
                authorUid: currentUser.uid,
                authorName: currentUser.displayName || currentUser.email
            });

            await logChange("character_added", `New character added: ${title}`, synopsis.slice(0, 120));
            msgEl.textContent = "Character added to the roster!";
            msgEl.className = "characters-form-msg success";
        }

        updateCounts();
        buildAffilChips();
        renderGrid();
        setTimeout(closeEntryForm, 900);

    } catch (err) {
        msgEl.textContent = "Failed to save. Check your connection and try again.";
        msgEl.className = "characters-form-msg error";
        console.error("Character save failed:", err);
    }

    btn.disabled = false;
    btn.textContent = "Save Character";
});

// ── Delete character ──────────────────────────────────────────
async function deleteCharacter(id) {
    if (!confirm("Permanently remove this character from the roster?")) return;
    try {
        await deleteDoc(doc(db, "characters", id));
        allCharacters = allCharacters.filter(c => c.id !== id);
        closeEntryModal();
        updateCounts();
        buildAffilChips();
        renderGrid();
    } catch (err) { console.error("Character delete failed:", err); }
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
    if (e.key === "Escape") { closeEntryModal(); closeEntryForm(); closeSearch(); }
});

// ── Search overlay ────────────────────────────────────────────
const searchOverlay = document.getElementById("charactersSearchOverlay");
const searchInput = document.getElementById("charactersSearchInput");
const searchResults = document.getElementById("charactersSearchResults");

document.getElementById("charactersSearchBtn").addEventListener("click", () => {
    searchOverlay.classList.remove("hidden");
    searchInput.focus();
});
document.getElementById("charactersSearchClose").addEventListener("click", closeSearch);
searchOverlay.addEventListener("click", (e) => { if (e.target === e.currentTarget) closeSearch(); });

function closeSearch() {
    searchOverlay.classList.add("hidden");
    searchInput.value = "";
    searchResults.innerHTML = '<div class="characters-search-hint">Start typing to search characters…</div>';
}

let debounce;
searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 180);
});

function runSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (q.length < 2) {
        searchResults.innerHTML = '<div class="characters-search-hint">Start typing to search characters…</div>';
        return;
    }

    const hits = allCharacters.filter(c =>
        (c.title || "").toLowerCase().includes(q) ||
        (c.synopsis || "").toLowerCase().includes(q) ||
        (c.charClass || "").toLowerCase().includes(q) ||
        (c.race || "").toLowerCase().includes(q) ||
        (c.region || "").toLowerCase().includes(q) ||
        (c.affiliation || "").toLowerCase().includes(q) ||
        (c.writtenBy || "").toLowerCase().includes(q) ||
        (c.authorName || "").toLowerCase().includes(q)
    );

    searchResults.innerHTML = "";

    if (hits.length === 0) {
        searchResults.innerHTML = '<div class="characters-search-no-results">No characters found.</div>';
        return;
    }

    hits.slice(0, 15).forEach(character => {
        const item = document.createElement("div");
        item.className = "characters-search-result";
        const meta = [character.charClass, character.race, capitalize(character.status || "unknown")].filter(Boolean).join(" · ");
        item.innerHTML = `
            <div class="characters-search-result-type">${meta}</div>
            <div class="characters-search-result-title">${highlight(escHtml(character.title || "Unnamed"), q)}</div>
            <div class="characters-search-result-desc">${escHtml(character.synopsis || "")}</div>
        `;
        item.addEventListener("click", () => { closeSearch(); openEntryModal(character); });
        searchResults.appendChild(item);
    });
}

function highlight(text, q) {
    const rx = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return text.replace(rx, '<span class="search-highlight">$1</span>');
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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