// ============================================================
//  js/character-sheet.js  —  Alithia Character Sheet
//
//  Auth-guarded. Multiple characters per user stored in
//  Firestore at: characters/{uid}/sheets/{sheetId}
//
//  Three scrollable sections (tabs):
//    1. Stats & Combat
//    2. Character (backstory, contacts, etc.)
//    3. Rot · Fate · Polarity systems
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged, signOut }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    collection, doc, getDoc, getDocs, setDoc, deleteDoc,
    serverTimestamp, query, orderBy
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
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; } if (p.x < -4) p.x = W + 4; if (p.x > W + 4) p.x = -4;
    }
    requestAnimationFrame(drawParticles);
}
window.addEventListener("resize", () => { resizeCanvas(); initParticles(); });
resizeCanvas(); initParticles(); requestAnimationFrame(drawParticles);

// ── State ────────────────────────────────────────────────────
let currentUser = null;
let currentSheetId = null;  // Firestore doc ID for active sheet
let sheetData = {};     // live data object
let saveTimeout = null;
let isDirty = false;
let isStoryteller = false;
let viewingUid = null;

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const sheetWrap = document.getElementById("sheetWrap");
const charSelect = document.getElementById("charSelect");
const charNewBtn = document.getElementById("charNewBtn");
const sheetSaveBtn = document.getElementById("sheetSaveBtn");
const sheetPdfBtn = document.getElementById("sheetPdfBtn");
const signOutBtn = document.getElementById("signOutBtn");
const topbarUsername = document.getElementById("topbarUsername");
const saveStatus = document.getElementById("saveStatus");
const newCharModal = document.getElementById("newCharModalBackdrop");
const newCharClose = document.getElementById("newCharModalClose");
const newCharInput = document.getElementById("newCharNameInput");
const newCharMsg = document.getElementById("newCharMsg");
const newCharCreate = document.getElementById("newCharCreateBtn");

// ── Auth guard ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        sessionStorage.setItem("alithia_redirect", window.location.href);
        window.location.href = "login.html";
        return;
    }

    currentUser = user;
    topbarUsername.textContent = user.displayName || user.email;

    const params = new URLSearchParams(window.location.search);
    const paramUid = params.get("uid");
    const paramSheet = params.get("sheet");

    let isStUser = false;

    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            isStUser = userSnap.data().isStoryteller === true;
        }
    } catch (err) {
        console.error("Role fetch failed:", err);
    }

    // 🔥 CRITICAL FIX: If params exist, DO NOT silently fallback
    if (paramUid && paramSheet) {
        if (!isStUser) {
            console.warn("Non-storyteller tried to access storyteller view");
            window.location.href = "storyteller-pool.html";
            return;
        }

        // ✅ Storyteller mode
        isStoryteller = true;
        viewingUid = paramUid;

        showSheetUI();

        try {
            await loadStorytellerView(paramUid, paramSheet);
        } catch (err) {
            console.error("Storyteller load failed:", err);
        }

        return; // 🚫 prevent fallback
    }

    // ✅ Normal player mode
    showSheetUI();

    try {
        await loadCharacterList();
    } catch (err) {
        console.error("Character list load failed:", err);
    }
});

// helper
function showSheetUI() {
    authGuard.classList.add("fade-out");
    setTimeout(() => {
        authGuard.style.display = "none";
        sheetWrap.classList.remove("hidden");
    }, 500);
}

signOutBtn.addEventListener("click", async () => {
    await signOut(auth); window.location.href = "login.html";
});

// ── Tab navigation ───────────────────────────────────────────
document.querySelectorAll(".sheet-tab").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".sheet-tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".sheet-section").forEach(s => s.classList.remove("active"));
        btn.classList.add("active");
        const tabId = btn.dataset.tab;
        document.getElementById(`tab-${tabId}`).classList.add("active");
    });
});

// ── Character list ───────────────────────────────────────────
async function loadCharacterList() {
    try {
        const q = query(
            collection(db, "character-sheets", currentUser.uid, "sheets"),
            orderBy("createdAt", "asc")
        );
        const snap = await getDocs(q);
        charSelect.innerHTML = `<option value="">— Select Character —</option>`;
        snap.forEach(d => {
            const opt = document.createElement("option");
            opt.value = d.id;
            opt.textContent = d.data().charName || "Unnamed Character";
            charSelect.appendChild(opt);
        });
        // Auto-load last used character from sessionStorage
        const lastId = sessionStorage.getItem("alithia_last_sheet");
        if (lastId) {
            charSelect.value = lastId;
            if (charSelect.value === lastId) await loadSheet(lastId);
        }
    } catch (err) {
        console.error("Failed to load character list:", err);
    }
}

// ── Storyteller view — load a specific player's sheet read-only ─
async function loadStorytellerView(ownerUid, sheetId) {
    try {
        // Update topbar to show storyteller context
        const topbarLabel = document.querySelector(".topbar-label");
        if (topbarLabel) topbarLabel.textContent = "Storyteller — Read Only";

        // Add a visible read-only banner
        const banner = document.createElement("div");
        banner.style.cssText = `
            position:fixed; top:calc(var(--topbar-h) + var(--tabnav-h)); left:0;right:0;z-index:77;
            background:rgba(255,215,0,0.08);border-bottom:1px solid rgba(255,215,0,0.25);
            padding:0.4rem 1.25rem;display:flex;align-items:center;gap:0.75rem;
            font-family:var(--font-display);font-size:0.45rem;letter-spacing:0.2em;
            color:rgba(255,215,0,0.7);
        `;
        banner.innerHTML = `
            ★ STORYTELLER VIEW — READ ONLY &nbsp;·&nbsp;
            <a href="storyteller-pool.html" style="color:rgba(255,215,0,0.5);text-decoration:none;font-style:italic;font-family:var(--font-body);font-size:0.8rem;letter-spacing:0;">
                ← Back to Character Pool
            </a>
        `;
        document.body.appendChild(banner);

        // Adjust sheet wrap padding for the extra banner
        const sheetWrapEl = document.getElementById("sheetWrap");
        if (sheetWrapEl) sheetWrapEl.style.paddingTop = "calc(var(--topbar-h) + var(--tabnav-h) + 36px)";

        // Load the sheet from the owner's collection
        const snap = await getDoc(
            doc(db, "character-sheets", ownerUid, "sheets", sheetId)
        );
        if (!snap.exists()) {
            console.error("Sheet not found");
            return;
        }
        currentSheetId = sheetId;
        sheetData = snap.data();

        // Show the owner's name in the character switcher area
        const charName = sheetData.charName || "Unnamed Character";
        charSelect.innerHTML = `<option value="${sheetId}">${charName}</option>`;
        charSelect.value = sheetId;

        populateSheet(sheetData);
        lockAllFields();
    } catch (err) {
        console.error("Failed to load storyteller view:", err);
    }
}

