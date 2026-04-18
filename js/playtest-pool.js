// ============================================================
//  js/playtest-pool.js  —  Alithia Playtest Grounds
//
//  Auth-guarded — all authenticated users can browse & adopt.
//  Managers (Keeper / Storyteller): create, edit info, edit sheet,
//    lock, delete pregens, and revoke player adoptions.
//
//  Firestore:
//    playtest-sheets/{pregenId}        — pregen templates
//    playtest-adoptions/{adoptionId}   — adoption records
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged, signOut }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
    serverTimestamp, query, orderBy, where, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Particle canvas ──────────────────────────────────────────
const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d");
let W, H, particles;
function resizeCanvas() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
function makeParticle() { return { x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.1 + 0.2, speed: Math.random() * 0.2 + 0.03, drift: (Math.random() - 0.5) * 0.12, alpha: Math.random() * 0.4 + 0.06, pulse: Math.random() * Math.PI * 2 }; }
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
        if (p.x < -4) p.x = W + 4; if (p.x > W + 4) p.x = -4;
    }
    requestAnimationFrame(drawParticles);
}
window.addEventListener("resize", () => { resizeCanvas(); initParticles(); });
resizeCanvas(); initParticles(); requestAnimationFrame(drawParticles);

// ── State ─────────────────────────────────────────────────────
let currentUser = null;
let isManager = false;   // Keeper or Storyteller
let allPregens = [];      // all loaded pregen docs
let userAdoptions = {};      // pregenId → { adoptionId, characterSheetId }
let activeDrawerPregen = null;
let pendingAdoptPregen = null;
let pendingEditPregenId = null;   // null = create mode, string = edit mode
let pendingDeletePregenId = null;
let searchQuery = "";

// ── DOM refs ──────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const ptWrap = document.getElementById("ptWrap");
const topbarUsername = document.getElementById("topbarUsername");
const signOutBtn = document.getElementById("signOutBtn");
const ptLoading = document.getElementById("ptLoading");
const ptEmpty = document.getElementById("ptEmpty");
const ptGrid = document.getElementById("ptGrid");
const ptSearch = document.getElementById("ptSearch");
const ptManagerBar = document.getElementById("ptManagerBar");
const ptAddBtn = document.getElementById("ptAddBtn");
const ptYourSection = document.getElementById("ptYourSection");
const ptYourList = document.getElementById("ptYourList");

// Drawer
const ptDrawerBackdrop = document.getElementById("ptDrawerBackdrop");
const ptDrawerClose = document.getElementById("ptDrawerClose");
const ptDrawerAdoptBtn = document.getElementById("ptDrawerAdoptBtn");
const ptDrawerEditInfoBtn = document.getElementById("ptDrawerEditInfoBtn");
const ptDrawerEditorLink = document.getElementById("ptDrawerEditorLink");
const ptAdoptionsPanel = document.getElementById("ptAdoptionsPanel");
const ptAdoptionsList = document.getElementById("ptAdoptionsList");
const ptAdoptionsCount = document.getElementById("ptAdoptionsCount");

// Create/edit modal
const ptCreateModal = document.getElementById("ptCreateModalBackdrop");
const ptCreateModalClose = document.getElementById("ptCreateModalClose");
const ptCreateModalTitle = document.getElementById("ptCreateModalTitle");
const ptCreateModalHint = document.getElementById("ptCreateModalHint");
const ptPregenNameInput = document.getElementById("ptPregenNameInput");
const ptCharNameInput = document.getElementById("ptCharNameInput");
const ptConceptInput = document.getElementById("ptConceptInput");
const ptCreateMsg = document.getElementById("ptCreateMsg");
const ptCreateSaveBtn = document.getElementById("ptCreateSaveBtn");

// Adopt modal
const ptAdoptModal = document.getElementById("ptAdoptModalBackdrop");
const ptAdoptModalClose = document.getElementById("ptAdoptModalClose");
const ptAdoptHint = document.getElementById("ptAdoptHint");
const ptAdoptNameInput = document.getElementById("ptAdoptNameInput");
const ptAdoptMsg = document.getElementById("ptAdoptMsg");
const ptAdoptConfirmBtn = document.getElementById("ptAdoptConfirmBtn");

