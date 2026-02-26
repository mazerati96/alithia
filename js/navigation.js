// ============================================================
//  js/navigation.js  —  Alithia Shared Navigation
//  Include on every page:
//    <script src="../js/navigation.js"></script>   (from /pages/)
//    <script src="js/navigation.js"></script>      (from root)
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

    const hamburger = document.getElementById('hamburger');
    const navOverlay = document.getElementById('navOverlay');

    if (!hamburger || !navOverlay) return; // page doesn't use nav, bail silently

    // ── Toggle open/close ──────────────────────────────────
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('open');
        navOverlay.classList.toggle('open');
    });

    // ── Close when any nav link is clicked ─────────────────
    navOverlay.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('open');
            navOverlay.classList.remove('open');
        });
    });

    // ── Close on Escape key ────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hamburger.classList.remove('open');
            navOverlay.classList.remove('open');
        }
    });

    // ── Close when clicking outside the nav menu ──────────
    navOverlay.addEventListener('click', (e) => {
        if (e.target === navOverlay) {
            hamburger.classList.remove('open');
            navOverlay.classList.remove('open');
        }
    });

});

// ============================================================
//  Page transition helper — call from any page's JS:
// ============================================================

function navigateTo(url) {
    const transition = document.querySelector('.page-transition');
    if (transition) {
        transition.classList.add('active');
        setTimeout(() => { window.location.href = url; }, 600);
    } else {
        window.location.href = url;
    }
}

// Expose globally so non-module scripts can use it too
window.navigateTo = navigateTo;