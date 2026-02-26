// ============================================================
//  js/wruil.js  —  Alithia Country / Continent Page
//
//  ── TEMPLATE INSTRUCTIONS ───────────────────────────────────
//  When copying this file for a new region, change ONLY:
//    1. PAGE_ID  → the Firestore document key (lowercase, no spaces)
//    2. PAGE_SLUG → used for the back-link on the page
//  Everything else adapts automatically.
//  ────────────────────────────────────────────────────────────
const PAGE_ID = "wruil";    // ← change this per page
const PAGE_SLUG = "wruil";    // ← change this per page (usually same)

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Particle canvas (shared pattern) ─────────────────────────
const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d");
let W, H, particles;

function resizeCanvas() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
function makeParticle() {
    return {
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 1.1 + 0.2,
        speed: Math.random() * 0.22 + 0.03,
        drift: (Math.random() - 0.5) * 0.12,
        alpha: Math.random() * 0.4 + 0.06,
        pulse: Math.random() * Math.PI * 2,
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

// ── Wiki link routing table ───────────────────────────────────
// TODO: Update hrefs as pages are built. Mark with resolved:false
// to show the dashed "unresolved" style for pages not yet built.
const WIKI_ROUTES = {
    faction: { href: "factions.html", resolved: true },
    character: { href: "characters.html", resolved: true },
    region: { href: "lore-codex.html", resolved: true },
    history: { href: "lore-codex.html", resolved: true },
    magic: { href: "lore-codex.html", resolved: true },
    // Add more types here as needed
};

// ── State ─────────────────────────────────────────────────────
let currentUser = null;
let isKeeper = false;
let editMode = false;
let pageData = { sections: [] };
let editingIndex = null;   // null = new section, number = editing existing

// ── DOM refs ──────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const ogWrap = document.getElementById("ogWrap");
const ogSections = document.getElementById("ogSections");
const ogLoading = document.getElementById("ogLoading");
const ogEditToggle = document.getElementById("ogEditToggle");
const ogEditBanner = document.getElementById("ogEditBanner");
const editBannerExit = document.getElementById("editBannerExit");
const ogAddSectionWrap = document.getElementById("ogAddSectionWrap");
const ogAddSectionBtn = document.getElementById("ogAddSectionBtn");
const ogLastEdited = document.getElementById("ogLastEdited");

// ── Auth guard ────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    currentUser = user;

    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists() && userSnap.data().role === "keeper") isKeeper = true;
    } catch (_) { /* non-fatal */ }

    authGuard.classList.add("fade-out");
    setTimeout(() => { authGuard.style.display = "none"; ogWrap.classList.remove("hidden"); }, 500);

    if (isKeeper) ogEditToggle.classList.remove("hidden");

    await loadPage();
});