// Delete modal
const ptDeleteModal = document.getElementById("ptDeleteModalBackdrop");
const ptDeleteModalClose = document.getElementById("ptDeleteModalClose");
const ptDeleteNameDisplay = document.getElementById("ptDeleteNameDisplay");
const ptDeleteConfirmInput = document.getElementById("ptDeleteConfirmInput");
const ptDeleteMsg = document.getElementById("ptDeleteMsg");
const ptDeleteConfirmBtn = document.getElementById("ptDeleteConfirmBtn");
const ptDeleteCancelBtn = document.getElementById("ptDeleteCancelBtn");

// ── Auth guard ────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        sessionStorage.setItem("alithia_redirect", window.location.href);
        window.location.href = "login.html";
        return;
    }

    currentUser = user;
    topbarUsername.textContent = user.displayName || user.email;

    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const d = userSnap.data();
            isManager = d.isStoryteller === true || d.role === "keeper";
        }
    } catch (err) {
        console.error("Role check failed:", err);
    }

    if (isManager) ptManagerBar?.classList.remove("hidden");

    authGuard.classList.add("fade-out");
    setTimeout(() => { authGuard.style.display = "none"; ptWrap.classList.remove("hidden"); }, 500);

    try {
        await loadPool();
    } catch (err) {
        console.error("Pool load failed:", err);
        if (ptLoading) ptLoading.innerHTML = `<span style="color:var(--error)">Could not load pregens — check connection.</span>`;
    }
});

signOutBtn?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
});

// ── Load pool ─────────────────────────────────────────────────
async function loadPool() {
    if (ptLoading) ptLoading.style.display = "flex";
    if (ptGrid) ptGrid.innerHTML = "";

    // 1 — Load all pregens
    const pregensSnap = await getDocs(
        query(collection(db, "playtest-sheets"), orderBy("createdAt", "asc"))
    );
    allPregens = [];
    pregensSnap.forEach(d => allPregens.push({ id: d.id, ...d.data() }));

    // 2 — Load this user's adoptions
    userAdoptions = {};
    const adoptSnap = await getDocs(
        query(collection(db, "playtest-adoptions"), where("adoptedByUid", "==", currentUser.uid))
    );
    adoptSnap.forEach(d => {
        const data = d.data();
        userAdoptions[data.pregenId] = {
            adoptionId: d.id,
            characterSheetId: data.characterSheetId,
            adoptedAt: data.adoptedAt,
        };
    });

    if (ptLoading) ptLoading.style.display = "none";

    updateStats();
    renderYourAdoptions();
    renderGrid();
}

// ── Stats ─────────────────────────────────────────────────────
function updateStats() {
    const total = allPregens.reduce((acc, p) => acc + (p.adoptionCount || 0), 0);
    setText("statPregens", allPregens.length);
    setText("statAdoptions", total);
    setText("statMyAdoptions", Object.keys(userAdoptions).length);
}

// ── Your adoptions section ────────────────────────────────────
function renderYourAdoptions() {
    const keys = Object.keys(userAdoptions);
    if (keys.length === 0) { ptYourSection?.classList.add("hidden"); return; }
    ptYourSection?.classList.remove("hidden");
    if (!ptYourList) return;
    ptYourList.innerHTML = "";
    keys.forEach(pregenId => {
        const pregen = allPregens.find(p => p.id === pregenId);
        const item = document.createElement("div");
        item.className = "pt-your-item";
        item.innerHTML = `
            <span class="pt-your-pregen-name">${_e(pregen?.pregenName || "Unknown Pregen")}</span>
            <a class="pt-your-sheet-link" href="character-sheet.html">Open Sheet →</a>
        `;
        // Store sheet id so character-sheet.html auto-loads it on click
        item.querySelector("a")?.addEventListener("click", () => {
            sessionStorage.setItem("alithia_last_sheet", userAdoptions[pregenId].characterSheetId);
        });
        ptYourList.appendChild(item);
    });
}

