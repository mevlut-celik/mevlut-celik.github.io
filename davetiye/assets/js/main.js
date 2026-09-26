/* ==========================================================================
   Büşra Nur & Mevlüt — main.js
   Same shape in every project on this site: helpers, then one initX()
   per feature (query its own nodes, bail out if they are missing, bind its
   own listeners), then a single boot().
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------- Helpers ------------------------------- */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  /* ------------------------------ Countdowns ----------------------------- */
  // Each [data-countdown] holds the event start (ISO, +03:00) and two
  // sentences: one shown while the event is under way, one once it is over.
  var LIVE_WINDOW = 12 * 60 * 60 * 1000;   // an event "is happening" for 12h

  function initCountdowns() {
    var boxes = $$("[data-countdown]");
    if (!boxes.length) return;

    function render(box) {
      var start = new Date(box.getAttribute("data-countdown")).getTime();
      var diff = start - Date.now();

      if (diff <= 0) {
        var text = -diff < LIVE_WINDOW
          ? box.getAttribute("data-live")
          : box.getAttribute("data-done");
        if (box.getAttribute("data-state") !== text) {
          box.setAttribute("data-state", text);
          box.innerHTML = "";
          var p = document.createElement("p");
          p.className = "countdown__done";
          p.textContent = text;
          box.appendChild(p);
        }
        return false;
      }

      var parts = {
        days: Math.floor(diff / 86400000),
        hours: Math.floor(diff / 3600000) % 24,
        minutes: Math.floor(diff / 60000) % 60,
        seconds: Math.floor(diff / 1000) % 60
      };
      Object.keys(parts).forEach(function (key) {
        var node = $("[data-unit='" + key + "']", box);
        if (node) node.textContent = String(parts[key]);
      });
      return true;
    }

    function tick() {
      var running = boxes.map(render).some(Boolean);
      if (running) window.setTimeout(tick, 1000);
    }

    tick();
  }

  /* -------------------------------- Boot --------------------------------- */
  function boot() {
    initCountdowns();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
