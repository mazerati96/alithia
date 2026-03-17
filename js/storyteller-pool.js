// ============================================================
//  js/storyteller-pool.js  —  Alithia Storyteller Pool
//
//  Auth-guarded — requires role === "storyteller".
//  Reads all character-sheets across all users.
//  Read-only — no writes performed.
// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged, signOut }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    collection, doc, getDoc, getDocs, query, orderBy
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
let allPlayers = {};   // uid → { name, email }
let allCharacters = [];   // flat list of all char sheet docs
let activeFilter = "all";
let searchQuery = "";

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const accessDenied = document.getElementById("accessDenied");
const poolWrap = document.getElementById("poolWrap");
const poolGrid = document.getElementById("poolGrid");
const poolLoading = document.getElementById("poolLoading");
const poolEmpty = document.getElementById("poolEmpty");
const poolSearch = document.getElementById("poolSearch");
const poolChips = document.getElementById("poolFilterChips");
const topbarUsername = document.getElementById("topbarUsername");
const signOutBtn = document.getElementById("signOutBtn");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const drawerClose = document.getElementById("drawerClose");
const drawerLoading = document.getElementById("drawerLoading");
const drawerContent = document.getElementById("drawerContent");
const drawerOpenBtn = document.getElementById("drawerOpenBtn");

// ── Auth guard + role check ───────────────────────────────────
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

        if (!userSnap.exists()) {
            throw new Error("User doc missing");
        }

        canAccess = userSnap.data().isStoryteller === true;

    } catch (err) {
        console.error("Access check failed:", err);

        // 🔥 Don't proceed if role check fails
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

    poolWrap.classList.remove("hidden");

    try {
        await loadPool();
    } catch (err) {
        console.error("Pool load failed:", err);
    }
});

signOutBtn?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
});

// ── Load all character sheets ─────────────────────────────────
async function loadPool() {
    poolLoading.style.display = "flex";
    poolGrid.innerHTML = "";

    try {
        // 1. Load all users to get display names
        const usersSnap = await getDocs(collection(db, "users"));
        usersSnap.forEach(d => {
            allPlayers[d.id] = {
                name: d.data().username || d.data().email || "Unknown",
                email: d.data().email || "",
                uid: d.id,
            };
        });

        // 2. Load all character sheets — fetch each user's subcollection individually
        //    (avoids collectionGroup index requirement)
        allCharacters = [];

        const playerUidList = Object.keys(allPlayers);
        await Promise.all(playerUidList.map(async (uid) => {
            try {
                const userSheetsSnap = await getDocs(
                    query(
                        collection(db, "character-sheets", uid, "sheets"),
                        orderBy("updatedAt", "desc")
                    )
                );
                userSheetsSnap.forEach(d => {
                    allCharacters.push({
                        id: d.id,
                        ownerUid: uid,
                        ...d.data(),
                    });
                });
            } catch (err) {
                // User may have no sheets yet — non-fatal
                console.log(`No sheets for ${uid}:`, err.message);
            }
        }));

        // Sort all characters by updatedAt descending
        allCharacters.sort((a, b) => {
            const aTime = a.updatedAt?.toMillis?.() || 0;
            const bTime = b.updatedAt?.toMillis?.() || 0;
            return bTime - aTime;
        });

        // Stats
        const playerUids = [...new Set(allCharacters.map(c => c.ownerUid))];
        document.getElementById("statTotalPlayers").textContent = playerUids.length;
        document.getElementById("statTotalChars").textContent = allCharacters.length;

        // Last updated
        if (allCharacters.length > 0 && allCharacters[0].updatedAt) {
            const d = allCharacters[0].updatedAt.toDate();
            document.getElementById("statLastUpdated").textContent =
                d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        }

        // Build player filter chips
        buildFilterChips(playerUids);
        renderPool();

    } catch (err) {
        console.error("Failed to load pool:", err);
        poolLoading.innerHTML = `<span style="color:var(--error)">Could not load characters. Check Firestore rules.</span>`;
    }
}

