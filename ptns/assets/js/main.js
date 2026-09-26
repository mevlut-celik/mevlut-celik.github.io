/* ==========================================================================
   PTNS · ODTÜ araştırma anketi — main.js
   Same shape in every project on this site: helpers, then one initX()
   per feature (query its own nodes, bail out if they are missing, bind its
   own listeners), then a single boot(). One file serves every page.

   Flow:  index.html (onam) → form.html (katılımcı bilgileri)
          → survey.html (senaryo) → tesekkur.html
   Between pages the answers travel in localStorage under the same keys
   and shapes as the previous version, and the final payload sent to the
   Apps Script is unchanged, so new rows line up with the existing sheet.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------- Helpers ------------------------------- */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (error) { return null; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { return false; }
  }

  function forget(key) {
    try { localStorage.removeItem(key); } catch (error) { /* ignore */ }
  }

  function setError(input, message) {
    var field = input.closest(".field");
    if (!field) return;
    var slot = $(".field__error", field);
    field.classList.toggle("field--invalid", Boolean(message));
    if (slot) {
      slot.textContent = message || "";
      slot.hidden = !message;
    }
  }

  function onlyDigits(input, maxLength) {
    input.addEventListener("input", function () {
      var clean = input.value.replace(/[^0-9]/g, "").slice(0, maxLength);
      if (clean !== input.value) input.value = clean;
    });
  }

  function inRange(value, min, max) {
    if (!/^\d+$/.test(value)) return false;
    var number = Number(value);
    return number >= min && number <= max;
  }

  /* -------------------------------- Config ------------------------------- */
  var KEYS = { volunteer: "volunteerInfo", participant: "form1Data" };

  // Same deployments as before: one receives answers, one serves the admin view
  var SUBMIT_URL = "https://script.google.com/macros/s/AKfycbymB8ADdqBwKkUCOm4F_lq9URs1NogGNgG6MhA3Js5OCc_YwkGo9GxH-Un5CGHF6MG83A/exec";
  var ADMIN_URL  = "https://script.google.com/macros/s/AKfycbw73H-j1IqNx75_qCjSIWuyP3sj760Uwl6NPMk7BqAhmgM-aTLIZGvJQB9U3Wa2dolyQA/exec";

  // Column order written by Code.gs → doPost (one row per selected line)
  var COLUMNS = [
    "Tarih", "Yaş", "Cinsiyet", "İl", "İlçe", "Eğitim Düzeyi", "Lisansüstü",
    "Fakülte", "Deneyim (yıl)", "Deneyim (ay)", "Okul Türü", "Sınıf Düzeyleri",
    "Hizmet İçi Eğitim", "Seçilen Cümle", "Açıklama", "Yapılacaklar",
    "Görüşme Gönüllüsü", "İletişim E-postası"
  ];
  var LONG_COLUMNS = [12, 13, 14, 15];

  /* --------------------------- Step 1 · Onam ----------------------------- */
  function initConsent() {
    var form = $("#consent-form");
    if (!form) return;

    var agree = $("#consentCheck");
    var proceed = $("#proceedButton");
    var emailField = $("#emailField");
    var email = $("#contactEmail");

    function syncEmail() {
      var yes = $("#volunteerYes").checked;
      emailField.hidden = !yes;
      if (!yes) { email.value = ""; setError(email, ""); }
    }

    agree.addEventListener("change", function () { proceed.disabled = !agree.checked; });
    $$("input[name='volunteer']", form).forEach(function (radio) {
      radio.addEventListener("change", syncEmail);
    });

    // Restore an earlier answer if the participant came back
    var saved = readJSON(KEYS.volunteer);
    if (saved && saved.isVolunteer === "Evet") {
      $("#volunteerYes").checked = true;
      email.value = saved.email || "";
    } else if (saved && saved.isVolunteer === "Hayır") {
      $("#volunteerNo").checked = true;
    }
    syncEmail();
    proceed.disabled = !agree.checked;

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!agree.checked) return;

      var yes = $("#volunteerYes").checked;
      if (yes && !email.checkValidity() || yes && !email.value.trim()) {
        setError(email, "Görüşme için geçerli bir e-posta adresi giriniz.");
        email.focus();
        return;
      }

      writeJSON(KEYS.volunteer, {
        isVolunteer: yes ? "Evet" : "Hayır",
        email: yes ? email.value.trim() : ""
      });
      window.location.href = "form.html";
    });
  }

  /* ----------------------- Step 2 · Katılımcı bilgileri ------------------ */
  function initParticipantForm() {
    var form = $("#volunteerForm");
    if (!form) return;

    var city = $("#city");
    var district = $("#district");
    var districts = window.PTNS_DISTRICTS || {};

    function fillDistricts(selected) {
      district.textContent = "";
      var first = el("option", null, "İlçe seçiniz");
      first.value = "";
      district.appendChild(first);
      (districts[city.value] || []).forEach(function (name) {
        var option = el("option", null, name);
        option.value = name;
        district.appendChild(option);
      });
      district.value = selected || "";
    }

    city.addEventListener("change", function () { fillDistricts(""); });

    onlyDigits($("#age"), 2);
    onlyDigits($("#experienceYears"), 2);
    onlyDigits($("#experienceMonths"), 2);

    // Restore earlier answers when the participant navigates back
    var saved = readJSON(KEYS.participant);
    if (saved) {
      ["age", "gender", "city", "educationLevel", "graduateEducation", "department",
       "experienceYears", "experienceMonths", "schoolType", "trainingExperience"].forEach(function (id) {
        if (saved[id] != null && $("#" + id)) $("#" + id).value = saved[id];
      });
      fillDistricts(saved.district);
      String(saved.classLevels || "").split(", ").forEach(function (grade) {
        var box = $("input[name='classLevels[]'][value='" + grade + "']", form);
        if (box) box.checked = true;
      });
    }

    var rules = [
      ["#age", function (v) { return inRange(v, 20, 65) ? "" : "20 ile 65 arasında bir yaş giriniz."; }],
      ["#gender", function (v) { return v ? "" : "Lütfen bir seçim yapınız."; }],
      ["#city", function (v) { return v ? "" : "Lütfen il seçiniz."; }],
      ["#educationLevel", function (v) { return v ? "" : "Lütfen bir seçim yapınız."; }],
      ["#experienceYears", function (v) { return inRange(v, 0, 45) ? "" : "0 ile 45 arasında bir değer giriniz."; }],
      ["#experienceMonths", function (v) { return inRange(v, 0, 11) ? "" : "0 ile 11 arasında bir değer giriniz."; }],
      ["#schoolType", function (v) { return v ? "" : "Lütfen bir seçim yapınız."; }]
    ];

    rules.forEach(function (rule) {
      var input = $(rule[0]);
      input.addEventListener("change", function () { if (!rule[1](input.value)) setError(input, ""); });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var firstInvalid = null;
      rules.forEach(function (rule) {
        var input = $(rule[0]);
        var message = rule[1](input.value.trim());
        setError(input, message);
        if (message && !firstInvalid) firstInvalid = input;
      });

      if (firstInvalid) {
        $("#form-error").hidden = false;
        firstInvalid.focus();
        firstInvalid.scrollIntoView({ block: "center" });
        return;
      }

      // Same keys, same order, same value formats as the previous version
      var data = {
        timestamp: new Date().toLocaleString("tr-TR"),
        age: $("#age").value,
        gender: $("#gender").value,
        city: city.value,
        district: district.value,
        educationLevel: $("#educationLevel").value,
        graduateEducation: $("#graduateEducation").value,
        department: $("#department").value,
        experienceYears: $("#experienceYears").value,
        experienceMonths: $("#experienceMonths").value,
        schoolType: $("#schoolType").value,
        classLevels: $$("input[name='classLevels[]']:checked", form).map(function (box) { return box.value; }).join(", "),
        trainingExperience: $("#trainingExperience").value
      };

      writeJSON(KEYS.participant, data);
      window.location.href = "survey.html";
    });
  }

  /* --------------------------- Step 3 · Senaryo -------------------------- */
  function initSurvey() {
    var transcript = $("#transcript");
    if (!transcript) return;

    var selectStep = $("#select-step");
    var detailStep = $("#detail-step");
    var details = $("#details");
    var count = $("#tally-count");
    var toDetails = $("#to-details");
    var drafts = {};   // explanation / actions typed so far, by line index

    if (!readJSON(KEYS.participant)) $("#missing-profile").hidden = false;

    // Keep each line's exact original text before decorating it: that string
    // is what gets stored in the sheet and must match earlier responses.
    var lines = $$(".line", transcript);
    lines.forEach(function (line, index) {
      var text = line.getAttribute("data-text");
      var match = text.match(/^(Öğretmen|Öğrenci \d+):\s*/);
      var who = el("span", "line__who", match ? match[1] : "");
      var body = el("span", "line__text", match ? text.slice(match[0].length) : text);
      line.textContent = "";
      line.appendChild(who);
      line.appendChild(body);
      if (match && match[1] === "Öğretmen") line.classList.add("line--teacher");

      if (!line.hasAttribute("data-pick")) {
        line.classList.add("line--fixed");
        return;
      }
      line.classList.add("line--pick");
      line.setAttribute("role", "button");
      line.setAttribute("tabindex", "0");
      line.setAttribute("aria-pressed", "false");
      line.setAttribute("data-index", String(index));
      line.appendChild(el("span", "line__box"));
    });

    var pickable = $$(".line--pick", transcript);

    function selected() {
      return pickable.filter(function (line) { return line.getAttribute("aria-pressed") === "true"; });
    }

    function updateTally() {
      var n = selected().length;
      count.textContent = n ? n + " ifade seçildi" : "Henüz seçim yapılmadı";
      toDetails.disabled = n === 0;
    }

    function toggle(line) {
      var on = line.getAttribute("aria-pressed") !== "true";
      line.setAttribute("aria-pressed", on ? "true" : "false");
      updateTally();
    }

    transcript.addEventListener("click", function (event) {
      var line = event.target.closest(".line--pick");
      if (line) toggle(line);
    });
    transcript.addEventListener("keydown", function (event) {
      var line = event.target.closest(".line--pick");
      if (line && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        toggle(line);
      }
    });
    updateTally();

    function rememberDrafts() {
      $$(".detail", details).forEach(function (block) {
        drafts[block.getAttribute("data-index")] = {
          explanation: $("textarea[name^='explanation']", block).value,
          actions: $("textarea[name^='actions']", block).value
        };
      });
    }

    function textarea(name, value) {
      var node = el("textarea", "input");
      node.name = name;
      node.rows = 4;
      node.required = true;
      node.value = value || "";
      return node;
    }

    toDetails.addEventListener("click", function () {
      var picks = selected();
      if (!picks.length) return;

      details.textContent = "";
      picks.forEach(function (line, n) {
        var index = line.getAttribute("data-index");
        var draft = drafts[index] || {};
        var block = el("section", "detail");
        block.setAttribute("data-index", index);
        block.setAttribute("data-text", line.getAttribute("data-text"));

        block.appendChild(el("h3", "display display--sm", "Seçim " + (n + 1)));
        block.appendChild(el("p", "detail__quote", line.getAttribute("data-text")));

        var f1 = el("div", "field");
        var l1 = el("label", "label");
        l1.appendChild(el("span", "term", "Açıklama"));
        l1.htmlFor = "explanation" + n;
        var t1 = textarea("explanation" + n, draft.explanation);
        t1.id = "explanation" + n;
        f1.appendChild(l1); f1.appendChild(t1); f1.appendChild(el("p", "field__error"));
        f1.lastChild.hidden = true;

        var f2 = el("div", "field");
        var l2 = el("label", "label");
        l2.appendChild(el("span", "term", "Yapılacaklar"));
        l2.htmlFor = "actions" + n;
        var t2 = textarea("actions" + n, draft.actions);
        t2.id = "actions" + n;
        f2.appendChild(l2); f2.appendChild(t2); f2.appendChild(el("p", "field__error"));
        f2.lastChild.hidden = true;

        block.appendChild(f1);
        block.appendChild(f2);
        details.appendChild(block);
      });

      selectStep.hidden = true;
      detailStep.hidden = false;
      window.scrollTo(0, 0);
    });

    $("#back-to-select").addEventListener("click", function () {
      rememberDrafts();
      detailStep.hidden = true;
      selectStep.hidden = false;
      window.scrollTo(0, 0);
    });

    $("#detailsForm").addEventListener("submit", function (event) {
      event.preventDefault();

      var firstEmpty = null;
      $$("textarea", details).forEach(function (area) {
        var message = area.value.trim() ? "" : "Bu alan zorunludur.";
        setError(area, message);
        if (message && !firstEmpty) firstEmpty = area;
      });
      if (firstEmpty) { firstEmpty.focus(); return; }

      var participant = readJSON(KEYS.participant) || {};
      var volunteer = readJSON(KEYS.volunteer) || {};
      var selections = $$(".detail", details).map(function (block) {
        return {
          sentence: block.getAttribute("data-text"),
          explanation: $("textarea[name^='explanation']", block).value,
          actions: $("textarea[name^='actions']", block).value
        };
      });

      var payload = Object.assign({}, participant, {
        isVolunteer: volunteer.isVolunteer || "",
        contactEmail: volunteer.email || "",
        selections: selections
      });

      var submit = $("#send-button");
      var status = $("#send-status");
      submit.disabled = true;
      submit.textContent = "Gönderiliyor…";
      status.hidden = true;

      // Apps Script does not send CORS headers, so the response is opaque:
      // a resolved fetch means the request left the browser.
      fetch(SUBMIT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function () {
          forget(KEYS.participant);
          forget(KEYS.volunteer);
          window.location.href = "tesekkur.html";
        })
        .catch(function () {
          submit.disabled = false;
          submit.textContent = "Yanıtları gönder";
          status.hidden = false;
        });
    });
  }

  /* -------------------------------- Admin -------------------------------- */
  function initAdmin() {
    var body = $("#responsesTableBody");
    if (!body) return;

    var head = $("#responsesTableHead");
    var search = $("#admin-search");
    var status = $("#admin-status");
    var rows = [];

    var tr = el("tr");
    COLUMNS.forEach(function (name) { tr.appendChild(el("th", null, name)); });
    head.appendChild(tr);

    function formatCell(value, column) {
      if (value == null) return "";
      var text = String(value);
      if (column === 0 && /^\d{4}-\d{2}-\d{2}T/.test(text)) {
        return new Date(text).toLocaleString("tr-TR");
      }
      return text;
    }

    function render() {
      var term = search.value.trim().toLocaleLowerCase("tr-TR");
      var visible = rows.filter(function (row) {
        return !term || row.join(" ").toLocaleLowerCase("tr-TR").indexOf(term) !== -1;
      });

      body.textContent = "";
      visible.forEach(function (row) {
        var line = el("tr");
        COLUMNS.forEach(function (_, column) {
          var cell = el("td", LONG_COLUMNS.indexOf(column) !== -1 ? "is-long" : null, row[column]);
          line.appendChild(cell);
        });
        body.appendChild(line);
      });

      $("#stat-rows").textContent = String(rows.length);
      var people = {};
      var volunteers = {};
      rows.forEach(function (row) {
        var id = row[0] + "|" + row[1] + "|" + row[3];
        people[id] = true;
        if (row[16] === "Evet") volunteers[id] = true;
      });
      $("#stat-people").textContent = String(Object.keys(people).length);
      $("#stat-volunteers").textContent = String(Object.keys(volunteers).length);
      $("#admin-count").textContent = visible.length + " / " + rows.length + " satır";
      return visible;
    }

    function load() {
      status.hidden = false;
      status.className = "notice";
      status.textContent = "Yanıtlar yükleniyor…";

      fetch(ADMIN_URL + "?action=getResponses")
        .then(function (response) { return response.json(); })
        .then(function (data) {
          rows = (Array.isArray(data) ? data : []).map(function (row) {
            return COLUMNS.map(function (_, column) { return formatCell(row[column], column); });
          });
          // Drop a header row if the sheet has one (real rows always carry an age)
          if (rows.length && !/^\d+$/.test(rows[0][1])) rows.shift();
          render();
          status.hidden = true;
        })
        .catch(function () {
          status.className = "notice notice--error";
          status.textContent = "Yanıtlar yüklenemedi. Bağlantıyı ve Apps Script dağıtımını kontrol edin.";
        });
    }

    search.addEventListener("input", render);
    $("#admin-refresh").addEventListener("click", load);
    $("#admin-export").addEventListener("click", function () {
      if (!window.XLSX) return;
      var visible = render();
      var sheet = window.XLSX.utils.aoa_to_sheet([COLUMNS].concat(visible));
      var book = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(book, sheet, "Form Yanıtları");
      window.XLSX.writeFile(book, "form_yanitlari.xlsx");
    });

    load();
  }

  /* -------------------------------- Year --------------------------------- */
  function initYear() {
    $$("[data-year]").forEach(function (node) {
      node.textContent = String(new Date().getFullYear());
    });
  }

  /* -------------------------------- Boot --------------------------------- */
  function boot() {
    initConsent();
    initParticipantForm();
    initSurvey();
    initAdmin();
    initYear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
