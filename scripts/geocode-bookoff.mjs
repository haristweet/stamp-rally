// BOOKOFF 店舗一覧.md から東京都・神奈川県を抽出し、
// Nominatim (OpenStreetMap) でジオコーディングして CSV を生成する。
//
// 店舗一覧の .md はこのリポジトリに含まれないので、パスを渡して実行する:
//   node scripts/geocode-bookoff.mjs path/to/bookoff_店舗一覧.md
//   BOOKOFF_MD=path/to/bookoff_店舗一覧.md node scripts/geocode-bookoff.mjs
//
// Nominatim 利用規約: 1 req/s 以下、User-Agent 必須。
// https://operations.osmfoundation.org/policies/nominatim/

import fs from "node:fs";
import path from "node:path";

const SRC = process.argv[2] ?? process.env.BOOKOFF_MD;
const OUT = path.resolve("public/bookoff-tokyo-kanagawa.csv");
const CACHE = path.resolve("scripts/.geocode-cache.json");

const SECTIONS = ["## 東京都", "## 神奈川県"];

function extractStores(md) {
  const lines = md.split("\n");
  const results = [];
  let inTarget = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      inTarget = SECTIONS.some((s) => line.startsWith(s));
      continue;
    }
    if (!inTarget) continue;
    // | 1 | 店舗名 | 住所 | 電話番号 |
    const m = line.match(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const name = m[1].trim();
    const address = m[2].trim();
    results.push({ name, address });
  }
  return results;
}

async function geocode(address) {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q: address,
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {
    return {};
  }
}
function saveCache(c) {
  fs.writeFileSync(CACHE, JSON.stringify(c, null, 2));
}

function csvEscape(s) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  if (!SRC) {
    console.error("店舗一覧の .md のパスを渡してください:");
    console.error("  node scripts/geocode-bookoff.mjs path/to/bookoff_店舗一覧.md");
    process.exit(1);
  }
  if (!fs.existsSync(SRC)) {
    console.error(`店舗一覧が見つかりません: ${SRC}`);
    process.exit(1);
  }
  const md = fs.readFileSync(SRC, "utf8");
  const stores = extractStores(md);
  console.log(`抽出: ${stores.length} 店舗`);

  const cache = loadCache();
  const results = [];
  const failures = [];

  for (let i = 0; i < stores.length; i++) {
    const s = stores[i];
    let coord = cache[s.address];
    if (!coord) {
      process.stdout.write(`[${i + 1}/${stores.length}] ${s.name} ... `);
      try {
        coord = await geocode(s.address);
      } catch (e) {
        console.log(`ERR ${e.message}`);
        failures.push({ ...s, reason: e.message });
        await sleep(1100);
        continue;
      }
      if (!coord) {
        // 番地以下を削って再試行
        const loose = s.address.replace(/[0-9０-９]+[-‐−ー].*$/, "").trim();
        if (loose && loose !== s.address) {
          await sleep(1100);
          process.stdout.write("(loose) ");
          try {
            coord = await geocode(loose);
          } catch {}
        }
      }
      if (coord) {
        cache[s.address] = coord;
        saveCache(cache);
        console.log(`OK ${coord.lat.toFixed(5)},${coord.lng.toFixed(5)}`);
      } else {
        console.log("NOT FOUND");
        failures.push({ ...s, reason: "not found" });
      }
      await sleep(1100); // 1 req/s 制限
    } else {
      console.log(`[${i + 1}/${stores.length}] ${s.name} (cache)`);
    }
    if (coord) results.push({ ...s, ...coord });
  }

  const header = "店舗名,住所,緯度,経度\n";
  const body = results
    .map(
      (r) =>
        `${csvEscape(r.name)},${csvEscape(r.address)},${r.lat},${r.lng}`
    )
    .join("\n");
  fs.writeFileSync(OUT, header + body + "\n");
  console.log(`\n✅ 書き出し: ${OUT} (${results.length} 店舗)`);
  if (failures.length) {
    console.log(`⚠️  失敗: ${failures.length} 店舗`);
    for (const f of failures) console.log(`  - ${f.name} / ${f.address} (${f.reason})`);
  }
}

main();
