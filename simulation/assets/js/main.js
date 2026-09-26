/* ==========================================================================
   Manyetik Kuvvet Simülasyonu — main.js
   Same shape in every project on this site: helpers, then one initX()
   per feature (query its own nodes, bail out if they are missing, bind its
   own listeners), then a single boot().

   Physics: a straight conductor of length L carrying current I sits in a
   uniform field B that points to the right. The wire makes angle θ with B,
   so the force is  F = I · L · B · sin θ  and points perpendicular to both
   the wire and the field — here, into the page (⊗).
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------- Helpers ------------------------------- */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function round(value, step) { return Math.round(value / step) * step; }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* -------------------------------- State -------------------------------- */
  var PARAMS = {
    angle:   { min: 0,   max: 90, step: 1,   value: 90,  unit: "°", digits: 0 },
    current: { min: 0.1, max: 10, step: 0.1, value: 1,   unit: "A", digits: 1 },
    field:   { min: 0.1, max: 2,  step: 0.1, value: 0.5, unit: "T", digits: 1 },
    length:  { min: 0.1, max: 5,  step: 0.1, value: 1,   unit: "m", digits: 1 }
  };
  var STORE_KEY = "manyetik_olcumler";
  var listeners = [];

  function value(name) { return PARAMS[name].value; }
  function sinTheta() { return Math.sin(value("angle") * Math.PI / 180); }
  function force() { return value("current") * value("length") * value("field") * sinTheta(); }

  function setParam(name, next) {
    var p = PARAMS[name];
    var decimals = p.digits;
    p.value = Number(clamp(round(next, p.step), p.min, p.max).toFixed(decimals));
    listeners.forEach(function (fn) { fn(name); });
  }

  function onChange(fn) { listeners.push(fn); }

  /* ------------------------------- Controls ------------------------------ */
  function initControls() {
    var panel = $("#controls");
    if (!panel) return;

    Object.keys(PARAMS).forEach(function (name) {
      var input = $("#" + name);
      var p = PARAMS[name];
      input.min = p.min;
      input.max = p.max;
      input.step = p.step;
      input.value = p.value;
      input.addEventListener("input", function () { setParam(name, Number(input.value)); });
    });

    function sync() {
      Object.keys(PARAMS).forEach(function (name) {
        var p = PARAMS[name];
        var input = $("#" + name);
        if (Number(input.value) !== p.value) input.value = p.value;
        $("#" + name + "-val").textContent = p.value.toFixed(p.digits) + " " + p.unit;
      });
      $("#force-val").textContent = force().toFixed(2) + " N";
      $("#sin-val").textContent = "sin θ = " + sinTheta().toFixed(3);
    }

    onChange(sync);
    sync();
  }

  /* -------------------------------- Stage -------------------------------- */
  function initStage() {
    var canvas = $("#simulation");
    if (!canvas) return;

    var ctx = canvas.getContext("2d");
    var W = 1000, H = 500, CX = W / 2, CY = H / 2, PX_PER_M = 80;
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var colors = {};
    var phase = 0;
    var dragging = false;

    function readColors() {
      colors = {
        field: cssVar("--accent"),
        force: cssVar("--force"),
        current: cssVar("--current"),
        wire: cssVar("--wire"),
        ink: cssVar("--ink"),
        mute: cssVar("--ink-mute")
      };
    }

    function resize() {
      var dpr = window.devicePixelRatio || 1;
      var width = canvas.clientWidth;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(width / 2 * dpr);
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
      draw();
    }

    function wireGeometry() {
      var theta = value("angle") * Math.PI / 180;
      var half = Math.max(24, value("length") * PX_PER_M) / 2;
      var dx = Math.cos(theta), dy = -Math.sin(theta);
      return {
        theta: theta, half: half, dx: dx, dy: dy,
        x1: CX - dx * half, y1: CY - dy * half,
        x2: CX + dx * half, y2: CY + dy * half
      };
    }

    function arrow(x1, y1, x2, y2, color, width, head) {
      var angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
      ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
      ctx.closePath();
      ctx.fill();
    }

    function drawField() {
      var strength = value("field") / PARAMS.field.max;
      ctx.globalAlpha = 0.18 + strength * 0.5;
      for (var y = 50; y < H; y += 50) {
        for (var x = 30; x < W; x += 120) {
          arrow(x, y, x + 70, y, colors.field, 1.2 + strength * 1.6, 9);
        }
      }
      ctx.globalAlpha = 1;
      ctx.font = "600 18px 'JetBrains Mono', monospace";
      ctx.fillStyle = colors.field;
      ctx.fillText("B →  " + value("field").toFixed(1) + " T", 24, 32);
    }

    function drawAngle(g) {
      if (value("angle") === 0) return;
      ctx.strokeStyle = colors.mute;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.lineTo(CX + 150, CY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(CX, CY, 70, 0, -g.theta, true);
      ctx.stroke();
      var mid = -g.theta / 2;
      ctx.font = "600 16px 'JetBrains Mono', monospace";
      ctx.fillStyle = colors.ink;
      ctx.fillText("θ = " + value("angle") + "°", CX + 84 * Math.cos(mid), CY + 84 * Math.sin(mid) + 5);
    }

    function drawWire(g) {
      var width = 6 + value("current") * 0.6;

      ctx.lineCap = "round";
      ctx.strokeStyle = colors.wire;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(g.x1, g.y1);
      ctx.lineTo(g.x2, g.y2);
      ctx.stroke();

      // Moving charges — spacing fixed, speed grows with the current
      ctx.fillStyle = colors.current;
      var spacing = 26;
      var length = g.half * 2;
      var offset = reduceMotion ? 0 : phase % spacing;
      for (var s = offset; s < length; s += spacing) {
        ctx.beginPath();
        ctx.arc(g.x1 + g.dx * s, g.y1 + g.dy * s, Math.max(2.5, width * 0.32), 0, Math.PI * 2);
        ctx.fill();
      }

      // Current direction
      if (length > 60) {
        // on the side away from the angle arc
        var ax = CX - g.dx * 30 + g.dy * (width + 16);
        var ay = CY - g.dy * 30 - g.dx * (width + 16);
        arrow(ax, ay, ax + g.dx * 60, ay + g.dy * 60, colors.current, 2.5, 10);
        ctx.font = "600 15px 'JetBrains Mono', monospace";
        ctx.fillStyle = colors.current;
        ctx.textAlign = "right";
        ctx.fillText("I = " + value("current").toFixed(1) + " A", ax + g.dy * 10 + g.dx * 30, ay - g.dx * 10 + g.dy * 30 - 8);
        ctx.textAlign = "left";
      }

      // Terminals and the drag handle at the + end
      ctx.font = "700 16px 'Space Grotesk', sans-serif";
      ctx.fillStyle = colors.ink;
      ctx.fillText("−", g.x1 - g.dx * 22 - 5, g.y1 - g.dy * 22 + 6);
      ctx.beginPath();
      ctx.arc(g.x2, g.y2, 13, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = colors.field;
      ctx.stroke();
      ctx.fillStyle = colors.field;
      ctx.fillText("+", g.x2 - 5, g.y2 + 6);
    }

    function drawForce() {
      var F = force();
      var r = 12 + Math.sqrt(F) * 5;
      ctx.font = "600 18px 'JetBrains Mono', monospace";
      ctx.fillStyle = colors.force;
      ctx.fillText("F = " + F.toFixed(2) + " N", W - 250, 32);

      if (F < 0.005) return;
      ctx.beginPath();
      ctx.arc(CX, CY, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = colors.force;
      ctx.stroke();
      var k = r * 0.55;
      ctx.beginPath();
      ctx.moveTo(CX - k, CY - k); ctx.lineTo(CX + k, CY + k);
      ctx.moveTo(CX + k, CY - k); ctx.lineTo(CX - k, CY + k);
      ctx.stroke();
      ctx.font = "13px 'JetBrains Mono', monospace";
      ctx.fillStyle = colors.force;
      ctx.fillText("⊗ sayfa düzleminden içeri", W - 250, 54);
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      var g = wireGeometry();
      drawField();
      drawAngle(g);
      drawWire(g);
      drawForce();
    }

    function loop() {
      phase += 0.6 + value("current") * 0.35;
      draw();
      if (!reduceMotion) window.requestAnimationFrame(loop);
    }

    // Drag the + end of the wire: direction sets θ, distance sets L
    function point(event) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * W / rect.width,
        y: (event.clientY - rect.top) * H / rect.height
      };
    }

    function nearHandle(p) {
      var g = wireGeometry();
      return Math.hypot(p.x - g.x2, p.y - g.y2) < 26;
    }

    canvas.addEventListener("pointerdown", function (event) {
      if (!nearHandle(point(event))) return;
      dragging = true;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    });

    canvas.addEventListener("pointermove", function (event) {
      var p = point(event);
      if (!dragging) {
        canvas.classList.toggle("is-over", nearHandle(p));
        return;
      }
      var dx = p.x - CX, dy = CY - p.y;
      var degrees = Math.atan2(dy, dx) * 180 / Math.PI;
      if (degrees < -90) degrees = 90;       // snapping past the left side
      setParam("angle", clamp(degrees, 0, 90));
      setParam("length", Math.hypot(dx, dy) * 2 / PX_PER_M);
    });

    function stop(event) {
      if (!dragging) return;
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
      canvas.classList.remove("is-dragging");
    }
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);

    readColors();
    onChange(function () { if (reduceMotion) draw(); });
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener("resize", resize);
    resize();
    loop();
  }

  /* ----------------------------- Measurements ---------------------------- */
  function initMeasurements() {
    var table = $("#data-table");
    if (!table) return;

    var body = $("tbody", table);
    var rows = [];
    try { rows = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (error) { rows = []; }

    function persist() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(rows)); } catch (error) { /* ignore */ }
    }

    function render() {
      body.textContent = "";
      if (!rows.length) {
        var empty = document.createElement("tr");
        empty.className = "table__empty";
        var cell = document.createElement("td");
        cell.colSpan = 7;
        cell.textContent = "Henüz ölçüm yok. Parametreleri ayarlayıp “Ölçümü kaydet”e basın.";
        empty.appendChild(cell);
        body.appendChild(empty);
      }
      rows.forEach(function (row, index) {
        var tr = document.createElement("tr");
        [index + 1, row.angle, row.sin.toFixed(3), row.current.toFixed(1), row.field.toFixed(1), row.length.toFixed(1), row.force.toFixed(2)]
          .forEach(function (text) {
            var td = document.createElement("td");
            td.textContent = String(text);
            tr.appendChild(td);
          });
        body.appendChild(tr);
      });
      $("#data-count").textContent = rows.length + " ölçüm";
      $$("[data-export], #clear-data").forEach(function (button) { button.disabled = !rows.length; });
    }

    $("#save-data").addEventListener("click", function () {
      rows.push({
        angle: value("angle"),
        sin: sinTheta(),
        current: value("current"),
        field: value("field"),
        length: value("length"),
        force: force()
      });
      persist();
      render();
    });

    $("#clear-data").addEventListener("click", function () {
      if (!window.confirm("Tüm ölçümler silinsin mi?")) return;
      rows = [];
      persist();
      render();
    });

    // Same sheet names and column headers as the previous version
    var EXPORTS = {
      "sinus-force":   { sheet: "Sinus-Kuvvet",        pick: function (r) { return { "Sinüs(θ)": +r.sin.toFixed(4), "Kuvvet (N)": +r.force.toFixed(4) }; } },
      "current-force": { sheet: "Akım-Kuvvet",         pick: function (r) { return { "Akım (A)": r.current, "Kuvvet (N)": +r.force.toFixed(4) }; } },
      "length-force":  { sheet: "TelUzunluğu-Kuvvet",  pick: function (r) { return { "Tel Uzunluğu (m)": r.length, "Kuvvet (N)": +r.force.toFixed(4) }; } },
      "field-force":   { sheet: "ManyetikAlan-Kuvvet", pick: function (r) { return { "Manyetik Alan (T)": r.field, "Kuvvet (N)": +r.force.toFixed(4) }; } },
      "all":           { sheet: "Olcumler",            pick: function (r) {
        return { "Açı (°)": r.angle, "Sinüs(θ)": +r.sin.toFixed(4), "Akım (A)": r.current,
                 "Manyetik Alan (T)": r.field, "Tel Uzunluğu (m)": r.length, "Kuvvet (N)": +r.force.toFixed(4) };
      } }
    };

    $$("[data-export]").forEach(function (button) {
      button.addEventListener("click", function () {
        var spec = EXPORTS[button.getAttribute("data-export")];
        if (!spec || !rows.length || !window.XLSX) return;
        var sheet = window.XLSX.utils.json_to_sheet(rows.map(spec.pick));
        var book = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(book, sheet, spec.sheet);
        window.XLSX.writeFile(book, spec.sheet + ".xlsx");
      });
    });

    render();
  }

  /* -------------------------------- Boot --------------------------------- */
  function boot() {
    initControls();
    initStage();
    initMeasurements();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