// ── Render grid ───────────────────────────────────────────────
function renderGrid() {
    if (!ptGrid) return;
    ptGrid.innerHTML = "";

    const q = searchQuery.toLowerCase();
    const filtered = allPregens.filter(p => {
        if (!q) return true;
        return [p.pregenName, p.concept, p.charName, p.species, p.classLevel]
            .some(v => (v || "").toLowerCase().includes(q));
    });

    if (filtered.length === 0) {
        ptEmpty?.classList.remove("hidden");
        return;
    }
    ptEmpty?.classList.add("hidden");
    filtered.forEach((p, i) => ptGrid.appendChild(buildPregenCard(p, i)));
}

ptSearch?.addEventListener("input", () => {
    searchQuery = ptSearch.value.trim();
    renderGrid();
});

// ── Build pregen card ─────────────────────────────────────────
function buildPregenCard(pregen, index) {
    const card = document.createElement("div");
    const adopted = !!userAdoptions[pregen.id];
    const locked = !!pregen.isLocked;
    const rot = pregen.rot_status || "on_path";
    const pol = parseInt(pregen.polarity) || 0;
    const identity = [pregen.charName, pregen.species, pregen.classLevel].filter(Boolean).join(" · ") || "No details yet";
    const adoptCount = pregen.adoptionCount || 0;

    card.className = `pt-card${locked ? " pt-card-locked" : ""}`;
    card.style.animationDelay = `${index * 40}ms`;

    const pills = [
        rot === "off_path" || rot === "penalty"
            ? `<span class="cc-pill off-path">OFF PATH</span>`
            : `<span class="cc-pill on-path">ON PATH</span>`,
        pol > 0 ? `<span class="cc-pill polarity-pos">+${pol}</span>`
            : pol < 0 ? `<span class="cc-pill polarity-neg">${pol}</span>`
                : `<span class="cc-pill polarity-neu">POL 0</span>`,
    ].join("");

    const adoptBtn = adopted
        ? `<span class="pt-card-adopted-badge">✓ Adopted</span>`
        : locked
            ? `<span class="pt-card-locked-badge">⊘ Locked</span>`
            : `<button class="pt-card-adopt-btn">Adopt →</button>`;

    const managerRow = isManager ? `
        <div class="pt-card-manager-row">
            <button class="pt-card-meta-btn pt-card-edit-info-btn">✎ Info</button>
            <a class="pt-card-meta-btn pt-card-edit-btn" href="character-sheet.html?pregen=${_e(pregen.id)}">⚙ Stats</a>
            <button class="pt-card-meta-btn pt-card-lock-btn">${locked ? "⊘ Unlock" : "⊘ Lock"}</button>
            <button class="pt-card-meta-btn pt-card-delete-btn">🗑</button>
        </div>` : "";

    card.innerHTML = `
        ${locked ? `<div class="pt-card-lock-ribbon">LOCKED</div>` : ""}
        <div class="pt-card-template-name">${_e(pregen.pregenName || "Unnamed Pregen")}</div>
        ${pregen.concept ? `<div class="pt-card-concept">${_e(pregen.concept)}</div>` : ""}
        <div class="pt-card-identity">${_e(identity)}</div>
        <div class="pt-card-pills">${pills}</div>
        <div class="pt-card-footer">
            <span class="pt-card-adopt-count">${adoptCount} adopted</span>
            ${adoptBtn}
        </div>
        ${managerRow}
    `;

    // Card body → open drawer (not on action buttons)
    card.addEventListener("click", (e) => {
        if (e.target.closest(".pt-card-adopt-btn") ||
            e.target.closest(".pt-card-edit-info-btn") ||
            e.target.closest(".pt-card-edit-btn") ||
            e.target.closest(".pt-card-lock-btn") ||
            e.target.closest(".pt-card-delete-btn")) return;
        openDrawer(pregen);
    });

    card.querySelector(".pt-card-adopt-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openAdoptModal(pregen);
    });

    if (isManager) {
        card.querySelector(".pt-card-edit-info-btn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            openEditMetadataModal(pregen);
        });
        card.querySelector(".pt-card-lock-btn")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            await toggleLock(pregen, card);
        });
        card.querySelector(".pt-card-delete-btn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            openDeleteModal(pregen);
        });
    }

    return card;
}

