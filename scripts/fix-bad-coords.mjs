// validate-csv で検出された異常行を再ジオコードして CSV を上書き
import fs from "node:fs";
import Papa from "papaparse";
import { execSync } from "node:child_process";

const CSV = "public/bookoff-tokyo-kanagawa.csv";

// validate-csv の出力をパース（手動で対象住所を指定）
const TARGETS = [
  "神奈川県川崎市川崎区港町12-1",
  "東京都八王子市狭間町1462-1",
  "東京都目黒区自由が丘2-11-23",
  "東京都板橋区高島平1-75-10",
  "神奈川県相模原市南区相模大野5-30-7",
  "東京都練馬区東大泉1-26-15",
  "神奈川県藤沢市用田491-1",
  "東京都武蔵野市境南町5-5-16",
  "東京都世田谷区北烏山5-21-11",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function geocode(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q: query,
      format: "json",
      limit: "1",
      countrycodes: "jp",
      "accept-language": "ja",
    });
  const res = await fetch(url, {
    headers: { "User-Agent": "stamp-rally/1.0 (personal project)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
}

async function tryVariants(address) {
  // 番地削り、市区町村だけ等を順次試す
  const variants = [
    `日本、${address}`,
    address.replace(/\d+-\d+-\d+.*$/, ""), // 丁目まで
    address.replace(/[0-9０-９]+[-‐−ー].*$/, ""), // 町名まで
  ];
  for (const v of variants) {
    await sleep(1100);
    try {
      const c = await geocode(v);
      if (c) return { ...c, used: v };
    } catch {}
  }
  return null;
}

const text = fs.readFileSync(CSV, "utf8");
const { data, meta } = Papa.parse(text, {
  header: true,
  skipEmptyLines: true,
});
const headers = meta.fields;

let fixed = 0;
for (const addr of TARGETS) {
  const row = data.find((r) => r["住所"] === addr);
  if (!row) {
    console.log(`SKIP not found in CSV: ${addr}`);
    continue;
  }
  console.log(`\n▶ ${row["店舗名"]} / ${addr}`);
  console.log(`  旧: (${row["緯度"]}, ${row["経度"]})`);
  const c = await tryVariants(addr);
  if (c) {
    row["緯度"] = c.lat;
    row["経度"] = c.lng;
    console.log(`  新: (${c.lat}, ${c.lng})  via "${c.used}"`);
    fixed++;
  } else {
    console.log(`  ❌ 見つからず`);
  }
}

const out = Papa.unparse(data, { columns: headers });
fs.writeFileSync(CSV, out + "\n");
console.log(`\n✅ ${fixed} 件修正して書き出し: ${CSV}`);
