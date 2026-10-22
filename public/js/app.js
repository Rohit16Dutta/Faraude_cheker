(function () {
  "use strict";

  const ICONS = {
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 0h11l-2 4 2 4H5"/></svg>',
  };

  const RECENT_KEY = "courier-check-recent";
  const KEY_KEY = "fraud-checker-key";

  const form = document.getElementById("check-form");
  const input = document.getElementById("phone");
  const checkBtn = document.getElementById("check-btn");
  const phoneError = document.getElementById("phone-error");
  const keyRow = document.getElementById("key-row");
  const keyInput = document.getElementById("access-key");
  const recentBox = document.getElementById("recent");
  const connection = document.getElementById("connection");
  const result = document.getElementById("result");

  let reasonOptions = null;
  let busy = false;

  function storage(fn) {
    try {
      return fn(window.localStorage);
    } catch (e) {
      return null;
    }
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.startsWith("aria-") || k === "role" || k === "for" || k === "scope" || k === "datetime") node.setAttribute(k, v);
      else node[k] = v;
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function looksLikePhone(value) {
    const digits = String(value).replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d)).replace(/\D/g, "");
    return /^(?:88)?01[3-9]\d{8}$/.test(digits);
  }

  // 01712345678 -> 01712-345678, the way numbers are usually written in Bangladesh.
  function formatPhone(phone) {
    return /^\d{11}$/.test(phone) ? `${phone.slice(0, 5)}-${phone.slice(5)}` : phone;
  }

  function pct(n) {
    return n == null ? "—" : `${Math.round(n * 10) / 10}%`;
  }

  // ---------- Recent lookups ----------

  function getRecent() {
    const list = storage((s) => JSON.parse(s.getItem(RECENT_KEY) || "[]"));
    return Array.isArray(list) ? list.filter((p) => typeof p === "string").slice(0, 5) : [];
  }

  function addRecent(phone) {
    storage((s) => s.setItem(RECENT_KEY, JSON.stringify([phone, ...getRecent().filter((p) => p !== phone)].slice(0, 5))));
    renderRecent(phone);
  }

  function renderRecent(current) {
    const list = getRecent().filter((p) => p !== current);
    recentBox.hidden = !list.length;
    recentBox.replaceChildren(el("span", null, "Recent"), ...list.map((phone) => {
      const b = el("button", { type: "button" }, formatPhone(phone));
      b.addEventListener("click", () => {
        input.value = formatPhone(phone);
        check(phone);
      });
      return b;
    }));
  }

  // ---------- API ----------

  async function api(url, options) {
    const headers = Object.assign({ Accept: "application/json" }, options && options.headers);
    if (keyInput.value) headers["X-Access-Key"] = keyInput.value;
    let res;
    try {
      res = await fetch(url, Object.assign({}, options, { headers }));
    } catch (e) {
      throw new Error("Can't reach the server. Check your connection and try again.");
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (res.status === 401) {
      keyRow.hidden = false;
      keyInput.focus();
      const err = new Error("Enter the access key to continue.");
      err.auth = true;
      throw err;
    }
    if (!data) throw new Error("The server isn't responding. Start it with npm start.");
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    storage((s) => (keyInput.value ? s.setItem(KEY_KEY, keyInput.value) : s.removeItem(KEY_KEY)));
    return data;
  }

  function loadMeta() {
    if (!reasonOptions) {
      reasonOptions = api("/api/couriers").catch((e) => {
        reasonOptions = null;
        throw e;
      });
    }
    return reasonOptions;
  }

  function showConnection() {
    loadMeta().then((meta) => {
      const on = meta.couriers.filter((c) => c.configured).length;
      const all = meta.couriers.length;
      connection.className = "connection " + (meta.demo ? "partial" : on === all ? "ok" : on ? "partial" : "none");
      connection.textContent = meta.demo ? "Demo mode" : `${on} of ${all} couriers connected`;
      connection.hidden = false;
    }).catch(() => {});
  }

  // ---------- Lookup ----------

  function setError(message) {
    phoneError.textContent = message || "";
    phoneError.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function setBusy(on) {
    busy = on;
    checkBtn.disabled = on;
    checkBtn.textContent = on ? "Checking…" : "Check";
  }

  function showLoading() {
    const lines = [70, 45, 90, 60].map((w) => el("div", { class: "skeleton-line", style: `width:${w}%` }));
    result.hidden = false;
    result.replaceChildren(el("div", { class: "panel panel-body", style: "display:grid;gap:14px", "aria-label": "Loading" }, ...lines));
  }

  async function check(raw, refresh) {
    const phone = String(raw || "").trim();
    if (busy) return;
    if (!phone) {
      setError("Enter a phone number.");
      input.focus();
      return;
    }
    if (!looksLikePhone(phone)) {
      setError("Enter an 11-digit Bangladeshi mobile number, e.g. 01712-345678.");
      input.focus();
      return;
    }
    setError("");
    setBusy(true);
    showLoading();
    try {
      const data = await api(`/api/check?phone=${encodeURIComponent(phone)}${refresh ? "&refresh=1" : ""}`);
      input.value = formatPhone(data.phone);
      addRecent(data.phone);
      render(data);
      showConnection();
    } catch (e) {
      result.replaceChildren(el("div", { class: "alert", role: "alert" }, e.message));
    } finally {
      setBusy(false);
    }
  }

  // ---------- Render ----------

  function meter(success, cancel) {
    const total = success + cancel;
    const m = el("div", { class: "meter", "aria-hidden": "true" });
    if (total) {
      const ok = el("i", { class: "ok" });
      ok.style.width = (success / total) * 100 + "%";
      const bad = el("i", { class: "bad" });
      bad.style.width = (cancel / total) * 100 + "%";
      m.append(ok, bad);
    }
    return m;
  }

  function summaryPanel(data) {
    const o = data.overall;
    const advice = el("div", { class: "advice" }, el("strong", null, o.advice));
    if (o.notes.length) advice.append(el("span", { class: "notes" }, o.notes.join(" · ")));

    return el("article", { class: "panel" },
      el("div", { class: "summary-top" },
        el("div", null,
          el("div", { class: "eyebrow" }, "Customer"),
          el("div", { class: "phone" }, formatPhone(data.phone))),
        el("span", { class: "status s-" + o.level }, o.title)),
      el("dl", { class: "metrics" },
        el("div", null, el("dt", null, "Success rate"), el("dd", null, pct(o.successRate))),
        el("div", null, el("dt", null, "Total orders"), el("dd", null, String(o.total))),
        el("div", null, el("dt", null, "Delivered"), el("dd", { class: o.success ? "pos" : null }, String(o.success))),
        el("div", null, el("dt", null, "Returned"), el("dd", { class: o.cancel ? "neg" : null }, String(o.cancel)))),
      meter(o.success, o.cancel),
      advice);
  }

  function courierRow(c) {
    const name = el("th", { scope: "row" }, c.name);
    if (c.status !== "ok") {
      const label = c.status === "not_configured" ? "Not connected" : "Unavailable";
      return el("tr", null, name,
        el("td", { class: "num muted" }, "—"),
        el("td", { class: "num muted hide-sm" }, "—"),
        el("td", { class: "num muted hide-sm" }, "—"),
        el("td", { class: "muted", title: c.status === "error" ? c.error : null }, label));
    }
    const decided = c.success + c.cancel;
    const rate = decided ? (c.success / decided) * 100 : null;
    return el("tr", null, name,
      el("td", { class: "num" }, String(c.total)),
      el("td", { class: "num hide-sm" }, String(c.success)),
      el("td", { class: "num hide-sm" }, String(c.cancel)),
      el("td", { class: "rate-cell" },
        c.total
          ? el("div", { class: "rate" }, meter(c.success, c.cancel), el("b", null, pct(rate)))
          : el("span", { class: "muted" }, "No orders"),
        c.total ? el("div", { class: "rate-sub" }, `${c.success} delivered · ${c.cancel} returned`) : null));
  }

  function couriersPanel(data) {
    const refresh = el("button", { type: "button", class: "btn", html: ICONS.refresh + "Refresh" });
    refresh.addEventListener("click", () => check(data.phone, true));
    const time = new Date(data.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    return el("section", { class: "panel", "aria-labelledby": "couriers-h" },
      el("div", { class: "panel-head" },
        el("h2", { id: "couriers-h" }, "Couriers"),
        el("div", { class: "head-actions" }, el("span", { class: "meta" }, `Updated ${time}`), refresh)),
      el("table", { class: "table" },
        el("thead", null, el("tr", null,
          el("th", { scope: "col" }, "Courier"),
          el("th", { scope: "col", class: "num" }, "Orders"),
          el("th", { scope: "col", class: "num hide-sm" }, "Delivered"),
          el("th", { scope: "col", class: "num hide-sm" }, "Returned"),
          el("th", { scope: "col" }, "Success rate"))),
        el("tbody", null, ...data.couriers.map(courierRow))));
  }

  function reportsPanel(data) {
    const toggle = el("button", { type: "button", class: "btn btn-danger", html: ICONS.flag + "Report customer", "aria-expanded": "false" });
    const panel = el("section", { class: "panel", "aria-labelledby": "reports-h" },
      el("div", { class: "panel-head" },
        el("h2", { id: "reports-h" }, data.reports.length ? `Seller reports (${data.reports.length})` : "Seller reports"),
        toggle));

    if (data.reports.length) {
      panel.append(el("ul", { class: "report-list" }, ...data.reports.map((r) => {
        const d = new Date(r.createdAt);
        return el("li", null,
          el("div", null, el("div", { class: "reason" }, r.reasonLabel || r.reason), r.note ? el("div", { class: "note" }, r.note) : null),
          el("time", { datetime: r.createdAt }, d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })));
      })));
    } else {
      panel.append(el("div", { class: "panel-body" }, el("p", { class: "empty" }, "No reports for this number.")));
    }

    toggle.addEventListener("click", () => {
      const open = panel.querySelector(".report-form");
      if (open) {
        open.remove();
        toggle.setAttribute("aria-expanded", "false");
        return;
      }
      toggle.setAttribute("aria-expanded", "true");
      panel.append(reportForm(data.phone, () => {
        panel.querySelector(".report-form").remove();
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }));
      panel.querySelector("#report-reason").focus();
    });
    return panel;
  }

  function reportForm(phone, close) {
    const select = el("select", { class: "input", id: "report-reason", required: true });
    const note = el("input", { class: "input", id: "report-note", type: "text", maxLength: 300, placeholder: "Optional" });
    const msg = el("p", { class: "form-msg", "aria-live": "polite" });
    const cancel = el("button", { type: "button", class: "btn" }, "Cancel");
    const submit = el("button", { type: "submit", class: "btn btn-primary" }, "Submit report");
    cancel.addEventListener("click", close);

    const f = el("form", { class: "report-form" },
      el("div", null, el("label", { for: "report-reason", class: "field-label" }, "Reason"), select),
      el("div", null, el("label", { for: "report-note", class: "field-label" }, "Details"), note),
      el("div", { class: "actions" }, msg, cancel, submit));

    loadMeta().then((meta) => {
      select.replaceChildren(...Object.entries(meta.reasons).map(([value, text]) => el("option", { value }, text)));
    }).catch((e) => {
      msg.textContent = e.message;
    });

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!select.value) return;
      submit.disabled = true;
      try {
        await api("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, reason: select.value, note: note.value }),
        });
        await check(phone);
      } catch (err) {
        msg.textContent = err.message;
        submit.disabled = false;
      }
    });
    return f;
  }

  function render(data) {
    const nodes = [summaryPanel(data), couriersPanel(data), reportsPanel(data)];
    if (data.demo) nodes.push(el("p", { class: "demo-note" }, "Demo mode — figures are sample data."));
    result.hidden = false;
    result.replaceChildren(...nodes);
  }

  // ---------- Wiring ----------

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    check(input.value);
  });

  input.addEventListener("input", () => {
    if (!phoneError.hidden) setError("");
  });

  // Pasting a complete number runs the lookup straight away.
  input.addEventListener("paste", () => {
    setTimeout(() => {
      if (looksLikePhone(input.value)) check(input.value);
    }, 0);
  });

  keyInput.value = storage((s) => s.getItem(KEY_KEY)) || "";
  if (keyInput.value) keyRow.hidden = false;
  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      reasonOptions = null;
      showConnection();
      if (input.value) check(input.value);
    }
  });

  renderRecent();
  showConnection();
})();