// ── Drawer ─────────────────────────────────────────────────────
function openDrawer(pregen) {
    activeDrawerPregen = pregen;
    ptDrawerBackdrop?.classList.remove("hidden");

    setText("ptDrawerName", pregen.pregenName || "Unnamed Pregen");
    setText("ptDrawerConcept", pregen.concept || "No concept provided.");

    // Adopt button state
    if (ptDrawerAdoptBtn) {
        if (userAdoptions[pregen.id]) {
            ptDrawerAdoptBtn.textContent = "✓ Already Adopted";
            ptDrawerAdoptBtn.disabled = true;
        } else if (pregen.isLocked) {
            ptDrawerAdoptBtn.textContent = "⊘ Locked";
            ptDrawerAdoptBtn.disabled = true;
        } else {
            ptDrawerAdoptBtn.textContent = "Adopt this Pregen";
            ptDrawerAdoptBtn.disabled = false;
        }
    }

    // Manager-only controls in drawer
    if (ptDrawerEditInfoBtn) {
        ptDrawerEditInfoBtn.classList.toggle("hidden", !isManager);
        ptDrawerEditInfoBtn.onclick = () => openEditMetadataModal(pregen);
    }
    if (ptDrawerEditorLink) {
        ptDrawerEditorLink.classList.toggle("hidden", !isManager);
        ptDrawerEditorLink.href = `character-sheet.html?pregen=${pregen.id}`;
    }

    // Populate stats
    const s = f => parseInt(pregen[`stat_${f}`]) || 0;
    setText("ptDrCharName", pregen.charName || "—");
    setText("ptDrPronouns", pregen.pronouns || "—");
    setText("ptDrSpecies", pregen.species || "—");
    setText("ptDrClassLevel", pregen.classLevel || "—");
    setText("ptDrFortitude", s("fortitude"));
    setText("ptDrMuscle", s("muscle"));
    setText("ptDrSwiftness", s("swiftness"));
    setText("ptDrKeeness", s("keeness"));
    setText("ptDrWisdom", s("wisdom"));
    setText("ptDrCharm", s("charm"));
    setText("ptDrFaith", s("faith"));
    setText("ptDrSelf", s("self"));
    setText("ptDrLore", s("lore"));
    setText("ptDrVitality", s("fortitude") + s("muscle"));
    setText("ptDrTenacity", s("self") + s("charm"));
    setText("ptDrSoul", s("faith") + s("wisdom"));

    const rotLabels = { on_path: "On Path", off_path: "Off Path", aligned: "Aligned", penalty: "PENALTY" };
    setText("ptDrRotStatus", rotLabels[pregen.rot_status] || "On Path");
    setText("ptDrFatePoints", pregen.fate_points || 0);
    const pol = parseInt(pregen.polarity) || 0;
    setText("ptDrPolarity", pol > 0 ? `+${pol}` : `${pol}`);
    setText("ptDrPolarityBand", getPolarityBand(pol));

    const div = document.createElement("div");
    div.innerHTML = pregen.backstory || "";
    setText("ptDrBackstory", div.textContent || div.innerText || "Not recorded yet.");

    // Adoptions panel — manager only
    if (ptAdoptionsPanel) {
        if (isManager) {
            ptAdoptionsPanel.classList.remove("hidden");
            loadAdoptionsForPregen(pregen.id);
        } else {
            ptAdoptionsPanel.classList.add("hidden");
        }
    }
}

function closeDrawer() {
    ptDrawerBackdrop?.classList.add("hidden");
    activeDrawerPregen = null;
}

