// Deco Planner UI controller. Vanilla JS — no framework dependencies.
// The decompression math lives in scuba-dive.browserified.js (loaded first
// via <script>) and is invoked through `require("/scuba-dive.js")`.

(function () {
  "use strict";

  if (typeof require !== "function") {
    console.error("Deco engine failed to load (require is undefined).");
    return;
  }
  var dive = require("/scuba-dive.js");
  window.dive = dive; // expose for advanced users / browser console

  // ---------- State ----------

  var bottomGases = [
    { name: "21/35",  fO2: 0.21, fHe: 0.35 },
  ];
  var decoGases = [
    { name: "50%",         fO2: 0.50, fHe: 0.00 },
    { name: "Oxygen 100%", fO2: 1.00, fHe: 0.00 },
  ];
  var segments = [
    { startDepth: 0,  endDepth: 50, gasName: "21/35", time: 5  },
    { startDepth: 50, endDepth: 50, gasName: "21/35", time: 25 },
  ];

  // ---------- Helpers ----------

  function $(id) { return document.getElementById(id); }

  function parseNum(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function gasOptionsHtml(selected) {
    var all = bottomGases.concat(decoGases);
    return all.map(function (g) {
      var sel = g.name === selected ? " selected" : "";
      return '<option value="' + escapeHtml(g.name) + '"' + sel + ">" + escapeHtml(g.name) + "</option>";
    }).join("");
  }

  // ---------- Render ----------

  function renderGasRow(g, kind, idx) {
    return (
      '<tr data-idx="' + idx + '" data-kind="' + kind + '" class="border-b border-slate-100">' +
        '<td class="py-1.5 pr-2"><input type="text" data-field="name" value="' + escapeHtml(g.name) + '" class="w-full"/></td>' +
        '<td class="py-1.5 pr-2"><input type="number" step="0.01" min="0" max="1" data-field="fO2" value="' + g.fO2 + '" class="w-24"/></td>' +
        '<td class="py-1.5 pr-2"><input type="number" step="0.01" min="0" max="1" data-field="fHe" value="' + g.fHe + '" class="w-24"/></td>' +
        '<td class="py-1.5 pr-0 text-right"><button class="btn-danger" data-action="remove">Remove</button></td>' +
      "</tr>"
    );
  }

  function renderSegmentRow(s, idx) {
    return (
      '<tr data-idx="' + idx + '" class="border-b border-slate-100">' +
        '<td class="py-1.5 pr-2"><input type="number" step="0.5" min="0" data-field="startDepth" value="' + s.startDepth + '" class="w-24"/></td>' +
        '<td class="py-1.5 pr-2"><input type="number" step="0.5" min="0" data-field="endDepth" value="' + s.endDepth + '" class="w-24"/></td>' +
        '<td class="py-1.5 pr-2"><select data-field="gasName" class="w-36">' + gasOptionsHtml(s.gasName) + "</select></td>" +
        '<td class="py-1.5 pr-2"><input type="number" step="0.5" min="0" data-field="time" value="' + s.time + '" class="w-24"/></td>' +
        '<td class="py-1.5 pr-0 text-right"><button class="btn-danger" data-action="remove">Remove</button></td>' +
      "</tr>"
    );
  }

  function render() {
    $("bottomGassesBody").innerHTML = bottomGases.map(function (g, i) { return renderGasRow(g, "bottom", i); }).join("");
    $("decoGassesBody").innerHTML   = decoGases  .map(function (g, i) { return renderGasRow(g, "deco",   i); }).join("");
    $("diveSegmentsBody").innerHTML = segments   .map(function (s, i) { return renderSegmentRow(s, i); }).join("");
  }

  // ---------- Wiring: edits + add/remove ----------

  function readGas(row) {
    return {
      name: row.querySelector('[data-field="name"]').value.trim() || "unnamed",
      fO2:  parseNum(row.querySelector('[data-field="fO2"]').value, 0),
      fHe:  parseNum(row.querySelector('[data-field="fHe"]').value, 0),
    };
  }

  function readSegment(row) {
    return {
      startDepth: parseNum(row.querySelector('[data-field="startDepth"]').value, 0),
      endDepth:   parseNum(row.querySelector('[data-field="endDepth"]').value, 0),
      gasName:    row.querySelector('[data-field="gasName"]').value,
      time:       parseNum(row.querySelector('[data-field="time"]').value, 0),
    };
  }

  document.addEventListener("input", function (ev) {
    var t = ev.target;
    var row = t.closest && t.closest("tr[data-idx]");
    if (!row) return;
    var idx = parseInt(row.getAttribute("data-idx"), 10);
    var kind = row.getAttribute("data-kind");
    if (kind === "bottom") bottomGases[idx] = readGas(row);
    else if (kind === "deco") decoGases[idx] = readGas(row);
    else segments[idx] = readSegment(row);
  });

  document.addEventListener("click", function (ev) {
    var btn = ev.target.closest && ev.target.closest('button[data-action="remove"]');
    if (!btn) return;
    var row = btn.closest("tr[data-idx]");
    var idx = parseInt(row.getAttribute("data-idx"), 10);
    var kind = row.getAttribute("data-kind");
    if (kind === "bottom") bottomGases.splice(idx, 1);
    else if (kind === "deco") decoGases.splice(idx, 1);
    else segments.splice(idx, 1);
    render();
  });

  $("addBottomGas").addEventListener("click", function () {
    bottomGases.push({ name: "air", fO2: 0.21, fHe: 0 });
    render();
  });

  $("addDecoGas").addEventListener("click", function () {
    decoGases.push({ name: "50%", fO2: 0.5, fHe: 0 });
    render();
  });

  $("addDiveSegment").addEventListener("click", function () {
    var last = segments[segments.length - 1];
    var startDepth = last ? last.endDepth : 0;
    var firstGas = (bottomGases[0] && bottomGases[0].name) || "air";
    segments.push({ startDepth: startDepth, endDepth: startDepth, gasName: firstGas, time: 10 });
    render();
  });

  $("resetDefaults").addEventListener("click", function () {
    bottomGases = [{ name: "21/35", fO2: 0.21, fHe: 0.35 }];
    decoGases   = [{ name: "50%", fO2: 0.5, fHe: 0 }, { name: "Oxygen 100%", fO2: 1.0, fHe: 0 }];
    segments    = [
      { startDepth: 0,  endDepth: 50, gasName: "21/35", time: 5  },
      { startDepth: 50, endDepth: 50, gasName: "21/35", time: 25 },
    ];
    $("algorithm").value = "buhlmann";
    $("gfLow").value = 0.2; $("gfHigh").value = 0.8;
    $("ppO2").value = 1.6; $("end").value = 30;
    $("resultsSection").classList.add("hidden");
    render();
  });

  // ---------- Compute ----------

  function showError(msg) {
    $("resultsSection").classList.remove("hidden");
    var b = $("errorBanner");
    b.textContent = msg;
    b.classList.remove("hidden");
    $("planBody").innerHTML = "";
    $("totalTime").textContent = "—";
    $("decoTime").textContent = "—";
  }

  function clearError() {
    $("errorBanner").classList.add("hidden");
    $("errorBanner").textContent = "";
  }

  function classifyPhase(seg, lastDepth) {
    if (seg.endDepth > lastDepth)  return "descent";
    if (seg.endDepth < lastDepth)  return seg.startDepth === seg.endDepth ? "stop" : "ascent";
    return seg.startDepth === seg.endDepth ? "bottom" : "ascent";
  }

  function calculate() {
    clearError();

    if (segments.length === 0) {
      showError("Add at least one dive segment before calculating.");
      return;
    }

    var algorithm = $("algorithm").value;
    var gfLow  = parseNum($("gfLow").value, NaN);
    var gfHigh = parseNum($("gfHigh").value, NaN);
    var ppO2   = parseNum($("ppO2").value, NaN);
    var maxEnd = parseNum($("end").value, NaN);

    if (!isFinite(gfLow) || gfLow <= 0 || gfLow > 1) return showError("GF Low must be between 0 and 1.");
    if (!isFinite(gfHigh) || gfHigh <= 0 || gfHigh > 1) return showError("GF High must be between 0 and 1.");
    if (gfLow > gfHigh) return showError("GF Low must be less than or equal to GF High.");
    if (!isFinite(ppO2) || ppO2 <= 0 || ppO2 > 2) return showError("Deco ppO₂ must be between 0 and 2.");
    if (!isFinite(maxEnd) || maxEnd < 0) return showError("Max END must be non-negative.");

    var plan;
    try {
      if (algorithm === "buhlmann") {
        var buhlmann = dive.deco.buhlmann();
        plan = new buhlmann.plan(buhlmann.ZH16BTissues);
      } else {
        var vpm = dive.deco.vpm();
        plan = new vpm.plan();
      }
    } catch (e) {
      return showError("Could not initialize the " + algorithm + " engine: " + e);
    }

    try {
      bottomGases.forEach(function (g) { plan.addBottomGas(g.name, g.fO2, g.fHe); });
      decoGases.forEach(function (g) { plan.addDecoGas(g.name, g.fO2, g.fHe); });
      segments.forEach(function (s) { plan.addDepthChange(s.startDepth, s.endDepth, s.gasName, s.time); });
    } catch (e) {
      return showError("Profile error: " + e);
    }

    var result;
    try {
      result = plan.calculateDecompression(false, gfLow, gfHigh, ppO2, maxEnd);
    } catch (e) {
      return showError("Decompression calculation failed: " + e);
    }

    if (!result || !result.length) {
      return showError("Engine returned no plan. Check that gases and segments are consistent.");
    }

    // Sanity-check the engine's output before rendering. We refuse to display
    // numbers that look pathological (NaN / Infinity / negative time) — better
    // a visible error than a silently wrong dive plan.
    for (var i = 0; i < result.length; i++) {
      var r = result[i];
      if (!isFinite(r.startDepth) || !isFinite(r.endDepth) || !isFinite(r.time) || r.time < 0) {
        return showError(
          "Plan rejected: segment " + i + " has invalid numbers " +
          "(start=" + r.startDepth + ", end=" + r.endDepth + ", time=" + r.time + "). " +
          "Try a more conservative profile."
        );
      }
    }

    // Render
    var lastDepth = 0;
    var running = 0;
    var diveTime = segments.reduce(function (a, s) { return a + (s.time || 0); }, 0);
    var totalTime = result.reduce(function (a, s) { return a + (s.time || 0); }, 0);
    var decoTime = totalTime - diveTime;

    var rows = result.map(function (s) {
      var phase = classifyPhase(s, lastDepth);
      lastDepth = s.endDepth;
      running += s.time;
      var phaseClass = {
        descent: "bg-brine-50 text-brine-800",
        bottom:  "bg-slate-50 text-slate-700",
        ascent:  "bg-amber-50 text-amber-800",
        stop:    "bg-rose-50 text-rose-800",
      }[phase] || "";
      return (
        '<tr class="hover:bg-slate-50">' +
          '<td class="py-1.5 px-2"><span class="inline-flex rounded px-2 py-0.5 text-xs font-medium ' + phaseClass + '">' + phase + "</span></td>" +
          '<td class="py-1.5 px-2 tabular-nums">' + round1(s.startDepth) + "</td>" +
          '<td class="py-1.5 px-2 tabular-nums">' + round1(s.endDepth) + "</td>" +
          '<td class="py-1.5 px-2">' + escapeHtml(s.gasName) + "</td>" +
          '<td class="py-1.5 px-2 tabular-nums">' + round1(s.time) + "</td>" +
          '<td class="py-1.5 px-2 tabular-nums text-slate-500">' + round1(running) + "</td>" +
        "</tr>"
      );
    }).join("");

    $("planBody").innerHTML = rows;
    $("totalTime").textContent = round1(totalTime);
    $("decoTime").textContent = round1(decoTime);
    $("resultsSection").classList.remove("hidden");
  }

  $("calculateDeco").addEventListener("click", calculate);

  render();
})();