// ── Lock all editable fields (storyteller read-only mode) ────
function lockAllFields() {
    // Disable all contenteditable
    document.querySelectorAll("[contenteditable]").forEach(el => {
        el.contentEditable = "false";
        el.style.cursor = "default";
        el.style.opacity = "0.85";
    });
    // Disable all inputs
    document.querySelectorAll("input, select, textarea, button").forEach(el => {
        // Keep navigation, tab buttons, and sign out working
        if (el.closest(".sheet-tabnav") || el.closest(".sheet-topbar") ||
            el.closest(".dice-bar") || el.closest(".roll-history") ||
            el.id === "signOutBtn") return;
        el.disabled = true;
        el.style.cursor = "default";
    });
    // Hide save/pdf/new/delete buttons
    ["sheetSaveBtn", "sheetPdfBtn", "charNewBtn", "charDelBtn"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });
}

charSelect.addEventListener("change", async () => {
    const id = charSelect.value;
    if (!id) { clearSheet(); return; }
    if (isDirty && currentSheetId) await saveSheet();
    await loadSheet(id);
});

// ── Load sheet ───────────────────────────────────────────────
async function loadSheet(id) {
    try {
        const snap = await getDoc(doc(db, "character-sheets", currentUser.uid, "sheets", id));
        if (!snap.exists()) return;
        currentSheetId = id;
        sessionStorage.setItem("alithia_last_sheet", id);
        sheetData = snap.data();
        populateSheet(sheetData);
    } catch (err) {
        console.error("Failed to load sheet:", err);
    }
}

// ── Populate all fields from data ────────────────────────────
function populateSheet(data) {
    // Contenteditable fields
    document.querySelectorAll("[data-field][contenteditable]").forEach(el => {
        const key = el.dataset.field;
        if (data[key] !== undefined) el.innerHTML = data[key];
        else el.innerHTML = "";
    });
    // Input fields (number + text)
    document.querySelectorAll("input[data-field]").forEach(el => {
        const key = el.dataset.field;
        if (data[key] !== undefined) el.value = data[key];
    });
    // Select fields
    document.querySelectorAll("select[data-field]").forEach(el => {
        const key = el.dataset.field;
        if (data[key] !== undefined) el.value = data[key];
    });
    // Attempt dots
    const attemptsUsed = parseInt(data.rot_attempts_used) || 0;
    document.querySelectorAll(".attempt-dot").forEach(dot => {
        const n = parseInt(dot.dataset.attempt);
        dot.classList.toggle("used", n <= attemptsUsed);
    });
    // Contacts
    renderContacts(data.contacts || []);
    // Recalculate everything
    recalcAll();
    // Polarity
    updatePolarity(parseInt(data.polarity) || 0);
    // Fate thread
    updateThreadBar(data.fate_thread_status || "intact");
    // Health state
    updateHealthState();
    isDirty = false;
}

// ── Clear sheet when nothing selected ───────────────────────
function clearSheet() {
    currentSheetId = null;
    sheetData = {};
    document.querySelectorAll("[data-field][contenteditable]").forEach(el => el.innerHTML = "");
    document.querySelectorAll("input[data-field]").forEach(el => { el.value = el.type === "number" ? 0 : ""; });
    document.querySelectorAll("select[data-field]").forEach(el => el.selectedIndex = 0);
    document.querySelectorAll(".attempt-dot").forEach(dot => dot.classList.remove("used"));
    renderContacts([]);
    recalcAll();
    updatePolarity(0);
    updateThreadBar("intact");
    isDirty = false;
}

// ── Auto-save on any change (debounced) ──────────────────────
function scheduleAutoSave() {
    isDirty = true;
    if (!currentSheetId) return; // still mark dirty, just don't write yet
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveSheet(), 2500);
}

// ── Collect data from DOM ─────────────────────────────────────
function collectSheetData() {
    const data = { ...sheetData };
    // Contenteditable
    document.querySelectorAll("[data-field][contenteditable]").forEach(el => {
        data[el.dataset.field] = el.innerHTML;
    });
    // Inputs
    document.querySelectorAll("input[data-field]").forEach(el => {
        data[el.dataset.field] = el.type === "number" ? (parseFloat(el.value) || 0) : el.value;
    });
    // Selects
    document.querySelectorAll("select[data-field]").forEach(el => {
        data[el.dataset.field] = el.value;
    });
    // Attempt dots
    let attemptsUsed = 0;
    document.querySelectorAll(".attempt-dot.used").forEach(() => attemptsUsed++);
    data.rot_attempts_used = attemptsUsed;
    // Contacts
    data.contacts = collectContacts();
    return data;
}

