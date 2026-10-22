"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { toPublic } = require("./reports");

// Node only: keeps merchant reports in a small JSON file.
function createFileReportStore(file) {
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
    async forPhone(phone) {
      return items.filter((r) => r.phone === phone).map(toPublic);
    },
    async add(report) {
      items.push(report);
      save();
    },
  };
}

module.exports = { createFileReportStore };