// ── Load page data ────────────────────────────────────────────
async function loadPage() {
    try {
        const snap = await getDoc(doc(db, "world-pages", PAGE_ID));

        if (snap.exists()) {
            pageData = snap.data();

            // Update hero fields from Firestore if present
            if (pageData.heroEyebrow) document.getElementById("heroEyebrow").textContent = pageData.heroEyebrow;
            if (pageData.heroTitle) document.getElementById("heroTitle").textContent = pageData.heroTitle;
            if (pageData.heroTagline) document.getElementById("heroTagline").textContent = pageData.heroTagline;
            if (pageData.heroTags) renderHeroTags(pageData.heroTags);

            // Last edited
            if (pageData.updatedAt) {
                const d = pageData.updatedAt.toDate();
                ogLastEdited.textContent = `Last edited ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
                ogLastEdited.classList.remove("hidden");
            }
        } else {
            // Document doesn't exist yet — start with empty sections
            pageData = { sections: [] };
        }

        renderAllSections();

    } catch (err) {
        console.error("Failed to load page:", err);
        ogLoading.innerHTML = `<span style="color:var(--error)">Could not load this page's lore.</span>`;
    }
}

// ── Render hero tags ──────────────────────────────────────────
function renderHeroTags(tags) {
    const heroTagsEl = document.getElementById("heroTags");
    if (!tags || !tags.length) return;
    heroTagsEl.innerHTML = tags.map((t, i) =>
        `<span class="hero-tag">${escHtml(t)}</span>${i < tags.length - 1 ? '<span class="tag-dot">&middot;</span>' : ''}`
    ).join("");
}

// ── Render all sections ───────────────────────────────────────
function renderAllSections() {
    ogLoading.style.display = "none";
    ogSections.innerHTML = "";

    if (!pageData.sections || pageData.sections.length === 0) {
        if (isKeeper) {
            // Keepers see a prompt to start writing
            ogSections.innerHTML = `<div class="og-empty">No lore written yet. Enter edit mode and add the first section.</div>`;
        } else {
            ogSections.innerHTML = `<div class="og-empty">The lore for this land has not yet been recorded.</div>`;
        }
        return;
    }

    pageData.sections.forEach((section, index) => {
        ogSections.appendChild(buildSectionEl(section, index));
    });
}

// ── Build a rendered section element ─────────────────────────
function buildSectionEl(section, index) {
    const el = document.createElement("div");
    el.className = "og-section";
    el.dataset.index = index;

    // Extract wiki links for tag chips
    const wikiTags = extractWikiTags(section.content || "");

    const docBtnHtml = section.docUrl ? `
        <a href="${escHtml(section.docUrl)}" target="_blank" rel="noopener noreferrer" class="og-doc-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            Open in Google Docs ↗
        </a>` : "";

    const tagChipsHtml = wikiTags.length ? `
        <div class="og-section-tags">
            ${wikiTags.map(t => `<span class="og-tag-chip" data-type="${t.type}">${escHtml(t.label)}</span>`).join("")}
        </div>` : "";

    const footerHtml = (docBtnHtml || tagChipsHtml)
        ? `<div class="og-section-footer">${docBtnHtml}<div>${tagChipsHtml}</div></div>`
        : "";

    // Keeper edit controls (hidden until hover, or always visible in edit mode)
    const controlsHtml = isKeeper ? `
        <div class="og-section-controls" id="controls-${index}">
            <button class="og-section-btn" data-action="edit" data-index="${index}" title="Edit section">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="og-section-btn delete-btn" data-action="delete" data-index="${index}" title="Delete section">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
        </div>` : "";

    el.innerHTML = `
        <div class="og-section-header">
            <div class="og-section-title">${escHtml(section.title || "Untitled Section")}</div>
            ${controlsHtml}
        </div>
        <div class="og-section-divider"></div>
        <div class="og-section-body">${parseWikiLinks(section.content || "")}</div>
        ${footerHtml}
    `;

    // Wire up keeper buttons
    if (isKeeper) {
        el.querySelectorAll(".og-section-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const idx = parseInt(btn.dataset.index, 10);
                if (action === "edit") openEditor(idx);
                if (action === "delete") openDeleteModal(idx);
            });
        });

        // In edit mode, always show controls
        if (editMode) {
            el.querySelector(".og-section-controls")?.classList.add("force-show");
        }
    }

    return el;
}

// ── Parse [[type:Name]] wiki-link syntax ─────────────────────
function parseWikiLinks(rawContent) {
    // rawContent is HTML coming from the RTF editor — we need to parse
    // the [[...]] markers that were typed literally (not inside HTML tags).
    // Replace each occurrence with a styled anchor.
    return rawContent.replace(/\[\[(\w+):([^\]]+)\]\]/g, (match, type, name) => {
        const route = WIKI_ROUTES[type.toLowerCase()];
        const resolved = route?.resolved ?? false;
        const href = route ? `${route.href}#${slugify(name)}` : "#";
        const cls = resolved ? "wiki-link" : "wiki-link wiki-unresolved";
        const title = resolved ? `Go to ${name}` : `${name} (page not yet built)`;
        return `<a class="${cls}" href="${href}" data-type="${escHtml(type.toLowerCase())}" title="${escHtml(title)}">${escHtml(name)}</a>`;
    });
}

