"use strict";

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

// Turns any common way of writing a Bangladeshi mobile number into 01XXXXXXXXX.
// Accepts +880 / 880 / 0088 prefixes, spaces, dashes and Bangla digits. Returns null if invalid.
function normalizeBdPhone(input) {
  let s = String(input || "")
    .replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)))
    .replace(/[\s\-().]/g, "");
  s = s.replace(/^(\+?880|00880)/, "0");
  return /^01[3-9]\d{8}$/.test(s) ? s : null;
}

module.exports = { normalizeBdPhone };
