/* ==========================================================================
   FRESHDATA S/N Üreteci — main.js
   Same shape in every project on this site: helpers, then one initX()
   per feature (query its own nodes, bail out if they are missing, bind its
   own listeners), then a single boot().

   The S/N model is a port of freshdata_sn_gui.py (downloads/): the same
   normalisation, the same error messages, Crockford Base32 padded to 13
   characters, RLY- or EXT- in front.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------- Helpers ------------------------------- */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  /* ------------------------------- S/N model ----------------------------- */
  var CROCKFORD32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var PREFIX = { Relay: "RLY", Extender: "EXT" };
  var EXAMPLE = "00:16:C0:01:F0:08:60:69";

  function stripSeparators(value) {
    return value.replace(/[:\-\s]/g, "").toUpperCase();
  }

  function normalizeDevEui(value) {
    var hex = stripSeparators(value);
    if (hex.length !== 16) throw new Error("DevEUI 16 hexadecimal karakter olmalı.");
    if (!/^[0-9A-F]+$/.test(hex)) throw new Error("DevEUI yalnızca 0-9 ve A-F karakterlerinden oluşmalı.");
    return hex;
  }

  // 64 bits never need more than 13 Base32 digits (13 × 5 = 65), so writing
  // the number as 65 bits and reading it back five at a time gives exactly
  // the Python divmod loop followed by rjust(13, "0") — without BigInt.
  function toCrockford32(hex) {
    var bits = "0";
    for (var i = 0; i < hex.length; i++) {
      bits += ("000" + parseInt(hex.charAt(i), 16).toString(2)).slice(-4);
    }
    var encoded = "";
    for (var j = 0; j < bits.length; j += 5) {
      encoded += CROCKFORD32.charAt(parseInt(bits.substr(j, 5), 2));
    }
    return encoded;
  }

  function devEuiToSn(value, product) {
    return PREFIX[product] + "-" + toCrockford32(normalizeDevEui(value));
  }

  function groupHex(hex) {
    return hex.match(/../g).join(":");
  }

  /* ------------------------------- Generator ----------------------------- */
  function initGenerator() {
    var form = $("#sn-form");
    if (!form) return;

    var input = $("#deveui");
    var count = $("#deveui-count");
    var error = $("#deveui-error");
    var label = $("#label");
    var output = $("#sn");
    var labelProduct = $("#label-product");
    var labelDevEui = $("#label-deveui");
    var status = $("#status");
    var copyButton = $("[data-copy]");
    var stepsSource = $("#steps-source");
    var steps = {};
    $$("[data-step]").forEach(function (node) { steps[node.getAttribute("data-step")] = node; });

    var current = "";
    var copyTimer = null;

    function product() {
      var checked = $("input[name='product']:checked", form);
      return checked ? checked.value : "Relay";
    }

    function setStatus(text, tone) {
      status.textContent = text;
      status.classList.toggle("is-ok", tone === "ok");
      status.classList.toggle("is-warn", tone === "warn");
    }

    function setError(text) {
      error.textContent = text;
      error.hidden = !text;
      if (text) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }

    function renderSteps(hex, isOwn) {
      steps.hex.textContent = hex;
      steps.base32.textContent = toCrockford32(hex);
      steps.sn.textContent = PREFIX[product()] + "-" + toCrockford32(hex);
      stepsSource.textContent = (isOwn ? "Girilen DevEUI: " : "Örnek DevEUI: ") + groupHex(hex);
    }

    // Redraw the label and the steps from whatever is in the field right now
    function render() {
      var hex = stripSeparators(input.value);
      var valid = /^[0-9A-F]{16}$/.test(hex);
      var prefix = PREFIX[product()];

      count.textContent = Math.min(hex.length, 99) + " / 16";
      count.classList.toggle("is-ok", valid);
      count.classList.toggle("is-bad", hex.length > 16 || /[^0-9A-F]/.test(hex));

      labelProduct.textContent = product().toUpperCase();
      current = valid ? devEuiToSn(hex, product()) : "";
      output.textContent = current || prefix + "-·············";
      output.classList.toggle("is-empty", !valid);
      labelDevEui.textContent = valid ? groupHex(hex) : "—";
      copyButton.disabled = !valid;

      renderSteps(valid ? hex : stripSeparators(EXAMPLE), valid);
    }

    function stamp() {
      label.classList.remove("is-fresh");
      void label.offsetWidth;          // restart the animation
      label.classList.add("is-fresh");
    }

    function generate() {
      try {
        devEuiToSn(input.value, product());
        setError("");
        render();
        setStatus("S/N oluşturuldu.", "ok");
        stamp();
      } catch (err) {
        setError(err.message);
        setStatus("");
        input.focus();
      }
    }

    function copied() {
      setStatus("S/N panoya kopyalandı.", "ok");
      copyButton.textContent = "Kopyalandı ✓";
      copyButton.classList.add("is-done");
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(function () {
        copyButton.textContent = "Kopyala";
        copyButton.classList.remove("is-done");
      }, 1600);
    }

    // Older browsers and plain-http pages have no async clipboard
    function copyFallback() {
      var area = document.createElement("textarea");
      area.value = current;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(area);
      if (ok) copied();
      else setStatus("Kopyalanamadı; S/N'yi seçip elle kopyalayın.", "warn");
    }

    function copy() {
      if (!current) {
        setStatus("Önce bir seri numarası oluşturun.", "warn");
        return;
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(current).then(copied, copyFallback);
      } else {
        copyFallback();
      }
    }

    function clear() {
      input.value = "";
      setError("");
      setStatus("");
      render();
      input.focus();
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      generate();
    });

    input.addEventListener("input", function () {
      setError("");
      setStatus("");
      render();
    });

    $$("input[name='product']", form).forEach(function (radio) {
      radio.addEventListener("change", function () {
        render();
        if (current) stamp();
      });
    });

    $("[data-example]").addEventListener("click", function () {
      input.value = EXAMPLE;
      generate();
    });

    $("[data-clear]").addEventListener("click", clear);
    copyButton.addEventListener("click", copy);

    render();
    if (window.matchMedia("(pointer: fine)").matches) input.focus();
  }

  /* -------------------------------- Boot --------------------------------- */
  function boot() {
    initGenerator();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
