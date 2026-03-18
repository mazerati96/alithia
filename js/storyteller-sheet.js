// ============================================================
//  js/storyteller-sheet.js  —  Alithia Storyteller Sheet
//
//  Auth-guarded — requires isStoryteller === true.
//  Player data: reads from character-sheets/{uid}/sheets (live)
//  ST data:     reads/writes storyteller-sheets/{uid} (own doc)
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged, signOut }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    collection, doc, getDoc, getDocs, setDoc,
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
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        if (p.x < -4) p.x = W + 4; if (p.x > W + 4) p.x = -4;
    }
    requestAnimationFrame(drawParticles);
}
window.addEventListener("resize", () => { resizeCanvas(); initParticles(); });
resizeCanvas(); initParticles(); requestAnimationFrame(drawParticles);

// ── State ────────────────────────────────────────────────────
let currentUser = null;
let allPlayers = {};        // uid → { name, email, uid }
let allCharacters = [];     // flat list of all player character docs
let stSheetData = {};       // ST's own persisted data
let saveTimeout = null;
let isDirty = false;
let showExcluded = false;
let activeTab = "players";

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const accessDenied = document.getElementById("accessDenied");
const stSheetWrap = document.getElementById("stSheetWrap");
const topbarUsername = document.getElementById("topbarUsername");
const signOutBtn = document.getElementById("signOutBtn");
const stSaveBtn = document.getElementById("stSaveBtn");
const stPdfBtn = document.getElementById("stPdfBtn");
const saveStatusEl = document.getElementById("saveStatus");
const playersList = document.getElementById("playerTrackerList");
const playersLoading = document.getElementById("playersLoading");
const playersEmpty = document.getElementById("playersEmpty");
const toggleExcludedBtn = document.getElementById("toggleExcludedBtn");
const refreshBtn = document.getElementById("refreshPlayersBtn");
const sessionLogList = document.getElementById("sessionLogList");
const sessionsEmpty = document.getElementById("sessionsEmpty");
const addSessionBtn = document.getElementById("addSessionBtn");
const campaignNotes = document.getElementById("campaignNotes");
const npcList = document.getElementById("npcList");
const npcEmpty = document.getElementById("npcEmpty");
const addNpcBtn = document.getElementById("addNpcBtn");
const eventsList = document.getElementById("eventsList");
const eventsEmpty = document.getElementById("eventsEmpty");
const addEventBtn = document.getElementById("addEventBtn");

// ── Auth guard ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        sessionStorage.setItem("alithia_redirect", window.location.href);
        window.location.href = "login.html";
        return;
    }

    currentUser = user;
    topbarUsername.textContent = user.displayName || user.email;

    let canAccess = false;
    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) throw new Error("User doc missing");
        canAccess = userSnap.data().isStoryteller === true;
    } catch (err) {
        console.error("Access check failed:", err);
        authGuard.classList.add("fade-out");
        setTimeout(() => { authGuard.style.display = "none"; }, 500);
        accessDenied.classList.remove("hidden");
        return;
    }

    authGuard.classList.add("fade-out");
    setTimeout(() => { authGuard.style.display = "none"; }, 500);

    if (!canAccess) {
        accessDenied.classList.remove("hidden");
        return;
    }

    stSheetWrap.classList.remove("hidden");

    try {
        await loadAll();
    } catch (err) {
        console.error("Load failed:", err);
    }
});

signOutBtn?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
});

// ── Load all data ────────────────────────────────────────────
async function loadAll() {
    // 1. Load ST's own sheet first (needed for overrides during render)
    await loadStSheet();
    // 2. Load all player characters
    await loadPlayerData();
}

async function loadStSheet() {
    try {
        const snap = await getDoc(doc(db, "storyteller-sheets", currentUser.uid));
        if (snap.exists()) {
            stSheetData = snap.data();
        } else {
            stSheetData = {
                playerOverrides: {},
                sessions: [],
                npcs: [],
                worldEvents: [],
                campaignNotes: ""
            };
        }
    } catch (err) {
        console.error("ST sheet load failed:", err);
        stSheetData = { playerOverrides: {}, sessions: [], npcs: [], worldEvents: [], campaignNotes: "" };
    }

    // Populate non-player sections immediately
    populateWorldTab();
    renderSessionLog();
}

