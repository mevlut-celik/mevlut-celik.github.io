/* ==========================================================================
   Mevlüt Çelik — main.js
   Same shape in every project on this site: helpers, then one initX()
   per feature (query its own nodes, bail out if they are missing, bind its
   own listeners), then a single boot().
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------- Helpers ------------------------------- */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  /* -------------------------------- Year --------------------------------- */
  function initYear() {
    $$("[data-year]").forEach(function (node) {
      node.textContent = String(new Date().getFullYear());
    });
  }

  /* -------------------------------- Boot --------------------------------- */
  function boot() {
    initYear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
