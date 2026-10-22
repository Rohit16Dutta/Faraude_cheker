(function () {
  "use strict";

  const COURIER_ICONS = { low: "✅", medium: "⚠️", high: "🚨", new: "🆕", unknown: "❔" };

  const form = document.getElementById("check-form");
  const input = document.getElementById("phone");
  const keyRow = document.getElementById("key-row");
  const keyInput = document.getElementById("access-key");
  const result = document.getElementById("result");

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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    checkPhone(input.value);
  });
})();
