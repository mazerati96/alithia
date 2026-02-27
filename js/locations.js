// ============================================================
//  js/locations.js  —  Alithia Locations Page

// ============================================================

import { auth, db } from "../auth/firebase-config.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const PAGE_ID = "locations";

// ── Particle canvas ──────────────────────────────────────────
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

// ── State ────────────────────────────────────────────────────
let currentUser = null;
let isKeeper = false;
let editMode = false;
let pageData = { blurb: "" };

// ── DOM refs ─────────────────────────────────────────────────
const authGuard = document.getElementById("authGuard");
const locWrap = document.getElementById("locWrap");
const locIntro = document.getElementById("locIntro");
const locIntroLoading = document.getElementById("locIntroLoading");
const locLastEdited = document.getElementById("locLastEdited");
const locEditToggle = document.getElementById("locEditToggle");
const locEditBanner = document.getElementById("locEditBanner");
const editBannerExit = document.getElementById("editBannerExit");
const locEditor = document.getElementById("locEditor");
const rteBody = document.getElementById("rteBody");
const locSaveBtn = document.getElementById("locSaveBtn");
const locCancelBtn = document.getElementById("locCancelBtn");
const locEditorMsg = document.getElementById("locEditorMsg");

// ── Auth guard ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    currentUser = user;

    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists() && userSnap.data().role === "keeper") isKeeper = true;
    } catch (_) { /* non-fatal */ }

    authGuard.classList.add("fade-out");
    setTimeout(() => { authGuard.style.display = "none"; locWrap.classList.remove("hidden"); }, 500);

    if (isKeeper) locEditToggle.classList.remove("hidden");

    await loadPage();
});

// ── Load page blurb from Firestore ───────────────────────────
async function loadPage() {
    try {
        const snap = await getDoc(doc(db, "world-pages", PAGE_ID));

        if (snap.exists()) {
            pageData = snap.data();

            if (pageData.updatedAt) {
                const d = pageData.updatedAt.toDate();
                locLastEdited.textContent = `Last edited ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
                locLastEdited.classList.remove("hidden");
            }
        } else {
            pageData = { blurb: "" };
        }

        renderBlurb();

    } catch (err) {
        console.error("Failed to load locations page:", err);
        locIntroLoading.style.display = "none";
        locIntro.innerHTML = `<div class="loc-intro-empty">Could not load the overview. Please try again.</div>`;
    }
}

// ── Render blurb ─────────────────────────────────────────────
function renderBlurb() {
    locIntroLoading.style.display = "none";

    // Remove any previous content besides the loading div
    Array.from(locIntro.children).forEach(el => {
        if (el !== locIntroLoading) el.remove();
    });

    if (!pageData.blurb || !pageData.blurb.trim()) {
        if (isKeeper) {
            const prompt = document.createElement("div");
            prompt.className = "loc-intro-empty";
            prompt.textContent = "No overview written yet. Enter edit mode to add one.";
            locIntro.appendChild(prompt);
        } else {
            const empty = document.createElement("div");
            empty.className = "loc-intro-empty";
            empty.textContent = "The overview of Alithia's lands has not yet been recorded.";
            locIntro.appendChild(empty);
        }
        return;
    }

    const content = document.createElement("div");
    content.innerHTML = sanitize(pageData.blurb);
    locIntro.appendChild(content);
}

// ── Edit mode toggle ──────────────────────────────────────────
locEditToggle.addEventListener("click", () => enterEditMode());
editBannerExit.addEventListener("click", () => exitEditMode());
locCancelBtn.addEventListener("click", () => exitEditMode());

function enterEditMode() {
    if (!isKeeper) return;
    editMode = true;

    locEditBanner.classList.remove("hidden");
    locEditor.classList.remove("hidden");
    locEditToggle.textContent = "✕ Close Editor";
    locEditToggle.style.borderColor = "rgba(61,255,143,0.4)";
    locEditToggle.onclick = () => exitEditMode();

    // Populate editor with current blurb
    rteBody.innerHTML = pageData.blurb || "";
    if (!rteBody.innerHTML.trim()) rteBody.focus();

    clearMsg();
}

function exitEditMode() {
    editMode = false;
    locEditBanner.classList.add("hidden");
    locEditor.classList.add("hidden");

    // Reset toggle button
    locEditToggle.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Blurb`;
    locEditToggle.style.borderColor = "";
    locEditToggle.onclick = () => enterEditMode();

    clearMsg();
}

// ── RTE toolbar ───────────────────────────────────────────────
document.querySelectorAll(".rte-btn[data-cmd]").forEach(btn => {
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        const val = btn.dataset.val || null;
        document.execCommand(cmd, false, val);
        rteBody.focus();
    });
});

// ── Save blurb ────────────────────────────────────────────────
locSaveBtn.addEventListener("click", async () => {
    if (!isKeeper) return;

    const html = rteBody.innerHTML.trim();
    locSaveBtn.disabled = true;
    locSaveBtn.textContent = "Saving…";
    clearMsg();

    try {
        await setDoc(doc(db, "world-pages", PAGE_ID), {
            blurb: html,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
        }, { merge: true });

        pageData.blurb = html;
        renderBlurb();

        // Update last edited label
        const now = new Date();
        locLastEdited.textContent = `Last edited ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
        locLastEdited.classList.remove("hidden");

        setMsg("Saved!", "success");
        setTimeout(() => exitEditMode(), 900);

    } catch (err) {
        console.error("Save failed:", err);
        setMsg("Failed to save. Check your connection and try again.", "error");
    }

    locSaveBtn.disabled = false;
    locSaveBtn.textContent = "Save Blurb";
});

// ── Scroll reveal for region buttons ─────────────────────────
const regionBtns = document.querySelectorAll(".loc-region-btn");
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.1 });

regionBtns.forEach(btn => {
    btn.style.opacity = "0";
    btn.style.transform = "translateY(8px)";
    btn.style.transition = "opacity 0.4s ease, transform 0.4s ease";
    observer.observe(btn);
});

// ── Keyboard: Escape exits edit mode ─────────────────────────
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editMode) exitEditMode();
});

// ── Helpers ───────────────────────────────────────────────────
function setMsg(text, type) {
    locEditorMsg.textContent = text;
    locEditorMsg.className = `loc-editor-msg ${type}`;
}
function clearMsg() {
    locEditorMsg.textContent = "";
    locEditorMsg.className = "loc-editor-msg";
}

// Basic HTML sanitizer — strips script tags but preserves
// formatting tags the RTE produces (b, i, u, h2, h3, p, ul, li, blockquote)
function sanitize(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    div.querySelectorAll("script, style, iframe, object, embed, form").forEach(el => el.remove());
    div.querySelectorAll("*").forEach(el => {
        [...el.attributes].forEach(attr => {
            if (attr.name.startsWith("on") || (attr.name === "href" && attr.value.startsWith("javascript"))) {
                el.removeAttribute(attr.name);
            }
        });
    });
    return div.innerHTML;
}