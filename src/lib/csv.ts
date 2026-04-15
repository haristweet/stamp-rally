import Papa from "papaparse";
import type { Store } from "./types";

export type CsvParseResult =
  | { ok: true; stores: Store[] }
  | { ok: false; error: string };

// 想定ヘッダ: 店舗名, 住所, 緯度, 経度
// 英語ヘッダも一応許容: name, address, lat/latitude, lng/longitude
const HEADER_MAP: Record<string, keyof Store> = {
  店舗名: "name",
  name: "name",
  住所: "address",
  address: "address",
  緯度: "lat",
  lat: "lat",
  latitude: "lat",
  経度: "lng",
  lng: "lng",
  lon: "lng",
  longitude: "lng",
  店舗ID: "storeId",
  storeId: "storeId",
  種別: "kind",
  kind: "kind",
  電話番号: "phone",
  phone: "phone",
  tel: "phone",
  店舗規模: "scale",
  scale: "scale",
};

export function parseCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    return { ok: false, error: `CSV解析エラー: ${parsed.errors[0].message}` };
  }
  const rows = parsed.data;
  if (rows.length === 0) return { ok: false, error: "データ行がありません" };

  const stores: Store[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const mapped: Partial<Store> = {};
    for (const [key, value] of Object.entries(row)) {
      const target = HEADER_MAP[key];
      if (!target) continue;
      if (target === "lat" || target === "lng") {
        const n = parseFloat(value);
        if (Number.isFinite(n)) mapped[target] = n;
      } else {
        mapped[target] = value?.trim();
      }
    }
    if (
      !mapped.name ||
      !mapped.address ||
      mapped.lat === undefined ||
      mapped.lng === undefined
    ) {
      return {
        ok: false,
        error: `${i + 2}行目: 必須カラム（店舗名/住所/緯度/経度）が不足または不正です`,
      };
    }
    stores.push({
      id: `${mapped.name}__${mapped.lat}_${mapped.lng}`,
      name: mapped.name,
      address: mapped.address,
      lat: mapped.lat,
      lng: mapped.lng,
      storeId: mapped.storeId || undefined,
      kind: mapped.kind || undefined,
      phone: mapped.phone || undefined,
      scale: mapped.scale || undefined,
    });
  }
  return { ok: true, stores };
}