// ── Save sheet ───────────────────────────────────────────────
async function saveSheet() {
    if (!currentSheetId || !currentUser) return;
    const data = collectSheetData();
    data.updatedAt = serverTimestamp();
    data.uid = currentUser.uid;
    // Sync charName to select option
    if (data.charName) {
        const opt = charSelect.querySelector(`option[value="${currentSheetId}"]`);
        if (opt) opt.textContent = data.charName || "Unnamed Character";
    }
    try {
        await setDoc(
            doc(db, "character-sheets", currentUser.uid, "sheets", currentSheetId),
            data, { merge: true }
        );
        sheetData = data;
        isDirty = false;
        showSaveStatus("✦ Saved", false);
    } catch (err) {
        console.error("Save failed:", err);
        showSaveStatus("Save failed — check connection", true);
    }
}

sheetSaveBtn.addEventListener("click", () => {
    if (!currentSheetId) {
        showSaveStatus("Select or create a character first", true);
        newCharModal.classList.remove("hidden");
        setTimeout(() => newCharInput.focus(), 50);
        return;
    }
    saveSheet();
});

function showSaveStatus(msg, isError) {
    saveStatus.textContent = msg;
    saveStatus.classList.toggle("error", isError);
    saveStatus.classList.add("visible");
    setTimeout(() => saveStatus.classList.remove("visible"), 2000);
}

// ── PDF export ───────────────────────────────────────────────
sheetPdfBtn.addEventListener("click", () => {
    window.print();
});

// ── Wire all editable fields to auto-save ───────────────────
document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.field || el.closest("[data-field]")) scheduleAutoSave();
    // Trigger recalcs
    if (el.matches("input[data-field^='stat_']")) recalcAll();
    if (el.matches("#currentHealth")) updateHealthState();
    if (el.matches("#polarityInput")) updatePolarity(parseInt(el.value) || 0);
    if (el.matches("#fatePointsInput")) { /* auto-tracking placeholder */ }
});

document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches("select[data-field]")) {
        scheduleAutoSave();
        if (el.id === "fateThreadSelect") updateThreadBar(el.value);
        if (el.matches("select[data-field='rot_status']")) scheduleAutoSave();
    }
});

// Contenteditable blur triggers save
document.querySelectorAll("[contenteditable]").forEach(el => {
    el.addEventListener("blur", scheduleAutoSave);
});

// ── Calculations ─────────────────────────────────────────────
function getStatVal(field) {
    const el = document.querySelector(`input[data-field="stat_${field}"]`);
    return el ? (parseInt(el.value) || 0) : 0;
}

function recalcAll() {
    const fortitude = getStatVal("fortitude");
    const muscle = getStatVal("muscle");
    const swiftness = getStatVal("swiftness");
    const keeness = getStatVal("keeness");
    const wisdom = getStatVal("wisdom");
    const charm = getStatVal("charm");
    const faith = getStatVal("faith");
    const self_stat = getStatVal("self");
    const lore = getStatVal("lore");

    // Derived stats
    const vitality = fortitude + muscle;
    const tenacity = self_stat + charm;
    const soul = faith + wisdom;

    // Display derived
    ["derivedVitality", "resVitality"].forEach(id => setInner(id, vitality));
    ["derivedTenacity", "resTenacity"].forEach(id => setInner(id, tenacity));
    ["derivedSoul", "resSoul"].forEach(id => setInner(id, soul));

    // Health max = 1 + floor(vitality / 2)
    const maxHealth = 1 + Math.floor(vitality / 2);
    // Morale max = 1 + floor(tenacity / 2)
    const maxMorale = 1 + Math.floor(tenacity / 2);
    // Sanity max = 1 + floor(soul / 2)
    const maxSanity = 1 + Math.floor(soul / 2);

    setInner("calcHealth", maxHealth);
    setInner("maxHealth", maxHealth);
    setInner("calcMorale", maxMorale);
    setInner("maxMorale", maxMorale);
    setInner("calcSanity", maxSanity);
    setInner("maxSanity", maxSanity);

    // Evasion = Swiftness + Keeness
    setInner("calcEvasion", swiftness + keeness);

    updateHealthState();
}

