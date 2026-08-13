// 店舗CSV（直営 2xxxx / フランチャイズ 1xxxx）と座標を突き合わせて
// public/bookoff-stores.csv を生成する。
//
//   node scripts/build-stores.mjs <直営CSV> <FC CSV> --coords <coords.csv>
//
// 座標の優先順位:
//   1. data/coords-overrides.json（手動補正。移転直後などの保険。何より優先）
//   2. --coords で渡す公式ピン（bookoff-shop-data/coords.csv）
//   3. 国土地理院APIによる住所ジオコーディング（1・2で埋まらない店だけの予備）
//
// 種別は store_ID の先頭桁から導出する（2→直営 / 1→フランチャイズ）。
// 実行すると前回の出力との差分（新規開店・閉店・変更）を表示する。

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const OUT = path.resolve("public/bookoff-stores.csv");
const OVERRIDES = path.resolve("data/coords-overrides.json");
const CACHE = path.resolve("scripts/.geocode-cache-gsi.json");
const COARSE = path.resolve("scripts/.geocode-coarse.txt");
const FAILURES = path.resolve("scripts/.geocode-failures.txt");
const GSI_INTERVAL_MS = 700;

const HEADER = [
  "店舗ID",
  "店舗名",
  "住所",
  "緯度",
  "経度",
  "電話番号",
  "店舗規模",
  "営業時間",
  "駐車場",
  "種別",
];

function kindFromStoreId(id) {
  if (id.startsWith("2")) return "直営";
  if (id.startsWith("1")) return "フランチャイズ";
  return "不明";
}

function parseCsvFile(file) {
  return Papa.parse(fs.readFileSync(file, "utf8"), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  }).data;
}

const clean = (v) => (v ?? "").replace(/[\s　]+/g, " ").trim();

function readStores(file) {
  const rows = [];
  for (const r of parseCsvFile(file)) {
    const storeId = clean(r.store_ID);
    const address = clean(r.address);
    // 住所が空の行は連番スイープの欠番なので落とす
    if (!storeId || !address) continue;
    rows.push({
      storeId,
      name: clean(r.store_name),
      address,
      hours: clean(r.hour),
      phone: clean(r.tel),
      scale: clean(r.kibo),
      parking: clean(r.parking),
      kind: kindFromStoreId(storeId),
    });
  }
  return rows;
}

function readCoords(file) {
  const map = new Map();
  for (const r of parseCsvFile(file)) {
    const id = clean(r.store_ID);
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lng);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    map.set(id, { lat, lng, address: clean(r.address) });
  }
  return map;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// 国土地理院の住所検索。GeoJSON の coordinates は [経度, 緯度] の順。