ptDrawerClose?.addEventListener("click", closeDrawer);
ptDrawerBackdrop?.addEventListener("click", e => { if (e.target === ptDrawerBackdrop) closeDrawer(); });
ptDrawerAdoptBtn?.addEventListener("click", () => {
    if (activeDrawerPregen && !activeDrawerPregen.isLocked && !userAdoptions[activeDrawerPregen.id]) {
        openAdoptModal(activeDrawerPregen);
    }
});

// ── Load adoptions for a pregen (manager only) ────────────────
async function loadAdoptionsForPregen(pregenId) {
    if (ptAdoptionsList) ptAdoptionsList.innerHTML = '<div class="pt-adoptions-empty">Loading…</div>';
    try {
        const snap = await getDocs(
            query(collection(db, "playtest-adoptions"), where("pregenId", "==", pregenId))
        );
        const adoptions = [];
        snap.forEach(d => adoptions.push({ id: d.id, ...d.data() }));

        if (ptAdoptionsCount) ptAdoptionsCount.textContent = adoptions.length;
        if (!ptAdoptionsList) return;

        if (adoptions.length === 0) {
            ptAdoptionsList.innerHTML = '<div class="pt-adoptions-empty">No adoptions yet.</div>';
            return;
        }

        ptAdoptionsList.innerHTML = "";
        adoptions.forEach(a => {
            const row = document.createElement("div");
            row.className = "pt-adoption-row";
            const date = a.adoptedAt?.toDate
                ? a.adoptedAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : "—";
            row.innerHTML = `
                <div class="pt-adoption-info">
                    <span class="pt-adoption-name">${_e(a.adoptedByName || "Unknown Player")}</span>
                    <span class="pt-adoption-date">Adopted ${date}</span>
                </div>
                <button class="pt-adoption-revoke-btn">Revoke</button>
            `;
            row.querySelector(".pt-adoption-revoke-btn")?.addEventListener("click", async (e) => {
                const btn = e.currentTarget;
                btn.textContent = "Revoking…"; btn.disabled = true;
                await revokeAdoption(pregenId, a.id, a.adoptedByUid, a.characterSheetId, row);
            });
            ptAdoptionsList.appendChild(row);
        });
    } catch (err) {
        console.error("Adoptions load failed:", err);
        if (ptAdoptionsList) ptAdoptionsList.innerHTML = '<div class="pt-adoptions-empty" style="color:var(--error)">Could not load adoptions.</div>';
    }
}

// ── Revoke adoption ───────────────────────────────────────────
async function revokeAdoption(pregenId, adoptionId, adoptedByUid, sheetId, rowEl) {
    try {
        await deleteDoc(doc(db, "character-sheets", adoptedByUid, "sheets", sheetId));
        await deleteDoc(doc(db, "playtest-adoptions", adoptionId));
        await updateDoc(doc(db, "playtest-sheets", pregenId), { adoptionCount: increment(-1) });

        rowEl.remove();
        const pregen = allPregens.find(p => p.id === pregenId);
        if (pregen) pregen.adoptionCount = Math.max(0, (pregen.adoptionCount || 1) - 1);
        if (ptAdoptionsCount) ptAdoptionsCount.textContent = Math.max(0, parseInt(ptAdoptionsCount.textContent || "1") - 1);
        renderGrid();
        updateStats();
    } catch (err) {
        console.error("Revoke failed:", err);
        const btn = rowEl.querySelector(".pt-adoption-revoke-btn");
        if (btn) { btn.textContent = "Revoke"; btn.disabled = false; }
    }
}