function setInner(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// ── Health state ──────────────────────────────────────────────
const HEALTH_STATES = {
    healthy: { label: "Healthy", pct: 1.00, effect: null },
    injured: { label: "Injured", pct: 0.75, effect: "−1 to all physical rolls. The body protests but endures." },
    bloodied: { label: "Bloodied", pct: 0.50, effect: "−2 to all physical rolls. Movement is visibly impaired. Others notice." },
    critical: { label: "Critical", pct: 0.25, effect: "−3 to all rolls. One more hit may be your last. Act accordingly." },
    dying: { label: "Dying", pct: 0.00, effect: "Incapacitated. Without immediate aid, death follows. Your story hangs by a thread." },
};

function updateHealthState() {
    const maxEl = document.getElementById("maxHealth");
    const curEl = document.getElementById("currentHealth");
    if (!maxEl || !curEl) return;

    const max = parseInt(maxEl.textContent) || 0;
    const cur = parseInt(curEl.value);
    if (!max || isNaN(cur)) return;

    const ratio = Math.max(0, cur / max);
    let activeState = "healthy";
    if (ratio <= 0) activeState = "dying";
    else if (ratio <= 0.25) activeState = "critical";
    else if (ratio <= 0.50) activeState = "bloodied";
    else if (ratio <= 0.75) activeState = "injured";

    document.querySelectorAll(".hs-seg").forEach(seg => {
        seg.classList.toggle("active", seg.dataset.state === activeState);
    });

    const effect = HEALTH_STATES[activeState].effect;
    const effectEl = document.getElementById("hsEffect");
    if (effectEl) {
        if (effect) {
            effectEl.textContent = effect;
            effectEl.classList.add("visible");
        } else {
            effectEl.classList.remove("visible");
        }
    }
}

// ── Polarity system ──────────────────────────────────────────
const POLARITY_BANDS = [
    { min: -20, max: -20, id: "xenderon-threshold", label: "XENDERON THRESHOLD", desc: "The absolute floor. Beyond here lies the Xenderon Module.", color: "#fd79a8", bandEl: "band--20", dotEl: "dot--20" },
    { min: -19, max: -13, id: "abyss", label: "ABYSS", desc: "Deep in Xenderon's pull. Rising from here is very hard.", color: "#e84393", bandEl: "band-abyss", dotEl: "dot-abyss" },
    { min: -12, max: -7, id: "deep-neg", label: "DEEP NEGATIVE", desc: "Strong pull toward darkness. Debuffs active and compounding.", color: "#e17055", bandEl: "band-deep-neg", dotEl: "dot-deep-neg" },
    { min: -6, max: -1, id: "negative", label: "NEGATIVE", desc: "Leaning dark. Minor debuffs active. Still recoverable.", color: "#fdcb6e", bandEl: "band-negative", dotEl: "dot-negative" },
    { min: 0, max: 0, id: "neutral", label: "NEUTRAL", desc: "No buffs or debuffs. All characters begin here.", color: "rgba(61,255,143,0.6)", bandEl: "band-neutral", dotEl: "dot-neutral" },
    { min: 1, max: 6, id: "positive", label: "POSITIVE", desc: "Leaning toward light. Minor buffs beginning.", color: "#a8e6cf", bandEl: "band-positive", dotEl: "dot-positive" },
    { min: 7, max: 12, id: "deep-pos", label: "DEEP POSITIVE", desc: "Strong pull toward grace. Buffs active. Hard to fall from.", color: "#74b9ff", bandEl: "band-deep-pos", dotEl: "dot-deep-pos" },
    { min: 13, max: 19, id: "grace", label: "GRACE", desc: "Well into Vyomi's pull. Significant buffs. NPCs notice.", color: "#a29bfe", bandEl: "band-grace", dotEl: "dot-grace" },
    { min: 20, max: 20, id: "vyomi-threshold", label: "VYOMI THRESHOLD", desc: "The absolute ceiling. Beyond here lies the Vyomi Module.", color: "#6c5ce7", bandEl: "band-+20", dotEl: "dot-+20" },
];

function updatePolarity(val) {
    val = Math.max(-20, Math.min(20, val));

    // Update input styling
    const polInput = document.getElementById("polarityInput");
    if (polInput) {
        polInput.value = val;
        polInput.classList.toggle("negative", val < 0);
    }

    // Fill bar
    const pct = Math.abs(val) / 20 * 50; // 50% is half the bar
    const fillNeg = document.getElementById("polFillNeg");
    const fillPos = document.getElementById("polFillPos");
    if (fillNeg) fillNeg.style.width = val < 0 ? `${pct}%` : "0%";
    if (fillPos) fillPos.style.width = val > 0 ? `${pct}%` : "0%";

    // Find active band
    const band = POLARITY_BANDS.find(b => val >= b.min && val <= b.max);
    if (!band) return;

    // Update all band rows
    document.querySelectorAll(".pol-band").forEach(el => el.classList.remove("active-band"));
    const activeBandEl = document.getElementById(band.bandEl);
    if (activeBandEl) activeBandEl.classList.add("active-band");

    // Update band display
    const labelEl = document.getElementById("polarityBandLabel");
    const descEl = document.getElementById("polarityBandDesc");
    if (labelEl) {
        labelEl.textContent = band.label;
        labelEl.style.color = band.color;
    }
    if (descEl) descEl.textContent = band.desc;

    // Update band display card border color
    const bandDisplay = document.getElementById("polarityBandDisplay");
    if (bandDisplay) {
        bandDisplay.style.borderColor = band.color.replace(")", ", 0.3)").replace("rgb", "rgba") || band.color;
    }
}

// Polarity +/− buttons
document.getElementById("polMinus")?.addEventListener("click", () => {
    const inp = document.getElementById("polarityInput");
    const newVal = Math.max(-20, (parseInt(inp.value) || 0) - 1);
    inp.value = newVal;
    updatePolarity(newVal);
    scheduleAutoSave();
});
document.getElementById("polPlus")?.addEventListener("click", () => {
    const inp = document.getElementById("polarityInput");
    const newVal = Math.min(20, (parseInt(inp.value) || 0) + 1);
    inp.value = newVal;
    updatePolarity(newVal);
    scheduleAutoSave();
});
document.getElementById("polarityInput")?.addEventListener("input", (e) => {
    updatePolarity(parseInt(e.target.value) || 0);
    scheduleAutoSave();
});

// ── Fate thread bar ──────────────────────────────────────────
function updateThreadBar(status) {
    document.querySelectorAll(".thread-seg").forEach(seg => {
        seg.classList.toggle("active", seg.dataset.thread === status);
    });
    const sel = document.getElementById("fateThreadSelect");
    if (sel) sel.value = status;
}
document.getElementById("fateThreadSelect")?.addEventListener("change", (e) => {
    updateThreadBar(e.target.value);
    scheduleAutoSave();
});

// ── Fate points ±  buttons ───────────────────────────────────
document.getElementById("fpMinus")?.addEventListener("click", () => {
    const inp = document.getElementById("fatePointsInput");
    inp.value = Math.max(0, (parseInt(inp.value) || 0) - 1);
    scheduleAutoSave();
});
document.getElementById("fpPlus")?.addEventListener("click", () => {
    const inp = document.getElementById("fatePointsInput");
    inp.value = Math.min(99, (parseInt(inp.value) || 0) + 1);
    scheduleAutoSave();
});

// ── Attempt dots ─────────────────────────────────────────────
document.querySelectorAll(".attempt-dot").forEach(dot => {
    dot.addEventListener("click", () => {
        const n = parseInt(dot.dataset.attempt);
        const dots = document.querySelectorAll(".attempt-dot");
        // Count currently used
        let usedCount = 0;
        dots.forEach(d => { if (d.classList.contains("used")) usedCount++; });
        // Toggle: if clicking the last used one, remove it; otherwise set to n
        if (usedCount === n && dot.classList.contains("used")) {
            // Deselect this and above
            dots.forEach(d => { if (parseInt(d.dataset.attempt) >= n) d.classList.remove("used"); });
        } else {
            dots.forEach(d => { d.classList.toggle("used", parseInt(d.dataset.attempt) <= n); });
        }
        scheduleAutoSave();
    });
});

// ── Contacts ─────────────────────────────────────────────────
function renderContacts(contacts) {
    const list = document.getElementById("contactsList");
    if (!list) return;
    list.innerHTML = "";
    (contacts || []).forEach((c, i) => addContactRow(c.name || "", c.relationship || "", i));
}

function addContactRow(name = "", relationship = "", index) {
    const list = document.getElementById("contactsList");
    if (!list) return;
    const row = document.createElement("div");
    row.className = "contact-row";
    row.innerHTML = `
        <input class="contact-name-input" type="text" placeholder="NPC Name" value="${escHtml(name)}" maxlength="60" />
        <input class="contact-rel-input" type="text" placeholder="Relationship, disposition…" value="${escHtml(relationship)}" maxlength="120" />
        <button class="contact-del-btn" title="Remove contact">✕</button>
    `;
    row.querySelector(".contact-del-btn").addEventListener("click", () => {
        row.remove();
        scheduleAutoSave();
    });
    row.querySelectorAll("input").forEach(inp => inp.addEventListener("input", scheduleAutoSave));
    list.appendChild(row);
}

function collectContacts() {
    const contacts = [];
    document.querySelectorAll(".contact-row").forEach(row => {
        const name = row.querySelector(".contact-name-input")?.value.trim();
        const rel = row.querySelector(".contact-rel-input")?.value.trim();
        if (name || rel) contacts.push({ name: name || "", relationship: rel || "" });
    });
    return contacts;
}

document.getElementById("addContactBtn")?.addEventListener("click", () => {
    addContactRow();
    scheduleAutoSave();
});

// ── New character modal ──────────────────────────────────────
charNewBtn.addEventListener("click", () => {
    newCharInput.value = "";
    newCharMsg.textContent = "";
    newCharMsg.className = "form-message";
    newCharModal.classList.remove("hidden");
    setTimeout(() => newCharInput.focus(), 50);
});
newCharClose.addEventListener("click", () => newCharModal.classList.add("hidden"));
newCharModal.addEventListener("click", (e) => {
    if (e.target === newCharModal) newCharModal.classList.add("hidden");
});
newCharInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") newCharCreate.click();
});