async function loadPlayerData() {
    playersLoading.style.display = "flex";
    playersList.innerHTML = "";
    allPlayers = {};
    allCharacters = [];

    try {
        // Load all users
        const usersSnap = await getDocs(collection(db, "users"));
        usersSnap.forEach(d => {
            allPlayers[d.id] = {
                name: d.data().username || d.data().email || "Unknown",
                email: d.data().email || "",
                uid: d.id,
            };
        });

        // Load all character sheets per user
        const uidList = Object.keys(allPlayers);
        await Promise.all(uidList.map(async (uid) => {
            try {
                const sheetsSnap = await getDocs(
                    query(collection(db, "character-sheets", uid, "sheets"), orderBy("updatedAt", "desc"))
                );
                sheetsSnap.forEach(d => {
                    allCharacters.push({ id: d.id, ownerUid: uid, ...d.data() });
                });
            } catch (err) {
                console.log(`No sheets for ${uid}:`, err.message);
            }
        }));

        allCharacters.sort((a, b) => {
            const aT = a.updatedAt?.toMillis?.() || 0;
            const bT = b.updatedAt?.toMillis?.() || 0;
            return bT - aT;
        });

    } catch (err) {
        console.error("Player load failed:", err);
        playersLoading.innerHTML = `<span style="color:var(--error)">Could not load player data. Check Firestore rules.</span>`;
        return;
    }

    playersLoading.style.display = "none";
    renderPlayerTracker();
}

// ── Tab navigation ───────────────────────────────────────────
document.querySelectorAll(".st-tab").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".st-tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".st-section").forEach(s => s.classList.remove("active"));
        btn.classList.add("active");
        activeTab = btn.dataset.tab;
        document.getElementById(`tab-${activeTab}`).classList.add("active");
    });
});

// ── Render player tracker ────────────────────────────────────
function renderPlayerTracker() {
    playersList.innerHTML = "";

    const visible = allCharacters.filter(c => {
        const key = makeKey(c.ownerUid, c.id);
        const excluded = stSheetData.playerOverrides?.[key]?.excluded || false;
        return showExcluded ? true : !excluded;
    });

    if (visible.length === 0) {
        playersEmpty.classList.remove("hidden");
        return;
    }
    playersEmpty.classList.add("hidden");

    visible.forEach((char, i) => {
        const key = makeKey(char.ownerUid, char.id);
        const override = stSheetData.playerOverrides?.[key] || {};
        const playerName = allPlayers[char.ownerUid]?.name || "Unknown Player";
        const card = buildPlayerCard(char, playerName, key, override);
        card.style.animationDelay = `${i * 35}ms`;
        playersList.appendChild(card);
    });
}

function makeKey(ownerUid, charId) {
    return `${ownerUid}__${charId}`;
}

function getOverride(key) {
    if (!stSheetData.playerOverrides) stSheetData.playerOverrides = {};
    if (!stSheetData.playerOverrides[key]) stSheetData.playerOverrides[key] = {};
    return stSheetData.playerOverrides[key];
}

