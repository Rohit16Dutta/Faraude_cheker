"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REASONS = {
  refused: "Refused to receive the parcel",
  fake_order: "Fake / prank order",
  unreachable: "Phone unreachable or switched off",
  wrong_address: "Gave a fake or wrong address",
  abusive: "Abusive behaviour",
  other: "Other",
};

// Merchant-submitted reports about a phone number, kept in a small JSON file.
function createReportStore(file) {
  let items = [];
  try {
    items = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(items)) items = [];
  } catch (e) {
    items = [];
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    forPhone(phone) {
      return items
        .filter((r) => r.phone === phone)
        .map(({ reason, note, shop, createdAt }) => ({ reason, reasonLabel: REASONS[reason], note, shop, createdAt }));
    },
    add({ phone, reason, note, shop }) {
      if (!REASONS[reason]) throw new Error("Choose a reason from the list");
      const report = {
        phone,
        reason,
        note: String(note || "").trim().slice(0, 300),
        shop: String(shop || "").trim().slice(0, 60),
        createdAt: new Date().toISOString(),
      };
      items.push(report);
      save();
      return report;
    },
  };
}

module.exports = { createReportStore, REASONS };