// Extract unique wiki tags from raw content for tag chips
function extractWikiTags(rawContent) {
    const seen = new Set();
    const tags = [];
    const re = /\[\[(\w+):([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(rawContent)) !== null) {
        const key = `${m[1].toLowerCase()}:${m[2]}`;
        if (!seen.has(key)) {
            seen.add(key);
            tags.push({ type: m[1].toLowerCase(), label: m[2] });
        }
    }
    return tags;
}

// ── Edit mode toggle ──────────────────────────────────────────
ogEditToggle.addEventListener("click", () => {
    editMode = !editMode;
    ogEditToggle.classList.toggle("active", editMode);
    ogEditToggle.textContent = editMode ? "✓ Editing" : "";

    // Re-add SVG icon
    if (!editMode) {
        ogEditToggle.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Page`;
    }

    ogEditBanner.classList.toggle("hidden", !editMode);
    ogAddSectionWrap.classList.toggle("hidden", !editMode);

    // Re-render to toggle force-show on controls
    renderAllSections();
});

editBannerExit.addEventListener("click", () => {
    editMode = false;
    ogEditToggle.classList.remove("active");
    ogEditToggle.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Page`;
    ogEditBanner.classList.add("hidden");
    ogAddSectionWrap.classList.add("hidden");
    renderAllSections();
});

ogAddSectionBtn.addEventListener("click", () => openEditor(null));

// ══════════════════════════════════════════════════════════════
//  SECTION EDITOR MODAL
// ══════════════════════════════════════════════════════════════

const editorBackdrop = document.getElementById("editorBackdrop");
const editorModalTitle = document.getElementById("editorModalTitle");
const editorClose = document.getElementById("editorClose");
const editorTitle = document.getElementById("editorTitle");
const rteBody = document.getElementById("rteBody");
const editorDocUrl = document.getElementById("editorDocUrl");
const editorSaveBtn = document.getElementById("editorSaveBtn");
const editorCancelBtn = document.getElementById("editorCancelBtn");
const editorMsg = document.getElementById("editorMsg");

function openEditor(index) {
    editingIndex = index;
    editorMsg.classList.add("hidden");

    if (index === null) {
        // New section
        editorModalTitle.textContent = "Add New Section";
        editorTitle.value = "";
        rteBody.innerHTML = "";
        editorDocUrl.value = "";
    } else {
        // Edit existing
        const section = pageData.sections[index];
        editorModalTitle.textContent = "Edit Section";
        editorTitle.value = section.title || "";
        rteBody.innerHTML = section.content || "";
        editorDocUrl.value = section.docUrl || "";
    }

    editorSaveBtn.disabled = false;
    editorSaveBtn.textContent = "Save Section";
    showModal(editorBackdrop);
    setTimeout(() => editorTitle.focus(), 350);
}

function closeEditor() {
    hideModal(editorBackdrop);
    editingIndex = null;
}

editorClose.addEventListener("click", closeEditor);
editorCancelBtn.addEventListener("click", closeEditor);
editorBackdrop.addEventListener("click", (e) => { if (e.target === editorBackdrop) closeEditor(); });

// ── RTF toolbar ───────────────────────────────────────────────
document.querySelectorAll(".rte-btn[data-cmd]").forEach(btn => {
    btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus in editor
        const cmd = btn.dataset.cmd;
        const val = btn.dataset.val || null;
        document.execCommand(cmd, false, val);
        rteBody.focus();
    });
});

// ── Wiki link button & dialog ─────────────────────────────────
const rteWikiBtn = document.getElementById("rteWikiBtn");
const rteWikiHelp = document.getElementById("rteWikiHelp");
const rteWikiHelpClose = document.getElementById("rteWikiHelpClose");
const wikiDialogBackdrop = document.getElementById("wikiDialogBackdrop");
const wikiDialog = document.getElementById("wikiDialog");
const wikiDialogClose = document.getElementById("wikiDialogClose");
const wikiLinkType = document.getElementById("wikiLinkType");
const wikiLinkName = document.getElementById("wikiLinkName");
const wikiInsertBtn = document.getElementById("wikiInsertBtn");
const wikiCancelBtn = document.getElementById("wikiCancelBtn");

// Clicking [[Link]] button shows quick help + dialog
rteWikiBtn.addEventListener("click", () => {
    rteWikiHelp.classList.toggle("visible");
});
rteWikiHelpClose.addEventListener("click", () => {
    rteWikiHelp.classList.remove("visible");
    // Save cursor position, open dialog
    openWikiDialog();
});

// We also expose a dedicated "Insert link" flow via the toolbar button click (if help already dismissed)
rteWikiBtn.addEventListener("dblclick", (e) => {
    e.preventDefault();
    rteWikiHelp.classList.remove("visible");
    openWikiDialog();
});

function openWikiDialog() {
    wikiLinkName.value = "";
    showModal(wikiDialogBackdrop);
    setTimeout(() => wikiLinkName.focus(), 350);
}

wikiDialogClose.addEventListener("click", () => hideModal(wikiDialogBackdrop));
wikiCancelBtn.addEventListener("click", () => hideModal(wikiDialogBackdrop));
wikiDialogBackdrop.addEventListener("click", (e) => { if (e.target === wikiDialogBackdrop) hideModal(wikiDialogBackdrop); });

wikiInsertBtn.addEventListener("click", () => {
    const type = wikiLinkType.value;
    const name = wikiLinkName.value.trim();
    if (!name) { wikiLinkName.focus(); return; }

    hideModal(wikiDialogBackdrop);

    // Insert the raw marker into the editor at cursor
    rteBody.focus();
    const marker = `[[${type}:${name}]]`;
    document.execCommand("insertText", false, marker);
});

// ── Save section to Firestore ─────────────────────────────────
editorSaveBtn.addEventListener("click", async () => {
    const title = editorTitle.value.trim();
    const content = rteBody.innerHTML.trim();
    const docUrl = editorDocUrl.value.trim();

    if (!title) {
        showEditorMsg("Please add a section title.");
        return;
    }

    editorSaveBtn.disabled = true;
    editorSaveBtn.textContent = "Saving…";

    const sections = [...(pageData.sections || [])];
    const sectionData = { title, content, docUrl: docUrl || "" };

    if (editingIndex === null) {
        sections.push(sectionData);
    } else {
        sections[editingIndex] = sectionData;
    }

    try {
        await setDoc(doc(db, "world-pages", PAGE_ID), {
            ...(pageData || {}),
            sections,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
        });

        pageData.sections = sections;

        // Write to changelog (non-blocking)
        const clType = editingIndex === null ? "lore_section_added" : "lore_section_edited";
        const clPreview = content.replace(/<[^>]+>/g, "").slice(0, 120);
        writeChangelog(clType, title, clPreview);

        // Update last-edited display
        ogLastEdited.textContent = `Last edited just now`;
        ogLastEdited.classList.remove("hidden");

        closeEditor();
        renderAllSections();

    } catch (err) {
        console.error("Save failed:", err);
        editorSaveBtn.disabled = false;
        editorSaveBtn.textContent = "Save Section";
        showEditorMsg("Save failed. Check your connection or permissions.");
    }
});

function showEditorMsg(msg) {
    editorMsg.textContent = msg;
    editorMsg.classList.remove("hidden");
}

// ══════════════════════════════════════════════════════════════
//  DELETE SECTION MODAL
// ══════════════════════════════════════════════════════════════

const deleteBackdrop = document.getElementById("deleteBackdrop");
const deleteSectionTitle = document.getElementById("deleteSectionTitle");
const deleteCancelBtn = document.getElementById("deleteCancelBtn");
const deleteConfirmBtn = document.getElementById("deleteConfirmBtn");
const deleteError = document.getElementById("deleteError");

let pendingDeleteIndex = null;

function openDeleteModal(index) {
    pendingDeleteIndex = index;
    const title = pageData.sections[index]?.title || "this section";
    deleteSectionTitle.textContent = title.length > 60 ? title.slice(0, 60) + "…" : title;
    deleteError.classList.add("hidden");
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = "Delete Section";
    showModal(deleteBackdrop);
    deleteCancelBtn.focus();
}

deleteCancelBtn.addEventListener("click", () => hideModal(deleteBackdrop));
deleteBackdrop.addEventListener("click", (e) => { if (e.target === deleteBackdrop) hideModal(deleteBackdrop); });

deleteConfirmBtn.addEventListener("click", async () => {
    if (pendingDeleteIndex === null) return;

    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = "Deleting…";

    const sections = [...pageData.sections];
    const deletedTitle = pageData.sections[pendingDeleteIndex]?.title || "Untitled Section";
    sections.splice(pendingDeleteIndex, 1);

    try {
        await setDoc(doc(db, "world-pages", PAGE_ID), {
            ...(pageData || {}),
            sections,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
        });

        // Write to changelog (non-blocking)
        writeChangelog("lore_section_deleted", deletedTitle);

        pageData.sections = sections;
        hideModal(deleteBackdrop);
        renderAllSections();

    } catch (err) {
        console.error("Delete failed:", err);
        deleteConfirmBtn.disabled = false;
        deleteConfirmBtn.textContent = "Delete Section";
        deleteError.textContent = "Could not delete. Check your permissions.";
        deleteError.classList.remove("hidden");
    }
});

// ══════════════════════════════════════════════════════════════
//  MODAL HELPERS
// ══════════════════════════════════════════════════════════════

function showModal(backdrop) {
    backdrop.classList.remove("hidden");
    requestAnimationFrame(() => backdrop.classList.add("modal-visible"));
}

function hideModal(backdrop) {
    backdrop.classList.remove("modal-visible");
    setTimeout(() => backdrop.classList.add("hidden"), 300);
}

// Global Escape key handler
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Close modals in priority order (innermost first)
    if (!wikiDialogBackdrop.classList.contains("hidden")) { hideModal(wikiDialogBackdrop); return; }
    if (!deleteBackdrop.classList.contains("hidden")) { hideModal(deleteBackdrop); return; }
    if (!editorBackdrop.classList.contains("hidden")) { closeEditor(); return; }
});

