// ============================================================
//  js/auth-status.js  —  Alithia Shared Auth Status
//
//  Include on any page that has the hamburger nav to
//  dynamically swap "Collaborator Login" → "Dashboard"
//  when the user is already signed in.
//
//  Add to any page AFTER navigation.js:
//    <script type="module" src="../js/auth-status.js"></script>
//    (use src="js/auth-status.js" from root-level pages)
// ============================================================

import { auth } from "../auth/firebase-config.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

onAuthStateChanged(auth, (user) => {

    // ── Swap nav login link based on auth state ──────────────
    // Looks for any <a> in .nav-menu whose href ends in login.html
    const navLinks = document.querySelectorAll(".nav-menu a");

    navLinks.forEach(link => {
        if (link.getAttribute("href")?.includes("login.html")) {
            if (user) {
                // Logged in — point to dashboard instead
                link.textContent = "MY DASHBOARD";
                link.setAttribute("href", "dashboard.html");
            } else {
                // Not logged in — ensure it says login
                link.textContent = "COLLABORATOR LOGIN";
                link.setAttribute("href", "login.html");
            }
        }
    });

    // ── Optional: add a small auth indicator to the topbar ───
    // If the page has a .topbar-auth-indicator element, populate it
    const indicator = document.getElementById("authIndicator");
    if (indicator) {
        if (user) {
            const name = user.displayName || user.email;
            indicator.innerHTML = `
                <span class="auth-dot logged-in"></span>
                <a href="dashboard.html" class="auth-name">${escHtml(name)}</a>
            `;
        } else {
            indicator.innerHTML = `
                <span class="auth-dot logged-out"></span>
                <a href="login.html" class="auth-name">Sign In</a>
            `;
        }
    }
});

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}