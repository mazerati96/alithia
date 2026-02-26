// World Map Interactions — Alithia
// Drag, tap, and navigation logic ported from starmap.js

document.addEventListener('DOMContentLoaded', () => {

    const regions = document.querySelectorAll('.region');
    const worldmapBackground = document.querySelector('.worldmap-background');
    const mapImage = worldmapBackground.querySelector('img');
    const container = document.querySelector('.worldmap-container');

    // ============================================
    // SMOOTH FADE-IN AFTER IMAGE LOADS
    // ============================================

    function onImageLoaded() {
        worldmapBackground.style.transform = 'translate(-50%, -50%)';
        setTimeout(() => {
            worldmapBackground.classList.add('loaded');
        }, 100);
    }

    mapImage.addEventListener('load', onImageLoaded);

    if (mapImage.complete) {
        onImageLoaded();
    }

    // ============================================
    // REGION DATA — add/rename regions to match Alithia's lore
    // 'link' should point to the lore page for that region
    // ============================================

    const regionData = {
        region1: { name: 'Qir Uc', link: '../pages/qir-uc.html' },
        region2: { name: 'Oraci', link: '../pages/oraci.html' },
        region3: { name: 'Ogith', link: '../pages/ogith.html' },
        region4: { name: 'Uranlereli', link: '../pages/uranlereli.html' },
        region5: { name: 'Narithrem', link: '../pages/narithrem.html' },
        region6: { name: 'Cheryndraka', link: '../pages/cheryndraka.html' },
        region7: { name: 'Khorb', link: '../pages/khorb.html' },
        region8: { name: 'Region Name', link: 'pages/region8.html' },
        region9: { name: 'Region Name', link: 'pages/region9.html' },
        region10: { name: 'Region Name', link: 'pages/region10.html' },
        region11: { name: 'Region Name', link: 'pages/region11.html' },
        region12: { name: 'Region Name', link: 'pages/region12.html' },
        region13: { name: 'Region Name', link: 'pages/region13.html' },
        region14: { name: 'Kindush', link: '../pages/kindush.html' },
        region15: { name: 'Elreach', link: '../pages/elreach.html' },
        region16: { name: 'Mistwelia', link: '../pages/mistwelia.html' },
       
    };

    // ============================================
    // PAGE TRANSITION HELPER
    // ============================================

    function navigateToRegion(regionKey) {
        const data = regionData[regionKey];
        if (data) window.navigateTo(data.link);
    }

    // ============================================
    // DRAGGABLE MAP — MOUSE (desktop)
    // ============================================

    let isDragging = false;
    let hasDragged = false;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;

    const MAX_DRAG = 500;

    container.addEventListener('mousedown', (e) => {
        isDragging = true;
        hasDragged = false;
        startX = e.clientX - currentX;
        startY = e.clientY - currentY;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();

        const newX = e.clientX - startX;
        const newY = e.clientY - startY;

        if (Math.abs(newX - currentX) > 3 || Math.abs(newY - currentY) > 3) {
            hasDragged = true;
        }

        currentX = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, newX));
        currentY = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, newY));

        worldmapBackground.style.transform =
            `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // ============================================
    // DRAGGABLE MAP — TOUCH (mobile)
    // ============================================

    let touchStartX = 0;
    let touchStartY = 0;

    container.addEventListener('touchstart', (e) => {
        isDragging = true;
        hasDragged = false;
        const touch = e.touches[0];
        touchStartX = touch.clientX - currentX;
        touchStartY = touch.clientY - currentY;
        e.preventDefault();
    }, { passive: false });

    container.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault();

        const touch = e.touches[0];
        const newX = touch.clientX - touchStartX;
        const newY = touch.clientY - touchStartY;

        if (Math.abs(newX - currentX) > 3 || Math.abs(newY - currentY) > 3) {
            hasDragged = true;
        }

        currentX = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, newX));
        currentY = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, newY));

        worldmapBackground.style.transform =
            `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
    }, { passive: false });

    container.addEventListener('touchend', () => {
        isDragging = false;
    });

    // ============================================
    // REGION CLICK — desktop
    // ============================================

    regions.forEach(region => {
        region.addEventListener('click', () => {
            if (!hasDragged) {
                navigateToRegion(region.getAttribute('data-region'));
            }
            hasDragged = false;
        });
    });

    // ============================================
    // REGION TAP — mobile
    // container's touchstart calls e.preventDefault() which blocks
    // the synthetic click, so we listen on touchend directly per region.
    // ============================================

    regions.forEach(region => {
        region.addEventListener('touchend', (e) => {
            if (!hasDragged) {
                e.stopPropagation();
                navigateToRegion(region.getAttribute('data-region'));
            }
        });
    });

});