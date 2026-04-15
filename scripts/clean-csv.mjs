import fs from "node:fs";
import Papa from "papaparse";

const CSV = "public/bookoff-tokyo-kanagawa.csv";
// CRLF を LF に統一、末尾の不正な quote 連鎖を除去
let raw = fs.readFileSync(CSV, "utf8");
raw = raw.replace(/\r\n/g, "\n").replace(/"+\s*$/g, "");
const { data, meta } = Papa.parse(raw, {
  header: true,
  skipEmptyLines: true,
  newline: "\n",
});

for (const row of data) {
  for (const k of Object.keys(row)) {
    if (typeof row[k] === "string") row[k] = row[k].trim();
  }
}

const out = Papa.unparse(data, { columns: meta.fields });
fs.writeFileSync(CSV, out + "\n");
console.log(`✅ cleaned ${data.length} rows`);
