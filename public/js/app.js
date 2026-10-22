(function () {
  "use strict";

  const LOCAL_PRIVACY = "🔒 Nothing leaves your device — this check runs in your browser.";

  const MODES = {
    phone: {
      label: "Customer's mobile number",
      placeholder: "e.g. 01712345678",
      multiline: false,
      inputMode: "tel",
      remote: true,
      privacy: "📦 Checked live with every courier you've connected (Steadfast, Pathao, RedX, Paperfly, Carrybee).",
    },
    url: {
      label: "Paste the link you want to check",
      placeholder: "e.g. http://paypa1-secure-login.xyz/verify",
      example: "http://paypa1-account-verify.xyz/login?session=update",
      multiline: false,
      inputMode: "url",
      run: FraudChecks.checkUrl,
      privacy: LOCAL_PRIVACY,
    },
    message: {
      label: "Paste the message you received",
      placeholder: "Paste the SMS, WhatsApp or email text here…",
      example: "Dear customer, your SBI account will be BLOCKED today due to pending KYC update. Verify your account immediately at http://sbi-kyc-update.top/login and share the OTP with our officer.",
      multiline: true,
      run: FraudChecks.checkMessage,
      privacy: LOCAL_PRIVACY,
    },
    email: {
      label: "Paste the sender's email address",
      placeholder: "e.g. support@amaz0n-billing.com",
      example: "paypal.security.team@gmail.com",
      multiline: false,
      inputMode: "email",
      run: FraudChecks.checkEmail,
      privacy: LOCAL_PRIVACY,
    },
  };

  const VERDICTS = {
    high: { icon: "🚨", title: "High risk — likely a scam", text: "Several strong warning signs. Don't click, reply, pay or share any details." },
    medium: { icon: "⚠️", title: "Suspicious — be careful", text: "Some warning signs found. Verify through an official channel before doing anything." },
    low: { icon: "✅", title: "No major red flags found", text: "That's a good sign, but no tool can guarantee something is safe. Stay alert." },
  };

  const COURIER_ICONS = { low: "✅", medium: "⚠️", high: "🚨", new: "🆕", unknown: "❔" };

  const tabs = document.querySelectorAll('[role="tab"]');
  const form = document.getElementById("panel");
  const label = document.getElementById("input-label");
  const input = document.getElementById("input");
  const textarea = document.getElementById("input-text");
  const exampleBtn = document.getElementById("example");
  const privacy = document.getElementById("privacy");
  const keyRow = document.getElementById("key-row");
  const keyInput = document.getElementById("access-key");
  const result = document.getElementById("result");

  let mode = "phone";
  let reasonOptions = null;

  function storage(fn) {
    try {
      return fn(window.localStorage);
    } catch (e) {
      return null;
    }
  }

  keyInput.value = storage((s) => s.getItem("fraud-checker-key")) || "";
  if (keyInput.value) keyRow.hidden = false;

  function field() {
    return MODES[mode].multiline ? textarea : input;
  }

  function setMode(next, focus) {
    mode = next;
    const cfg = MODES[mode];
    tabs.forEach((t) => {
      const active = t.dataset.mode === mode;
      t.setAttribute("aria-selected", String(active));
      t.tabIndex = active ? 0 : -1;
      if (active) {
        form.setAttribute("aria-labelledby", t.id);
        if (focus) t.focus();
      }
    });
    label.textContent = cfg.label;
    input.hidden = cfg.multiline;
    textarea.hidden = !cfg.multiline;
    input.inputMode = cfg.inputMode || "text";
    label.htmlFor = field().id;
    field().placeholder = cfg.placeholder;
    privacy.textContent = cfg.privacy;
    // No sample phone number: any valid number could belong to a real person.
    exampleBtn.hidden = Boolean(cfg.remote);
    keyRow.hidden = !(cfg.remote && keyInput.value);
    result.hidden = true;
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") node.className = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.startsWith("aria-") || k === "role") node.setAttribute(k, v);
      else node[k] = v;
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function showError(message) {
    result.replaceChildren(el("p", { class: "error" }, message));
    result.hidden = false;
  }

  // ---------- Link / message / email checks (run locally) ----------

  const ORDER = { high: 0, medium: 1, low: 2, info: 3 };

  function renderLocal(report) {
    result.replaceChildren();
    result.hidden = false;
    if (report.error) return showError(report.error);

    const v = VERDICTS[report.level];
    const bar = el("span", { class: report.level });
    bar.style.width = Math.max(4, report.score) + "%";
    result.append(
      el("div", { class: "verdict " + report.level },
        el("div", { class: "icon", "aria-hidden": "true" }, v.icon),
        el("div", null, el("h2", null, v.title), el("p", null, v.text))),
      el("div", { class: "meter", role: "img", "aria-label": `Risk score ${report.score} out of 100` }, bar),
      el("p", { class: "meter-label" }, `Risk score: ${report.score}/100` + (report.target ? ` · Checked: ${report.target}` : ""))
    );

    const findings = report.findings.slice().sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    if (findings.length) {
      const list = el("ul", { class: "findings" });
      for (const f of findings) {
        list.append(el("li", { class: f.severity },
          el("strong", null, el("span", { class: "badge" }, f.severity === "info" ? "note" : f.severity), f.title),
          el("span", null, f.detail)));
      }
      result.append(el("h3", null, "What we found"), list);
    } else {
      result.append(el("p", null, "None of our warning-sign checks were triggered."));
    }
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---------- Customer phone check (via the server, across all couriers) ----------

  function apiHeaders(extra) {
    const h = Object.assign({ Accept: "application/json" }, extra);
    if (keyInput.value) h["X-Access-Key"] = keyInput.value;
    return h;
  }

  async function apiFetch(url, options) {
    let res;
    try {
      res = await fetch(url, Object.assign({}, options, { headers: apiHeaders(options && options.headers) }));
    } catch (e) {
      throw new Error("Couldn't reach the server. Check your connection and try again.");
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
      throw new Error("This site is protected. Enter the access key above, then try again.");
    }
    if (!data) {
      throw new Error("The courier check needs the Fraud Checker server. Start it with \"npm start\" and open the site from there.");
    }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    storage((s) => (keyInput.value ? s.setItem("fraud-checker-key", keyInput.value) : s.removeItem("fraud-checker-key")));
    return data;
  }

  async function checkPhone(raw, refresh) {
    const phone = String(raw || "").trim();
    if (!phone) return showError("Enter the customer's mobile number.");
    result.replaceChildren(el("p", { class: "loading" }, "⏳ Checking every courier… this can take a few seconds."));
    result.hidden = false;
    try {
      const data = await apiFetch(`/api/check?phone=${encodeURIComponent(phone)}${refresh ? "&refresh=1" : ""}`);
      renderPhone(data);
    } catch (e) {
      showError(e.message);
    }
  }

  function pct(n) {
    return n == null ? "—" : `${n % 1 ? n.toFixed(1) : n}%`;
  }

  function stat(value, caption, cls) {
    return el("div", { class: "stat " + (cls || "") }, el("strong", null, String(value)), el("span", null, caption));
  }

  function splitBar(success, cancel, labelText) {
    const total = success + cancel;
    const bar = el("div", { class: "split", role: "img", "aria-label": labelText });
    if (total) {
      const ok = el("span", { class: "ok" });
      ok.style.width = (success / total) * 100 + "%";
      const bad = el("span", { class: "bad" });
      bad.style.width = (cancel / total) * 100 + "%";
      bar.append(ok, bad);
    }
    return bar;
  }

  function renderPhone(data) {
    const o = data.overall;
    result.replaceChildren();
    result.hidden = false;

    if (data.demo) {
      result.append(el("p", { class: "demo-banner" }, "🧪 Demo mode — these numbers are made up. Add your courier logins to .env to see real data."));
    }

    result.append(
      el("div", { class: "verdict " + o.level },
        el("div", { class: "icon", "aria-hidden": "true" }, COURIER_ICONS[o.level]),
        el("div", null, el("h2", null, o.title), el("p", null, o.advice))),
      el("div", { class: "stats" },
        stat(pct(o.successRate), "Success rate", o.level),
        stat(o.total, "Total parcels"),
        stat(o.success, "Delivered", "low"),
        stat(o.cancel, "Cancelled / returned", "high")),
      splitBar(o.success, o.cancel, `${o.success} delivered, ${o.cancel} cancelled`),
      el("p", { class: "meter-label" },
        `${data.phone} · ${o.couriersChecked} courier${o.couriersChecked === 1 ? "" : "s"} checked, ` +
        `${o.couriersWithHistory} with history · ${new Date(data.checkedAt).toLocaleString()}`)
    );

    if (o.notes.length) {
      result.append(el("ul", { class: "notes" }, ...o.notes.map((n) => el("li", null, n))));
    }

    const rows = data.couriers.map((c) => {
      if (c.status !== "ok") {
        return el("tr", { class: "muted" },
          el("th", { scope: "row" }, c.name),
          el("td", { colSpan: 4 }, c.status === "not_configured" ? "Not connected" : `⚠️ ${c.error}`));
      }
      const decided = c.success + c.cancel;
      const rate = decided ? Math.round((c.success / decided) * 1000) / 10 : null;
      return el("tr", null,
        el("th", { scope: "row" }, c.name),
        el("td", { class: "num" }, String(c.total)),
        el("td", { class: "num" }, String(c.success)),
        el("td", { class: "num" }, String(c.cancel)),
        el("td", { class: "rate" },
          c.total ? splitBar(c.success, c.cancel, `${pct(rate)} success`) : null,
          el("span", null, c.total ? pct(rate) : "No history")));
    });

    result.append(
      el("h3", null, "By courier"),
      el("div", { class: "table-wrap" },
        el("table", { class: "couriers" },
          el("thead", null, el("tr", null,
            el("th", { scope: "col" }, "Courier"),
            el("th", { scope: "col", class: "num" }, "Total"),
            el("th", { scope: "col", class: "num" }, "Delivered"),
            el("th", { scope: "col", class: "num" }, "Cancelled"),
            el("th", { scope: "col" }, "Success"))),
          el("tbody", null, ...rows)))
    );

    const reportsBox = el("div", { class: "reports" });
    renderReports(reportsBox, data.reports);
    result.append(el("h3", null, "Merchant reports"), reportsBox, reportForm(data.phone));

    const refresh = el("button", { type: "button", class: "ghost small" }, "↻ Re-check now");
    refresh.addEventListener("click", () => checkPhone(data.phone, true));
    result.append(el("div", { class: "actions" }, refresh));
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderReports(box, reports) {
    if (!reports.length) {
      box.replaceChildren(el("p", { class: "muted-text" }, "No merchant has reported this number yet."));
      return;
    }
    box.replaceChildren(el("ul", { class: "findings" }, ...reports.map((r) =>
      el("li", { class: "high" },
        el("strong", null, r.reasonLabel || r.reason),
        el("span", null, [r.note, r.shop && `— ${r.shop}`, new Date(r.createdAt).toLocaleDateString()].filter(Boolean).join(" · "))))));
  }

  function reportForm(phone) {
    const select = el("select", { id: "report-reason", required: true });
    const note = el("textarea", { id: "report-note", rows: 2, maxLength: 300, placeholder: "What happened? (optional)" });
    const shop = el("input", { id: "report-shop", type: "text", maxLength: 60, placeholder: "Your shop name (optional)" });
    const status = el("p", { class: "muted-text", "aria-live": "polite" });
    const submit = el("button", { type: "submit", class: "primary small" }, "Submit report");

    const f = el("form", { class: "report-form" },
      el("label", { htmlFor: "report-reason" }, "Reason"), select,
      el("label", { htmlFor: "report-note" }, "Details"), note,
      el("label", { htmlFor: "report-shop" }, "Shop"), shop,
      el("div", { class: "actions" }, submit), status);

    loadReasons().then((reasons) => {
      select.replaceChildren(...Object.entries(reasons).map(([value, text]) => el("option", { value }, text)));
    }).catch(() => {
      status.textContent = "Couldn't load report options.";
    });

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.disabled = true;
      status.textContent = "Saving…";
      try {
        await apiFetch("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, reason: select.value, note: note.value, shop: shop.value }),
        });
        await checkPhone(phone);
      } catch (err) {
        status.textContent = err.message;
        submit.disabled = false;
      }
    });

    return el("details", { class: "report" }, el("summary", null, "🚩 Report this customer"), f);
  }

  async function loadReasons() {
    if (!reasonOptions) {
      reasonOptions = apiFetch("/api/couriers").then((d) => d.reasons).catch((e) => {
        reasonOptions = null;
        throw e;
      });
    }
    return reasonOptions;
  }

  // ---------- Wiring ----------

  function run() {
    const cfg = MODES[mode];
    if (cfg.remote) checkPhone(field().value);
    else renderLocal(cfg.run(field().value));
  }

  tabs.forEach((t) => {
    t.addEventListener("click", () => setMode(t.dataset.mode));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const list = Array.from(tabs);
      const i = list.indexOf(t) + (e.key === "ArrowRight" ? 1 : -1);
      setMode(list[(i + list.length) % list.length].dataset.mode, true);
    });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit();
  });

  exampleBtn.addEventListener("click", () => {
    field().value = MODES[mode].example;
    run();
  });

  setMode("phone");
})();
