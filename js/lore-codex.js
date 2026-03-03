// ============================================================
//  js/lore-codex.js  —  Alithia Lore Codex (with Wikilinks)
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    collection, addDoc, getDocs, getDoc, doc, deleteDoc,
    updateDoc, query, orderBy, where, serverTimestamp
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
let allEntries = [];
let activeCat = "all";
let editingId = null;

// ── Wikilink config ───────────────────────────────────────────
// Maps [[type: Name]] → { collection, page, label }
const WIKILINK_TYPES = {
    character: { collection: "characters", page: "characters.html", label: "Character" },
    faction: { collection: "factions", page: "factions.html", label: "Faction" },
    location: { collection: "locations", page: "locations.html", label: "Location" },
};

// Regex: matches [[type: Name]] anywhere in a string
// Capture group 1 = type, group 2 = name
const WIKILINK_RE = /\[\[([a-zA-Z]+):\s*([^\]]+?)\s*\]\]/g;

// ── Category meta ─────────────────────────────────────────────
const CAT_LABELS = {
    region: "🗺 Region",
    faction: "⚔ Faction",
    character: "👤 Character",
    history: "📜 History",
    magic: "✧ Magic & Arcana",
    misc: "◈ Miscellany",
    vel: "* Vel",
};

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const loreWrap = document.getElementById("loreWrap");
const loreGrid = document.getElementById("loreGrid");
const loreLoading = document.getElementById("loreLoading");

// ── Auth guard ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        sessionStorage.setItem("alithia_redirect", window.location.href);
        window.location.href = "login.html";
        return;
    }
    currentUser = user;

    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) isKeeper = userDoc.data().role === "keeper";

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
    const counts = { region: 0, faction: 0, character: 0, history: 0, magic: 0, misc: 0, vel: 0 };
    allEntries.forEach(e => { if (counts[e.category] !== undefined) counts[e.category]++; });
    document.getElementById("countAll").textContent = allEntries.length;
    document.getElementById("countRegion").textContent = counts.region;
    document.getElementById("countFaction").textContent = counts.faction;
    document.getElementById("countCharacter").textContent = counts.character;
    document.getElementById("countHistory").textContent = counts.history;
    document.getElementById("countMagic").textContent = counts.magic;
    document.getElementById("countMisc").textContent = counts.misc;
    document.getElementById("countVel").textContent = counts.vel;
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

    visible.forEach((entry, i) => loreGrid.appendChild(buildCard(entry, i)));
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
    const hasDoc = !!(entry.docUrl?.trim());

    // Render wikilinks as simple badges on the card (non-interactive preview)
    const previewDesc = stripWikilinks(desc);

    // Show stub badge if this entry was auto-created by a wikilink
    const stubBadge = entry.source === "lore_wikilink"
        ? '<span class="lore-card-stub-badge">⚠ Stub</span>'
        : "";

    card.innerHTML = `
<div class="lore-card-inner">
    <div class="lore-card-top">
        <span class="lore-card-cat">${catLabel}</span>
        ${stubBadge}
        ${hasDoc ? '<span class="lore-card-doc-badge">📋 doc linked</span>' : ""}
    </div>
    <div class="lore-card-title">${renderWikilinkBadges(escHtml(entry.title || "Untitled Entry"))}</div>
    <div class="lore-card-desc">${escHtml(previewDesc) || "<em>No synopsis yet.</em>"}</div>
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

    // Render the synopsis with interactive wikilink chips
    const descEl = document.getElementById("modalDesc");
    descEl.innerHTML = "";
    if (entry.synopsis || entry.content) {
        descEl.appendChild(buildWikilinkContent(entry.synopsis || entry.content));
    }

    // Stub notice
    const existingNotice = document.getElementById("modalStubNotice");
    if (existingNotice) existingNotice.remove();
    if (entry.source === "lore_wikilink") {
        const notice = document.createElement("div");
        notice.id = "modalStubNotice";
        notice.className = "lore-stub-notice";
        notice.innerHTML = `⚠ This entry was auto-created by a wikilink. A Keeper should fill in the details.`;
        descEl.before(notice);
    }

    // Google Doc section
    const frameEl = document.getElementById("modalDocFrame");
    frameEl.innerHTML = "";
    if (entry.docUrl?.trim()) {
        frameEl.innerHTML = `
<div class="lore-doc-linked">
    <div class="lore-doc-linked-info">
        <span class="lore-doc-linked-icon">📄</span>
        <div class="lore-doc-linked-text">
            <span class="lore-doc-linked-title">Full Document Available</span>
            <span class="lore-doc-linked-hint">Opens in Google Docs — sign-in may be required</span>
        </div>
    </div>
    <a class="lore-doc-open-btn"
       href="${escHtml(entry.docUrl.trim())}"
       target="_blank" rel="noopener noreferrer">
        Open in Google Docs →
    </a>
</div>`;
    } else {
        frameEl.innerHTML = `
