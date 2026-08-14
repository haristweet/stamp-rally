"use client";

import type { Store, VisitRecord } from "./types";

// スタンプ記録の持ち運び。端末をまたぐときと、外部の記録（Swarmのチェックイン）を
// 取り込むときに使う。データは端末の中だけで処理し、どこにも送信しない。

const FORMAT = "stamp-rally/visits";

export type ExportFile = {
  format: typeof FORMAT;
  version: 1;
  exportedAt: string;
  visits: VisitRecord[];
};

export function buildExport(visits: VisitRecord[]): string {
  const data: ExportFile = {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    visits: [...visits].sort((a, b) => a.storeId.localeCompare(b.storeId)),
  };
  return JSON.stringify(data, null, 1);
}

export type ParseResult =
  | { ok: true; records: VisitRecord[]; unknownIds: string[] }
  | { ok: false; error: string };

function isValidDate(s: unknown): s is string {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

// このアプリの書き出しと、店舗ID→日時 の形（Swarmの取り込み結果）の両方を受け取る
export function parseImport(text: string, stores: Store[]): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSONとして読めませんでした" };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "中身が空です" };
  }

  const known = new Set(stores.map((s) => s.id));
  const records: VisitRecord[] = [];
  const unknownIds: string[] = [];
  const push = (storeId: string, visitedAt: string) => {
    if (known.has(storeId)) records.push({ storeId, visitedAt });
    else unknownIds.push(storeId);
  };

  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.visits)) {
    for (const v of obj.visits) {
      if (!v || typeof v !== "object") continue;
      const { storeId, visitedAt } = v as Record<string, unknown>;
      if (typeof storeId === "string" && isValidDate(visitedAt)) {
        push(storeId, visitedAt);
      }
    }
  } else {
    for (const [storeId, v] of Object.entries(obj)) {
      if (!v || typeof v !== "object") continue;
      const { visitedAt } = v as Record<string, unknown>;
      if (isValidDate(visitedAt)) push(storeId, visitedAt);
    }
  }

  if (records.length === 0 && unknownIds.length === 0) {
    return { ok: false, error: "スタンプの記録が見つかりませんでした" };
  }
  return { ok: true, records, unknownIds };
}

export type MergePreview = {
  merged: VisitRecord[];
  added: number; // 新しく増える店
  updated: number; // 日付が古いほうに直る店
  unchanged: number;
};

// 同じ店の記録が両方にあるときは古いほうの日付を採用する。
// 既存の日付はKMLの取り込み日など仮のものがあるので、実際に行った日が優先される。
export function mergeVisits(
  current: VisitRecord[],
  incoming: VisitRecord[]
): MergePreview {
  const byId = new Map(current.map((v) => [v.storeId, v.visitedAt]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const v of incoming) {
    const now = byId.get(v.storeId);
    if (now === undefined) {
      byId.set(v.storeId, v.visitedAt);
      added++;
    } else if (Date.parse(v.visitedAt) < Date.parse(now)) {
      byId.set(v.storeId, v.visitedAt);
      updated++;
    } else {
      unchanged++;
    }
  }
  const merged = [...byId.entries()]
    .map(([storeId, visitedAt]) => ({ storeId, visitedAt }))
    .sort((a, b) => a.storeId.localeCompare(b.storeId));
  return { merged, added, updated, unchanged };
}

export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari が読み終わる前に消えないよう少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