// ── Build player filter chips ─────────────────────────────────
function buildFilterChips(uids) {
    // Keep "All Players" chip, add one per player
    const existing = poolChips.querySelector('[data-filter="all"]');
    poolChips.innerHTML = "";
    poolChips.appendChild(existing || makeChip("all", "All Players"));

    uids.forEach(uid => {
        const name = allPlayers[uid]?.name || "Unknown";
        poolChips.appendChild(makeChip(uid, name));
    });

    poolChips.querySelectorAll(".pool-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            poolChips.querySelectorAll(".pool-chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            activeFilter = chip.dataset.filter;
            renderPool();
        });
    });
}

function makeChip(filter, label) {
    const btn = document.createElement("button");
    btn.className = "pool-chip" + (filter === "all" ? " active" : "");
    btn.dataset.filter = filter;
    btn.textContent = label;
    return btn;
}

// ── Search ────────────────────────────────────────────────────
let searchTimeout = null;
poolSearch?.addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    searchQuery = e.target.value.trim().toLowerCase();
    searchTimeout = setTimeout(renderPool, 180);
});

// ── Render pool ───────────────────────────────────────────────
function renderPool() {
    poolLoading.style.display = "none";
    poolGrid.innerHTML = "";

    // Filter
    let chars = allCharacters.filter(c => {
        if (activeFilter !== "all" && c.ownerUid !== activeFilter) return false;
        if (searchQuery) {
            const name = (c.charName || "").toLowerCase();
            const player = (allPlayers[c.ownerUid]?.name || "").toLowerCase();
            const species = (c.species || "").toLowerCase();
            if (!name.includes(searchQuery) && !player.includes(searchQuery) && !species.includes(searchQuery)) return false;
        }
        return true;
    });

    if (chars.length === 0) {
        poolEmpty.classList.remove("hidden");
        return;
    }
    poolEmpty.classList.add("hidden");

    // Group by player
    const byPlayer = {};
    chars.forEach(c => {
        if (!byPlayer[c.ownerUid]) byPlayer[c.ownerUid] = [];
        byPlayer[c.ownerUid].push(c);
    });

    let delay = 0;
    Object.entries(byPlayer).forEach(([uid, chars]) => {
        const player = allPlayers[uid] || { name: "Unknown Player", uid };
        const section = document.createElement("div");
        section.className = "player-section";
        section.style.animationDelay = `${delay}ms`;
        delay += 60;

        const initials = getInitials(player.name);
        section.innerHTML = `
            <div class="player-header">
                <div class="player-avatar">${escHtml(initials)}</div>
                <span class="player-name">${escHtml(player.name)}</span>
                <span class="player-char-count">${chars.length} character${chars.length !== 1 ? "s" : ""}</span>
            </div>
            <div class="char-cards-row" id="row-${uid}"></div>
        `;

        const row = section.querySelector(`#row-${uid}`);
        chars.forEach((char, i) => {
            row.appendChild(buildCharCard(char, player.name, i));
        });

        poolGrid.appendChild(section);
    });
}