// ══════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function slugify(str) {
    return str.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
}

// ══════════════════════════════════════════════════════════════
//  CHANGELOG INTEGRATION
//  Fires automatically after every section save / delete.
//  Copy this file with a new PAGE_ID and all 16 other worlds
//  get changelog entries for free — no changes needed here.
// ══════════════════════════════════════════════════════════════

/**
 * Writes a single changelog entry to Firestore.
 * @param {"lore_section_added"|"lore_section_edited"|"lore_section_deleted"} type
 * @param {string} sectionTitle  — the section's title
 * @param {string} [preview]     — optional short excerpt
 */
async function writeChangelog(type, sectionTitle, preview = "") {
    const pageLabel = PAGE_ID.charAt(0).toUpperCase() + PAGE_ID.slice(1); // "wruil" → "Wruil"

    const summaryMap = {
        lore_section_added: `New lore section added to ${pageLabel}: "${sectionTitle}"`,
        lore_section_edited: `Lore section updated in ${pageLabel}: "${sectionTitle}"`,
        lore_section_deleted: `Lore section removed from ${pageLabel}: "${sectionTitle}"`,
    };

    try {
        await addDoc(collection(db, "changelog"), {
            type,
            summary: summaryMap[type] || `Lore change in ${pageLabel}`,
            preview: preview.slice(0, 120) || "",
            pageId: PAGE_ID,
            authorUid: currentUser?.uid || "",
            createdAt: serverTimestamp(),
        });
    } catch (err) {
        // Changelog write is non-fatal — don't block the UI if it fails
        console.warn("Changelog write skipped:", err.message);
    }
}