// ── Build individual player card ─────────────────────────────
function buildPlayerCard(char, playerName, key, override) {
    const card = document.createElement("div");
    const isExcluded = override.excluded || false;
    card.className = `ptc${isExcluded ? " ptc-excluded" : ""}`;
    card.dataset.key = key;

    // Live player data
    const rotStatus = char.rot_status || "on_path";
    const rotAttempts = parseInt(char.rot_attempts_used) || 0; // player's actual attempts
    const polarity = parseInt(char.polarity) || 0;
    const fatePoints = parseInt(char.fate_points) || 0;
    const fateThread = char.fate_thread_status || "intact";

    // ST's own rot tracking
    const stAttempts = parseInt(override.stRotAttempts) || 0;
    const stCycle = parseInt(override.stRotCycle) || 1;

    const rotBadgeClass = rotStatus === "off_path" ? "off-path"
        : rotStatus === "penalty" ? "penalty"
            : rotStatus === "aligned" ? "aligned"
                : "on-path";
    const rotBadgeLabel = { on_path: "ON PATH", off_path: "OFF PATH", aligned: "ALIGNED", penalty: "PENALTY" }[rotStatus] || "ON PATH";

    card.innerHTML = `
        <div class="ptc-header">
            <div class="ptc-identity">
                <span class="ptc-char-name">${escHtml(char.charName || "Unnamed Character")}</span>
                <span class="ptc-player-name">Played by ${escHtml(playerName)}</span>
            </div>
            <div class="ptc-header-right">
                <span class="ptc-rot-badge ${rotBadgeClass}">${rotBadgeLabel}</span>
                <button class="ptc-exclude-btn">${isExcluded ? "Include" : "Exclude"}</button>
            </div>
        </div>
        <div class="ptc-body">
            <!-- Fated Slot -->
            <div class="ptc-fated-row">
                <span class="ptc-field-label">Fated Slot</span>
                <input class="ptc-fated-input" type="text"
                       placeholder="Assign fated slot…"
                       value="${escHtml(override.fatedSlot || "")}" />
            </div>

            <!-- ST Rot tracking (ST's own, not the player's) -->
            <div class="ptc-rot-row">
                <span class="ptc-rot-label">ST Rot Tracking</span>
                <div class="ptc-rot-dots">
                    ${[1, 2, 3].map(n => `<button class="ptc-dot${stAttempts >= n ? " used" : ""}" data-attempt="${n}"></button>`).join("")}
                </div>
                <span class="ptc-cycle-label">Cycle
                    <input class="ptc-cycle-input" type="number" min="0" max="999"
                           value="${stCycle}" title="Edit cycle number — set to 0 to reset" />
                </span>
                <button class="ptc-reset-btn">Reset Cycle</button>
            </div>
            <!-- Rot penalty banner -->
            <div class="ptc-rot-penalty${stAttempts >= 3 ? "" : " hidden"}">
                ⚠ All 3 attempts used — narrative consequence due. Reset when resolved.
            </div>

            <!-- Expand toggle -->
            <button class="ptc-expand-btn">
                <span class="ptc-expand-icon">▼</span>
                Polarity · Fate · Roll Tally · Notes
            </button>

            <!-- Expandable details -->
            <div class="ptc-details hidden">
                ${buildPolarityRow(polarity)}
                ${buildFateRow(fatePoints, fateThread)}
                ${buildTallyGrid(override)}
                <div class="ptc-notes-row">
                    <span class="ptc-field-label">ST Notes</span>
                    <textarea class="ptc-notes-input" placeholder="Private storyteller notes on this character…">${escHtml(override.notes || "")}</textarea>
                </div>
            </div>
        </div>
    `;

    attachCardListeners(card, key, char);
    return card;
}

function buildPolarityRow(val) {
    const pct = Math.abs(val) / 20 * 50;
    const bandName = getPolarityBand(val);

    let fillHtml = "";
    if (val < 0) {
        fillHtml = `<div class="ptc-pol-fill neg" style="width:${pct}%"></div>`;
    } else if (val > 0) {
        fillHtml = `<div class="ptc-pol-fill pos" style="width:${pct}%"></div>`;
    }

    const valColor = val < 0 ? "var(--pol-neg)" : val > 0 ? "var(--pol-pos)" : "var(--green-dim)";
    const valStr = val > 0 ? `+${val}` : `${val}`;

    return `
        <div class="ptc-polarity-row">
            <span class="ptc-field-label">Polarity</span>
            <div class="ptc-pol-track">
                ${fillHtml}
                <div class="ptc-pol-zero-mark"></div>
            </div>
            <span class="ptc-pol-val" style="color:${valColor}">${valStr}</span>
            <span class="ptc-pol-band">${escHtml(bandName)}</span>
        </div>
    `;
}