// ── Build character card ──────────────────────────────────────
function buildCharCard(char, playerName, index) {
    const card = document.createElement("div");
    card.className = "char-card";
    card.style.animationDelay = `${index * 40}ms`;

    const name = char.charName || "Unnamed Character";
    const species = char.species || "";
    const cls = char.classLevel || "";
    const meta = [species, cls].filter(Boolean).join(" · ") || "No details yet";

    // Status pills
    const pills = [];
    const rotStatus = char.rot_status || "on_path";
    if (rotStatus === "off_path" || rotStatus === "penalty") {
        pills.push({ label: "ROT", cls: "off-path" });
    } else {
        pills.push({ label: "ON PATH", cls: "on-path" });
    }

    const polarity = parseInt(char.polarity) || 0;
    if (polarity > 0) pills.push({ label: `+${polarity}`, cls: "polarity-pos" });
    else if (polarity < 0) pills.push({ label: `${polarity}`, cls: "polarity-neg" });
    else pills.push({ label: "POL 0", cls: "polarity-neu" });

    const pillsHtml = pills.map(p =>
        `<span class="cc-pill ${p.cls}">${p.label}</span>`
    ).join("");

    // Last updated
    let updatedStr = "";
    if (char.updatedAt) {
        const d = char.updatedAt.toDate();
        updatedStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    card.innerHTML = `
        <div class="cc-name">${escHtml(name)}</div>
        <div class="cc-meta">${escHtml(meta)}</div>
        <div class="cc-pills">${pillsHtml}</div>
        ${updatedStr ? `<div class="cc-updated">Updated ${updatedStr}</div>` : ""}
        <span class="cc-arrow">→</span>
    `;

    card.addEventListener("click", () => openDrawer(char, playerName));
    return card;
}

// ── Drawer ────────────────────────────────────────────────────
function openDrawer(char, playerName) {
    drawerBackdrop.classList.remove("hidden");
    drawerLoading.style.display = "flex";
    drawerContent.classList.add("hidden");

    document.getElementById("drawerCharName").textContent = char.charName || "Unnamed";
    document.getElementById("drawerPlayerName").textContent = `Played by ${playerName}`;

    // Open full sheet link — passes ownerUid + sheetId via query string
    drawerOpenBtn.href = `character-sheet.html?uid=${char.ownerUid}&sheet=${char.id}`;

    populateDrawer(char);
}

function populateDrawer(char) {
    drawerLoading.style.display = "none";
    drawerContent.classList.remove("hidden");

    // Identity
    setText("drPronouns", char.pronouns || "—");
    setText("drSpecies", char.species || "—");
    setText("drClassLevel", char.classLevel || "—");
    setText("drOrigin", char.origin || "—");

    // Stats
    const s = (field) => parseInt(char[`stat_${field}`]) || 0;
    setText("drFortitude", s("fortitude"));
    setText("drMuscle", s("muscle"));
    setText("drSwiftness", s("swiftness"));
    setText("drKeeness", s("keeness"));
    setText("drWisdom", s("wisdom"));
    setText("drCharm", s("charm"));
    setText("drFaith", s("faith"));
    setText("drSelf", s("self"));
    setText("drLore", s("lore"));

    // Derived
    setText("drVitality", s("fortitude") + s("muscle"));
    setText("drTenacity", s("self") + s("charm"));
    setText("drSoul", s("faith") + s("wisdom"));

    // Status
    const maxHealth = 1 + Math.floor((s("fortitude") + s("muscle")) / 2);
    const curHealth = parseInt(char.current_health) || 0;
    setText("drHealth", `${curHealth} / ${maxHealth}`);
    setText("drHealthState", char.health_state ? capitalize(char.health_state) : "—");

    const maxMorale = 1 + Math.floor((s("self") + s("charm")) / 2);
    const curMorale = parseInt(char.current_morale) || 0;
    setText("drMorale", `${curMorale} / ${maxMorale}`);

    const maxSanity = 1 + Math.floor((s("faith") + s("wisdom")) / 2);
    const curSanity = parseInt(char.current_sanity) || 0;
    setText("drSanity", `${curSanity} / ${maxSanity}`);

    // Rot
    const rotLabels = { on_path: "On Path", off_path: "Off Path", aligned: "Aligned", penalty: "PENALTY" };
    setText("drRotStatus", rotLabels[char.rot_status] || "On Path");
    setText("drRotCycle", `Cycle ${char.rot_cycle || 1} · ${char.rot_points_lost || 0} pts lost`);

    // Fate
    setText("drFatePoints", char.fate_points || 0);
    setText("drFateThread", capitalize(char.fate_thread_status || "intact"));

    // Polarity
    const pol = parseInt(char.polarity) || 0;
    setText("drPolarity", pol > 0 ? `+${pol}` : `${pol}`);
    setText("drPolarityBand", getPolarityBand(pol));

    // Fated slot (Storyteller only)
    setText("drFatedSlot", stripHtml(char.rot_fated_slot) || "Not assigned yet");
    const rotNotes = stripHtml(char.rot_notes || "");
    const rotNotesEl = document.getElementById("drRotNotes");
    if (rotNotesEl) rotNotesEl.textContent = rotNotes || "";

    // Backstory
    setText("drBackstory", stripHtml(char.backstory) || "Not recorded yet.");
}

function closeDrawer() {
    drawerBackdrop.classList.add("hidden");
}
drawerClose?.addEventListener("click", closeDrawer);
drawerBackdrop?.addEventListener("click", (e) => {
    if (e.target === drawerBackdrop) closeDrawer();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
});

// ── Helpers ───────────────────────────────────────────────────
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripHtml(html) {
    if (!html) return "";
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");
}

function getInitials(name) {
    return name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
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