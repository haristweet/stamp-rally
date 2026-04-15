// 現在の CSV（座標あり）に、KML から抽出したメタデータを名前マッチで付与する。
// 追加する列: 店舗ID, 種別, 電話番号, 店舗規模
import fs from "node:fs";
import Papa from "papaparse";

const KML = "/tmp/bookoff-kml/doc.kml";
const CSV = "public/bookoff-tokyo-kanagawa.csv";

function classify(id) {
  const s = String(id).trim();
  if (/^(SP|SB)/i.test(s)) return "直営";
  const n = parseInt(parseFloat(s), 10);
  if (Number.isFinite(n)) {
    if (n >= 10000 && n < 20000) return "FC";
    if (n >= 20000 && n < 30000) return "直営";
  }
  return "不明";
}

function normalizeName(name) {
  return name
    .normalize("NFKC") // 全角→半角（英数・記号）
    .replace(/^\[\d+\]/, "") // 先頭の [20190715] などを除去
    .replace(/[（(][^）)]*[）)]/g, "") // カッコ内
    .replace(/[・･、。\s]/g, "") // 各種ドット・空白
    .replace(/店$/, "") // 末尾の「店」
    .replace(/^BOOKOFF/i, "")
    .replace(/^(PLUS|SUPERBAZAAR|FASHION|Rehelloby)/i, "")
    .replace(/買取センター/g, "")
    .toLowerCase();
}

function pick(block, field) {
  const re = new RegExp(
    `<Data name="${field}">\\s*<value>([^<]*)</value>`,
    ""
  );
  const m = block.match(re);
  return m ? m[1].trim() : "";
}

// --- KML パース --------------------------------------------------
const kml = fs.readFileSync(KML, "utf8");
const blocks = [...kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)];

const kmlIndex = new Map(); // normalizedName -> metadata
for (const [, b] of blocks) {
  const name = (b.match(/<name>([^<]+)<\/name>/) || [])[1]?.trim();
  if (!name) continue;
  const pref = pick(b, "都道府県");
  if (!/東京|神奈川/.test(pref)) continue;
  const id = pick(b, "ID");
  kmlIndex.set(normalizeName(name), {
    name,
    id,
    種別: classify(id),
    電話番号: pick(b, "電話番号"),
    店舗規模: pick(b, "店舗規模"),
    住所: pick(b, "住所"),
  });
}
console.log(`KML: 東京・神奈川 ${kmlIndex.size} 店舗`);

// --- 現 CSV 読み込み --------------------------------------------
const csvText = fs.readFileSync(CSV, "utf8");
const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
const rows = parsed.data;
console.log(`CSV: ${rows.length} 店舗`);

// --- マージ ------------------------------------------------------
let matched = 0;
const unmatched = [];
for (const row of rows) {
  const key = normalizeName(row["店舗名"]);
  const meta = kmlIndex.get(key);
  if (meta) {
    row["店舗ID"] = meta.id;
    row["種別"] = meta.種別;
    row["電話番号"] = meta.電話番号;
    row["店舗規模"] = meta.店舗規模;
    matched++;
  } else {
    row["店舗ID"] = "";
    row["種別"] = "新店/未登録";
    row["電話番号"] = "";
    row["店舗規模"] = "";
    unmatched.push(row["店舗名"]);
  }
}
console.log(`✅ マッチ: ${matched}`);
console.log(`❓ 未マッチ: ${unmatched.length}`);
for (const n of unmatched) console.log(`  - ${n}`);

// --- 書き出し ----------------------------------------------------
const columns = [
  "店舗名",
  "住所",
  "緯度",
  "経度",
  "店舗ID",
  "種別",
  "電話番号",
  "店舗規模",
];
const out = Papa.unparse(rows, { columns });
fs.writeFileSync(CSV, out + "\n");
console.log(`\n📝 書き出し: ${CSV}`);

// 種別集計
const counts = {};
for (const r of rows) counts[r["種別"]] = (counts[r["種別"]] || 0) + 1;
console.log("種別集計:", counts);
