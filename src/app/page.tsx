"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChainData, Store, VisitRecord } from "@/lib/types";
import {
  loadChain,
  loadVisits,
  saveChain,
  addVisit,
  saveVisits,
  migrateVisits,
} from "@/lib/storage";
import { parseCsv } from "@/lib/csv";
import Link from "next/link";
import { Radar } from "./Radar";
import { STAMP_RADIUS_M, distanceMeters } from "@/lib/geo";

type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; lat: number; lng: number; accuracy: number; at: number }
  | {
      status: "watching";
      lat: number;
      lng: number;
      accuracy: number;
      at: number;
    }
  | { status: "error"; message: string };

// スタンプ帳の並び順
type SortMode = "pref" | "near" | "visited";

// JISコード順（北海道→沖縄）。住所の先頭がこのいずれかで始まる
const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

function prefectureOf(address: string): string {
  return PREFECTURES.find((p) => address.startsWith(p)) ?? "その他";
}

// 店舗リストはブックオフ固定（ユーザーによるCSV読み込みは行わない）
const STORE_LIST_FILE = "bookoff-stores.csv";
const STORE_LIST_LABEL = "BOOKOFF 全国";
// 店舗データを差し替えたら上げる。保存済みが古ければCSVを読み直す
const STORE_DATA_VERSION = 3;

function geoErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "位置情報の利用が許可されていません。設定 → Safari → 位置情報 を確認してください。";
    case err.POSITION_UNAVAILABLE:
      return "位置情報を取得できませんでした（屋内などで GPS 信号が弱い可能性があります）。";
    case err.TIMEOUT:
      return "位置情報の取得がタイムアウトしました。屋外で再度お試しください。";
    default:
      return `位置情報の取得に失敗: ${err.message}`;
  }
}

