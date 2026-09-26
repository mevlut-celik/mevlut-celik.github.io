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

  /* ------------------------------- Nav menu ------------------------------ */
  function initNav() {
    var nav = $("#nav");
    var toggle = $("#nav-toggle");
    var menu = $("#nav-menu");
    if (!nav || !toggle || !menu) return;

    function setOpen(open) {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "Close" : "Menu";
    }

    toggle.addEventListener("click", function () {
      setOpen(!nav.classList.contains("is-open"));
    });

    menu.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setOpen(false);
    });
  }

  /* ----------------------------- Ankara clock ---------------------------- */
  function initClock() {
    var nodes = $$("[data-clock]");
    if (!nodes.length || !window.Intl) return;

    var format = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Istanbul"
    });

    function tick() {
      var text = format.format(new Date());
      nodes.forEach(function (node) { node.textContent = text; });
    }

    tick();
    window.setInterval(tick, 20000);
  }

  /* ---------------------------- Active section --------------------------- */
  function initActiveLink() {
    var links = $$(".nav__link[href^='#']");
    if (!links.length || !("IntersectionObserver" in window)) return;

    var sections = links
      .map(function (link) { return $(link.getAttribute("href")); })
      .filter(Boolean);

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (link) {
          link.classList.toggle("is-active", link.getAttribute("href") === "#" + entry.target.id);
        });
      });
    }, { rootMargin: "-40% 0px -55% 0px" });

    sections.forEach(function (section) { observer.observe(section); });
  }

  /* ------------------------------- Reveal -------------------------------- */
  function initReveal() {
    var targets = $$("[data-reveal]");
    if (!targets.length || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    targets.forEach(function (node) { node.classList.add("reveal"); });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });

    targets.forEach(function (node) { observer.observe(node); });
  }

  /* -------------------------------- Year --------------------------------- */
  function initYear() {
    $$("[data-year]").forEach(function (node) {
      node.textContent = String(new Date().getFullYear());
    });
  }

  /* -------------------------------- Boot --------------------------------- */
  function boot() {
    initNav();
    initClock();
    initActiveLink();
    initReveal();
    initYear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
