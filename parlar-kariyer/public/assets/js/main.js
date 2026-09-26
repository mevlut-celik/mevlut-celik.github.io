/* ==========================================================================
   ODTÜ Parlar Vakfı · Kariyer — main.js
   Same shape in every project on this site: helpers, then one initX()
   per feature (query its own nodes, bail out if they are missing, bind its
   own listeners), then a single boot().

   The form still posts natively to submit.php (which validates again on
   the server and redirects to success.html); this file only adds checks
   that save the applicant a round trip, plus a sending state.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------- Helpers ------------------------------- */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  var MAX_CV_BYTES = 10 * 1024 * 1024;             // mirrors submit.php
  var CV_EXTENSIONS = [".pdf", ".doc", ".docx"];   // mirrors submit.php

  function fieldOf(input) { return input.closest(".field") || input.closest(".consent"); }

  function setError(input, message) {
    var field = fieldOf(input);
    if (!field) return;
    var slot = $(".field__error", field);
    field.classList.toggle("field--invalid", Boolean(message));
    if (slot) {
      slot.textContent = message || "";
      slot.hidden = !message;
    }
  }

  /* ------------------------------ CV picker ------------------------------ */
  function initUpload() {
    var input = $("#cv");
    var name = $("#cv-name");
    if (!input || !name) return;

    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      name.textContent = file
        ? file.name + " · " + (file.size / 1024 / 1024).toFixed(1) + " MB"
        : "Dosya seçmek için tıklayın veya sürükleyin";
      setError(input, file ? checkCv(file) : "");
    });
  }

  function checkCv(file) {
    var lower = file.name.toLowerCase();
    var okType = CV_EXTENSIONS.some(function (ext) { return lower.slice(-ext.length) === ext; });
    if (!okType) return "Yalnızca PDF, DOC veya DOCX yükleyebilirsiniz.";
    if (file.size > MAX_CV_BYTES) return "Dosya 10 MB'tan büyük olamaz.";
    return "";
  }

  /* ---------------------------- Apply form ------------------------------- */
  function initApplyForm() {
    var form = $("#applicationForm");
    var button = $("#submitBtn");
    if (!form || !button) return;

    // Without JS the browser's own validation still applies; with JS we
    // show inline messages instead of the native bubbles.
    form.noValidate = true;

    // Clear a field's error as soon as it is corrected
    $$("[required]", form).forEach(function (input) {
      input.addEventListener("input", function () {
        if (input.type !== "file" && input.checkValidity()) setError(input, "");
      });
      input.addEventListener("change", function () {
        if (input.type === "checkbox" && input.checked) setError(input, "");
      });
    });

    form.addEventListener("submit", function (event) {
      var firstInvalid = null;

      $$("[required]", form).forEach(function (input) {
        var message = "";
        if (input.type === "file") {
          var file = input.files && input.files[0];
          message = file ? checkCv(file) : "Lütfen CV dosyanızı yükleyin.";
        } else if (input.type === "checkbox") {
          message = input.checked ? "" : "Başvuru için KVKK onayı gereklidir.";
        } else if (!input.checkValidity()) {
          message = input.validity.valueMissing ? "Bu alan zorunludur." : "Lütfen geçerli bir değer girin.";
        }
        setError(input, message);
        if (message && !firstInvalid) firstInvalid = input;
      });

      if (firstInvalid) {
        event.preventDefault();
        firstInvalid.focus();
        return;
      }

      button.disabled = true;
      button.textContent = "Gönderiliyor…";
    });

    // Coming back with the browser's back button must not leave it disabled
    window.addEventListener("pageshow", function () {
      button.disabled = false;
      button.textContent = "Başvuruyu Gönder";
    });
  }

  /* -------------------------------- Year --------------------------------- */
  function initYear() {
    $$("[data-year]").forEach(function (node) {
      node.textContent = String(new Date().getFullYear());
    });
  }

  /* -------------------------------- Boot --------------------------------- */
  function boot() {
    initUpload();
    initApplyForm();
    initYear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