export default function HomePage() {
  const [chain, setChain] = useState<ChainData | null>(null);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"stamp" | "radar" | "list">("stamp");
  const [ready, setReady] = useState(false);

  const visitedIds = useMemo(() => new Set(visits.map((v) => v.storeId)), [visits]);

  const storesWithDistance = useMemo(() => {
    if (!chain) return [];
    if (geo.status !== "ok" && geo.status !== "watching") return [];
    const { lat, lng } = geo;
    return chain.stores
      .map((s) => ({
        store: s,
        distance: distanceMeters(lat, lng, s.lat, s.lng),
      }))
      .sort((a, b) => a.distance - b.distance);
  }, [chain, geo]);

  const nearestUnvisited = useMemo(
    () => storesWithDistance.find((x) => !visitedIds.has(x.store.id)),
    [storesWithDistance, visitedIds]
  );

  // 同梱の店舗リストCSVを取り込む
  const loadStoreList = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      const res = await fetch(`${base}/${STORE_LIST_FILE}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = parseCsv(await res.text());
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      const data: ChainData = {
        chainName: STORE_LIST_LABEL,
        importedAt: new Date().toISOString(),
        version: STORE_DATA_VERSION,
        stores: result.stores,
      };
      saveChain(data);
      // 既に押したスタンプを新しい店舗IDに引き継ぐ
      const carried = migrateVisits(result.stores, loadVisits());
      const carriedIds = new Set(carried.map((v) => v.storeId));
      // CSV に「訪問済」フラグが付いている店舗は自動でスタンプ済みにする
      const now = new Date().toISOString();
      const seeded: VisitRecord[] = result.stores
        .filter((s) => s.visited && !carriedIds.has(s.id))
        .map((s) => ({ storeId: s.id, visitedAt: now }));
      const merged = [...carried, ...seeded];
      saveVisits(merged);
      setChain(data);
      setVisits(merged);
    } catch (e) {
      setLoadError(
        `店舗リストの読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // 初回起動時は店舗リストを自動で読み込む（保存済みならそれを使う）
  useEffect(() => {
    const saved = loadChain();
    setReady(true);
    if (saved && saved.version === STORE_DATA_VERSION) {
      setChain(saved);
      setVisits(loadVisits());
      return;
    }
    void loadStoreList();
  }, [loadStoreList]);

  const watchIdRef = useRef<number | null>(null);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setGeo({ status: "idle" });
  }, []);

  const startWatch = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeo({ status: "error", message: "この端末はGeolocationに対応していません" });
      return;
    }
    stopWatch();
    setGeo({ status: "loading" });
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) =>
        setGeo({
          status: "watching",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: Date.now(),
        }),
      (err) => setGeo({ status: "error", message: geoErrorMessage(err) }),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );
  }, [stopWatch]);

  useEffect(() => {
    return () => stopWatch();
  }, [stopWatch]);

  const handleStamp = useCallback((storeId: string) => {
    setVisits(addVisit(storeId));
  }, []);


  const totalCount = chain?.stores.length ?? 0;
  const visitedCount = visits.length;
  const remaining = Math.max(0, totalCount - visitedCount);

  if (!ready) {
    return <main className="mx-auto w-full max-w-md flex-1 px-4 pt-4" />;
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-4 pb-24">
      <header className="mb-4 flex items-start justify-between gap-2">
        <h1 className="text-2xl font-bold">非公式ブックオフスタンプラリー</h1>
        <Link
          href="/settings"
          aria-label="設定"
          className="shrink-0 rounded-full border border-gray-300 px-3 py-1.5 text-lg leading-none text-gray-600"
        >
          ⚙
        </Link>
      </header>

      {!chain ? (
        <StoreListStatus
          loading={loading}
          error={loadError}
          onRetry={loadStoreList}
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
              スタンプ
            </TabButton>
            <TabButton active={tab === "radar"} onClick={() => setTab("radar")}>
              レーダー
            </TabButton>
            <TabButton active={tab === "list"} onClick={() => setTab("list")}>
              スタンプ帳
            </TabButton>
          </nav>

          {tab === "radar" ? (
            geo.status === "ok" || geo.status === "watching" ? (
              <Radar
                userLat={geo.lat}
                userLng={geo.lng}
                stores={chain.stores}
                visitedIds={visitedIds}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                先に「スタンプ」タブで位置情報の追跡を開始してください
              </p>
            )
          ) : tab === "stamp" ? (
            <StampPanel
              geo={geo}
              onStart={startWatch}
              onStop={stopWatch}
              isWatching={geo.status === "watching" || geo.status === "loading"}
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

function StoreListStatus({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
        <button
          onClick={onRetry}
          className="mt-4 rounded-full bg-red-600 px-6 py-2 text-sm font-semibold text-white"
        >
          再読み込み
        </button>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
      {loading ? "店舗リストを読み込み中…" : "店舗リストを準備しています…"}
    </section>
  );
}

type NearItem = {
  store: Store;
  distance: number;
};

function KindBadge({ kind }: { kind?: string }) {
  if (!kind) return null;
  const style =
    kind === "直営"
      ? "bg-blue-100 text-blue-800 border-blue-300"
      : kind === "フランチャイズ"
        ? "bg-amber-100 text-amber-800 border-amber-300"
        : "bg-gray-100 text-gray-600 border-gray-300";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${style}`}>
      {kind}
    </span>
  );
}

function StampPanel({
  geo,
  onStart,
  onStop,
  isWatching,
  nearest,
  nearestAny,
  visitedIds,
  onStamp,
}: {
  geo: GeoState;
  onStart: () => void;
  onStop: () => void;
  isWatching: boolean;
  nearest: NearItem | undefined;
  nearestAny: NearItem | undefined;
  visitedIds: Set<string>;
  onStamp: (id: string) => void;
}) {
  const hasFix = geo.status === "ok" || geo.status === "watching";
  const target = nearest ?? nearestAny;
  const inRange = target ? target.distance <= STAMP_RADIUS_M : false;
  const alreadyVisited = target ? visitedIds.has(target.store.id) : false;
  const fix = hasFix
    ? (geo as Extract<GeoState, { status: "ok" | "watching" }>)
    : null;

  return (
    <section>
      <button
        onClick={isWatching ? onStop : onStart}
        className={`mb-2 w-full rounded-lg py-3 font-semibold text-white ${
          isWatching ? "bg-red-600" : "bg-gray-900"
        }`}
      >
        {geo.status === "loading"
          ? "取得中…"
          : isWatching
            ? "位置情報の追跡を停止"
            : "位置情報の追跡を開始"}
      </button>
      {isWatching && (
        <p className="mb-4 text-center text-xs text-emerald-700">
          ● 追跡中（移動すると自動更新されます）
        </p>
      )}

      {geo.status === "error" && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{geo.message}</p>
      )}

      {fix && (
        <p className="mb-4 text-xs text-gray-500">
          現在地: {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)} （精度 ±
          {Math.round(fix.accuracy)}m / 最終更新{" "}
          {new Date(fix.at).toLocaleTimeString("ja-JP")}）
        </p>
      )}

      {fix && target && (
        <div className="rounded-lg border p-4">
          <div className="text-xs text-gray-500">
            {alreadyVisited ? "最寄り店舗（訪問済）" : "最寄りの未訪問店舗"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">{shortName(target.store.name)}</span>
            <KindBadge kind={target.store.kind} />
            {target.store.scale && (
              <span className="rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
                規模 {target.store.scale}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-600">{target.store.address}</div>
          <dl className="mt-2 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-sm">
            {target.store.hours && (
              <>
                <dt className="text-gray-500">営業時間</dt>
                <dd>{target.store.hours}</dd>
              </>
            )}
            {target.store.parking && (
              <>
                <dt className="text-gray-500">駐車場</dt>
                <dd>{target.store.parking}</dd>
              </>
            )}
            <dt className="text-gray-500">電話番号</dt>
            <dd>
              {isDialable(target.store.phone) ? (
                <a
                  href={`tel:${target.store.phone!.replace(/[^0-9+]/g, "")}`}
                  className="text-blue-600 underline"
                >
                  {target.store.phone}
                </a>
              ) : (
                <span className="text-gray-500">{target.store.phone || "—"}</span>
              )}
            </dd>
            <dt className="text-gray-500">距離</dt>
            <dd className="font-mono">{formatDistance(target.distance)}</dd>
          </dl>
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
  stores: Store[];
  visits: VisitRecord[];
  storesWithDistance: { store: { id: string }; distance: number }[];
}) {
  const [sort, setSort] = useState<SortMode>("pref");
  const [onlyUnvisited, setOnlyUnvisited] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);

  const visitMap = useMemo(
    () => new Map(visits.map((v) => [v.storeId, v.visitedAt])),
    [visits]
  );
  const distMap = useMemo(
    () => new Map(storesWithDistance.map((x) => [x.store.id, x.distance])),
    [storesWithDistance]
  );

  const shown = useMemo(
    () => (onlyUnvisited ? stores.filter((s) => !visitMap.has(s.id)) : stores),
    [stores, onlyUnvisited, visitMap]
  );

  const byDistanceThenName = useCallback(
    (a: Store, b: Store) => {
      const da = distMap.get(a.id);
      const db = distMap.get(b.id);
      if (da !== undefined && db !== undefined) return da - db;
      if (da !== undefined) return -1;
      if (db !== undefined) return 1;
      return a.name.localeCompare(b.name, "ja");
    },
    [distMap]
  );

  const flat = useMemo(() => {
    const list = [...shown];
    if (sort === "near") return list.sort(byDistanceThenName);
    return list.sort((a, b) => {
      const av = visitMap.has(a.id) ? 0 : 1;
      const bv = visitMap.has(b.id) ? 0 : 1;
      if (av !== bv) return av - bv;
      return byDistanceThenName(a, b);
    });
  }, [shown, sort, visitMap, byDistanceThenName]);

  // 都道府県ごとの内訳。件数は絞り込みに関わらず実数を出す
  const groups = useMemo(() => {
    const all = new Map<string, Store[]>();
    for (const s of stores) {
      const p = prefectureOf(s.address);
      const arr = all.get(p);
      if (arr) arr.push(s);
      else all.set(p, [s]);
    }
    const visible = new Set(shown.map((s) => s.id));
    return PREFECTURES.filter((p) => all.has(p)).map((p) => {
      const list = all.get(p)!;
      return {
        pref: p,
        total: list.length,
        visited: list.filter((s) => visitMap.has(s.id)).length,
        stores: list
          .filter((s) => visible.has(s.id))
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
    });
  }, [stores, shown, visitMap]);

  // 現在地の都道府県だけ最初から開いておく（自分で開閉したあとは触らない）
  const nearestPref = useMemo(() => {
    const nearest = storesWithDistance[0];
    if (!nearest) return null;
    const s = stores.find((x) => x.id === nearest.store.id);
    return s ? prefectureOf(s.address) : null;
  }, [storesWithDistance, stores]);

  // 自分で開閉するまでは現在地の県だけ開いた状態にする
  const open = touched
    ? opened
    : new Set(nearestPref ? [nearestPref] : []);

  const toggle = (pref: string) => {
    const next = new Set(open);
    if (next.has(pref)) next.delete(pref);
    else next.add(pref);
    setTouched(true);
    setOpened(next);
  };

  return (
    <section>
      <div className="mb-2 flex gap-1">
        <SortButton active={sort === "pref"} onClick={() => setSort("pref")}>
          都道府県順
        </SortButton>
        <SortButton active={sort === "near"} onClick={() => setSort("near")}>
          近い順
        </SortButton>
        <SortButton active={sort === "visited"} onClick={() => setSort("visited")}>
          訪問済が先
        </SortButton>
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={onlyUnvisited}
          onChange={(e) => setOnlyUnvisited(e.target.checked)}
          className="h-4 w-4"
        />
        未訪問のみ表示（{stores.length - visitMap.size} 店）
      </label>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          該当する店舗がありません
        </p>
      ) : sort === "pref" ? (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = open.has(g.pref);
            const done = g.visited === g.total;
            return (
              <div key={g.pref} className="overflow-hidden rounded-lg border">
                <button
                  onClick={() => toggle(g.pref)}
                  className={`sticky top-0 z-10 flex w-full items-center justify-between px-3 py-2 text-left ${
                    done ? "bg-emerald-50" : "bg-gray-50"
                  }`}
                >
                  <span className="font-semibold">
                    {g.pref}
                    {g.stores.length === 0 && (
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        （表示なし）
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-sm">
                    <span className={done ? "text-emerald-700" : "text-gray-600"}>
                      {g.visited} / {g.total}
                    </span>
                    <span className="text-gray-400">{isOpen ? "▲" : "▼"}</span>
                  </span>
                </button>
                {isOpen && g.stores.length > 0 && (
                  <ul className="divide-y border-t">
                    {g.stores.map((s) => (
                      <StoreRow
                        key={s.id}
                        store={s}
                        visitedAt={visitMap.get(s.id)}
                        distance={distMap.get(s.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {flat.map((s) => (
            <StoreRow
              key={s.id}
              store={s}
              visitedAt={visitMap.get(s.id)}
              distance={distMap.get(s.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SortButton({
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
      className={`flex-1 rounded-full py-1.5 text-xs font-semibold transition ${
        active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function StoreRow({
  store,
  visitedAt,
  distance,
}: {
  store: Store;
  visitedAt: string | undefined;
  distance: number | undefined;
}) {
  return (
    <li className="flex items-center gap-3 p-3">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${
          visitedAt ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"
        }`}
      >
        {visitedAt ? "✅" : "・"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="font-semibold leading-tight break-words">
            {shortName(store.name)}
          </div>
          <KindBadge kind={store.kind} />
        </div>
        <div className="truncate text-xs text-gray-500">{store.address}</div>
        {visitedAt ? (
          <div className="text-xs text-emerald-700">
            訪問: {new Date(visitedAt).toLocaleDateString("ja-JP")}
          </div>
        ) : distance !== undefined ? (
          <div className="text-xs text-gray-500">距離 {formatDistance(distance)}</div>
        ) : null}
      </div>
    </li>
  );
}

// 「未定」や空欄が入っていることがあるので、数字を含むものだけ電話リンクにする
function isDialable(phone: string | undefined): boolean {
  return !!phone && /[0-9]/.test(phone);
}

function shortName(name: string): string {
  // 全店共通の "BOOKOFF " プレフィックスは省略して表示
  return name.replace(/^BOOKOFF\s+/i, "");
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}