function buildFateRow(points, thread) {
    const threads = ["intact", "fraying", "damaged", "severed"];
    const segsHtml = threads.map(t =>
        `<span class="ptc-thread-seg ${t}${thread === t ? " active" : ""}">${capitalize(t)}</span>`
    ).join("");

    return `
        <div class="ptc-fate-row">
            <span class="ptc-field-label">Fate</span>
            <span class="ptc-fate-pts">${points} pts</span>
            <div class="ptc-thread-segs">${segsHtml}</div>
        </div>
    `;
}

function buildTallyGrid(override) {
    const crossed = override.stRollTally || [];
    const cells = Array.from({ length: 20 }, (_, i) => {
        const n = i + 1;
        const isCrossed = crossed.includes(n);
        return `<button class="tally-cell${isCrossed ? " crossed" : ""}" data-num="${n}">${n}</button>`;
    }).join("");

    return `
        <div class="ptc-tally-section">
            <div class="ptc-tally-header">
                <span class="ptc-field-label">Roll Tally (1–20)</span>
                <button class="ptc-tally-clear-btn">Clear All</button>
            </div>
            <div class="ptc-tally-grid">${cells}</div>
        </div>
    `;
}

// ── Card event listeners ─────────────────────────────────────
function attachCardListeners(card, key, char) {
    // Exclude toggle
    card.querySelector(".ptc-exclude-btn").addEventListener("click", () => {
        const override = getOverride(key);
        override.excluded = !override.excluded;
        if (!showExcluded && override.excluded) {
            card.remove();
            if (playersList.children.length === 0) playersEmpty.classList.remove("hidden");
        } else {
            card.classList.toggle("ptc-excluded", override.excluded);
            card.querySelector(".ptc-exclude-btn").textContent = override.excluded ? "Include" : "Exclude";
        }
        scheduleAutoSave();
    });

    // Fated slot input
    card.querySelector(".ptc-fated-input").addEventListener("input", (e) => {
        getOverride(key).fatedSlot = e.target.value;
        scheduleAutoSave();
    });

    // ST Rot dots
    const dots = card.querySelectorAll(".ptc-dot");
    const penaltyBanner = card.querySelector(".ptc-rot-penalty");
    dots.forEach(dot => {
        dot.addEventListener("click", () => {
            const n = parseInt(dot.dataset.attempt);
            const override = getOverride(key);
            const current = parseInt(override.stRotAttempts) || 0;

            // Toggle: clicking the highest used dot removes it
            if (current === n && dot.classList.contains("used")) {
                override.stRotAttempts = n - 1;
            } else {
                override.stRotAttempts = n;
            }

            dots.forEach(d => {
                d.classList.toggle("used", parseInt(d.dataset.attempt) <= override.stRotAttempts);
            });

            if (penaltyBanner) penaltyBanner.classList.toggle("hidden", override.stRotAttempts < 3);
            scheduleAutoSave();
        });
    });

    // Cycle number input — editable, can be set to 0
    const cycleInput = card.querySelector(".ptc-cycle-input");
    cycleInput?.addEventListener("input", (e) => {
        const val = parseInt(e.target.value);
        getOverride(key).stRotCycle = isNaN(val) ? 0 : Math.max(0, val);
        scheduleAutoSave();
    });

    // Reset cycle — clears dots, bumps cycle counter by 1
    card.querySelector(".ptc-reset-btn").addEventListener("click", () => {
        const override = getOverride(key);
        override.stRotAttempts = 0;
        override.stRotCycle = (parseInt(override.stRotCycle) || 1) + 1;
        dots.forEach(d => d.classList.remove("used"));
        if (penaltyBanner) penaltyBanner.classList.add("hidden");
        if (cycleInput) cycleInput.value = override.stRotCycle;
        scheduleAutoSave();
    });

    // Tally grid — click to cross, click again to un-cross
    card.querySelectorAll(".tally-cell").forEach(cell => {
        cell.addEventListener("click", () => {
            const n = parseInt(cell.dataset.num);
            const override = getOverride(key);
            if (!override.stRollTally) override.stRollTally = [];
            const idx = override.stRollTally.indexOf(n);
            if (idx === -1) {
                override.stRollTally.push(n);
                cell.classList.add("crossed");
            } else {
                override.stRollTally.splice(idx, 1);
                cell.classList.remove("crossed");
            }
            scheduleAutoSave();
        });
    });

    // Tally clear button — uncrosses all, keeps grid
    card.querySelector(".ptc-tally-clear-btn")?.addEventListener("click", () => {
        getOverride(key).stRollTally = [];
        card.querySelectorAll(".tally-cell").forEach(c => c.classList.remove("crossed"));
        scheduleAutoSave();
    });

    // Expand / collapse details
    const expandBtn = card.querySelector(".ptc-expand-btn");
    const details = card.querySelector(".ptc-details");
    expandBtn.addEventListener("click", () => {
        const open = !details.classList.contains("hidden");
        details.classList.toggle("hidden", open);
        expandBtn.classList.toggle("open", !open);
    });

    // ST Notes textarea
    card.querySelector(".ptc-notes-input").addEventListener("input", (e) => {
        getOverride(key).notes = e.target.value;
        scheduleAutoSave();
    });
}

