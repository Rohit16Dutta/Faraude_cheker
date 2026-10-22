"use strict";

const VERDICTS = {
  low: { title: "Trusted", advice: "Safe to ship with cash on delivery." },
  medium: { title: "Caution", advice: "Confirm by phone before shipping." },
  high: { title: "High risk", advice: "Take advance payment first." },
  new: { title: "New customer", advice: "No history yet. Confirm by phone." },
  unknown: { title: "Unavailable", advice: "Couldn't reach any courier." },
};

// Combines per-courier results and merchant reports into one overall view.
function aggregate(couriers, reports = []) {
  const ok = couriers.filter((c) => c.status === "ok");
  const total = ok.reduce((s, c) => s + c.total, 0);
  const success = ok.reduce((s, c) => s + c.success, 0);
  const cancel = ok.reduce((s, c) => s + c.cancel, 0);
  const decided = success + cancel;
  const successRate = decided ? Math.round((success / decided) * 1000) / 10 : null;

  let level;
  if (!ok.length) level = "unknown";
  else if (!decided) level = "new";
  else if (successRate >= 80) level = "low";
  else if (successRate >= 50) level = "medium";
  else level = "high";

  const notes = [];
  if (decided > 0 && decided < 3) notes.push("Few past orders");
  if (reports.length >= 2) {
    level = "high";
    notes.push(`Reported ${reports.length} times`);
  } else if (reports.length === 1) {
    if (level === "low" || level === "new" || level === "unknown") level = "medium";
    notes.push("Reported once");
  }
  const failed = couriers.filter((c) => c.status === "error").length;
  if (failed && ok.length) notes.push(`${failed} courier${failed > 1 ? "s" : ""} unavailable`);

  return {
    level,
    ...VERDICTS[level],
    total,
    success,
    cancel,
    successRate,
    couriersChecked: ok.length,
    couriersWithHistory: ok.filter((c) => c.total > 0).length,
    notes,
  };
}

module.exports = { aggregate };