// ── Adopt flow ────────────────────────────────────────────────
function openAdoptModal(pregen) {
    pendingAdoptPregen = pregen;
    if (ptAdoptHint) ptAdoptHint.textContent = `A full editable copy of "${pregen.pregenName || "this pregen"}" will be added to your character sheet. Give your version a name to make it your own.`;
    if (ptAdoptNameInput) ptAdoptNameInput.value = pregen.charName || "";
    if (ptAdoptMsg) { ptAdoptMsg.textContent = ""; ptAdoptMsg.className = "pt-form-message"; }
    if (ptAdoptConfirmBtn) { ptAdoptConfirmBtn.disabled = false; ptAdoptConfirmBtn.textContent = "Adopt & Open Sheet"; }
    ptAdoptModal?.classList.remove("hidden");
    setTimeout(() => { ptAdoptNameInput?.select(); ptAdoptNameInput?.focus(); }, 50);
}

function closeAdoptModal() { ptAdoptModal?.classList.add("hidden"); pendingAdoptPregen = null; }
ptAdoptModalClose?.addEventListener("click", closeAdoptModal);
ptAdoptModal?.addEventListener("click", e => { if (e.target === ptAdoptModal) closeAdoptModal(); });
ptAdoptNameInput?.addEventListener("keydown", e => { if (e.key === "Enter") ptAdoptConfirmBtn?.click(); });

ptAdoptConfirmBtn?.addEventListener("click", async () => {
    const newName = ptAdoptNameInput?.value.trim();
    if (!newName) {
        if (ptAdoptMsg) { ptAdoptMsg.textContent = "Please enter a name for your character."; ptAdoptMsg.className = "pt-form-message error"; }
        return;
    }
    if (!pendingAdoptPregen) return;
    ptAdoptConfirmBtn.disabled = true;
    ptAdoptConfirmBtn.textContent = "Adopting…";

    try {
        const pregen = pendingAdoptPregen;
        const newSheetId = `pregen_adopted_${Date.now()}`;
        const userName = currentUser.displayName || currentUser.email || "Unknown";

        // Build the sheet copy — carry all gameplay fields, strip template-only fields
        const copy = { ...pregen };
        ["id", "pregenName", "concept", "isLocked", "adoptionCount", "createdBy", "lastEditedBy"].forEach(k => delete copy[k]);
        copy.charName = newName;
        copy.isAdoptedPregen = true;
        copy.pregenId = pregen.id;
        copy.uid = currentUser.uid;
        copy.createdAt = serverTimestamp();
        copy.updatedAt = serverTimestamp();

        // Write to player's character-sheets subcollection
        await setDoc(doc(db, "character-sheets", currentUser.uid, "sheets", newSheetId), copy);

        // Write adoption record
        await addDoc(collection(db, "playtest-adoptions"), {
            pregenId: pregen.id,
            pregenName: pregen.pregenName || "Unnamed Pregen",
            adoptedByUid: currentUser.uid,
            adoptedByName: userName,
            characterSheetId: newSheetId,
            adoptedAt: serverTimestamp(),
        });

        // Increment pregen's adoption count
        await updateDoc(doc(db, "playtest-sheets", pregen.id), { adoptionCount: increment(1) });

        // Update local state
        userAdoptions[pregen.id] = { adoptionId: "pending", characterSheetId: newSheetId };
        pregen.adoptionCount = (pregen.adoptionCount || 0) + 1;

        closeAdoptModal();
        closeDrawer();

        // Direct the character sheet page to auto-load the new sheet
        sessionStorage.setItem("alithia_last_sheet", newSheetId);
        window.location.href = "character-sheet.html";

    } catch (err) {
        console.error("Adoption failed:", err);
        if (ptAdoptMsg) { ptAdoptMsg.textContent = "Adoption failed — check connection and try again."; ptAdoptMsg.className = "pt-form-message error"; }
        ptAdoptConfirmBtn.disabled = false;
        ptAdoptConfirmBtn.textContent = "Adopt & Open Sheet";
    }
});