newCharCreate.addEventListener("click", async () => {
    const name = newCharInput.value.trim();
    if (!name) {
        newCharMsg.textContent = "Please enter a character name.";
        newCharMsg.className = "form-message error";
        return;
    }
    newCharCreate.disabled = true;
    newCharCreate.textContent = "Creating…";
    try {
        const newId = `sheet_${Date.now()}`;
        const newData = {
            charName: name,
            uid: currentUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db, "character-sheets", currentUser.uid, "sheets", newId), newData);
        // Add to select
        const opt = document.createElement("option");
        opt.value = newId;
        opt.textContent = name;
        charSelect.appendChild(opt);
        charSelect.value = newId;
        newCharModal.classList.add("hidden");
        if (isDirty) await saveSheet();
        await loadSheet(newId);
    } catch (err) {
        console.error("Create failed:", err);
        newCharMsg.textContent = "Could not create character. Try again.";
        newCharMsg.className = "form-message error";
    }
    newCharCreate.disabled = false;
    newCharCreate.textContent = "Create Character";
});

// ── Escape closes modal ───────────────────────────────────────
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") newCharModal.classList.add("hidden");
});

// ── Warn on unsaved changes ───────────────────────────────────
window.addEventListener("beforeunload", (e) => {
    if (isDirty) { e.preventDefault(); e.returnValue = ""; }
});

// ── Helpers ───────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ════════════════════════════════════════════════════════════
//  DICE ROLLER — d10 pool
//  Pass rules:
//    1        = critical fail  → −1 pass
//    2–5      = no pass
//    6–8      = 1 pass
//    9        = 1 pass (highlighted)
//    10       = 3 passes (highlighted, special)
// ════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────
let diceCount = 1;
const DICE_MIN = 1;
const DICE_MAX = 20;

// ── DOM refs ─────────────────────────────────────────────────
const diceBar = document.getElementById("diceBar");
const diceCountDisplay = document.getElementById("diceCountDisplay");
const diceCountMinus = document.getElementById("diceCountMinus");
const diceCountPlus = document.getElementById("diceCountPlus");
const diceRollBtn = document.getElementById("diceRollBtn");
const diceResultsDice = document.getElementById("diceResultsDice");
const diceResultsEmpty = document.getElementById("diceResultsEmpty");
const diceBarSummary = document.getElementById("diceBarSummary");
const diceSumTotal = document.getElementById("diceSumTotal");
const diceSumPasses = document.getElementById("diceSumPasses");
const diceSumResult = document.getElementById("diceSumResult");
const diceBarToggle = document.getElementById("diceBarToggle");
const diceToggleIcon = document.getElementById("diceToggleIcon");

// ── Count control ────────────────────────────────────────────
function updateCountDisplay() {
    diceCountDisplay.textContent = diceCount;
    diceCountMinus.style.opacity = diceCount <= DICE_MIN ? "0.3" : "1";
    diceCountPlus.style.opacity = diceCount >= DICE_MAX ? "0.3" : "1";
}

diceCountMinus.addEventListener("click", () => {
    if (diceCount > DICE_MIN) { diceCount--; updateCountDisplay(); }
});
diceCountPlus.addEventListener("click", () => {
    if (diceCount < DICE_MAX) { diceCount++; updateCountDisplay(); }
});