<div class="lore-doc-placeholder">
    <div class="lore-doc-placeholder-rune">ᚦ</div>
    <div class="lore-doc-placeholder-title">Document Pending</div>
    <div class="lore-doc-placeholder-body">
        The full lore document for this entry has not yet been linked.
        When a Google Doc is ready, anyone can attach it via
        <code>Edit Entry → Google Doc URL</code> and it will appear here automatically.
    </div>
</div>`;
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

    // Show wikilink hint in the form
    let hint = document.getElementById("wikilinkHint");
    if (!hint) {
        hint = document.createElement("div");
        hint.id = "wikilinkHint";
        hint.className = "lore-form-hint lore-wikilink-hint";
        hint.innerHTML = `
            <strong>Wikilinks:</strong> Use <code>[[character: Name]]</code>,
            <code>[[faction: Name]]</code>, or <code>[[location: Name]]</code>
            in the title or synopsis to auto-link and create stubs.`;
        document.getElementById("formDesc").after(hint);
    }

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
            await updateDoc(doc(db, "lore", editingId), {
                title, category, synopsis, docUrl,
                updatedAt: serverTimestamp()
            });
            const idx = allEntries.findIndex(e => e.id === editingId);
            if (idx !== -1) Object.assign(allEntries[idx], { title, category, synopsis, docUrl });

            // Process any wikilinks in the updated text
            await processWikilinks(title, synopsis);

            msgEl.textContent = "Entry updated!";
            msgEl.className = "lore-form-msg success";

        } else {
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

            // Process any wikilinks in the new entry
            await processWikilinks(title, synopsis);

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

// ============================================================
//  WIKILINK SYSTEM
// ============================================================

/**
 * parseWikilinks(text)
 * Returns an array of { type, name, config } objects for every
 * [[type: Name]] tag found in the given string.
 * Skips unrecognised types silently.
 */
function parseWikilinks(text) {
    if (!text) return [];
    const results = [];
    let match;
    const re = new RegExp(WIKILINK_RE.source, "gi"); // fresh regex each call
    while ((match = re.exec(text)) !== null) {
        const type = match[1].toLowerCase();
        const name = match[2].trim();
        const config = WIKILINK_TYPES[type];
        if (config) results.push({ type, name, config, raw: match[0] });
    }
    return results;
}

/**
 * stripWikilinks(text)
 * Returns text with [[...]] replaced by just the Name part.
 * Used for card previews where we want clean plain text.
 */
function stripWikilinks(text) {
    if (!text) return "";
    return text.replace(new RegExp(WIKILINK_RE.source, "gi"), (_, _type, name) => name.trim());
}

/**
 * renderWikilinkBadges(html)
 * Replaces [[type: Name]] in already-escaped HTML with a
 * simple non-interactive styled badge (used on cards).
 */
function renderWikilinkBadges(html) {
    return html.replace(/\[\[([a-zA-Z]+):\s*([^\]]+?)\s*\]\]/gi, (_, type, name) => {
        const t = type.toLowerCase();
        const cfg = WIKILINK_TYPES[t];
        if (!cfg) return escHtml(name);
        return `<span class="lore-wikilink-badge lore-wikilink-${t}">${escHtml(cfg.label)}: ${escHtml(name)}</span>`;
    });
}

/**
 * buildWikilinkContent(text)
 * Returns a DocumentFragment with plain text and interactive
 * wikilink chips. Each chip checks Firestore and either
 * navigates to the linked page or shows a "stub" tooltip.
 */
function buildWikilinkContent(text) {
    const frag = document.createDocumentFragment();
    const re = new RegExp(WIKILINK_RE.source, "gi");
    let lastIdx = 0;
    let match;

    while ((match = re.exec(text)) !== null) {
        // Plain text before this match
        if (match.index > lastIdx) {
            frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
        }

        const type = match[1].toLowerCase();
        const name = match[2].trim();
        const cfg = WIKILINK_TYPES[type];

        if (cfg) {
            const chip = document.createElement("a");
            chip.className = `lore-wikilink-chip lore-wikilink-${type}`;
            chip.textContent = `${cfg.label}: ${name}`;
            chip.href = "#";
            chip.title = `Navigate to ${name}`;

            chip.addEventListener("click", async (e) => {
                e.preventDefault();
                await navigateWikilink(type, name, cfg, chip);
            });

            frag.appendChild(chip);
        } else {
            // Unrecognised type — render plain
            frag.appendChild(document.createTextNode(name));
        }

        lastIdx = match.index + match[0].length;
    }

    // Remaining plain text
    if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    }

    return frag;
}

/**
 * navigateWikilink(type, name, config, chipEl)
 * Called when a wikilink chip is clicked in the modal.
 * Looks up the target in Firestore; if found opens the entry
 * modal (for characters) or navigates to the page. If not
 * found, shows a tooltip — the stub was already created on save.
 */
async function navigateWikilink(type, name, cfg, chipEl) {
    chipEl.textContent = "…";
    chipEl.classList.add("lore-wikilink-loading");

    try {
        const existing = await findStubByName(cfg.collection, name);

        chipEl.textContent = `${cfg.label}: ${name}`;
        chipEl.classList.remove("lore-wikilink-loading");

        if (existing) {
            if (type === "character") {
                // Open character modal inline — navigate to page with anchor
                window.location.href = `${cfg.page}?open=${encodeURIComponent(existing.id)}`;
            } else {
                window.location.href = `${cfg.page}?open=${encodeURIComponent(existing.id)}`;
            }
        } else {
            // Shouldn't normally happen (stub created on save), but handle gracefully
            showWikilinkTooltip(chipEl, `"${name}" not found — it may have been deleted.`);
        }
    } catch (err) {
        console.error("Wikilink navigation failed:", err);
        chipEl.textContent = `${cfg.label}: ${name}`;
        chipEl.classList.remove("lore-wikilink-loading");
        showWikilinkTooltip(chipEl, "Could not load — check your connection.");
    }
}

/**
 * showWikilinkTooltip(el, message)
 * Briefly shows a floating tooltip below the chip element.
 */
function showWikilinkTooltip(el, message) {
    const existing = document.getElementById("wikilinkTooltip");
    if (existing) existing.remove();

    const tip = document.createElement("div");
    tip.id = "wikilinkTooltip";
    tip.className = "lore-wikilink-tooltip";
    tip.textContent = message;

    const rect = el.getBoundingClientRect();
    tip.style.top = `${rect.bottom + window.scrollY + 6}px`;
    tip.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(tip);

    setTimeout(() => tip.remove(), 3000);
}

/**
 * findStubByName(collectionName, name)
 * Queries Firestore for a document in collectionName where
 * title == name (case-sensitive). Returns the doc data + id, or null.
 */
async function findStubByName(collectionName, name) {
    const q = query(collection(db, collectionName), where("title", "==", name));
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/**
 * processWikilinks(title, synopsis)
 * Scans both fields for [[type: Name]] tags.
 * For each tag: checks if target already exists → skip.
 *              If not → creates a stub in the right collection.
 * Also creates a mirrored lore entry for character stubs
 * (using linkedCharacterId so characters.js won't duplicate it).
 */
async function processWikilinks(title, synopsis) {
    const combined = `${title} ${synopsis}`;
    const links = parseWikilinks(combined);

    // Deduplicate by type+name so we don't double-create
    const seen = new Set();
    for (const link of links) {
        const key = `${link.type}:${link.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        await resolveWikilink(link.type, link.name, link.config);
    }
}

