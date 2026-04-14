"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChainData, VisitRecord } from "@/lib/types";
import { loadChain, loadVisits, saveChain, clearChain, addVisit, saveVisits } from "@/lib/storage";
import { parseCsv } from "@/lib/csv";
import { STAMP_RADIUS_M, distanceMeters } from "@/lib/geo";

type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; lat: number; lng: number; accuracy: number; at: number }
  | { status: "error"; message: string };

export default function HomePage() {
  const [chain, setChain] = useState<ChainData | null>(null);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [importError, setImportError] = useState<string | null>(null);
  const [tab, setTab] = useState<"stamp" | "list">("stamp");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChain(loadChain());
    setVisits(loadVisits());
    setReady(true);
  }, []);

  const visitedIds = useMemo(() => new Set(visits.map((v) => v.storeId)), [visits]);

  const storesWithDistance = useMemo(() => {
    if (!chain || geo.status !== "ok") return [];
    return chain.stores
      .map((s) => ({
        store: s,
        distance: distanceMeters(geo.lat, geo.lng, s.lat, s.lng),
      }))
      .sort((a, b) => a.distance - b.distance);
  }, [chain, geo]);

  const nearestUnvisited = useMemo(
    () => storesWithDistance.find((x) => !visitedIds.has(x.store.id)),
    [storesWithDistance, visitedIds]
  );

  const loadCsvText = useCallback((text: string, chainName: string) => {
    const result = parseCsv(text);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    const data: ChainData = {
      chainName,
      importedAt: new Date().toISOString(),
      stores: result.stores,
    };
    saveChain(data);
    saveVisits([]);
    setChain(data);
    setVisits([]);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setImportError(null);
      const text = await file.text();
      loadCsvText(text, file.name.replace(/\.csv$/i, ""));
    },
    [loadCsvText]
  );

  const handleUseSample = useCallback(async () => {
    setImportError(null);
    try {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      const res = await fetch(`${base}/sample-stores.csv`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      loadCsvText(text, "サンプル（首都圏10駅）");
    } catch (e) {
      setImportError(
        `サンプルの読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }, [loadCsvText]);

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeo({ status: "error", message: "この端末はGeolocationに対応していません" });
      return;
    }
    setGeo({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setGeo({
          status: "ok",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: Date.now(),
        }),
      (err) =>
        setGeo({ status: "error", message: `位置情報の取得に失敗: ${err.message}` }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  const handleStamp = useCallback((storeId: string) => {
    setVisits(addVisit(storeId));
  }, []);

  const handleReset = useCallback(() => {
    if (!confirm("店舗リストとスタンプ履歴をすべて削除します。よろしいですか？")) return;
    clearChain();
    setChain(null);
    setVisits([]);
  }, []);

  const totalCount = chain?.stores.length ?? 0;
  const visitedCount = visits.length;
  const remaining = Math.max(0, totalCount - visitedCount);

  if (!ready) {
    return <main className="mx-auto w-full max-w-md flex-1 px-4 pt-4" />;
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-4 pb-24">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">勝手にスタンプラリー</h1>
        {chain && (
          <p className="text-sm text-gray-600">
            ターゲット: <span className="font-semibold">{chain.chainName}</span>
          </p>
        )}
      </header>

      {!chain ? (
        <ImportPanel
          onFile={handleFile}
          onUseSample={handleUseSample}
          error={importError}
        />
      ) : (
        <>
          <section className="mb-4 rounded-lg bg-blue-50 p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-xs text-blue-700">全国制覇まで</div>
                <div className="text-3xl font-bold text-blue-900">
                  あと {remaining} <span className="text-base">店舗</span>
                </div>
              </div>
              <div className="text-right text-sm text-blue-800">
                {visitedCount} / {totalCount}
              </div>
            </div>
            <div className="mt-3 h-2 w-full rounded bg-blue-200">
              <div
                className="h-2 rounded bg-blue-600 transition-all"
                style={{
                  width: totalCount === 0 ? "0%" : `${(visitedCount / totalCount) * 100}%`,
                }}
              />
            </div>
          </section>

          <nav className="mb-3 flex gap-2">
            <TabButton active={tab === "stamp"} onClick={() => setTab("stamp")}>
              スタンプを押す
            </TabButton>
            <TabButton active={tab === "list"} onClick={() => setTab("list")}>
              スタンプ帳
            </TabButton>
          </nav>

          {tab === "stamp" ? (
            <StampPanel
              geo={geo}
              onRequest={requestLocation}
              nearest={nearestUnvisited}
              nearestAny={storesWithDistance[0]}
              visitedIds={visitedIds}
              onStamp={handleStamp}
            />
          ) : (
            <StampBook
              stores={chain.stores}
              visits={visits}
              storesWithDistance={storesWithDistance}
            />
          )}

          <div className="mt-8 border-t pt-4">
            <button onClick={handleReset} className="text-sm text-red-600 underline">
              店舗リストをリセット
            </button>
          </div>
        </>
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${
        active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function ImportPanel({
  onFile,
  onUseSample,
  error,
}: {
  onFile: (file: File) => void;
  onUseSample: () => void;
  error: string | null;
}) {
  return (
    <section className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
      <h2 className="mb-2 font-semibold">店舗リスト（CSV）を読み込む</h2>
      <p className="mb-4 text-xs text-gray-600">
        必須カラム: <code>店舗名, 住所, 緯度, 経度</code>
      </p>
      <label className="inline-block cursor-pointer rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white">
        CSVを選択
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </label>
      <div className="mt-4 text-xs text-gray-500">または</div>
      <button
        onClick={onUseSample}
        className="mt-2 rounded-full border border-gray-400 px-4 py-2 text-sm text-gray-700"
      >
        サンプル（首都圏10駅）を使う
      </button>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </section>
  );
}

type NearItem = {
  store: { id: string; name: string; address: string };
  distance: number;
};

function StampPanel({
  geo,
  onRequest,
  nearest,
  nearestAny,
  visitedIds,
  onStamp,
}: {
  geo: GeoState;
  onRequest: () => void;
  nearest: NearItem | undefined;
  nearestAny: NearItem | undefined;
  visitedIds: Set<string>;
  onStamp: (id: string) => void;
}) {
  const target = nearest ?? nearestAny;
  const inRange = target ? target.distance <= STAMP_RADIUS_M : false;
  const alreadyVisited = target ? visitedIds.has(target.store.id) : false;

  return (
    <section>
      <button
        onClick={onRequest}
        className="mb-4 w-full rounded-lg bg-gray-900 py-3 font-semibold text-white"
      >
        {geo.status === "loading" ? "取得中…" : "現在地を取得"}
      </button>

      {geo.status === "error" && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{geo.message}</p>
      )}

      {geo.status === "ok" && (
        <p className="mb-4 text-xs text-gray-500">
          現在地: {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)} （精度 ±
          {Math.round(geo.accuracy)}m）
        </p>
      )}

      {geo.status === "ok" && target && (
        <div className="rounded-lg border p-4">
          <div className="text-xs text-gray-500">
            {alreadyVisited ? "最寄り店舗（訪問済）" : "最寄りの未訪問店舗"}
          </div>
          <div className="mt-1 text-lg font-bold">{target.store.name}</div>
          <div className="text-sm text-gray-600">{target.store.address}</div>
          <div className="mt-2 text-sm">
            距離: <span className="font-mono">{formatDistance(target.distance)}</span>
          </div>
          <button
            disabled={!inRange || alreadyVisited}
            onClick={() => onStamp(target.store.id)}
            className={`mt-4 w-full rounded-lg py-3 font-semibold text-white transition ${
              !inRange || alreadyVisited
                ? "bg-gray-300"
                : "bg-emerald-600 active:bg-emerald-700"
            }`}
          >
            {alreadyVisited
              ? "スタンプ獲得済み"
              : inRange
                ? "スタンプを押す！"
                : `半径${STAMP_RADIUS_M}m以内で活性化`}
          </button>
        </div>
      )}
    </section>
  );
}

function StampBook({
  stores,
  visits,
  storesWithDistance,
}: {
  stores: { id: string; name: string; address: string }[];
  visits: VisitRecord[];
  storesWithDistance: { store: { id: string }; distance: number }[];
}) {
  const visitMap = new Map(visits.map((v) => [v.storeId, v.visitedAt]));
  const distMap = new Map(storesWithDistance.map((x) => [x.store.id, x.distance]));
  const sorted = [...stores].sort((a, b) => {
    const av = visitMap.has(a.id) ? 0 : 1;
    const bv = visitMap.has(b.id) ? 0 : 1;
    if (av !== bv) return av - bv;
    return a.name.localeCompare(b.name, "ja");
  });

  return (
    <ul className="divide-y rounded-lg border">
      {sorted.map((s) => {
        const visitedAt = visitMap.get(s.id);
        const dist = distMap.get(s.id);
        return (
          <li key={s.id} className="flex items-center gap-3 p-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${
                visitedAt
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {visitedAt ? "✅" : "・"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{s.name}</div>
              <div className="truncate text-xs text-gray-500">{s.address}</div>
              {visitedAt ? (
                <div className="text-xs text-emerald-700">
                  訪問: {new Date(visitedAt).toLocaleString("ja-JP")}
                </div>
              ) : dist !== undefined ? (
                <div className="text-xs text-gray-500">距離 {formatDistance(dist)}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}