// ── Create pregen ─────────────────────────────────────────────
ptAddBtn?.addEventListener("click", () => {
    pendingEditPregenId = null;
    if (ptCreateModalTitle) ptCreateModalTitle.textContent = "New Pregen";
    if (ptCreateModalHint) ptCreateModalHint.textContent = "Fill in the template details. You'll be taken to the full sheet editor to build out stats.";
    if (ptCreateSaveBtn) ptCreateSaveBtn.textContent = "Create & Edit Sheet →";
    if (ptPregenNameInput) ptPregenNameInput.value = "";
    if (ptCharNameInput) ptCharNameInput.value = "";
    if (ptConceptInput) ptConceptInput.value = "";
    if (ptCreateMsg) { ptCreateMsg.textContent = ""; ptCreateMsg.className = "pt-form-message"; }
    ptCreateModal?.classList.remove("hidden");
    setTimeout(() => ptPregenNameInput?.focus(), 50);
});

// ── Edit pregen metadata ──────────────────────────────────────
function openEditMetadataModal(pregen) {
    pendingEditPregenId = pregen.id;
    if (ptCreateModalTitle) ptCreateModalTitle.textContent = "Edit Pregen Info";
    if (ptCreateModalHint) ptCreateModalHint.textContent = "Update the template name, character name suggestion, or concept. To edit stats, use the sheet editor.";
    if (ptCreateSaveBtn) ptCreateSaveBtn.textContent = "Save Changes";
    if (ptPregenNameInput) ptPregenNameInput.value = pregen.pregenName || "";
    if (ptCharNameInput) ptCharNameInput.value = pregen.charName || "";
    if (ptConceptInput) ptConceptInput.value = pregen.concept || "";
    if (ptCreateMsg) { ptCreateMsg.textContent = ""; ptCreateMsg.className = "pt-form-message"; }
    ptCreateModal?.classList.remove("hidden");
    setTimeout(() => ptPregenNameInput?.focus(), 50);
}

ptCreateModalClose?.addEventListener("click", () => ptCreateModal?.classList.add("hidden"));
ptCreateModal?.addEventListener("click", e => { if (e.target === ptCreateModal) ptCreateModal.classList.add("hidden"); });

ptCreateSaveBtn?.addEventListener("click", async () => {
    const name = ptPregenNameInput?.value.trim();
    if (!name) {
        if (ptCreateMsg) { ptCreateMsg.textContent = "Template name is required."; ptCreateMsg.className = "pt-form-message error"; }
        return;
    }
    ptCreateSaveBtn.disabled = true;
    ptCreateSaveBtn.textContent = pendingEditPregenId ? "Saving…" : "Creating…";

    const charName = ptCharNameInput?.value.trim() || "";
    const concept = ptConceptInput?.value.trim() || "";

    try {
        if (pendingEditPregenId) {
            // Edit mode — update metadata only
            await updateDoc(doc(db, "playtest-sheets", pendingEditPregenId), {
                pregenName: name, charName, concept, updatedAt: serverTimestamp()
            });
            const pregen = allPregens.find(p => p.id === pendingEditPregenId);
            if (pregen) { pregen.pregenName = name; pregen.charName = charName; pregen.concept = concept; }
            ptCreateModal?.classList.add("hidden");
            renderGrid();

        } else {
            // Create mode — make the doc, then redirect to the sheet editor
            const newId = `pregen_${Date.now()}`;
            await setDoc(doc(db, "playtest-sheets", newId), {
                pregenName: name, charName, concept,
                createdBy: currentUser.uid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                adoptionCount: 0,
                isLocked: false,
                // Default empty sheet fields so the editor has something to work with
                pronouns: "", species: "", classLevel: "", origin: "",
                backstory: "", polarity: 0, fate_points: 0,
                rot_status: "on_path", rot_cycle: 1, rot_attempts_used: 0,
                rot_points_lost: 0, fate_thread_status: "intact",
            });
            window.location.href = `character-sheet.html?pregen=${newId}`;
        }
    } catch (err) {
        console.error("Save failed:", err);
        if (ptCreateMsg) { ptCreateMsg.textContent = "Could not save — check connection."; ptCreateMsg.className = "pt-form-message error"; }
        ptCreateSaveBtn.disabled = false;
        ptCreateSaveBtn.textContent = pendingEditPregenId ? "Save Changes" : "Create & Edit Sheet →";
    }
});