// ── Toggle excluded ───────────────────────────────────────────
toggleExcludedBtn?.addEventListener("click", () => {
    showExcluded = !showExcluded;
    toggleExcludedBtn.textContent = showExcluded ? "Hide Excluded" : "Show Excluded";
    toggleExcludedBtn.classList.toggle("active-toggle", showExcluded);
    renderPlayerTracker();
});

// ── Refresh player data ───────────────────────────────────────
refreshBtn?.addEventListener("click", async () => {
    await loadPlayerData();
});

// ══════════════════════════════════════════════════════════════
//  SESSION LOG
// ══════════════════════════════════════════════════════════════

function renderSessionLog() {
    sessionLogList.innerHTML = "";
    const sessions = stSheetData.sessions || [];

    sessionsEmpty.classList.toggle("hidden", sessions.length > 0);

    sessions.forEach((s, i) => addSessionEntry(s.id, s.date || "", s.title || "", s.notes || ""));
}

function addSessionEntry(id = null, date = "", title = "", notes = "") {
    const entryId = id || `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (!id) {
        if (!stSheetData.sessions) stSheetData.sessions = [];
        stSheetData.sessions.unshift({ id: entryId, date, title, notes });
    }

    sessionsEmpty.classList.add("hidden");

    const entry = document.createElement("div");
    entry.className = "session-entry";
    entry.dataset.id = entryId;
    entry.innerHTML = `
        <div class="session-entry-header">
            <input class="session-date-input" type="date" value="${escHtml(date)}" />
            <input class="session-title-input" type="text" placeholder="Session title…" value="${escHtml(title)}" maxlength="80" />
            <button class="session-del-btn" title="Delete session">✕</button>
        </div>
        <textarea class="session-notes-area" placeholder="What happened this session — events, decisions, consequences, hooks…">${escHtml(notes)}</textarea>
    `;

    entry.querySelector(".session-del-btn").addEventListener("click", () => {
        stSheetData.sessions = (stSheetData.sessions || []).filter(s => s.id !== entryId);
        entry.remove();
        if (!stSheetData.sessions.length) sessionsEmpty.classList.remove("hidden");
        scheduleAutoSave();
    });

    entry.querySelector(".session-date-input").addEventListener("input", (e) => {
        const s = stSheetData.sessions?.find(s => s.id === entryId);
        if (s) s.date = e.target.value;
        scheduleAutoSave();
    });

    entry.querySelector(".session-title-input").addEventListener("input", (e) => {
        const s = stSheetData.sessions?.find(s => s.id === entryId);
        if (s) s.title = e.target.value;
        scheduleAutoSave();
    });

    entry.querySelector(".session-notes-area").addEventListener("input", (e) => {
        const s = stSheetData.sessions?.find(s => s.id === entryId);
        if (s) s.notes = e.target.value;
        scheduleAutoSave();
    });

    // Prepend so newest is first
    sessionLogList.prepend(entry);
}

addSessionBtn?.addEventListener("click", () => {
    const today = new Date().toISOString().slice(0, 10);
    addSessionEntry(null, today, "", "");
    scheduleAutoSave();
});

// ══════════════════════════════════════════════════════════════
//  WORLD TAB
// ══════════════════════════════════════════════════════════════

function populateWorldTab() {
    // Campaign notes
    if (campaignNotes) {
        campaignNotes.innerHTML = stSheetData.campaignNotes || "";
    }

    // NPCs
    renderNpcs();

    // World events
    renderEvents();

    // Wire campaign notes autosave
    campaignNotes?.addEventListener("input", () => {
        stSheetData.campaignNotes = campaignNotes.innerHTML;
        scheduleAutoSave();
    });
}

// ── NPCs ─────────────────────────────────────────────────────
function renderNpcs() {
    npcList.innerHTML = "";
    const npcs = stSheetData.npcs || [];
    npcEmpty.classList.toggle("hidden", npcs.length > 0);
    npcs.forEach(n => addNpcRow(n.id, n.name || "", n.faction || "", n.disposition || "neutral", n.notes || ""));
}

function addNpcRow(id = null, name = "", faction = "", disposition = "neutral", notes = "") {
    const rowId = id || `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (!id) {
        if (!stSheetData.npcs) stSheetData.npcs = [];
        stSheetData.npcs.push({ id: rowId, name, faction, disposition, notes });
    }

    npcEmpty.classList.add("hidden");

    const row = document.createElement("div");
    row.className = "npc-row";
    row.dataset.id = rowId;
    row.innerHTML = `
        <input class="npc-name-input" type="text" placeholder="NPC Name…" value="${escHtml(name)}" maxlength="60" />
        <input class="npc-faction-input" type="text" placeholder="Faction…" value="${escHtml(faction)}" maxlength="60" />
        <select class="npc-disposition-select">
            <option value="friendly"${disposition === "friendly" ? " selected" : ""}>Friendly</option>
            <option value="neutral"${disposition === "neutral" ? " selected" : ""}>Neutral</option>
            <option value="hostile"${disposition === "hostile" ? " selected" : ""}>Hostile</option>
            <option value="unknown"${disposition === "unknown" ? " selected" : ""}>Unknown</option>
        </select>
        <input class="npc-notes-input" type="text" placeholder="Brief notes…" value="${escHtml(notes)}" maxlength="150" />
        <button class="npc-del-btn" title="Remove NPC">✕</button>
    `;

    row.querySelector(".npc-del-btn").addEventListener("click", () => {
        stSheetData.npcs = (stSheetData.npcs || []).filter(n => n.id !== rowId);
        row.remove();
        if (!stSheetData.npcs.length) npcEmpty.classList.remove("hidden");
        scheduleAutoSave();
    });

    ["npc-name-input", "npc-faction-input", "npc-notes-input"].forEach(cls => {
        row.querySelector(`.${cls}`).addEventListener("input", () => syncNpcRow(row, rowId));
    });

    row.querySelector(".npc-disposition-select").addEventListener("change", () => syncNpcRow(row, rowId));

    npcList.appendChild(row);
}

