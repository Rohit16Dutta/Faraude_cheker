/*
 * Fraud Checker — heuristic rules.
 * Pure functions with no DOM access so they can run in the browser and in Node tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FraudChecks = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const WEIGHTS = { high: 50, medium: 20, low: 8, info: 0 };

  // Brands commonly impersonated in phishing, mapped to their official registrable domains.
  const BRANDS = {
    paypal: ["paypal.com", "paypal.me"],
    apple: ["apple.com", "icloud.com"],
    amazon: ["amazon.com", "amazon.in", "amazon.co.uk", "amazon.de", "amazon.ca", "amazon.com.au", "amazon.fr", "amazon.es", "amazon.it", "amazon.co.jp", "amazonaws.com"],
    microsoft: ["microsoft.com", "live.com", "outlook.com", "office.com", "microsoftonline.com"],
    google: ["google.com", "gmail.com", "youtube.com", "google.co.in", "google.co.uk", "googleapis.com", "googleusercontent.com", "gstatic.com"],
    netflix: ["netflix.com"],
    facebook: ["facebook.com", "fb.com"],
    instagram: ["instagram.com"],
    whatsapp: ["whatsapp.com", "whatsapp.net"],
    linkedin: ["linkedin.com"],
    coinbase: ["coinbase.com"],
    binance: ["binance.com"],
    chase: ["chase.com"],
    wellsfargo: ["wellsfargo.com"],
    bankofamerica: ["bankofamerica.com"],
    sbi: ["onlinesbi.sbi", "sbi.co.in", "sbi.bank.in"],
    hdfc: ["hdfcbank.com", "hdfc.com", "hdfcbank.bank.in"],
    icici: ["icicibank.com", "icicibank.bank.in"],
    hdfcbank: ["hdfcbank.com", "hdfcbank.bank.in"],
    icicibank: ["icicibank.com", "icicibank.bank.in"],
    onlinesbi: ["onlinesbi.sbi", "sbi.co.in", "sbi.bank.in"],
    paytm: ["paytm.com"],
    phonepe: ["phonepe.com"],
    flipkart: ["flipkart.com"],
    fedex: ["fedex.com"],
    dhl: ["dhl.com"],
    usps: ["usps.com"],
    ups: ["ups.com"],
    irs: ["irs.gov"],
  };

  const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "cutt.ly", "rb.gy", "shorturl.at", "tiny.cc", "rebrand.ly", "s.id", "t.ly"];

  const RISKY_TLDS = ["zip", "mov", "xyz", "top", "tk", "ml", "ga", "cf", "gq", "click", "country", "work", "loan", "men", "gdn", "kim", "rest", "support", "cam", "buzz", "icu", "monster", "cyou", "sbs", "lol", "quest"];

  const DISPOSABLE_EMAIL_DOMAINS = ["mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "getnada.com", "sharklasers.com", "dispostable.com", "throwawaymail.com", "maildrop.cc", "fakeinbox.com"];

  const FREE_EMAIL_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "aol.com", "icloud.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "yandex.com", "rediffmail.com"];

  const SECOND_LEVEL = ["co", "com", "org", "net", "gov", "ac", "edu", "bank"];

  const PATH_KEYWORDS = ["login", "signin", "sign-in", "verify", "verification", "secure", "account", "update", "confirm", "wallet", "password", "banking", "unlock", "suspend", "kyc", "billing"];

  const LEET = { 0: "o", 1: "l", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", "@": "a", $: "s" };

  function finding(severity, title, detail) {
    return { severity, title, detail };
  }

  function summarize(findings) {
    const score = Math.min(100, findings.reduce((sum, f) => sum + (WEIGHTS[f.severity] || 0), 0));
    let level = "low";
    if (score >= 50) level = "high";
    else if (score >= 20) level = "medium";
    return { score, level, findings };
  }

  function registrableDomain(host) {
    const labels = host.split(".").filter(Boolean);
    if (labels.length <= 2) return labels.join(".");
    const tld = labels[labels.length - 1];
    const sld = labels[labels.length - 2];
    if (tld.length === 2 && SECOND_LEVEL.includes(sld)) return labels.slice(-3).join(".");
    return labels.slice(-2).join(".");
  }

  function deLeet(s) {
    return s.replace(/[0134578@$]/g, (c) => LEET[c] || c).replace(/rn/g, "m").replace(/vv/g, "w");
  }

  function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[a.length][b.length];
  }

  function isOfficial(domain, official) {
    return official.includes(domain);
  }

  // Look for a brand name inside a host that does not belong to that brand.
  function brandFindings(host) {
    const out = [];
    const domain = registrableDomain(host);
    const tokens = host.split(/[.-]/).filter(Boolean);
    const flat = host.replace(/[.-]/g, "");
    const flatDeLeet = deLeet(flat);
    const mainLabel = domain.split(".")[0];

    for (const [brand, official] of Object.entries(BRANDS)) {
      if (isOfficial(domain, official)) continue;
      const short = brand.length < 6;
      const literal = short ? tokens.includes(brand) : flat.includes(brand);
      const lookalike = !literal && (short ? tokens.map(deLeet).includes(brand) : flatDeLeet.includes(brand));
      const typo = !literal && !lookalike && brand.length >= 6 && levenshtein(mainLabel, brand) === 1;

      if (literal) {
        out.push(finding("high", `Uses the name "${brand}" but isn't an official ${brand} domain`,
          `The real site is ${official[0]}. Scammers put brand names in fake domains to look legitimate.`));
      } else if (lookalike) {
        out.push(finding("high", `Lookalike of "${brand}"`,
          `The domain swaps characters (like 0 for o or 1 for l) to imitate ${official[0]}.`));
      } else if (typo) {
        out.push(finding("high", `Misspelling of "${brand}"`,
          `"${mainLabel}" is one letter away from "${brand}" — a classic typosquatting trick. The real site is ${official[0]}.`));
      }
    }
    return out;
  }

  function parseUrl(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    try {
      const url = new URL(hasScheme ? raw : "http://" + raw);
      if (!url.hostname || !/^https?:$/.test(url.protocol)) return null;
      return { url, hasScheme, raw };
    } catch (e) {
      return null;
    }
  }

  function checkUrl(input) {
    const parsed = parseUrl(input);
    if (!parsed) {
      return { error: "That doesn't look like a valid web address. Try something like https://example.com/login" };
    }
    const { url, hasScheme, raw } = parsed;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const domain = registrableDomain(host);
    const tld = host.split(".").pop();
    const findings = [];

    if (hasScheme && url.protocol === "http:") {
      findings.push(finding("medium", "Not using HTTPS",
        "The connection isn't encrypted. Never enter passwords or card details on an http:// page."));
    }

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) {
      findings.push(finding("high", "Uses a raw IP address instead of a name",
        "Legitimate businesses almost never send you to a bare IP address."));
    }

    if (host.split(".").some((l) => l.startsWith("xn--"))) {
      findings.push(finding("high", "Contains disguised international characters (punycode)",
        "Letters from other alphabets can make a fake domain look identical to a real one."));
    }

    if (/@/.test(raw.replace(/^[a-z]+:\/\//i, "").split("/")[0])) {
      findings.push(finding("high", 'Contains "@" in the address',
        "Everything before the @ is ignored by the browser — a trick used to hide the real destination."));
    }

    if (SHORTENERS.includes(domain) || SHORTENERS.includes(host)) {
      findings.push(finding("medium", "Shortened link",
        "Link shorteners hide where you'll actually end up. Expand it with a preview service before clicking."));
    }

    if (RISKY_TLDS.includes(tld)) {
      findings.push(finding("medium", `Uncommon domain ending ".${tld}"`,
        "This ending is cheap to register and is frequently abused by scam sites."));
    }

    findings.push(...brandFindings(host));

    const subdomainCount = host.split(".").length - domain.split(".").length;
    if (subdomainCount >= 3) {
      findings.push(finding("medium", "Unusually many subdomains",
        `The real site here is "${domain}". Long chains like a.b.c.${domain} are often used to bury the true domain.`));
    }

    const hyphens = (domain.match(/-/g) || []).length;
    if (hyphens >= 2) {
      findings.push(finding("low", "Many hyphens in the domain",
        "Names like secure-account-update.com are typical of throwaway phishing domains."));
    }

    const pathAndQuery = (url.pathname + url.search).toLowerCase();
    const hits = PATH_KEYWORDS.filter((k) => pathAndQuery.includes(k) || host.includes(k));
    if (hits.length) {
      findings.push(finding("low", "Uses sensitive keywords",
        `Found: ${hits.join(", ")}. Phishing pages often pretend to be login or verification screens.`));
    }

    if (url.port && !["80", "443"].includes(url.port)) {
      findings.push(finding("low", `Unusual port :${url.port}`, "Regular websites rarely specify a custom port."));
    }

    if (raw.length > 120) {
      findings.push(finding("low", "Very long link", "Extremely long links are often used to hide the real destination."));
    }

    if ((raw.match(/%[0-9a-f]{2}/gi) || []).length > 5) {
      findings.push(finding("low", "Heavily encoded characters", "Lots of %xx codes can be used to obscure what a link really does."));
    }

    if (/\.(exe|scr|apk|msi|bat|cmd|js|vbs|jar|iso)$/i.test(url.pathname)) {
      findings.push(finding("high", "Link downloads a program or app file",
        "Opening files like this from an unknown link can install malware."));
    }

    return { ...summarize(findings), target: host, domain };
  }

  const MESSAGE_RULES = [
    { severity: "high", title: "Asks for passwords, OTPs or PINs",
      detail: "No real bank, company or government agency will ever ask you to share a password, OTP or PIN.",
      re: /\b(share|send|give|tell|provide|forward|reply with|enter|confirm|disclose)\b[^.!?\n]{0,40}?\b(otp|one[- ]time (pass)?code|verification code|pin|password|passcode|cvv|security code|login details|card (details|number)|ssn|social security|aadhaar|pan (card|number))\b/gi,
      negated: /\b(do not|don'?t|never|not)\s*$/i },
    { severity: "high", title: "Requests unusual payment methods",
      detail: "Gift cards, crypto, and wire transfers are scammers' favourite methods because they can't be reversed.",
      re: /\b(gift ?cards?|itunes card|google play card|steam card|bitcoin|btc|crypto(currency)?|usdt|wire transfer|western union|moneygram|zelle|upi pin)\b/i },
    { severity: "medium", title: "Creates urgency or pressure",
      detail: "Pressure to act fast is designed to stop you from thinking it through.",
      re: /\b(urgent(ly)?|immediately|act now|right away|within (24|48) hours|expires? (today|soon)|last chance|final (notice|warning)|limited time)\b/i },
    { severity: "high", title: "Threatens consequences",
      detail: "Threats of suspension, arrest or legal action are a common scare tactic.",
      re: /\b(suspend(ed)?|blocked|deactivated|locked|arrest(ed)?|warrant|legal action|police|penalty|lawsuit|court|disconnected)\b/i },
    { severity: "high", title: "Promises a prize or unexpected money",
      detail: "If you didn't enter a contest, you didn't win one.",
      re: /\b(you('ve| have)? won|winner|lottery|jackpot|prize|claim your (reward|prize|gift)|free (iphone|gift)|cash ?back reward|inheritance|unclaimed (funds|money))\b/i },
    { severity: "high", title: "Promises unrealistic investment returns",
      detail: "Guaranteed or very high returns are the hallmark of investment fraud.",
      re: /\b(guaranteed (returns?|profit|income)|double your (money|investment)|risk[- ]free|\d{2,}% (returns?|profit)|daily profit|earn \$?\d+[,\d]* (per|a) (day|week))\b/i },
    { severity: "medium", title: "Job or task offer that sounds too easy",
      detail: "\"Like videos / rate products and get paid\" schemes usually end with you paying them.",
      re: /\b(work from home|part[- ]time job|earn (money|daily)|like (and|&) subscribe|rate products|task based|easy money|no experience (needed|required))\b/i },
    { severity: "medium", title: "Asks you to verify or update your account",
      detail: "Real companies don't ask you to confirm details through a link in a message.",
      re: /\b(verify your (account|identity|details)|update your (account|details|kyc|payment)|confirm your (account|identity|details)|kyc (update|pending|expired)|re-?activate)\b/i },
    { severity: "medium", title: "Mentions a delivery problem or unpaid fee",
      detail: "Fake parcel and toll messages ask for a small fee to steal your card details.",
      re: /\b(parcel|package|shipment|delivery) (is )?(on hold|held|pending|failed|could not be delivered)|redelivery fee|customs fee|unpaid toll|outstanding (fee|balance)\b/i },
    { severity: "medium", title: "Asks you to keep it secret",
      detail: "Scammers isolate victims from people who could warn them.",
      re: /\b(don'?t tell|keep (this|it) (secret|confidential|between us)|do not (share|discuss) (this|with))\b/i },
    { severity: "medium", title: "Asks you to install remote-access apps",
      detail: "Apps like AnyDesk or TeamViewer give a stranger full control of your device.",
      re: /\b(anydesk|teamviewer|quick ?support|rustdesk|remote access|screen ?share)\b/i },
    { severity: "low", title: "Uses a generic greeting",
      detail: "Real companies you deal with usually know your name.",
      re: /\b(dear (customer|user|client|sir\/madam|account holder|valued (customer|member))|hello (customer|user))\b/i },
    { severity: "low", title: "Claims to be from a bank or government agency",
      detail: "Impersonating trusted institutions is common. Contact them directly using a number you look up yourself.",
      re: /\b(irs|hmrc|income tax (department|dept)|customs|bank (of|security)|fraud department|rbi|reserve bank|social security administration|tax refund)\b/i },
  ];

  // Returns the first match that isn't preceded by a negation such as "do not".
  function matchRule(text, rule) {
    if (!rule.negated) {
      const m = text.match(rule.re);
      return m && m[0];
    }
    for (const m of text.matchAll(rule.re)) {
      const before = text.slice(Math.max(0, m.index - 20), m.index);
      if (!rule.negated.test(before)) return m[0];
    }
    return null;
  }

  const URL_IN_TEXT = /\b((?:https?:\/\/|www\.)[^\s<>"')]+)/gi;

  function checkMessage(input) {
    const text = String(input || "").trim();
    if (text.length < 5) return { error: "Paste the full message you received so it can be checked." };

    const findings = [];
    for (const rule of MESSAGE_RULES) {
      const m = matchRule(text, rule);
      if (m) findings.push(finding(rule.severity, rule.title, `${rule.detail} (Found: "${m}")`));
    }

    const urls = [...new Set((text.match(URL_IN_TEXT) || []).map((u) => u.replace(/[.,;:!?]+$/, "")))];
    for (const u of urls.slice(0, 5)) {
      const r = checkUrl(u);
      if (r.error) continue;
      if (r.level === "low") {
        findings.push(finding("info", `Contains a link: ${r.target}`,
          "No major red flags in the link itself, but only open links you were expecting."));
      } else {
        const reasons = r.findings
          .filter((f) => f.severity !== "info")
          .sort((a, b) => WEIGHTS[b.severity] - WEIGHTS[a.severity])
          .map((f) => f.title);
        findings.push(finding(r.level === "high" ? "high" : "medium", `Suspicious link: ${r.target}`,
          `${reasons.join("; ")}. Don't open it — go to the official website or app yourself instead.`));
      }
    }

    const letters = text.replace(/[^a-z]/gi, "");
    const upper = text.replace(/[^A-Z]/g, "");
    if (letters.length > 30 && upper.length / letters.length > 0.5) {
      findings.push(finding("low", "Lots of CAPITAL LETTERS", "Shouting is used to create alarm and excitement."));
    }

    return { ...summarize(findings), links: urls };
  }

  function checkEmail(input) {
    const email = String(input || "").trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1");
    const m = email.match(/^([^\s@]+)@([a-z0-9.-]+\.[a-z]{2,})$/);
    if (!m) return { error: "Enter a single email address, like support@example.com" };
    const [, local, host] = m;
    const domain = registrableDomain(host);
    const tld = host.split(".").pop();
    const findings = [];

    if (DISPOSABLE_EMAIL_DOMAINS.includes(domain)) {
      findings.push(finding("medium", "Disposable email address",
        "This service creates throwaway inboxes. Businesses don't use them."));
    }

    if (FREE_EMAIL_DOMAINS.includes(domain)) {
      const claimsBrand = Object.keys(BRANDS).some((b) => local.replace(/[^a-z]/g, "").includes(b)) ||
        /(support|helpdesk|security|billing|admin|service|official|verify|team|noreply|no-reply)/.test(local);
      if (claimsBrand) {
        findings.push(finding("high", "Official-sounding name on a free email account",
          `"${local}" sounds like a company department, but it's a personal ${domain} account. Real companies email from their own domain.`));
      } else {
        findings.push(finding("info", `Personal ${domain} account`,
          "Fine for friends and family — but be wary if it claims to represent a company."));
      }
    }

    findings.push(...brandFindings(host));

    if (RISKY_TLDS.includes(tld)) {
      findings.push(finding("medium", `Uncommon domain ending ".${tld}"`,
        "This ending is cheap to register and is frequently abused for scams."));
    }

    if ((domain.match(/-/g) || []).length >= 2) {
      findings.push(finding("low", "Many hyphens in the domain", "Throwaway scam domains often look like this."));
    }

    const digits = (local.match(/\d/g) || []).length;
    if (digits >= 5 || /[bcdfghjklmnpqrstvwxz]{6,}/.test(local)) {
      findings.push(finding("low", "Random-looking username",
        "Strings of digits or jumbled letters are typical of auto-generated scam accounts."));
    }

    return { ...summarize(findings), target: email, domain };
  }

  return { checkUrl, checkMessage, checkEmail, registrableDomain, levenshtein };
});