// ── Toggle lock ────────────────────────────────────────────────
async function toggleLock(pregen, cardEl) {
    try {
        const newLocked = !pregen.isLocked;
        await updateDoc(doc(db, "playtest-sheets", pregen.id), { isLocked: newLocked });
        pregen.isLocked = newLocked;
        if (activeDrawerPregen?.id === pregen.id) activeDrawerPregen.isLocked = newLocked;
        // Rebuild just this card
        const newCard = buildPregenCard(pregen, 0);
        newCard.style.animationDelay = "0ms";
        cardEl.replaceWith(newCard);
    } catch (err) {
        console.error("Lock toggle failed:", err);
    }
}

// ── Delete pregen modal ────────────────────────────────────────
function openDeleteModal(pregen) {
    pendingDeletePregenId = pregen.id;
    if (ptDeleteNameDisplay) ptDeleteNameDisplay.textContent = pregen.pregenName || "this pregen";
    if (ptDeleteConfirmInput) ptDeleteConfirmInput.value = "";
    if (ptDeleteConfirmBtn) ptDeleteConfirmBtn.disabled = true;
    if (ptDeleteMsg) { ptDeleteMsg.textContent = ""; ptDeleteMsg.className = "pt-form-message"; }
    ptDeleteModal?.classList.remove("hidden");
    setTimeout(() => ptDeleteConfirmInput?.focus(), 50);
}

ptDeleteConfirmInput?.addEventListener("input", () => {
    const pregen = allPregens.find(p => p.id === pendingDeletePregenId);
    if (!pregen || !ptDeleteConfirmBtn) return;
    ptDeleteConfirmBtn.disabled = (ptDeleteConfirmInput.value.trim() !== (pregen.pregenName || ""));
    if (ptDeleteMsg) ptDeleteMsg.textContent = "";
});

function closeDeleteModal() {
    ptDeleteModal?.classList.add("hidden");
    if (ptDeleteConfirmInput) ptDeleteConfirmInput.value = "";
    if (ptDeleteConfirmBtn) ptDeleteConfirmBtn.disabled = true;
    pendingDeletePregenId = null;
}

ptDeleteModalClose?.addEventListener("click", closeDeleteModal);
ptDeleteCancelBtn?.addEventListener("click", closeDeleteModal);
ptDeleteModal?.addEventListener("click", e => { if (e.target === ptDeleteModal) closeDeleteModal(); });

ptDeleteConfirmBtn?.addEventListener("click", async () => {
    if (!pendingDeletePregenId) return;
    ptDeleteConfirmBtn.disabled = true;
    ptDeleteConfirmBtn.textContent = "Deleting…";
    try {
        await deleteDoc(doc(db, "playtest-sheets", pendingDeletePregenId));
        allPregens = allPregens.filter(p => p.id !== pendingDeletePregenId);
        closeDeleteModal();
        closeDrawer();
        renderGrid();
        updateStats();
    } catch (err) {
        console.error("Delete failed:", err);
        if (ptDeleteMsg) { ptDeleteMsg.textContent = "Delete failed — check connection."; ptDeleteMsg.className = "pt-form-message error"; }
        ptDeleteConfirmBtn.disabled = false;
        ptDeleteConfirmBtn.textContent = "Delete Forever";
    }
});

// ── Keyboard shortcuts ─────────────────────────────────────────
document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
        closeDrawer();
        ptCreateModal?.classList.add("hidden");
        closeAdoptModal();
        closeDeleteModal();
    }
});

// ── Helpers ────────────────────────────────────────────────────
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}

function _e(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getPolarityBand(v) {
    if (v <= -20) return "Xenderon Threshold";
    if (v <= -13) return "Abyss";
    if (v <= -7) return "Deep Negative";
    if (v <= -1) return "Negative";
    if (v === 0) return "Neutral";
    if (v <= 6) return "Positive";
    if (v <= 12) return "Deep Positive";
    if (v <= 19) return "Grace";
    return "Vyomi Threshold";
}