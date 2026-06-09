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

  // ---------- Standard gas mixes (chosen by the maintainer) ----------

  var STANDARD_GASES = [
    { name: "Air",     fO2: 0.21, fHe: 0.00 },
    { name: "32%",     fO2: 0.32, fHe: 0.00 },
    { name: "50%",     fO2: 0.50, fHe: 0.00 },
    { name: "O2",      fO2: 1.00, fHe: 0.00 },
    { name: "30/30",   fO2: 0.30, fHe: 0.30 },
    { name: "21/35",   fO2: 0.21, fHe: 0.35 },
    { name: "18/45",   fO2: 0.18, fHe: 0.45 },
    { name: "15/55",   fO2: 0.15, fHe: 0.55 },
    { name: "10/70",   fO2: 0.10, fHe: 0.70 },
  ];

  // ---------- Units ----------

  // The deco engine works in meters internally. We translate at the I/O boundary
  // so the user can think in feet if they prefer. 1 m = 3.28084 ft.
  var FT_PER_M = 3.28084;
  var units = "metric"; // "metric" | "imperial"

  function depthUnitLabel() { return units === "metric" ? "m" : "ft"; }
  function toMeters(depthInCurrentUnits) {
    return units === "imperial" ? depthInCurrentUnits / FT_PER_M : depthInCurrentUnits;
  }
  function fromMeters(meters) {
    return units === "imperial" ? meters * FT_PER_M : meters;
  }

  // Surface Air Consumption (SAC) — the diver's at-surface breathing rate.
  // Stored in the current display unit (L/min when metric, cu ft/min when imperial).
  // 1 cu ft/min ≈ 28.3168 L/min.
  var L_PER_CUFT = 28.3168;
  function sacUnitLabel() { return units === "metric" ? "L/min" : "cu ft/min"; }
  function gasVolumeUnitLabel() { return units === "metric" ? "L" : "cu ft"; }

  // ---------- State ----------

  var bottomGases = [{ name: "21/35", fO2: 0.21, fHe: 0.35 }];
  var decoGases   = [
    { name: "50%", fO2: 0.50, fHe: 0.00 },
    { name: "O2",  fO2: 1.00, fHe: 0.00 },
  ];
  // Segments are stored in the user's CURRENT display units. When the user
  // toggles units we convert in-place so what they see stays consistent.
  // `kind` is one of "descent" | "flat" | "ascent". For flat segments
  // startDepth === endDepth (the UI exposes a single depth field).
  var segments = [
    { kind: "descent", startDepth: 0,  endDepth: 50, gasName: "21/35", time: 5  },
    { kind: "flat",    startDepth: 50, endDepth: 50, gasName: "21/35", time: 25 },
  ];

  // Infer kind from depth direction. Used to migrate legacy segments
  // (e.g. from a shared URL written before kind existed).
  function inferKind(s) {
    if (typeof s.kind === "string") return s.kind;
    if (s.endDepth > s.startDepth) return "descent";
    if (s.endDepth < s.startDepth) return "ascent";
    return "flat";
  }

  // ---------- Helpers ----------

  function $(id) { return document.getElementById(id); }

  function parseNum(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  // Imperial depths are easier to read and dive when rounded to the
  // standard 10-foot increment (matches typical deco stop intervals).
  // Metric stays at 1-decimal resolution.
  function displayDepth(meters) {
    var v = fromMeters(meters);
    return units === "imperial" ? Math.round(v / 10) * 10 : round1(v);
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

  // Keep each segment's gasName pointing to a still-registered BOTTOM gas.
  // User-defined dive segments (descent + bottom + optional initial ascent)
  // should breathe a bottom mix — never a deco mix — so when a referenced
  // gas disappears we re-point only to bottom gases. If no bottom gas
  // exists, leave the stale name in place so calculate() errors out
  // visibly rather than silently producing a wildly wrong plan based on a
  // deco mix breathed on the bottom.
  //
  // Returns an array of {idx, from, to} changes so the caller can surface
  // them to the user (a silent reassignment looks like "the deco plan got
  // weird out of nowhere", which is what just bit me).
  function syncSegmentGases() {
    var bottomNames = bottomGases.map(function (g) { return g.name; });
    var allNames = bottomNames.concat(decoGases.map(function (g) { return g.name; }));
    var changes = [];
    if (bottomNames.length === 0) return changes;
    segments.forEach(function (s, i) {
      if (allNames.indexOf(s.gasName) < 0) {
        changes.push({ idx: i, from: s.gasName, to: bottomNames[0] });
        s.gasName = bottomNames[0];
      }
    });
    return changes;
  }

  function showInfo(msg) {
    var b = $("infoBanner");
    if (!b) return;
    b.textContent = msg;
    b.classList.remove("hidden");
    clearTimeout(showInfo._t);
    showInfo._t = setTimeout(function () { b.classList.add("hidden"); }, 8000);
  }

  function reportSyncChanges(changes) {
    if (!changes || changes.length === 0) return;
    var summary = changes.map(function (c) {
      return "segment " + (c.idx + 1) + " (" + c.from + " → " + c.to + ")";
    }).join(", ");
    showInfo("Reassigned " + summary + " because the previous gas was removed. Adjust segments if needed.");
  }

  function standardGasOptionsHtml() {
    return '<option value="">Add standard gas…</option>' +
      STANDARD_GASES.map(function (g) {
        return '<option value="' + escapeHtml(g.name) + '">' + escapeHtml(g.name) + "</option>";
      }).join("");
  }

  // ---------- Render ----------

  var inputCls = "rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900 shadow-sm focus:border-brine-500 focus:ring-2 focus:ring-brine-200 outline-none";
  var btnDanger = "inline-flex items-center gap-1 rounded-md bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 text-xs px-2 py-1 transition";

  function renderGasRow(g, kind, idx) {
    return (
      '<tr data-idx="' + idx + '" data-kind="' + kind + '" class="border-b border-slate-100">' +
        '<td class="py-1.5 pr-2"><input type="text" data-field="name" value="' + escapeHtml(g.name) + '" class="' + inputCls + ' w-full"/></td>' +
        '<td class="py-1.5 pr-2"><input type="number" step="0.01" min="0" max="1" data-field="fO2" value="' + g.fO2 + '" class="' + inputCls + ' w-24"/></td>' +
        '<td class="py-1.5 pr-2"><input type="number" step="0.01" min="0" max="1" data-field="fHe" value="' + g.fHe + '" class="' + inputCls + ' w-24"/></td>' +
        '<td class="py-1.5 pr-0 text-right"><button class="' + btnDanger + '" data-action="remove">Remove</button></td>' +
      "</tr>"
    );
  }

  // Kind → pill colour + row background tint. Matches the result-table colours.
  var segmentRowStyle = {
    descent: { row: "bg-brine-50/40 hover:bg-brine-50",   pill: "bg-brine-100 text-brine-800",   label: "descent" },
    flat:    { row: "bg-slate-50/60 hover:bg-slate-100/60", pill: "bg-slate-200 text-slate-700", label: "flat / bottom" },
    ascent:  { row: "bg-amber-50/40 hover:bg-amber-50",   pill: "bg-amber-100 text-amber-800",   label: "ascent" },
  };

  function renderSegmentRow(s, idx) {
    var kind = inferKind(s);
    var style = segmentRowStyle[kind] || segmentRowStyle.flat;

    // Depth cell content depends on kind: flat shows ONE field, travel shows two.
    var depthCell;
    if (kind === "flat") {
      depthCell =
        '<input type="number" step="0.5" min="0" data-field="depth" value="' + s.startDepth + '" class="' + inputCls + ' w-24"/>';
    } else {
      depthCell =
        '<span class="inline-flex items-center gap-1.5">' +
          '<input type="number" step="0.5" min="0" data-field="startDepth" value="' + s.startDepth + '" class="' + inputCls + ' w-20"/>' +
          '<span class="text-slate-400">→</span>' +
          '<input type="number" step="0.5" min="0" data-field="endDepth" value="' + s.endDepth + '" class="' + inputCls + ' w-20"/>' +
        '</span>';
    }

    return (
      '<tr data-idx="' + idx + '" data-segkind="' + kind + '" class="border-b border-slate-100 ' + style.row + '">' +
        '<td class="py-1.5 pr-2">' +
          '<span class="inline-flex rounded px-2 py-0.5 text-xs font-medium ' + style.pill + '">' + style.label + '</span>' +
        '</td>' +
        '<td class="py-1.5 pr-2">' + depthCell + '</td>' +
        '<td class="py-1.5 pr-2"><select data-field="gasName" class="' + inputCls + ' w-36">' + gasOptionsHtml(s.gasName) + "</select></td>" +
        '<td class="py-1.5 pr-2"><input type="number" step="0.5" min="0" data-field="time" value="' + s.time + '" class="' + inputCls + ' w-24"/></td>' +
        '<td class="py-1.5 pr-0 text-right"><button class="' + btnDanger + '" data-action="remove">Remove</button></td>' +
      "</tr>"
    );
  }

  function renderGases() {
    $("bottomGassesBody").innerHTML = bottomGases.map(function (g, i) { return renderGasRow(g, "bottom", i); }).join("");
    $("decoGassesBody").innerHTML   = decoGases  .map(function (g, i) { return renderGasRow(g, "deco",   i); }).join("");
    $("addStandardBottomGas").innerHTML = standardGasOptionsHtml();
    $("addStandardDecoGas").innerHTML   = standardGasOptionsHtml();
    $("addStandardBottomGas").value = "";
    $("addStandardDecoGas").value = "";
  }

  function renderSegments() {
    $("diveSegmentsBody").innerHTML = segments.map(function (s, i) { return renderSegmentRow(s, i); }).join("");
    var u = depthUnitLabel();
    var headers = document.querySelectorAll("[data-depth-unit]");
    for (var i = 0; i < headers.length; i++) headers[i].textContent = u;
  }

  function render() {
    renderGases();
    renderSegments();
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
    var kind = row.getAttribute("data-segkind") || "flat";
    var depthField = row.querySelector('[data-field="depth"]');
    var startField = row.querySelector('[data-field="startDepth"]');
    var endField   = row.querySelector('[data-field="endDepth"]');
    var startDepth, endDepth;
    if (kind === "flat") {
      startDepth = endDepth = parseNum(depthField ? depthField.value : 0, 0);
    } else {
      startDepth = parseNum(startField ? startField.value : 0, 0);
      endDepth   = parseNum(endField   ? endField.value   : 0, 0);
    }
    return {
      kind: kind,
      startDepth: startDepth,
      endDepth:   endDepth,
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
    var changedField = t.getAttribute && t.getAttribute("data-field");
    if (kind === "bottom") {
      bottomGases[idx] = readGas(row);
      reportSyncChanges(syncSegmentGases());
      // Refresh segment dropdowns so the new label is selectable. Don't touch
      // the gas tables — that would yank focus out of the field you're typing in.
      if (changedField === "name") renderSegments();
    } else if (kind === "deco") {
      decoGases[idx] = readGas(row);
      reportSyncChanges(syncSegmentGases());
      if (changedField === "name") renderSegments();
    } else {
      segments[idx] = readSegment(row);
    }
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
    reportSyncChanges(syncSegmentGases());
    render();
  });

  function addStandardGas(target) {
    return function (ev) {
      var name = ev.target.value;
      if (!name) return;
      var pick = null;
      for (var i = 0; i < STANDARD_GASES.length; i++) {
        if (STANDARD_GASES[i].name === name) { pick = STANDARD_GASES[i]; break; }
      }
      if (!pick) return;
      var list = target === "bottom" ? bottomGases : decoGases;
      // Don't duplicate by name
      for (var j = 0; j < list.length; j++) if (list[j].name === pick.name) { ev.target.value = ""; return; }
      list.push({ name: pick.name, fO2: pick.fO2, fHe: pick.fHe });
      render();
    };
  }

  $("addBottomGas").addEventListener("click", function () {
    bottomGases.push({ name: "air", fO2: 0.21, fHe: 0 });
    render();
  });
  $("addDecoGas").addEventListener("click", function () {
    decoGases.push({ name: "50%", fO2: 0.5, fHe: 0 });
    render();
  });
  $("addStandardBottomGas").addEventListener("change", addStandardGas("bottom"));
  $("addStandardDecoGas").addEventListener("change", addStandardGas("deco"));

  function addSegmentOfKind(kind) {
    var last = segments[segments.length - 1];
    var startDepth = last ? last.endDepth : 0;
    var firstGas = (bottomGases[0] && bottomGases[0].name) || "Air";
    var seg;
    if (kind === "descent") {
      // Default to ~30 units deeper than where we are.
      var nextDeeper = startDepth + (units === "imperial" ? 100 : 30);
      seg = { kind: "descent", startDepth: startDepth, endDepth: nextDeeper, gasName: firstGas, time: 3 };
    } else if (kind === "ascent") {
      // Default to surface-bound. If already at 0, drop to a 6 m / 20 ft default end.
      var nextShallower = Math.max(0, startDepth - (units === "imperial" ? 100 : 30));
      if (nextShallower === startDepth) nextShallower = Math.max(0, startDepth - (units === "imperial" ? 20 : 6));
      seg = { kind: "ascent", startDepth: startDepth || (units === "imperial" ? 100 : 30), endDepth: nextShallower, gasName: firstGas, time: 3 };
    } else {
      seg = { kind: "flat", startDepth: startDepth, endDepth: startDepth, gasName: firstGas, time: 20 };
    }
    segments.push(seg);
    render();
  }

  $("addDescentSegment").addEventListener("click", function () { addSegmentOfKind("descent"); });
  $("addFlatSegment").addEventListener("click",    function () { addSegmentOfKind("flat"); });
  $("addAscentSegment").addEventListener("click",  function () { addSegmentOfKind("ascent"); });

  $("resetDefaults").addEventListener("click", function () {
    units = $("unitsToggle").value === "imperial" ? "imperial" : "metric";
    bottomGases = [{ name: "21/35", fO2: 0.21, fHe: 0.35 }];
    decoGases   = [{ name: "50%", fO2: 0.5, fHe: 0 }, { name: "O2", fO2: 1.0, fHe: 0 }];
    var d50 = units === "imperial" ? 165 : 50; // ~50m ≈ 165ft
    segments = [
      { kind: "descent", startDepth: 0,   endDepth: d50, gasName: "21/35", time: 5  },
      { kind: "flat",    startDepth: d50, endDepth: d50, gasName: "21/35", time: 25 },
    ];
    $("algorithm").value = "buhlmann";
    $("gfLow").value = 0.2; $("gfHigh").value = 0.8;
    $("ppO2").value = 1.6;
    $("end").value = units === "imperial" ? 100 : 30;
    $("sac").value = units === "imperial" ? 1 : round1(L_PER_CUFT); // 1 cu ft/min ≈ 28.3 L/min
    $("resultsSection").classList.add("hidden");
    render();
  });

  $("unitsToggle").addEventListener("change", function (ev) {
    var newUnits = ev.target.value === "imperial" ? "imperial" : "metric";
    if (newUnits === units) return;
    var prev = units;
    units = newUnits;
    // Convert segment depths so the displayed numbers stay physically equivalent.
    segments = segments.map(function (s) {
      var startMeters = prev === "imperial" ? s.startDepth / FT_PER_M : s.startDepth;
      var endMeters   = prev === "imperial" ? s.endDepth   / FT_PER_M : s.endDepth;
      return {
        kind:       inferKind(s),
        startDepth: round1(fromMeters(startMeters)),
        endDepth:   round1(fromMeters(endMeters)),
        gasName:    s.gasName,
        time:       s.time,
      };
    });
    // Convert max END similarly
    var endNum = parseNum($("end").value, 30);
    var endMeters = prev === "imperial" ? endNum / FT_PER_M : endNum;
    $("end").value = round1(fromMeters(endMeters));
    // SAC: imperial uses cu ft/min, metric uses L/min. Convert preserving the same
    // physical rate (1 cu ft = 28.3168 L).
    var sacNum = parseNum($("sac").value, 1);
    var sacInLPerMin = prev === "imperial" ? sacNum * L_PER_CUFT : sacNum;
    $("sac").value = units === "imperial" ? round1(sacInLPerMin / L_PER_CUFT) : round1(sacInLPerMin);
    // Update unit labels (cu ft/min / L/min, "Gas (cu ft)" / "Gas (L)").
    var sacLabels = document.querySelectorAll("[data-sac-unit]");
    for (var s = 0; s < sacLabels.length; s++) sacLabels[s].textContent = sacUnitLabel();
    // Hide stale results (they were rendered in the previous units)
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

  function calculate() {
    clearError();

    if (segments.length === 0) {
      showError("Add at least one dive segment before calculating.");
      return;
    }
    if (bottomGases.length === 0) {
      showError("Add at least one bottom gas before calculating — segments must breathe a bottom mix, not a deco mix.");
      return;
    }

    // Defense-in-depth: ensure every segment references a registered gas, in
    // case a rename or removal slipped through. A change here triggers a
    // re-render and a notice so the user sees what the engine actually ran.
    var beforeNames = segments.map(function (s) { return s.gasName; }).join("|");
    var changes = syncSegmentGases();
    var afterNames = segments.map(function (s) { return s.gasName; }).join("|");
    if (beforeNames !== afterNames) {
      reportSyncChanges(changes);
      render();
    }

    var algorithm = $("algorithm").value;
    var gfLow  = parseNum($("gfLow").value, NaN);
    var gfHigh = parseNum($("gfHigh").value, NaN);
    var ppO2   = parseNum($("ppO2").value, NaN);
    var maxEndCurrentUnits = parseNum($("end").value, NaN);

    if (!isFinite(gfLow) || gfLow <= 0 || gfLow > 1) return showError("GF Low must be between 0 and 1.");
    if (!isFinite(gfHigh) || gfHigh <= 0 || gfHigh > 1) return showError("GF High must be between 0 and 1.");
    if (gfLow > gfHigh) return showError("GF Low must be less than or equal to GF High.");
    if (!isFinite(ppO2) || ppO2 <= 0 || ppO2 > 2) return showError("Deco ppO₂ must be between 0 and 2.");
    if (!isFinite(maxEndCurrentUnits) || maxEndCurrentUnits < 0) return showError("Max END must be non-negative.");

    // Gas validation
    var allGases = bottomGases.concat(decoGases);
    for (var i = 0; i < allGases.length; i++) {
      var g = allGases[i];
      if (!(g.fO2 > 0))                   return showError("Gas '" + g.name + "': fO2 must be > 0.");
      if (g.fHe < 0)                      return showError("Gas '" + g.name + "': fHe must be ≥ 0.");
      if (g.fO2 + g.fHe > 1.0 + 1e-9)     return showError("Gas '" + g.name + "': fO2 + fHe > 1.0 (would imply negative N2).");
    }

    // Segment validation
    for (var k = 0; k < segments.length; k++) {
      var s = segments[k];
      var skind = inferKind(s);
      if (!(s.time > 0)) return showError("Segment " + (k + 1) + ": time must be > 0.");
      if (s.startDepth < 0 || s.endDepth < 0) return showError("Segment " + (k + 1) + ": depths must be ≥ 0.");
      if (skind === "descent" && !(s.endDepth > s.startDepth)) {
        return showError("Segment " + (k + 1) + " is a descent but end depth (" + s.endDepth + ") is not deeper than start (" + s.startDepth + ").");
      }
      if (skind === "ascent" && !(s.endDepth < s.startDepth)) {
        return showError("Segment " + (k + 1) + " is an ascent but end depth (" + s.endDepth + ") is not shallower than start (" + s.startDepth + ").");
      }
    }

    var maxEndMeters = toMeters(maxEndCurrentUnits);

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
      // Convert each segment's depths to meters for the engine.
      segments.forEach(function (s) {
        plan.addDepthChange(toMeters(s.startDepth), toMeters(s.endDepth), s.gasName, s.time);
      });
    } catch (e) {
      return showError("Profile error: " + e);
    }

    var result;
    try {
      result = plan.calculateDecompression(false, gfLow, gfHigh, ppO2, maxEndMeters);
    } catch (e) {
      return showError("Decompression calculation failed: " + (e && e.message ? e.message : e));
    }

    if (!result || !result.length) {
      return showError("Engine returned no plan. Check that gases and segments are consistent.");
    }

    // Refuse to display pathological numbers — better a visible error than a wrong plan.
    for (var n = 0; n < result.length; n++) {
      var r = result[n];
      if (!isFinite(r.startDepth) || !isFinite(r.endDepth) || !isFinite(r.time) || r.time < 0) {
        return showError(
          "Plan rejected: segment " + n + " has invalid numbers " +
          "(start=" + r.startDepth + ", end=" + r.endDepth + ", time=" + r.time + "). " +
          "Try a more conservative profile."
        );
      }
    }

    renderResult(result);
    captureStateToUrl();
  }

  function classifyPhase(seg, hasAscended) {
    // Pure depth change first.
    if (seg.endDepth > seg.startDepth) return { phase: "descent", hasAscended: hasAscended };
    if (seg.endDepth < seg.startDepth) return { phase: "ascent",  hasAscended: true };
    // start == end → it's a hold. Bottom only counts before the first ascent.
    return { phase: hasAscended ? "deco stop" : "bottom", hasAscended: hasAscended };
  }

  // Allocated time to physically switch tanks/regs in the water.
  var GAS_SWITCH_MIN = 2;

  // Pressure in ATA at a given depth in meters (seawater, 10 m per atm).
  function pressureAta(depthMeters) {
    return 1 + Math.max(0, depthMeters) / 10;
  }

  // Per-segment gas consumption.
  //   sac: surface consumption rate IN THE CURRENT DISPLAY UNIT (L/min or cu ft/min)
  //   startMeters/endMeters/timeMin: depths in METERS, time in minutes
  // Returns volume in the same unit as sac (L or cu ft).
  function consumeSegment(startMeters, endMeters, timeMin, sac) {
    if (!(sac > 0) || !(timeMin > 0)) return 0;
    var avgMeters = (startMeters + endMeters) / 2;
    return sac * pressureAta(avgMeters) * timeMin;
  }

  // ---------- Share URL ----------

  // Serialize the full input state into the URL hash so a plan is shareable
  // by copying the address bar. Hash (not query string) so the server never
  // sees it and the URL can be arbitrarily long.
  function captureStateToUrl() {
    var state = {
      u: units,
      a: $("algorithm").value,
      gfL: parseFloat($("gfLow").value),
      gfH: parseFloat($("gfHigh").value),
      pp: parseFloat($("ppO2").value),
      e: parseFloat($("end").value),
      sac: parseFloat($("sac").value),
      bg: bottomGases,
      dg: decoGases,
      s: segments,
    };
    try {
      var hash = "#plan=" + encodeURIComponent(JSON.stringify(state));
      history.replaceState(null, "", window.location.pathname + hash);
    } catch (e) {
      console.warn("Could not update URL with plan:", e);
    }
  }

  // Apply a state object loaded from a shared URL back into the UI state.
  // Returns true if anything was loaded.
  function restoreStateFromUrl() {
    var hash = window.location.hash || "";
    var m = hash.match(/[#&]plan=([^&]+)/);
    if (!m) return false;
    try {
      var s = JSON.parse(decodeURIComponent(m[1]));
      if (s.u === "imperial" || s.u === "metric") {
        units = s.u;
        $("unitsToggle").value = s.u;
      }
      if (s.a === "buhlmann" || s.a === "vpm") $("algorithm").value = s.a;
      if (typeof s.gfL === "number") $("gfLow").value = s.gfL;
      if (typeof s.gfH === "number") $("gfHigh").value = s.gfH;
      if (typeof s.pp === "number") $("ppO2").value = s.pp;
      if (typeof s.e === "number") $("end").value = s.e;
      if (typeof s.sac === "number") $("sac").value = s.sac;
      if (Array.isArray(s.bg) && s.bg.length) bottomGases = s.bg.map(function (g) {
        return { name: String(g.name || "unnamed"), fO2: +g.fO2 || 0, fHe: +g.fHe || 0 };
      });
      if (Array.isArray(s.dg)) decoGases = s.dg.map(function (g) {
        return { name: String(g.name || "unnamed"), fO2: +g.fO2 || 0, fHe: +g.fHe || 0 };
      });
      if (Array.isArray(s.s) && s.s.length) segments = s.s.map(function (seg) {
        var built = {
          startDepth: +seg.startDepth || 0,
          endDepth: +seg.endDepth || 0,
          gasName: String(seg.gasName || ""),
          time: +seg.time || 0,
        };
        // Either honour an explicit kind from the URL (post-rewrite) or infer
        // from depth direction (so old shared URLs still work).
        built.kind = (seg.kind === "descent" || seg.kind === "flat" || seg.kind === "ascent")
          ? seg.kind
          : inferKind(built);
        return built;
      });
      return true;
    } catch (e) {
      console.warn("Failed to parse shared plan from URL:", e);
      return false;
    }
  }

  function copyShareLink() {
    captureStateToUrl();
    var url = window.location.href;
    var done = function () {
      var btn = $("copyShareLink");
      var orig = btn.textContent;
      btn.textContent = "Link copied ✓";
      setTimeout(function () { btn.textContent = orig; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () {
        // Fall through to fallback
        fallbackCopy(url, done);
      });
    } else {
      fallbackCopy(url, done);
    }
  }

  function fallbackCopy(text, cb) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); cb(); }
    catch (e) { window.prompt("Copy this link:", text); }
    document.body.removeChild(ta);
  }

  function renderResult(result) {
    var diveTime = segments.reduce(function (a, s) { return a + (s.time || 0); }, 0);
    var engineTime = result.reduce(function (a, s) { return a + (s.time || 0); }, 0);
    var sac = Math.max(0, parseNum($("sac").value, 0));

    var phaseClass = {
      "descent":    "bg-brine-50 text-brine-800",
      "bottom":     "bg-slate-100 text-slate-700",
      "ascent":     "bg-amber-50 text-amber-800",
      "deco stop":  "bg-rose-50 text-rose-800",
      "gas switch": "bg-kelp-100 text-kelp-800",
    };

    var gasTotals = {};         // gasName -> volume in display units
    function bumpGas(name, vol) {
      if (!(vol > 0)) return;
      gasTotals[name] = (gasTotals[name] || 0) + vol;
    }
    var vUnit = gasVolumeUnitLabel();

    // Walk the engine result and splice in an explicit "gas switch" row each
    // time the gas changes. The switch is GAS_SWITCH_MIN minutes; consumption
    // is split 50/50 between the old and new gas at the switch depth.
    var hasAscended = false;
    var running = 0;
    var lastGas = null;
    var switchCount = 0;
    var rows = [];
    result.forEach(function (s) {
      if (lastGas !== null && s.gasName !== lastGas) {
        var depthDisp = displayDepth(s.startDepth);
        var halfTime = GAS_SWITCH_MIN / 2;
        var switchHalfA = consumeSegment(s.startDepth, s.startDepth, halfTime, sac);
        var switchHalfB = consumeSegment(s.startDepth, s.startDepth, halfTime, sac);
        bumpGas(lastGas, switchHalfA);
        bumpGas(s.gasName, switchHalfB);
        var switchVol = switchHalfA + switchHalfB;
        running += GAS_SWITCH_MIN;
        switchCount++;
        rows.push(
          '<tr class="hover:bg-slate-50">' +
            '<td class="py-1.5 px-2"><span class="inline-flex rounded px-2 py-0.5 text-xs font-medium ' + phaseClass["gas switch"] + '">gas switch</span></td>' +
            '<td class="py-1.5 px-2 tabular-nums">' + depthDisp + '</td>' +
            '<td class="py-1.5 px-2 tabular-nums">' + depthDisp + '</td>' +
            '<td class="py-1.5 px-2 font-medium">' + escapeHtml(lastGas) + ' <span class="text-slate-400">→</span> ' + escapeHtml(s.gasName) + '</td>' +
            '<td class="py-1.5 px-2 tabular-nums">' + GAS_SWITCH_MIN + '</td>' +
            '<td class="py-1.5 px-2 tabular-nums text-slate-500">' + round1(running) + '</td>' +
            '<td class="py-1.5 px-2 tabular-nums">' + round1(switchVol) + '</td>' +
          '</tr>'
        );
      }

      var cls = classifyPhase(s, hasAscended);
      hasAscended = cls.hasAscended;
      running += s.time;
      var startDisp = displayDepth(s.startDepth);
      var endDisp   = displayDepth(s.endDepth);
      var vol = consumeSegment(s.startDepth, s.endDepth, s.time, sac);
      bumpGas(s.gasName, vol);
      rows.push(
        '<tr class="hover:bg-slate-50">' +
          '<td class="py-1.5 px-2"><span class="inline-flex rounded px-2 py-0.5 text-xs font-medium ' + (phaseClass[cls.phase] || "") + '">' + cls.phase + "</span></td>" +
          '<td class="py-1.5 px-2 tabular-nums">' + startDisp + "</td>" +
          '<td class="py-1.5 px-2 tabular-nums">' + endDisp + "</td>" +
          '<td class="py-1.5 px-2">' + escapeHtml(s.gasName) + "</td>" +
          '<td class="py-1.5 px-2 tabular-nums">' + round1(s.time) + "</td>" +
          '<td class="py-1.5 px-2 tabular-nums text-slate-500">' + round1(running) + "</td>" +
          '<td class="py-1.5 px-2 tabular-nums">' + round1(vol) + "</td>" +
        "</tr>"
      );
      lastGas = s.gasName;
    });

    var totalTime = engineTime + switchCount * GAS_SWITCH_MIN;
    var decoTime = Math.max(0, totalTime - diveTime);

    // Total gas + per-gas breakdown
    var grandVol = 0;
    Object.keys(gasTotals).forEach(function (k) { grandVol += gasTotals[k]; });

    var breakdownHtml = Object.keys(gasTotals).sort().map(function (name) {
      return (
        '<span class="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs">' +
          '<span class="font-medium text-slate-700">' + escapeHtml(name) + '</span>' +
          '<span class="text-slate-500 tabular-nums">' + round1(gasTotals[name]) + ' ' + vUnit + '</span>' +
        '</span>'
      );
    }).join(" ");

    $("planBody").innerHTML = rows.join("");
    $("totalTime").textContent = round1(totalTime);
    $("decoTime").textContent = round1(decoTime);
    $("totalGas").textContent = round1(grandVol);
    $("gasUnitLabel").textContent = vUnit;
    $("gasBreakdown").innerHTML = breakdownHtml;
    $("gasColUnit").textContent = vUnit;
    $("resultsSection").classList.remove("hidden");
  }

  $("calculateDeco").addEventListener("click", function () {
    var btn = $("calculateDeco");
    if (btn.disabled) return;       // already running
    btn.disabled = true;
    try { calculate(); }
    finally { btn.disabled = false; }
  });

  $("copyShareLink").addEventListener("click", copyShareLink);

  // If we arrived via a shared URL, hydrate state and auto-compute so the
  // recipient sees the plan immediately.
  var loadedFromUrl = restoreStateFromUrl();
  render();
  if (loadedFromUrl) {
    setTimeout(function () {
      var btn = $("calculateDeco");
      btn.disabled = true;
      try { calculate(); }
      finally { btn.disabled = false; }
    }, 0);
  }
})();
