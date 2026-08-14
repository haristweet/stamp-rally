"use client";

import type { ChainData, Store, VisitRecord } from "./types";

export const CHAIN_KEY = "stamp-rally:chain";
export const VISITS_KEY = "stamp-rally:visits";

// useSyncExternalStore から localStorage を読むための素の値。
// 文字列なので、中身が同じなら React は同一とみなす。
export function readRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key);
}

// 同一タブの書き込みでは storage イベントが飛ばないので、他タブ由来の変更だけ拾う
export function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function loadChain(): ChainData | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(CHAIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChainData;
  } catch {
    return null;
  }
}

export function saveChain(chain: ChainData): void {
  localStorage.setItem(CHAIN_KEY, JSON.stringify(chain));
}

export function clearChain(): void {
  localStorage.removeItem(CHAIN_KEY);
  localStorage.removeItem(VISITS_KEY);
}

export function loadVisits(): VisitRecord[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(VISITS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as VisitRecord[];
  } catch {
    return [];
  }
}

export function saveVisits(visits: VisitRecord[]): void {
  localStorage.setItem(VISITS_KEY, JSON.stringify(visits));
}

// 店舗IDの体系が変わっても押したスタンプを失わないようにする。
// 旧ID `${店舗名}__${緯度}_${経度}` は店舗名で新IDに読み替える。
// 一覧から消えた店舗（閉店・改称）の記録は、件数が合わなくなるので捨てる。
// 同じ店でも表記が揺れる（ＪＲ↔JR、ザ･ビッグ↔ザ・ビッグ、
// 「○○店 / Rehello by ○○店」、「○○店（本・ソフト館）」など）ので均してから突合する
function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .split("/")[0]
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[\s　・]/g, "")
    .toLowerCase();
}

export function migrateVisits(
  stores: Store[],
  visits: VisitRecord[]
): VisitRecord[] {
  const ids = new Set(stores.map((s) => s.id));
  const idByName = new Map(stores.map((s) => [normalizeName(s.name), s.id]));
  const migrated: VisitRecord[] = [];
  const seen = new Set<string>();
  for (const v of visits) {
    let id = v.storeId;
    if (!ids.has(id)) {
      const mapped = idByName.get(normalizeName(id.split("__")[0]));
      if (!mapped) continue;
      id = mapped;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    migrated.push({ storeId: id, visitedAt: v.visitedAt });
  }
  return migrated;
}

export function addVisit(storeId: string): VisitRecord[] {
  const visits = loadVisits();
  if (visits.some((v) => v.storeId === storeId)) return visits;
  const next = [...visits, { storeId, visitedAt: new Date().toISOString() }];
  saveVisits(next);
  return next;
}
