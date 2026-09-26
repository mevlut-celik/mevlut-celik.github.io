/* ==========================================================================
   Büşra Nur Yüksel — main.js
   Same shape in every project on this site: helpers, then one initX()
   per feature (query its own nodes, bail out if they are missing, bind its
   own listeners), then a single boot(). One file serves every page.
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

  /* -------------------------------- Data --------------------------------- */
  // Posts written in the admin panel live in localStorage under this key.
  // Shape: { id, title, category, date, content, image }
  var STORE_KEY = "busra_posts";
  var DRAFT_KEY = "busra_draft";
  var PASSWORD = "lale";

  var CATEGORY_LABELS = {
    deneme: "Deneme",
    ilham: "İlham",
    gunluk: "Günlük",
    minimalizm: "Minimalizm"
  };

  var SEED_POSTS = [
    {
      id: "baharin-ilk-fisiltilari",
      title: "Baharın İlk Fısıltıları",
      category: "deneme",
      date: "18 Şubat 2026",
      minutes: 4,
      excerpt: "Rüzgarın yönü değiştiğinde içimizde uyanan o tarifsiz umut hissi... Doğanın sessiz ama güçlü bir şekilde yeniden doğuşunu izlemek, bize kendi hayatımızdaki döngüleri hatırlatıyor.",
      html:
        "<p>Rüzgarın yönü değiştiğinde içimizde uyanan o tarifsiz umut hissi... Doğanın sessiz ama güçlü bir şekilde yeniden doğuşunu izlemek, bize kendi hayatımızdaki döngüleri hatırlatıyor. Bazen sadece durup dinlemek gerekir.</p>" +
        "<p>Kışın o uzun ve yorucu günlerinin ardından, topraktan başını uzatan o ilk yeşillik, adeta direnişin en naif halidir. İnsan hayatı da öyledir; bazen her şeyin bittiğini sandığınız o gri günlerin ardından, en güzel yeşiller filizlenmeye başlar.</p>" +
        "<h2>Laleler Neden Özeldir?</h2>" +
        "<p>Bir lale düşünün; gösterişten uzak ama bir o kadar da göz alıcı. Gövdesi incecik olmasına rağmen, o büyük çiçeği cesaretle taşır. Hayatta böyle olmalı değil miyiz? Ne kadar fırtınalı olursa olsun günlerimiz, kendi renklerimizi sakince açmalıyız rüzgara karşı.</p>" +
        "<blockquote>Eğer bir çiçek olmayı seçebilseydim, kesinlikle bir lale olurdum. Sessiz, sakin ama nereye baksan kendini fark ettiren.</blockquote>" +
        "<p>Bu baharda kendinize bir iyilik yapın. Pencerelerinizi açın, o taze havayı içinize çekin ve doğanın o muazzam döngüsüne şahitlik edin. Göreceksiniz, içinizdeki o küçük umut tohumları da havayla temas ettikçe yeşermeye başlayacak.</p>"
    },
    {
      id: "satir-aralarinda-sakli-kalanlar",
      title: "Satır Aralarında Saklı Kalanlar",
      category: "ilham",
      date: "12 Şubat 2026",
      minutes: 5,
      excerpt: "Okuduğumuz her kitapta, altını çizdiğimiz her cümlede aslında kendimizden bir parça buluyoruz.",
      html:
        "<p>Okuduğumuz her kitapta, altını çizdiğimiz her cümlede aslında kendimizden bir parça buluyoruz. Kelimelerin gücü, zamanı ve mekanı aşarak ruhumuza dokunabilmesinde gizli. Bugün raftan rastgele bir kitap çekin ve bakın size ne fısıldayacak.</p>"
    },
    {
      id: "az-coktur-felsefesi-uzerine",
      title: "Az Çoktur Felsefesi Üzerine",
      category: "minimalizm",
      date: "05 Şubat 2026",
      minutes: 3,
      excerpt: "Fazlalıklardan arındıkça, hayatımızdaki asıl değerlerin yüzeye çıktığını fark ederiz.",
      html:
        "<p>Fazlalıklardan arındıkça, hayatımızdaki asıl değerlerin yüzeye çıktığını fark ederiz. Gerek eşyalarımızda gerekse zihnimizdeki o kalabalıktan kurtulmak, ruhsal bir detoks etkisi yaratır. Sadelik, gerçek zarafetin ta kendisidir.</p>"
    }
  ];

  function readStored() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch (error) { return []; }
  }

  function writeStored(posts) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(posts)); return true; }
    catch (error) { return false; }
  }

  function categoryLabel(value) {
    var key = String(value || "").toLowerCase();
    return CATEGORY_LABELS[key] || (key.charAt(0).toLocaleUpperCase("tr-TR") + key.slice(1));
  }

  function readMinutes(text) {
    return Math.max(1, Math.ceil(String(text || "").split(/\s+/).length / 200));
  }

  // Stored posts are plain text: blank lines split paragraphs, single
  // newlines become line breaks. Built with DOM nodes, never innerHTML.
  function renderPlainText(container, text) {
    container.textContent = "";
    String(text || "").split(/\n{2,}/).forEach(function (block) {
      var p = el("p");
      block.split("\n").forEach(function (line, index) {
        if (index) p.appendChild(document.createElement("br"));
        p.appendChild(document.createTextNode(line));
      });
      container.appendChild(p);
    });
  }

  // Newest first: stored posts (latest written on top), then the seeds.
  function allPosts() {
    var stored = readStored().slice().reverse().map(function (post) {
      return {
        id: post.id,
        title: post.title,
        category: post.category,
        date: post.date,
        minutes: readMinutes(post.content),
        excerpt: String(post.content || "").slice(0, 160) + (String(post.content || "").length > 160 ? "…" : ""),
        content: post.content,
        image: post.image || null
      };
    });
    return stored.concat(SEED_POSTS);
  }

  function findPost(id) {
    return allPosts().filter(function (post) { return post.id === id; })[0] || null;
  }

  /* ------------------------------- Nav menu ------------------------------ */
  function initNav() {
    var nav = $(".nav");
    var toggle = $(".nav__toggle");
    if (!nav || !toggle) return;

    toggle.addEventListener("click", function () {
      var open = !nav.classList.contains("is-open");
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ------------------------------- Post list ----------------------------- */
  function initPostList() {
    var list = $("#post-list");
    if (!list) return;

    var posts = allPosts();
    list.textContent = "";

    posts.forEach(function (post) {
      var url = "post.html?id=" + encodeURIComponent(post.id);
      var row = el("li", "post-row");

      var body = el("div", "post-row__body");
      var meta = el("p", "meta");
      meta.appendChild(el("span", null, post.date));
      meta.appendChild(el("span", null, post.minutes + " dk okuma"));

      var title = el("h3", "post-row__title");
      var titleLink = el("a", null, post.title);
      titleLink.href = url;
      title.appendChild(titleLink);

      body.appendChild(meta);
      body.appendChild(title);
      body.appendChild(el("p", "post-row__excerpt", post.excerpt));

      var aside = el("div", "post-row__aside");
      if (post.image) {
        var thumb = el("img", "post-row__thumb");
        thumb.src = post.image;
        thumb.alt = "";
        aside.appendChild(thumb);
      }
      aside.appendChild(el("span", "tag", categoryLabel(post.category)));
      var more = el("a", "read-more", "Devamını oku →");
      more.href = url;
      aside.appendChild(more);

      row.appendChild(body);
      row.appendChild(aside);
      list.appendChild(row);
    });

    var count = $("#post-count");
    if (count) count.textContent = posts.length + " yazı";
  }

  /* ------------------------------ Single post ---------------------------- */
  function initPost() {
    var article = $("#article");
    if (!article) return;

    var id = new URLSearchParams(window.location.search).get("id") || SEED_POSTS[0].id;
    var post = findPost(id);

    if (!post) {
      $("#post-title").textContent = "Yazı bulunamadı";
      $("#post-body").textContent = "Bu yazı kaldırılmış ya da bu tarayıcıda kayıtlı değil.";
      $("#post-meta").hidden = true;
      $("#post-category").hidden = true;
      return;
    }

    document.title = post.title + " | Büşra Nur Yüksel";
    $("#post-title").textContent = post.title;
    $("#post-category").textContent = categoryLabel(post.category);
    $("#post-date").textContent = post.date;
    $("#post-minutes").textContent = post.minutes + " dk okuma";

    var body = $("#post-body");
    if (post.html) body.innerHTML = post.html;          // authored seed content
    else renderPlainText(body, post.content);            // user-written content

    if (post.image) {
      $("#post-image").src = post.image;
      $("#post-figure").hidden = false;
    }
  }

  /* ------------------------------ Admin login ---------------------------- */
  function initAdminLogin() {
    var gate = $("#login");
    var form = $("#login-form");
    if (!gate || !form) return;

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var ok = $("#admin-password").value === PASSWORD;
      $("#login-error").hidden = ok;
      if (!ok) return;
      gate.hidden = true;
      $("#editor").hidden = false;
      $("#post-title-input").focus();
    });
  }

  /* ------------------------------ Admin editor --------------------------- */
  function initAdminEditor() {
    var form = $("#editor-form");
    if (!form) return;

    var fields = {
      title: $("#post-title-input"),
      category: $("#post-category-input"),
      date: $("#post-date-input"),
      content: $("#post-content-input"),
      image: $("#post-image-input")
    };
    var status = $("#editor-status");

    function say(message) {
      status.textContent = message;
      status.hidden = false;
    }

    fields.date.valueAsDate = new Date();

    // Restore an unfinished draft, if one was saved
    try {
      var draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (draft) {
        fields.title.value = draft.title || "";
        fields.category.value = draft.category || "ilham";
        fields.content.value = draft.content || "";
        if (draft.date) fields.date.value = draft.date;
        say("Kaydedilmiş taslağınız geri yüklendi.");
      }
    } catch (error) { /* no draft */ }

    fields.image.addEventListener("change", function () {
      var file = fields.image.files && fields.image.files[0];
      $("#dropzone-label").textContent = file ? file.name : "Görsel seçmek için tıklayın veya sürükleyin";
    });

    $("#save-draft").addEventListener("click", function () {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          title: fields.title.value,
          category: fields.category.value,
          date: fields.date.value,
          content: fields.content.value
        }));
        say("Taslak bu tarayıcıya kaydedildi.");
      } catch (error) {
        say("Taslak kaydedilemedi: tarayıcı depolaması kapalı.");
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var dateValue = fields.date.value ? new Date(fields.date.value) : new Date();
      var post = {
        id: "post_" + Date.now(),
        title: fields.title.value.trim(),
        category: fields.category.value,
        date: dateValue.toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" }),
        content: fields.content.value,
        image: null
      };

      function save() {
        var posts = readStored();
        posts.push(post);
        if (!writeStored(posts)) {
          say("Yazı kaydedilemedi. Görsel çok büyük olabilir ya da tarayıcı depolaması dolu.");
          return;
        }
        try { localStorage.removeItem(DRAFT_KEY); } catch (error) { /* ignore */ }
        window.location.href = "post.html?id=" + encodeURIComponent(post.id);
      }

      var file = fields.image.files && fields.image.files[0];
      if (!file) { save(); return; }

      var reader = new FileReader();
      reader.onload = function (loaded) {
        post.image = loaded.target.result;
        save();
      };
      reader.readAsDataURL(file);
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
    initNav();
    initPostList();
    initPost();
    initAdminLogin();
    initAdminEditor();
    initYear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