/**
 * resolveWikilink(type, name, config)
 * Core logic: create stub if target doesn't exist yet.
 */
async function resolveWikilink(type, name, config) {
    try {
        const existing = await findStubByName(config.collection, name);
        if (existing) {
            console.log(`[wiki] "${name}" already exists in ${config.collection} — skipping.`);
            return;
        }

        // Build the stub data for each supported type
        let stubData = {
            title: name,
            source: "lore_wikilink",   // flag for Keepers
            authorUid: currentUser.uid,
            authorName: currentUser.displayName || currentUser.email,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };

        if (type === "character") {
            Object.assign(stubData, {
                status: "unknown",
                charClass: "",
                race: "",
                region: "",
                affiliation: "",
                writtenBy: "",
                synopsis: "",
                docUrl: "",
            });
        } else if (type === "faction") {
            Object.assign(stubData, {
                synopsis: "",
                docUrl: "",
            });
        } else if (type === "location") {
            Object.assign(stubData, {
                synopsis: "",
                docUrl: "",
                region: "",
            });
        }

        const newDocRef = await addDoc(collection(db, config.collection), stubData);
        console.log(`[wiki] Stub created: ${type} "${name}" (id: ${newDocRef.id})`);

        // For character stubs, also create a mirrored lore entry so the
        // Characters → Lore sync doesn't create a duplicate later.
        if (type === "character") {
            await createLoreStubForCharacter(newDocRef.id, name);
        }

    } catch (err) {
        console.error(`[wiki] Failed to resolve wikilink for "${name}":`, err);
    }
}

/**
 * createLoreStubForCharacter(characterId, name)
 * Creates (or skips if exists) a lore entry with category "character"
 * and linkedCharacterId set, so characters.js syncCharacterToLore()
 * will UPDATE rather than CREATE a duplicate when the stub is filled in.
 */
async function createLoreStubForCharacter(characterId, name) {
    // Check if a linked lore entry already exists
    const q = query(collection(db, "lore"), where("linkedCharacterId", "==", characterId));
    const snap = await getDocs(q);
    if (!snap.empty) {
        console.log(`[wiki] Lore mirror already exists for character "${name}" — skipping.`);
        return;
    }

    await addDoc(collection(db, "lore"), {
        title: name,
        category: "character",
        synopsis: "",
        docUrl: "",
        linkedCharacterId: characterId,
        source: "lore_wikilink",
        authorUid: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });

    console.log(`[wiki] Lore mirror created for character stub "${name}"`);
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
<div class="lore-search-result-desc">${escHtml(stripWikilinks(entry.synopsis || ""))}</div>
        `;
        item.addEventListener("click", () => { closeLoreSearch(); openEntryModal(entry); });
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