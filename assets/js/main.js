/* ==========================================================================
   Mevlüt Çelik — main.js
   No dependencies. Every module follows the same shape: a named init()
   function that queries its own nodes, bails out if they are missing, and
   binds its own listeners. All modules are started once from boot().
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------- Nav menu ------------------------------ */
  function initNav() {
    var nav = document.getElementById("nav");
    var toggle = document.getElementById("nav-toggle");
    var menu = document.getElementById("nav-menu");
    if (!nav || !toggle || !menu) return;

    function setOpen(open) {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    toggle.addEventListener("click", function () {
      setOpen(!nav.classList.contains("is-open"));
    });

    menu.addEventListener("click", function (event) {
      if (event.target.closest(".nav__link")) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setOpen(false);
    });
  }

  /* ----------------------------- Nav pinning ----------------------------- */
  function initNavPin() {
    var nav = document.getElementById("nav");
    var hero = document.getElementById("hero");
    if (!nav || !hero) return;

    function update() {
      nav.classList.toggle("is-pinned", window.scrollY > hero.offsetHeight - 80);
    }

    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  /* ---------------------------- Active section --------------------------- */
  function initActiveLink() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".nav__link"));
    if (!links.length || !("IntersectionObserver" in window)) return;

    var sections = links
      .map(function (link) { return document.querySelector(link.getAttribute("href")); })
      .filter(Boolean);

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (link) {
          link.classList.toggle(
            "is-active",
            link.getAttribute("href") === "#" + entry.target.id
          );
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });

    sections.forEach(function (section) { observer.observe(section); });
  }

  /* ------------------------------- Reveal -------------------------------- */
  function initReveal() {
    var targets = Array.prototype.slice.call(
      document.querySelectorAll(".band__inner > *, .entry")
    );
    if (!targets.length) return;

    if (!("IntersectionObserver" in window)) return;

    targets.forEach(function (node) { node.classList.add("reveal"); });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -10% 0px" });

    targets.forEach(function (node) { observer.observe(node); });
  }

  /* -------------------------------- Year --------------------------------- */
  function initYear() {
    var node = document.getElementById("year");
    if (!node) return;
    node.textContent = String(new Date().getFullYear());
  }

  /* -------------------------------- Boot --------------------------------- */
  function boot() {
    initNav();
    initNavPin();
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