// Mousewheel over count display to change quickly
diceCountDisplay.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.deltaY < 0 && diceCount < DICE_MAX) diceCount++;
    if (e.deltaY > 0 && diceCount > DICE_MIN) diceCount--;
    updateCountDisplay();
}, { passive: false });

// ── Roll logic ───────────────────────────────────────────────
function rollD10() { return Math.floor(Math.random() * 10) + 1; }

function getDieClass(val) {
    if (val === 1) return "die-crit-fail";
    if (val === 10) return "die-ten";
    if (val >= 9) return "die-high";
    return "";
}

function getPassesForDie(val) {
    if (val === 1) return -1;  // critical fail
    if (val === 10) return 3;   // legendary
    if (val >= 6) return 1;   // standard pass
    return 0;
}

function getPassBadge(passes) {
    if (passes === -1) return { cls: "fail", text: "✕" };
    if (passes === 3) return { cls: "super", text: "3" };
    if (passes === 1) return { cls: "pass", text: "✓" };
    return null;
}

function getTierResult(passes) {
    // Net passes after crits applied
    if (passes <= -1) return { label: "CRITICAL FAILURE", cls: "crit-fail" };
    if (passes === 0) return { label: "FAILURE", cls: "fail" };
    if (passes <= 2) return { label: "PARTIAL SUCCESS", cls: "partial" };
    if (passes <= 5) return { label: "SUCCESS", cls: "success" };
    return { label: "CRITICAL SUCCESS", cls: "crit-success" };
}

// ── Roll animation ───────────────────────────────────────────
let rollTimeout = null;

function rollDice() {
    if (diceRollBtn.classList.contains("rolling")) return;

    diceRollBtn.classList.add("rolling");
    diceResultsDice.innerHTML = "";
    diceResultsEmpty.style.display = "none";
    diceBarSummary.classList.add("hidden");

    // Show scrambling placeholder dice
    const scrambleDuration = 420;
    const scrambleInterval = 60;
    let scrambleCount = 0;

    const scramble = setInterval(() => {
        diceResultsDice.innerHTML = "";
        for (let i = 0; i < diceCount; i++) {
            const chip = document.createElement("div");
            chip.className = "die-chip";
            chip.textContent = Math.floor(Math.random() * 10) + 1;
            chip.style.opacity = "0.4";
            chip.style.transform = `rotate(${(Math.random() - 0.5) * 12}deg)`;
            diceResultsDice.appendChild(chip);
        }
        scrambleCount++;
    }, scrambleInterval);

    // Resolve to real results
    clearTimeout(rollTimeout);
    rollTimeout = setTimeout(() => {
        clearInterval(scramble);
        diceRollBtn.classList.remove("rolling");

        const rolls = Array.from({ length: diceCount }, rollD10);
        let total = 0;
        let passes = 0;

        diceResultsDice.innerHTML = "";

        rolls.forEach((val, i) => {
            const p = getPassesForDie(val);
            total += val;
            passes += p;

            const chip = document.createElement("div");
            const extraClass = getDieClass(val);
            chip.className = `die-chip animate-in ${extraClass}`;
            chip.style.animationDelay = `${i * 45}ms`;
            chip.textContent = val;

            // Badge
            const badge = getPassBadge(p);
            if (badge) {
                const b = document.createElement("span");
                b.className = `die-pass-badge ${badge.cls}`;
                b.textContent = badge.text;
                chip.appendChild(b);
            }

            diceResultsDice.appendChild(chip);
        });

        // Show summary
        const tier = getTierResult(passes);
        diceSumTotal.textContent = total;
        diceSumPasses.textContent = Math.max(0, passes);
        diceSumResult.textContent = tier.label;
        diceSumResult.className = `summary-result ${tier.cls}`;

        // Pass val color: red if zero or negative
        diceSumPasses.style.color = passes <= 0
            ? "#ff4444"
            : "var(--green)";
        diceSumPasses.style.textShadow = passes <= 0
            ? "0 0 10px rgba(255,68,68,0.4)"
            : "0 0 10px rgba(61,255,143,0.4)";

        diceBarSummary.classList.remove("hidden");

        // Screen flash on crit success/fail
        if (tier.cls === "crit-success") flashScreen("rgba(61,255,143,0.08)");
        if (tier.cls === "crit-fail") flashScreen("rgba(255,68,68,0.08)");

    }, scrambleDuration);
}

function flashScreen(color) {
    const flash = document.createElement("div");
    flash.style.cssText = `
        position:fixed;inset:0;z-index:9999;
        background:${color};pointer-events:none;
        animation:screenFlash 0.5s ease forwards;
    `;
    if (!document.getElementById("screenFlashStyle")) {
        const style = document.createElement("style");
        style.id = "screenFlashStyle";
        style.textContent = `@keyframes screenFlash { from{opacity:1} to{opacity:0} }`;
        document.head.appendChild(style);
    }
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 500);
}

diceRollBtn.addEventListener("click", rollDice);

// Keyboard shortcut: Space or R to roll (when not typing in a field)
document.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    const isTyping = active && (
        active.isContentEditable ||
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT"
    );
    if (!isTyping && (e.code === "Space" || e.key === "r" || e.key === "R")) {
        e.preventDefault();
        rollDice();
    }
    // Arrow keys to adjust count when not typing
    if (!isTyping && e.key === "ArrowUp") { if (diceCount < DICE_MAX) { diceCount++; updateCountDisplay(); } }
    if (!isTyping && e.key === "ArrowDown") { if (diceCount > DICE_MIN) { diceCount--; updateCountDisplay(); } }
});

// ── Collapse toggle ──────────────────────────────────────────
let diceBarCollapsed = false;
diceBarToggle.addEventListener("click", () => {
    diceBarCollapsed = !diceBarCollapsed;
    diceBar.classList.toggle("collapsed", diceBarCollapsed);
    diceToggleIcon.textContent = diceBarCollapsed ? "▲" : "▼";
    document.querySelector(".sheet-wrap").style.paddingBottom =
        diceBarCollapsed ? "var(--dice-h-collapsed)" : "var(--dice-h)";
});