function syncNpcRow(row, rowId) {
    const n = stSheetData.npcs?.find(n => n.id === rowId);
    if (n) {
        n.name = row.querySelector(".npc-name-input")?.value || "";
        n.faction = row.querySelector(".npc-faction-input")?.value || "";
        n.disposition = row.querySelector(".npc-disposition-select")?.value || "neutral";
        n.notes = row.querySelector(".npc-notes-input")?.value || "";
    }
    scheduleAutoSave();
}

addNpcBtn?.addEventListener("click", () => {
    addNpcRow(null, "", "", "neutral", "");
    scheduleAutoSave();
});

// ── World Events ─────────────────────────────────────────────
function renderEvents() {
    eventsList.innerHTML = "";
    const events = stSheetData.worldEvents || [];
    eventsEmpty.classList.toggle("hidden", events.length > 0);
    events.forEach(e => addEventRow(e.id, e.date || "", e.text || ""));
}

function addEventRow(id = null, date = "", text = "") {
    const rowId = id || `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (!id) {
        if (!stSheetData.worldEvents) stSheetData.worldEvents = [];
        stSheetData.worldEvents.push({ id: rowId, date, text });
    }

    eventsEmpty.classList.add("hidden");

    const row = document.createElement("div");
    row.className = "event-row";
    row.dataset.id = rowId;
    row.innerHTML = `
        <input class="event-date-input" type="date" value="${escHtml(date)}" />
        <input class="event-text-input" type="text" placeholder="Describe the world event…" value="${escHtml(text)}" maxlength="200" />
        <button class="event-del-btn" title="Remove event">✕</button>
    `;

    row.querySelector(".event-del-btn").addEventListener("click", () => {
        stSheetData.worldEvents = (stSheetData.worldEvents || []).filter(e => e.id !== rowId);
        row.remove();
        if (!stSheetData.worldEvents.length) eventsEmpty.classList.remove("hidden");
        scheduleAutoSave();
    });

    row.querySelector(".event-date-input").addEventListener("input", (e) => {
        const ev = stSheetData.worldEvents?.find(e => e.id === rowId);
        if (ev) ev.date = e.target.value;
        scheduleAutoSave();
    });

    row.querySelector(".event-text-input").addEventListener("input", (e) => {
        const ev = stSheetData.worldEvents?.find(e => e.id === rowId);
        if (ev) ev.text = e.target.value;
        scheduleAutoSave();
    });

    eventsList.appendChild(row);
}

addEventBtn?.addEventListener("click", () => {
    const today = new Date().toISOString().slice(0, 10);
    addEventRow(null, today, "");
    scheduleAutoSave();
});

// ══════════════════════════════════════════════════════════════
//  SAVE
// ══════════════════════════════════════════════════════════════

function scheduleAutoSave() {
    isDirty = true;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveStSheet(), 2500);
}

async function saveStSheet() {
    if (!currentUser) return;

    const data = {
        playerOverrides: stSheetData.playerOverrides || {},
        sessions: stSheetData.sessions || [],
        npcs: stSheetData.npcs || [],
        worldEvents: stSheetData.worldEvents || [],
        campaignNotes: campaignNotes ? campaignNotes.innerHTML : (stSheetData.campaignNotes || ""),
        updatedAt: serverTimestamp(),
        uid: currentUser.uid,
    };

    try {
        await setDoc(doc(db, "storyteller-sheets", currentUser.uid), data, { merge: true });
        stSheetData = { ...stSheetData, ...data };
        isDirty = false;
        showSaveStatus("✦ Saved", false);
    } catch (err) {
        console.error("Save failed:", err);
        showSaveStatus("Save failed — check connection", true);
    }
}

stSaveBtn?.addEventListener("click", () => saveStSheet());

function showSaveStatus(msg, isError) {
    if (!saveStatusEl) return;
    saveStatusEl.textContent = msg;
    saveStatusEl.className = "st-save-status visible" + (isError ? " error" : "");
    setTimeout(() => saveStatusEl.classList.remove("visible"), 2500);
}

window.addEventListener("beforeunload", (e) => {
    if (isDirty) { e.preventDefault(); e.returnValue = ""; }
});

// ── PDF / Print ───────────────────────────────────────────────
stPdfBtn?.addEventListener("click", () => {
    // Expand all details before printing
    document.querySelectorAll(".ptc-details.hidden").forEach(d => d.classList.remove("hidden"));
    window.print();
});

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");
}

function getPolarityBand(val) {
    if (val <= -20) return "Xenderon Threshold";
    if (val <= -13) return "Abyss";
    if (val <= -7) return "Deep Negative";
    if (val <= -1) return "Negative";
    if (val === 0) return "Neutral";
    if (val <= 6) return "Positive";
    if (val <= 12) return "Deep Positive";
    if (val <= 19) return "Grace";
    return "Vyomi Threshold";
}