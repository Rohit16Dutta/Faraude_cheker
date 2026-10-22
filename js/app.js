(function () {
  "use strict";

  const MODES = {
    url: {
      label: "Paste the link you want to check",
      placeholder: "e.g. http://paypa1-secure-login.xyz/verify",
      example: "http://paypa1-account-verify.xyz/login?session=update",
      multiline: false,
      run: FraudChecks.checkUrl,
    },
    message: {
      label: "Paste the message you received",
      placeholder: "Paste the SMS, WhatsApp or email text here…",
      example: "Dear customer, your SBI account will be BLOCKED today due to pending KYC update. Verify your account immediately at http://sbi-kyc-update.top/login and share the OTP with our officer.",
      multiline: true,
      run: FraudChecks.checkMessage,
    },
    email: {
      label: "Paste the sender's email address",
      placeholder: "e.g. support@amaz0n-billing.com",
      example: "paypal.security.team@gmail.com",
      multiline: false,
      run: FraudChecks.checkEmail,
    },
  };

  const VERDICTS = {
    high: { icon: "🚨", title: "High risk — likely a scam", text: "Several strong warning signs. Don't click, reply, pay or share any details." },
    medium: { icon: "⚠️", title: "Suspicious — be careful", text: "Some warning signs found. Verify through an official channel before doing anything." },
    low: { icon: "✅", title: "No major red flags found", text: "That's a good sign, but no tool can guarantee something is safe. Stay alert." },
  };

  const tabs = document.querySelectorAll('[role="tab"]');
  const form = document.getElementById("panel");
  const label = document.getElementById("input-label");
  const input = document.getElementById("input");
  const textarea = document.getElementById("input-text");
  const exampleBtn = document.getElementById("example");
  const result = document.getElementById("result");

  let mode = "url";

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
    label.htmlFor = field().id;
    field().placeholder = cfg.placeholder;
    result.hidden = true;
  }

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    Object.assign(node, attrs || {});
    if (text != null) node.textContent = text;
    return node;
  }

  const ORDER = { high: 0, medium: 1, low: 2, info: 3 };

  function render(report) {
    result.replaceChildren();
    result.hidden = false;

    if (report.error) {
      result.append(el("p", { className: "error" }, report.error));
      return;
    }

    const v = VERDICTS[report.level];
    const verdict = el("div", { className: "verdict " + report.level });
    const body = el("div");
    body.append(el("h2", null, v.title), el("p", null, v.text));
    verdict.append(el("div", { className: "icon", ariaHidden: "true" }, v.icon), body);

    const meter = el("div", { className: "meter", role: "img", ariaLabel: `Risk score ${report.score} out of 100` });
    const bar = el("span", { className: report.level });
    bar.style.width = Math.max(4, report.score) + "%";
    meter.append(bar);

    const meterLabel = el("p", { className: "meter-label" },
      `Risk score: ${report.score}/100` + (report.target ? ` · Checked: ${report.target}` : ""));

    result.append(verdict, meter, meterLabel);

    const findings = report.findings.slice().sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    if (findings.length) {
      result.append(el("h3", null, "What we found"));
      const list = el("ul", { className: "findings" });
      for (const f of findings) {
        const li = el("li", { className: f.severity });
        const title = el("strong");
        title.append(el("span", { className: "badge" }, f.severity === "info" ? "note" : f.severity), f.title);
        li.append(title, el("span", null, f.detail));
        list.append(li);
      }
      result.append(list);
    } else {
      result.append(el("p", null, "None of our warning-sign checks were triggered."));
    }
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    render(MODES[mode].run(field().value));
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit();
  });

  exampleBtn.addEventListener("click", () => {
    field().value = MODES[mode].example;
    render(MODES[mode].run(field().value));
  });

  setMode("url");
})();
