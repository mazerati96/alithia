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

    entry.innerHTML = `
        <div class="cl-entry-time cl-entry-dot">
            <span class="cl-time-main">${timeMain}</span>
            <span class="cl-time-sub">${timeSub}</span>
        </div>
        <div class="cl-entry-content">
            <div class="cl-entry-type">${typeLabel}</div>
            <div class="cl-entry-summary">${escHtml(data.summary || "")}</div>
            ${data.preview ? `<div class="cl-entry-preview">${escHtml(data.preview)}</div>` : ""}
        </div>
    `;

    return entry;
}

function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}