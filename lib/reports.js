"use strict";

const REASONS = {
  refused: "Refused parcel",
  fake_order: "Fake order",
  unreachable: "Unreachable",
  wrong_address: "Wrong address",
  abusive: "Abusive",
  other: "Other",
};

// Validates a merchant report and returns the record to store.
function buildReport({ phone, reason, note, shop }) {
  if (!REASONS[reason]) throw new Error("Choose a reason from the list");
  return {
    phone,
    reason,
    note: String(note || "").trim().slice(0, 300),
    shop: String(shop || "").trim().slice(0, 60),
    createdAt: new Date().toISOString(),
  };
}

// The fields shown to other merchants.
function toPublic({ reason, note, shop, createdAt }) {
  return { reason, reasonLabel: REASONS[reason], note, shop, createdAt };
}

// Report stores share one async shape: forPhone(phone) and add(report).
function createMemoryReportStore() {
  const items = [];
  return {
    async forPhone(phone) {
      return items.filter((r) => r.phone === phone).map(toPublic);
    },
    async add(report) {
      items.push(report);
    },
  };
}

module.exports = { REASONS, buildReport, toPublic, createMemoryReportStore };
