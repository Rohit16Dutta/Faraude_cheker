"use strict";

const VERDICTS = {
  low: { title: "Trusted customer", advice: "Good delivery record. Safe to ship with cash on delivery." },
  medium: { title: "Be careful", advice: "Mixed delivery record. Confirm the order by phone and consider taking the delivery charge in advance." },
  high: { title: "High fraud risk", advice: "This customer often cancels or returns parcels. Take full or partial advance payment before shipping." },
  new: { title: "New customer", advice: "No delivery history with any courier. Confirm by phone; consider taking the delivery charge in advance." },
  unknown: { title: "Couldn't check", advice: "None of the couriers could be checked right now. See the errors below." },
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
  if (decided > 0 && decided < 3) notes.push("Only a few past parcels — treat this score with caution.");
  if (reports.length >= 2) {
    level = "high";
    notes.push(`${reports.length} merchants have reported this number.`);
  } else if (reports.length === 1) {
    if (level === "low" || level === "new" || level === "unknown") level = "medium";
    notes.push("1 merchant has reported this number.");
  }
  const failed = couriers.filter((c) => c.status === "error").length;
  if (failed && ok.length) notes.push(`${failed} courier${failed > 1 ? "s" : ""} could not be checked — the totals may be incomplete.`);

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