async function geocodeGsi(query) {
  const url =
    "https://msearch.gsi.go.jp/address-search/AddressSearch?" +
    new URLSearchParams({ q: query });
  const res = await fetch(url, {
    headers: { "User-Agent": "stamp-rally/1.0 (personal project)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const [lng, lat] = arr[0].geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, matched: arr[0].properties?.title ?? "" };
}

// 住所の当て方を段階的にゆるめる。
// 1) そのまま 2) 建物名（最初の空白以降）を落とす 3) 末尾の番地を落とす
function queryVariants(address) {
  const variants = [address];
  const noBuilding = address.split(" ")[0];
  if (noBuilding && noBuilding !== address) variants.push(noBuilding);
  const loose = noBuilding.replace(/[0-9０-９][-‐−ー0-9０-９]*$/, "").trim();
  if (loose && !variants.includes(loose)) variants.push(loose);
  return variants;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function csvEscape(s) {
  const v = String(s ?? "");
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// 前回の出力と比べて、開店・閉店・変更を洗い出す
function diffAgainstPrevious(rows) {
  if (!fs.existsSync(OUT)) return null;
  const before = new Map(
    parseCsvFile(OUT).map((r) => [clean(r["店舗ID"]), r])
  );
  const after = new Map(rows.map((r) => [r.storeId, r]));
  const added = rows.filter((r) => !before.has(r.storeId));
  const removed = [...before.values()].filter(
    (r) => !after.has(clean(r["店舗ID"]))
  );
  const watched = [
    ["店舗名", "name"],
    ["住所", "address"],
    ["営業時間", "hours"],
    ["電話番号", "phone"],
    ["店舗規模", "scale"],
    ["駐車場", "parking"],
  ];
  const changed = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a) continue;
    const fields = watched
      .filter(([label, key]) => clean(b[label]) !== clean(a[key]))
      .map(([label, key]) => `${label}: ${clean(b[label])} → ${clean(a[key])}`);
    const moved =
      Math.abs(parseFloat(b["緯度"]) - a.lat) > 1e-6 ||
      Math.abs(parseFloat(b["経度"]) - a.lng) > 1e-6;
    if (moved) fields.push("座標が変わった");
    if (fields.length > 0) changed.push({ id, name: a.name, fields });
  }
  return { added, removed, changed };
}

function reportDiff(diff) {
  if (!diff) {
    console.log("\n（前回の出力が無いので差分は出しません）");
    return;
  }
  const { added, removed, changed } = diff;
  console.log(
    `\n差分: 新規 ${added.length} / 消滅 ${removed.length} / 変更 ${changed.length}`
  );
  for (const r of added) console.log(`  [新規] ${r.storeId} ${r.name}`);
  for (const r of removed)
    console.log(`  [消滅] ${clean(r["店舗ID"])} ${clean(r["店舗名"])}`);
  for (const c of changed)
    console.log(`  [変更] ${c.id} ${c.name}\n         ${c.fields.join("\n         ")}`);
}

async function main() {
  const args = process.argv.slice(2);
  const files = [];
  let coordsFile = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--coords") coordsFile = args[++i];
    else files.push(args[i]);
  }
  if (files.length === 0) {
    console.error("店舗CSVのパスを渡してください:");
    console.error(
      "  node scripts/build-stores.mjs <直営CSV> <FC CSV> --coords <coords.csv>"
    );
    process.exit(1);
  }
  for (const f of [...files, coordsFile].filter(Boolean)) {
    if (!fs.existsSync(f)) {
      console.error(`ファイルが見つかりません: ${f}`);
      process.exit(1);
    }
  }

  const byId = new Map();
  for (const f of files) {
    const rows = readStores(f);
    console.log(`${path.basename(f)}: ${rows.length} 店舗`);
    for (const r of rows) byId.set(r.storeId, r);
  }
  const stores = [...byId.values()].sort((a, b) =>
    a.storeId.localeCompare(b.storeId)
  );

  const official = coordsFile ? readCoords(coordsFile) : new Map();
  const overrides = readJson(OVERRIDES, {});
  const cache = readJson(CACHE, {});
  console.log(
    `合計 ${stores.length} 店舗 / 公式座標 ${official.size} 件 / 手動補正 ${Object.keys(overrides).length} 件`
  );

  const rows = [];
  const failures = [];
  const geocoded = [];
  const tally = { override: 0, official: 0, gsi: 0 };

  for (let i = 0; i < stores.length; i++) {
    const s = stores[i];
    const ov = overrides[s.storeId];
    const off = official.get(s.storeId);
    let coord = null;
    if (ov && Number.isFinite(ov.lat) && Number.isFinite(ov.lng)) {
      coord = { lat: ov.lat, lng: ov.lng };
      tally.override++;
    } else if (off) {
      coord = { lat: off.lat, lng: off.lng };
      tally.official++;
    } else {
      // 公式ピンが無い店だけ住所から引く
      let hit = cache[s.address];
      if (!hit) {
        process.stdout.write(`[${i + 1}/${stores.length}] ${s.name} ... `);
        for (const q of queryVariants(s.address)) {
          try {
            hit = await geocodeGsi(q);
          } catch (e) {
            process.stdout.write(`(ERR ${e.message}) `);
            hit = null;
          }
          await sleep(GSI_INTERVAL_MS);
          if (hit) break;
          process.stdout.write("(retry) ");
        }
        if (hit) {
          cache[s.address] = hit;
          console.log(`${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)} [gsi]`);
        } else {
          console.log("NOT FOUND");
        }
      }
      if (hit) {
        coord = { lat: hit.lat, lng: hit.lng };
        tally.gsi++;
        geocoded.push({ ...s, matched: hit.matched ?? "" });
      }
    }
    if (!coord) {
      failures.push(s);
      continue;
    }
    rows.push({ ...s, lat: coord.lat, lng: coord.lng });
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));

  const diff = diffAgainstPrevious(rows);

  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.storeId,
        r.name,
        r.address,
        r.lat,
        r.lng,
        r.phone,
        r.scale,
        r.hours,
        r.parking,
        r.kind,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  fs.writeFileSync(OUT, lines.join("\n") + "\n");

  console.log(`\n書き出し: ${OUT}（${rows.length} 店舗）`);
  console.log(
    `座標の出どころ: 公式ピン ${tally.official} / 手動補正 ${tally.override} / 住所から ${tally.gsi}`
  );

  if (failures.length > 0) {
    fs.writeFileSync(
      FAILURES,
      failures.map((s) => `${s.storeId}\t${s.name}\t${s.address}`).join("\n") + "\n"
    );
    console.log(`座標が取れなかった店舗: ${failures.length} 件 → ${FAILURES}`);
  } else {
    fs.rmSync(FAILURES, { force: true });
  }

  // 住所から引いた分のうち番地まで当たらなかったものは数百mずれている可能性がある
  const coarse = geocoded.filter(
    (g) => !/[0-9０-９]+(番地?|号)$/.test(g.matched)
  );
  if (coarse.length > 0) {
    fs.writeFileSync(
      COARSE,
      coarse
        .map((g) => `${g.storeId}\t${g.name}\t${g.address}\t→ ${g.matched}`)
        .join("\n") + "\n"
    );
    console.log(`番地まで当たらなかった店舗: ${coarse.length} 件 → ${COARSE}`);
  } else {
    fs.rmSync(COARSE, { force: true });
  }

  reportDiff(diff);
}

main();
