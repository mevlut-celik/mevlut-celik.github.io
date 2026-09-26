/* ==========================================================================
   Yansıma ve İletim — main.js
   Same shape in every project on this site: helpers, then one initX()
   per feature (query its own nodes, bail out if they are missing, bind its
   own listeners), then a single boot().

   Wave model adapted from "Reflection and Transmission" by Andrew Duffy
   (Boston University, 2017), CC BY-NC-SA 4.0. The pulse equations, the
   four scenarios and the timing (index / 1000 s per frame, 60 fps) are
   kept exactly as in the original; only drawing and controls are new.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------- Helpers ------------------------------- */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // Gaussian pulse used throughout the original: exp(-(|a| / w)^2)
  function pulse(a, width) {
    var u = Math.abs(a) / width;
    return Math.exp(-u * u);
  }

  /* ------------------------------ Wave model ----------------------------- */
  var MODES = {
    1: { title: "Sağ Uç Sabit",            sign: -1 },
    2: { title: "Sağ Uç Serbest",          sign:  1 },
    3: { title: "İnce Yaydan Kalın Yaya",  sign: -1 },
    4: { title: "Kalın Yaydan İnce Yaya",  sign:  1 }
  };

  var FREQ = 48;
  var MU = 20;
  var SIZE = 401;

  var state = { mode: 1, sign: -1, index: -1, running: true, timer: null };
  var right = new Float64Array(SIZE);
  var left = new Float64Array(SIZE);

  function transmission(v1, v2) {
    var trans = 4 / (v1 * v2) / ((1 / v1 + 1 / v2) * (1 / v1 + 1 / v2));
    return { reflect: Math.sqrt(1 - trans), trans: Math.sqrt(v2 * trans / v1) };
  }

  function compute(time) {
    var i;
    var s = state.sign;

    if (state.mode <= 2) {
      for (i = 0; i < SIZE; i++) {
        right[i] = pulse(i + 50 - 20 * FREQ * time, 40);
        left[i] = s * pulse(i - 800 - 50 + 20 * FREQ * time, 40);
      }
    } else if (state.mode === 3) {
      var k3 = transmission(3.0, 1.0);
      for (i = 0; i < SIZE; i++) {
        right[i] = pulse(i + 50 - 20 * FREQ * time, 40) + k3.reflect * s * pulse(i - 400 - 50 + 20 * FREQ * time, 40);
        left[i] = k3.trans * pulse(i - 117 - 20 * (FREQ / 3.0) * time, 40 / 3.0);
      }
    } else {
      var k4 = transmission(1.0, 3.0);
      for (i = 0; i < SIZE; i++) {
        left[i] = k4.trans * pulse(i + 50 - 20 * FREQ * time, 40);
        right[i] = pulse(i - 117 - 20 * (FREQ / 3.0) * time, 40 / 3.0) + k4.reflect * s * pulse(i - 283 + 20 * (FREQ / 3.0) * time, 40 / 3.0);
      }
    }
  }

  /* -------------------------------- Scope -------------------------------- */
  function initScope() {
    var canvas = $("#myCanvas");
    if (!canvas) return;

    var ctx = canvas.getContext("2d");
    var W = 600, H = 280;
    var X0 = 70, Y0 = 70;              // plot origin: xBase, yBase2 in the original
    var colors = {
      grid: cssVar("--graticule"),
      axis: "#4d6b5a",
      label: cssVar("--ink-mute"),
      sum: cssVar("--accent"),
      light: cssVar("--amber"),
      heavy: cssVar("--cyan")
    };

    function resize() {
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientWidth * H / W * dpr);
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
      render();
    }

    function trace(color, width, from, to, values) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (var i = from; i <= to; i++) {
        var y = Y0 + 80 - 40 * values(i);
        if (i === from) ctx.moveTo(X0 + i, y);
        else ctx.lineTo(X0 + i, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    function render() {
      var time = Math.max(0, state.index) / 1000;
      compute(time);
      ctx.clearRect(0, 0, W, H);

      // Graticule
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.grid;
      ctx.font = "13px 'Share Tech Mono', monospace";
      ctx.fillStyle = colors.label;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (var gx = 0; gx <= 10; gx++) {
        ctx.beginPath();
        ctx.moveTo(X0 + 40 * gx, Y0);
        ctx.lineTo(X0 + 40 * gx, Y0 + 166);
        ctx.stroke();
        ctx.fillText(String(gx), X0 + 40 * gx, Y0 + 178);
      }
      for (var gy = 0; gy <= 4; gy++) {
        ctx.beginPath();
        ctx.moveTo(X0 - 10, Y0 + 40 * gy);
        ctx.lineTo(X0 + 400, Y0 + 40 * gy);
        ctx.stroke();
        ctx.fillText(String(20 * (2 - gy)), X0 - 26, Y0 + 40 * gy);
      }

      // Axes
      ctx.strokeStyle = colors.axis;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X0, Y0 - 20);
      ctx.lineTo(X0, Y0 + 160);
      ctx.moveTo(X0 - 1, Y0 + 80);
      ctx.lineTo(X0 + 418, Y0 + 80);
      ctx.moveTo(X0 + 410, Y0 + 74);
      ctx.lineTo(X0 + 418, Y0 + 80);
      ctx.lineTo(X0 + 410, Y0 + 86);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillText("x (m)", X0 + 426, Y0 + 80);
      ctx.textAlign = "center";
      ctx.fillText("y (mm)", X0, Y0 - 32);

      // Interface marker for the two-string scenarios
      if (state.mode >= 3) {
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = colors.axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X0 + 200, Y0);
        ctx.lineTo(X0 + 200, Y0 + 160);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Traces — the same split and widths as the original (thin = 2μ/10, thick = 4μ/10)
      var thin = 2 * MU / 10, thick = 4 * MU / 10;
      if (state.mode <= 2) {
        trace(colors.sum, thin * 0.75, 0, 400, function (i) { return right[i] + left[i]; });
      } else if (state.mode === 3) {
        trace(colors.light, thin * 0.75, 0, 200, function (i) { return right[i]; });
        trace(colors.heavy, thick * 0.75, 200, 400, function (i) { return left[i]; });
      } else {
        trace(colors.heavy, thick * 0.75, 0, 200, function (i) { return right[i]; });
        trace(colors.light, thin * 0.75, 200, 400, function (i) { return left[i]; });
      }

      $("#readout-time").textContent = time.toFixed(3) + " s";
      $("#readout-mode").textContent = MODES[state.mode].title;
      $("#run-led").classList.toggle("is-on", state.running && state.timer !== null);
    }

    // One frame forward, as drawMotion() did: advance, wrap at 1100, draw
    function step() {
      if (state.index >= 1100) state.index = -1;
      state.index += 1;
      render();
    }

    function stop() {
      window.clearTimeout(state.timer);
      state.timer = null;
    }

    function run() {
      step();
      if (state.running) state.timer = window.setTimeout(run, 1000 / 60);
    }

    var actions = {
      play: function () { stop(); state.running = true; run(); },
      pause: function () { stop(); state.running = false; render(); },
      forward: function () { stop(); state.running = false; step(); },
      back: function () {
        stop();
        state.running = false;
        state.index = Math.max(-1, state.index - 2);
        step();
      },
      reset: function () { stop(); state.index = -1; state.running = true; run(); }
    };

    $$("[data-action]").forEach(function (button) {
      button.addEventListener("click", function () { actions[button.getAttribute("data-action")](); });
    });

    $$("[data-mode]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.mode = Number(button.getAttribute("data-mode"));
        state.sign = MODES[state.mode].sign;
        $$("[data-mode]").forEach(function (other) {
          other.setAttribute("aria-pressed", other === button ? "true" : "false");
        });
        actions.reset();
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.target.closest("button, input, a")) return;
      if (event.key === " ") { event.preventDefault(); (state.running && state.timer ? actions.pause : actions.play)(); }
      if (event.key === "ArrowRight") actions.forward();
      if (event.key === "ArrowLeft") actions.back();
    });

    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener("resize", resize);

    resize();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      state.running = false;
      state.index = 330;           // a readable frame mid-reflection
      render();
    } else {
      actions.reset();
    }
  }

  /* -------------------------------- Boot --------------------------------- */
  function boot() {
    initScope();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