// Init
updateCountDisplay();

// ════════════════════════════════════════════════════════════
//  INVENTORY LIST
// ════════════════════════════════════════════════════════════

function renderInventory(items) {
    const list = document.getElementById("inventoryList");
    if (!list) return;
    list.innerHTML = "";
    (items || []).forEach(item => addInventoryRow(item.name || "", item.qty || 1, item.checked || false));
}

function addInventoryRow(name = "", qty = 1, checked = false) {
    const list = document.getElementById("inventoryList");
    if (!list) return;
    const row = document.createElement("div");
    row.className = "inventory-row";
    row.innerHTML = `
        <input class="inv-checkbox" type="checkbox" title="Toggle carried" ${checked ? "checked" : ""} />
        <input class="inv-name-input" type="text" placeholder="Item name…" value="${escHtml(name)}" maxlength="80" />
        <input class="inv-qty-input"  type="number" min="1" max="999" value="${qty}" title="Quantity" />
        <button class="inv-del-btn" title="Remove item">✕</button>
    `;
    row.querySelector(".inv-del-btn").addEventListener("click", () => { row.remove(); scheduleAutoSave(); });
    row.querySelectorAll("input").forEach(inp => inp.addEventListener("input", scheduleAutoSave));
    row.querySelector(".inv-checkbox").addEventListener("change", scheduleAutoSave);
    // Enter key on name field adds new row
    row.querySelector(".inv-name-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); addInventoryRow(); scheduleAutoSave(); }
    });
    list.appendChild(row);
    // Focus new empty rows
    if (!name) row.querySelector(".inv-name-input").focus();
}

function collectInventory() {
    const items = [];
    document.querySelectorAll(".inventory-row").forEach(row => {
        const name = row.querySelector(".inv-name-input")?.value.trim();
        const qty = parseInt(row.querySelector(".inv-qty-input")?.value) || 1;
        const checked = row.querySelector(".inv-checkbox")?.checked || false;
        if (name) items.push({ name, qty, checked });
    });
    return items;
}

document.getElementById("addInventoryBtn")?.addEventListener("click", () => {
    addInventoryRow();
});

// ════════════════════════════════════════════════════════════
//  DAMAGE BUTTONS
// ════════════════════════════════════════════════════════════

document.querySelectorAll(".dmg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const hpInput = document.getElementById("currentHealth");
        const maxEl = document.getElementById("maxHealth");
        if (!hpInput) return;

        const max = parseInt(maxEl?.textContent) || 0;
        const cur = parseInt(hpInput.value) || 0;
        const dmg = parseInt(btn.dataset.dmg) || 0;
        const heal = parseInt(btn.dataset.heal) || 0;
        const isDmg = dmg > 0;

        let newVal;
        if (isDmg) newVal = Math.max(0, cur - dmg);
        else newVal = Math.min(max || 9999, cur + heal);

        hpInput.value = newVal;
        updateHealthState();
        scheduleAutoSave();

        // Flash the status block
        const block = hpInput.closest(".status-block");
        if (block) {
            block.classList.remove("flash-damage", "flash-heal");
            void block.offsetWidth; // reflow
            block.classList.add(isDmg ? "flash-damage" : "flash-heal");
            setTimeout(() => block.classList.remove("flash-damage", "flash-heal"), 500);
        }
    });
});

// ════════════════════════════════════════════════════════════
//  ROT PENALTY BANNER
// ════════════════════════════════════════════════════════════

function checkRotPenalty() {
    const dots = document.querySelectorAll(".attempt-dot");
    const all = [...dots].every(d => d.classList.contains("used"));
    const banner = document.getElementById("rotPenaltyBanner");
    if (banner) banner.classList.toggle("hidden", !all);
}

// Hook into attempt dot clicks — re-check after each toggle
// (dots are already wired above; we just add the check)
document.querySelectorAll(".attempt-dot").forEach(dot => {
    dot.addEventListener("click", checkRotPenalty);
});

// Dismiss / reset cycle button
document.getElementById("rotPenaltyDismiss")?.addEventListener("click", () => {
    // Reset all dots
    document.querySelectorAll(".attempt-dot").forEach(d => d.classList.remove("used"));
    // Increment cycle number
    const cycleInput = document.querySelector("input[data-field='rot_cycle']");
    if (cycleInput) cycleInput.value = (parseInt(cycleInput.value) || 1) + 1;
    // Hide banner
    document.getElementById("rotPenaltyBanner")?.classList.add("hidden");
    scheduleAutoSave();
});

// ════════════════════════════════════════════════════════════
//  ROLL HISTORY
// ════════════════════════════════════════════════════════════

let rollHistoryLog = [];   // session-only, not saved to Firebase
const MAX_HISTORY = 10;

const rhToggleBtn = document.getElementById("rhToggleBtn");
const rhToggleCount = document.getElementById("rhToggleCount");
const rhList = document.getElementById("rhList");
const rhClear = document.getElementById("rhClear");
const rollHistoryEl = document.getElementById("rollHistory");
let rhOpen = false;

function addToHistory(diceCount, rolls, passes, tier) {
    rollHistoryLog.unshift({ diceCount, rolls, passes, tier, ts: Date.now() });
    if (rollHistoryLog.length > MAX_HISTORY) rollHistoryLog.pop();
    renderHistory();
    // Update badge count
    rhToggleCount.textContent = rollHistoryLog.length;
    rhToggleCount.classList.remove("hidden");
}

