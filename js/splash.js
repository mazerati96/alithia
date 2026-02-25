/* ─── Tagline typewriter ───────────────────────────────────── */
const tagline = "Where legend breathes and myth endures. A broken world, rebuilt only to fall apart again.";
const taglineEl = document.getElementById("tagline");

let charIndex = 0;
function typeTagline() {
    if (charIndex < tagline.length) {
        taglineEl.textContent += tagline[charIndex++];
        setTimeout(typeTagline, 30); //adjusted from 48 for a slightly faster typing effect
    }
}
// Start after the CSS fade-in animation reveals the tagline element
setTimeout(typeTagline, 500); //adjusted from 1000 to start typing sooner, syncing better with the fade-in

/* ─── Rune ring visibility ─────────────────────────────────── */
const runeRing = document.getElementById("runeRing");
setTimeout(() => runeRing.classList.add("visible"), 800);

/* ─── Particle canvas (floating ember motes) ───────────────── */
const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d");

let W, H, particles;

function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
}

function randomParticle() {
    return {
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.5 + 0.3,
        speed: Math.random() * 0.35 + 0.05,
        drift: (Math.random() - 0.5) * 0.25,
        alpha: Math.random() * 0.6 + 0.1,
        pulse: Math.random() * Math.PI * 2,
    };
}

function initParticles() {
    const count = Math.floor((W * H) / 6000);
    particles = Array.from({ length: count }, randomParticle);
}

function drawParticles(ts) {
    ctx.clearRect(0, 0, W, H);

    for (const p of particles) {
        p.pulse += 0.012;
        const a = p.alpha * (0.6 + 0.4 * Math.sin(p.pulse));

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(61, 255, 143, ${a})`;
        ctx.shadowColor = "#3dff8f";
        ctx.shadowBlur = 6;
        ctx.fill();

        p.y -= p.speed;
        p.x += p.drift;

        // wrap around
        if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
        if (p.x < -5) { p.x = W + 5; }
        if (p.x > W + 5) { p.x = -5; }
    }

    requestAnimationFrame(drawParticles);
}

window.addEventListener("resize", () => {
    resize();
    initParticles();
});

resize();
initParticles();
requestAnimationFrame(drawParticles);