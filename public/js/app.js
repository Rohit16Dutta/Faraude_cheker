(function () {
  "use strict";

  const COURIERS = {
    steadfast: { short: "SF", color: "#0d9488" },
    pathao: { short: "PA", color: "#e11d48" },
    redx: { short: "RX", color: "#dc2626" },
    paperfly: { short: "PF", color: "#2563eb" },
    carrybee: { short: "CB", color: "#d97706" },
  };

  const ICONS = {
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 0h11l-2 4 2 4H5"/></svg>',
  };

  const RECENT_KEY = "courier-check-recent";
  const KEY_KEY = "fraud-checker-key";

  const form = document.getElementById("check-form");
  const input = document.getElementById("phone");
  const goBtn = form.querySelector(".go");
  const keyRow = document.getElementById("key-row");
  const keyInput = document.getElementById("access-key");
  const recentBox = document.getElementById("recent");
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
      else if (k.startsWith("aria-") || k === "role" || k === "for") node.setAttribute(k, v);
      else node[k] = v;
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function looksLikePhone(value) {
    const digits = String(value).replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d)).replace(/\D/g, "");
    return /^(?:88)?01[3-9]\d{8}$/.test(digits);
  }

  // ---------- Recent searches ----------

  function getRecent() {
    const list = storage((s) => JSON.parse(s.getItem(RECENT_KEY) || "[]"));
    return Array.isArray(list) ? list.filter((p) => typeof p === "string").slice(0, 5) : [];
  }

  function addRecent(phone) {
    const list = [phone, ...getRecent().filter((p) => p !== phone)].slice(0, 5);
    storage((s) => s.setItem(RECENT_KEY, JSON.stringify(list)));
    renderRecent(phone);
  }

  function renderRecent(current) {
    const list = getRecent().filter((p) => p !== current);
    recentBox.hidden = !list.length;
    recentBox.replaceChildren(...list.map((phone) => {
      const chip = el("button", { type: "button", class: "chip" }, phone);
      chip.addEventListener("click", () => {
        input.value = phone;
        check(phone);
      });
      return chip;
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
      throw new Error("No connection");
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
      throw new Error("Enter the access key");
    }
    if (!data) throw new Error("Server not running");
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    storage((s) => (keyInput.value ? s.setItem(KEY_KEY, keyInput.value) : s.removeItem(KEY_KEY)));
    return data;
  }

  function loadReasons() {
    if (!reasonOptions) {
      reasonOptions = api("/api/couriers").then((d) => d.reasons).catch((e) => {
        reasonOptions = null;
        throw e;
      });
    }
    return reasonOptions;
  }

  // ---------- Check ----------

  function setBusy(on) {
    busy = on;
    goBtn.classList.toggle("busy", on);
    goBtn.disabled = on;
  }

  function showSkeleton() {
    document.body.classList.add("has-result");
    result.hidden = false;
    result.replaceChildren(
      el("div", { class: "skeleton", style: "height:176px" }),
      el("div", { class: "skeleton", style: "height:84px" }),
      el("div", { class: "skeleton", style: "height:280px" })
    );
  }

  function showMessage(title, text) {
    result.hidden = false;
    result.replaceChildren(el("div", { class: "card message" }, el("strong", null, title), text ? el("p", null, text) : null));
  }

  async function check(raw, refresh) {
    const phone = String(raw || "").trim();
    if (!phone) {
      input.focus();
      return;
    }
    if (busy) return;
    if (!looksLikePhone(phone)) {
      document.body.classList.add("has-result");
      showMessage("Invalid number", "Use an 11-digit number like 01712345678");
      return;
    }
    setBusy(true);
    showSkeleton();
    try {
      const data = await api(`/api/check?phone=${encodeURIComponent(phone)}${refresh ? "&refresh=1" : ""}`);
      input.value = data.phone;
      addRecent(data.phone);
      render(data);
    } catch (e) {
      showMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ---------- Render ----------

  function ring(rate, level) {
    const r = 56;
    const c = 2 * Math.PI * r;
    const value = el("div", { class: "ring tone-" + level });
    value.innerHTML =
      `<svg viewBox="0 0 128 128" aria-hidden="true"><circle class="track" cx="64" cy="64" r="${r}"/>` +
      `<circle class="value" cx="64" cy="64" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg>`;
    value.append(el("div", { class: "label" },
      el("strong", null, rate == null ? "—" : `${Math.round(rate)}%`),
      el("small", null, "success")));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      value.querySelector(".value").style.strokeDashoffset = String(c * (1 - (rate || 0) / 100));
    }));
    return value;
  }

  function bar(success, cancel) {
    const total = success + cancel;
    const b = el("div", { class: "bar", "aria-hidden": "true" });
    if (total) {
      const ok = el("i", { class: "ok" });
      const bad = el("i", { class: "bad" });
      ok.style.width = "0%";
      bad.style.width = "0%";
      b.append(ok, bad);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        ok.style.width = (success / total) * 100 + "%";
        bad.style.width = (cancel / total) * 100 + "%";
      }));
    }
    return b;
  }

  function courierRow(c) {
    const meta = COURIERS[c.id] || { short: c.name.slice(0, 2).toUpperCase(), color: "#64748b" };
    const avatar = el("div", { class: "avatar", style: `--c:${meta.color}`, "aria-hidden": "true" }, meta.short);
    const main = el("div", { class: "row-main" }, el("div", { class: "row-name" }, c.name));
    let val;

    if (c.status === "not_configured") {
      val = el("div", { class: "row-val" }, el("span", null, "Off"));
    } else if (c.status !== "ok") {
      val = el("div", { class: "row-val", title: c.error }, el("span", null, "Unavailable"));
    } else if (!c.total) {
      main.append(bar(0, 0));
      val = el("div", { class: "row-val" }, el("strong", null, "0"), el("span", null, "orders"));
    } else {
      const decided = c.success + c.cancel;
      const rate = decided ? Math.round((c.success / decided) * 100) : 0;
      main.append(bar(c.success, c.cancel));
      val = el("div", { class: "row-val" },
        el("strong", null, `${rate}%`),
        el("span", null, `${c.success}/${decided}`));
    }
    return el("div", { class: "row" + (c.status === "ok" ? "" : " off") }, avatar, main, val);
  }

  function render(data) {
    const o = data.overall;
    const nodes = [];

    const verdict = el("div", { class: "verdict tone-" + o.level },
      el("span", { class: "badge" }, o.title),
      el("h2", null, data.phone),
      el("p", null, o.advice));
    if (o.notes.length) verdict.append(el("div", { class: "tags" }, ...o.notes.map((n) => el("span", { class: "tag" }, n))));
    nodes.push(el("div", { class: "card hero" }, ring(o.successRate, o.level), verdict));

    nodes.push(el("div", { class: "stats" },
      el("div", { class: "card stat" }, el("strong", null, String(o.total)), el("span", null, "Orders")),
      el("div", { class: "card stat ok" }, el("strong", null, String(o.success)), el("span", null, "Delivered")),
      el("div", { class: "card stat bad" }, el("strong", null, String(o.cancel)), el("span", null, "Cancelled"))));

    nodes.push(el("div", { class: "card list" }, ...data.couriers.map(courierRow)));

    if (data.reports.length) {
      nodes.push(el("div", { class: "reports" }, ...data.reports.map((r) =>
        el("div", { class: "report-item" },
          el("div", null, el("strong", null, r.reasonLabel || r.reason), r.note ? el("p", null, r.note) : null),
          el("span", null, new Date(r.createdAt).toLocaleDateString())))));
    }

    const recheck = el("button", { type: "button", class: "btn", html: ICONS.refresh + "Refresh" });
    recheck.addEventListener("click", () => check(data.phone, true));
    const report = el("button", { type: "button", class: "btn danger", html: ICONS.flag + "Report", "aria-expanded": "false" });
    const toolbar = el("div", { class: "toolbar" }, recheck, report);
    nodes.push(toolbar);

    report.addEventListener("click", () => {
      const existing = result.querySelector(".report-form");
      if (existing) {
        existing.remove();
        report.setAttribute("aria-expanded", "false");
        return;
      }
      report.setAttribute("aria-expanded", "true");
      toolbar.after(reportForm(data.phone));
    });

    if (data.demo) nodes.push(el("p", { class: "demo" }, "Demo data"));

    result.hidden = false;
    result.replaceChildren(...nodes);
  }

  function reportForm(phone) {
    const reasons = el("div", { class: "reasons", role: "radiogroup", "aria-label": "Reason" });
    const note = el("input", { class: "field", type: "text", maxLength: 300, placeholder: "Note (optional)", "aria-label": "Note" });
    const msg = el("p", { class: "form-msg", "aria-live": "polite" });
    const submit = el("button", { type: "submit", class: "btn primary" }, "Submit report");
    const f = el("form", { class: "card report-form" }, reasons, note, submit, msg);

    loadReasons().then((options) => {
      Object.entries(options).forEach(([value, text], i) => {
        const id = "reason-" + value;
        reasons.append(
          el("input", { type: "radio", name: "reason", id, value, checked: i === 0 }),
          el("label", { for: id }, text));
      });
    }).catch((e) => {
      msg.textContent = e.message;
    });

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const chosen = f.querySelector('input[name="reason"]:checked');
      if (!chosen) return;
      submit.disabled = true;
      try {
        await api("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, reason: chosen.value, note: note.value }),
        });
        await check(phone);
      } catch (err) {
        msg.textContent = err.message;
        submit.disabled = false;
      }
    });

    requestAnimationFrame(() => {
      const first = f.querySelector('input[name="reason"]');
      if (first) first.focus();
    });
    return f;
  }

  // ---------- Wiring ----------

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    check(input.value);
  });

  // Pasting a full number checks it straight away.
  input.addEventListener("paste", () => {
    setTimeout(() => {
      if (looksLikePhone(input.value)) check(input.value);
    }, 0);
  });

  keyInput.value = storage((s) => s.getItem(KEY_KEY)) || "";
  if (keyInput.value) keyRow.hidden = false;
  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") check(input.value);
  });

  renderRecent();
})();