function renderHistory() {
    if (!rhList) return;
    if (rollHistoryLog.length === 0) {
        rhList.innerHTML = '<div class="rh-empty">No rolls yet this session.</div>';
        return;
    }
    rhList.innerHTML = "";
    rollHistoryLog.forEach(entry => {
        const row = document.createElement("div");
        row.className = "rh-entry";
        // Highlight special values in roll list
        const rollsHtml = entry.rolls.map(v => {
            if (v === 1) return `<span style="color:#ff4444">${v}</span>`;
            if (v === 10) return `<span style="color:var(--green)">${v}</span>`;
            if (v >= 9) return `<span style="color:rgba(61,255,143,0.8)">${v}</span>`;
            return `<span>${v}</span>`;
        }).join('<span style="color:rgba(61,255,143,0.2)"> · </span>');

        row.innerHTML = `
            <span class="rh-dice-label">${entry.diceCount}d10</span>
            <span class="rh-rolls">${rollsHtml}</span>
            <span class="rh-passes">${Math.max(0, entry.passes)}p</span>
            <span class="rh-result-chip ${entry.tier.cls}">${entry.tier.label.split(' ')[0]}</span>
        `;
        rhList.appendChild(row);
    });
}

rhToggleBtn?.addEventListener("click", () => {
    rhOpen = !rhOpen;
    rollHistoryEl?.classList.toggle("open", rhOpen);
});

rhClear?.addEventListener("click", () => {
    rollHistoryLog = [];
    renderHistory();
    rhToggleCount.classList.add("hidden");
});

// ════════════════════════════════════════════════════════════
//  PATCH: hook history + new fields into existing functions
// ════════════════════════════════════════════════════════════

// Patch populateSheet to also populate inventory
const _origPopulate = populateSheet;

// Patch collectSheetData to also collect inventory
const _origCollect = collectSheetData;

// Patch rollDice to push to history after resolving
// We do this by monkey-patching the setTimeout inside rollDice.
// Simpler: intercept diceRollBtn click after the roll resolves.
// We'll override by replacing the listener with a wrapper.
diceRollBtn.removeEventListener("click", rollDice);
diceRollBtn.addEventListener("click", () => {
    // Call the original roll
    rollDice();
    // After scramble duration, record to history
    setTimeout(() => {
        // Read results from DOM
        const chips = document.querySelectorAll(".die-chip");
        const rolls = [...chips].map(c => parseInt(c.textContent.trim())).filter(n => !isNaN(n));
        const passes = parseInt(document.getElementById("diceSumPasses")?.textContent) || 0;
        const resultEl = document.getElementById("diceSumResult");
        if (rolls.length === 0) return;
        const tierCls = resultEl?.className.replace("summary-result", "").trim() || "fail";
        const tierLabel = resultEl?.textContent || "—";
        addToHistory(rolls.length, rolls, passes, { cls: tierCls, label: tierLabel });
    }, 480); // slightly after scramble resolves
});

// ════════════════════════════════════════════════════════════
//  DELETE CHARACTER
// ════════════════════════════════════════════════════════════

const charDelBtn = document.getElementById("charDelBtn");
const delCharModal = document.getElementById("delCharModalBackdrop");
const delCharModalClose = document.getElementById("delCharModalClose");
const delCharCancelBtn = document.getElementById("delCharCancelBtn");
const delCharConfirmBtn = document.getElementById("delCharConfirmBtn");
const delCharConfirmInput = document.getElementById("delCharConfirmInput");
const delCharMsg = document.getElementById("delCharMsg");
const delCharNameDisplay = document.getElementById("delCharNameDisplay");

// Show delete button only when a character is loaded
function updateDelBtn() {
    if (charDelBtn) charDelBtn.classList.toggle("hidden", !currentSheetId);
}

// Hook into loadSheet and clearSheet to update del button visibility
const _origLoadSheet = loadSheet;
const _origClearSheet = clearSheet;

// Open delete modal
charDelBtn?.addEventListener("click", () => {
    if (!currentSheetId) return;
    const charName = sheetData.charName || "this character";
    delCharNameDisplay.textContent = charName;
    delCharConfirmInput.value = "";
    delCharConfirmBtn.disabled = true;
    delCharMsg.textContent = "";
    delCharMsg.className = "form-message";
    delCharModal.classList.remove("hidden");
    setTimeout(() => delCharConfirmInput.focus(), 50);
});

// Enable confirm button only when name matches exactly
delCharConfirmInput?.addEventListener("input", () => {
    const charName = sheetData.charName || "";
    const typed = delCharConfirmInput.value.trim();
    delCharConfirmBtn.disabled = typed !== charName;
    delCharMsg.textContent = "";
});

// Close modal
function closeDelModal() {
    delCharModal.classList.add("hidden");
    delCharConfirmInput.value = "";
    delCharConfirmBtn.disabled = true;
}
delCharModalClose?.addEventListener("click", closeDelModal);
delCharCancelBtn?.addEventListener("click", closeDelModal);
delCharModal?.addEventListener("click", (e) => { if (e.target === delCharModal) closeDelModal(); });
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !delCharModal.classList.contains("hidden")) closeDelModal();
});

// Confirm delete
delCharConfirmBtn?.addEventListener("click", async () => {
    if (!currentSheetId || !currentUser) return;
    delCharConfirmBtn.disabled = true;
    delCharConfirmBtn.textContent = "Deleting…";

    try {
        await deleteDoc(
            doc(db, "character-sheets", currentUser.uid, "sheets", currentSheetId)
        );

        // Remove from dropdown
        const opt = charSelect.querySelector(`option[value="${currentSheetId}"]`);
        if (opt) opt.remove();

        // Clear sheet state
        currentSheetId = null;
        sheetData = {};
        isDirty = false;
        clearSheet();
        updateDelBtn();
        charSelect.value = "";

        closeDelModal();
        showSaveStatus("Character deleted", false);

    } catch (err) {
        console.error("Delete failed:", err);
        delCharMsg.textContent = "Delete failed — check your connection and try again.";
        delCharMsg.className = "form-message error";
        delCharConfirmBtn.disabled = false;
        delCharConfirmBtn.textContent = "Delete Forever";
    }
});