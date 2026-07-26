(() => {
  'use strict';

  const VERSION = '0.6.5';
  const STYLE_ID = 'investor-control-v065-ui-fix';
  const FAB_CLASS = 'decision-gate-fab-fixed';
  let patchQueued = false;

  function isDecisionGateButton(button) {
    const text = String(button.textContent || '').trim();
    const accessibleName = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`.toLowerCase();
    const looksLikeGate = /^[✓✔☑]$/.test(text) || /decision\s*gate|έλεγχος\s*απόφασης|πύλη\s*απόφασης/.test(accessibleName);
    if (!looksLikeGate) return false;

    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return style.position === 'fixed'
      && rect.width >= 42
      && rect.height >= 42
      && rect.width <= 120
      && rect.height <= 120
      && rect.left >= window.innerWidth / 2;
  }

  function patchDecisionGate() {
    const button = [...document.querySelectorAll('button')].find(isDecisionGateButton);
    if (!button) return;

    button.classList.add(FAB_CLASS);
    if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', 'Decision Gate');
    if (!button.getAttribute('title')) button.setAttribute('title', 'Decision Gate');
  }

  function patchVisibleVersion() {
    for (const element of document.querySelectorAll('p, span, small, div, strong')) {
      if (element.children.length) continue;
      const text = String(element.textContent || '').trim();
      if (/^Λογιστική ακρίβεια\s*·\s*v\d+\.\d+\.\d+$/i.test(text)) {
        element.textContent = `Λογιστική ακρίβεια · v${VERSION}`;
      }
    }

    document.querySelectorAll('.details-list div').forEach(row => {
      const label = row.querySelector('dt');
      const value = row.querySelector('dd');
      if (label?.textContent.trim() === 'Έκδοση' && value) value.textContent = VERSION;
    });
  }

  function patch() {
    patchQueued = false;
    patchDecisionGate();
    patchVisibleVersion();
  }

  function queuePatch() {
    if (patchQueued) return;
    patchQueued = true;
    requestAnimationFrame(patch);
  }

  function start() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .${FAB_CLASS} {
          right: max(14px, calc((100vw - 820px) / 2 + 14px)) !important;
          bottom: calc(92px + env(safe-area-inset-bottom)) !important;
          width: 56px !important;
          height: 56px !important;
          min-width: 56px !important;
          min-height: 56px !important;
          border-radius: 50% !important;
          z-index: 60 !important;
        }

        @media (max-width: 540px) {
          .${FAB_CLASS} {
            right: 14px !important;
            bottom: calc(92px + env(safe-area-inset-bottom)) !important;
          }
        }
      `;
      document.head.appendChild(style);
    }

    patch();
    new MutationObserver(queuePatch).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', queuePatch, { passive: true });
    window.addEventListener('orientationchange', queuePatch, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
