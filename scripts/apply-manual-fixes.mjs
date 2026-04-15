// 手動で正しい座標を設定する
import fs from "node:fs";
import Papa from "papaparse";

const CSV = "public/bookoff-tokyo-kanagawa.csv";

// 住所 → (lat, lng)  ※手動調査
const FIXES = {
  "神奈川県川崎市川崎区港町12-1": [35.5376, 139.7094], // 京急港町駅前
  "東京都八王子市狭間町1462-1": [35.6370, 139.3173], // 狭間駅前 イトーヨーカドー
  "神奈川県相模原市南区相模大野5-30-7": [35.5305, 139.4368], // 相模大野駅前
  "神奈川県藤沢市用田491-1": [35.3893, 139.4310], // 藤沢市用田
};

const text = fs.readFileSync(CSV, "utf8");
const { data, meta } = Papa.parse(text, {
  header: true,
  skipEmptyLines: true,
});

let fixed = 0;
for (const [addr, [lat, lng]] of Object.entries(FIXES)) {
  const row = data.find((r) => r["住所"] === addr);
  if (!row) {
    console.log(`SKIP ${addr}`);
    continue;
  }
  console.log(
    `▶ ${row["店舗名"]}: (${row["緯度"]}, ${row["経度"]}) → (${lat}, ${lng})`
  );
  row["緯度"] = lat;
  row["経度"] = lng;
  fixed++;
}

const out = Papa.unparse(data, { columns: meta.fields });
fs.writeFileSync(CSV, out + "\n");
console.log(`\n✅ ${fixed} 件修正`);
