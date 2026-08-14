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
import { fetchNews, type NewsItem } from "@/lib/news";

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
        {/* 「非公式」は但し書きなので小さく載せる。1行に収めるための措置でもある */}
        <div className="min-w-0">
          <div className="text-xs font-semibold tracking-wide text-ink-weak">
            非公式
          </div>
          <h1 className="text-2xl font-bold">ブックオフスタンプラリー</h1>
        </div>
        <Link
          href="/settings"
          aria-label="設定"
          className="shrink-0 rounded-full border border-line px-3 py-1.5 text-lg leading-none text-ink-weak"
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
          <section className="mb-4 rounded-lg bg-accent-weak p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-xs text-accent-ink">全国制覇まで</div>
                <div className="text-3xl font-bold text-accent-ink">
                  あと {remaining} <span className="text-base">店舗</span>
                </div>
              </div>
              <div className="text-right text-sm text-accent-ink">
                {visitedCount} / {totalCount}
              </div>
            </div>
            <div className="mt-3 h-2 w-full rounded bg-accent-mid">
              <div
                className="h-2 rounded bg-accent transition-all"
                style={{
                  width: totalCount === 0 ? "0%" : `${(visitedCount / totalCount) * 100}%`,
                }}
              />
            </div>
          </section>

          <NewsBanner />

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
              <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-weak">
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
        active ? "bg-invert text-on-invert" : "bg-mute text-ink"
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
      <section className="rounded-lg border border-danger-line bg-danger-weak p-6 text-center">
        <p className="text-sm text-danger-ink">{error}</p>
        <button
          onClick={onRetry}
          className="mt-4 rounded-full bg-danger px-6 py-2 text-sm font-semibold text-on-danger"
        >
          再読み込み
        </button>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-weak">
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
      ? "bg-direct text-accent-ink border-accent-mid"
      : kind === "フランチャイズ"
        ? "bg-fc text-fc-ink border-fc-ink/40"
        : "bg-mute text-ink-weak border-line";
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
  const fix = hasFix
    ? (geo as Extract<GeoState, { status: "ok" | "watching" }>)
    : null;

  // 1枚目は最寄り（訪問済でも出す）、2枚目は最寄りの未踏。
  // 最寄りがそのまま未踏なら同じ内容になるので1枚だけにする。
  const cards: { label: string; item: NearItem }[] = [];
  if (nearestAny) cards.push({ label: "最寄り", item: nearestAny });
  if (nearest && nearest.store.id !== nearestAny?.store.id) {
    cards.push({ label: "最寄りの未踏", item: nearest });
  }

  const trackRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);

  const handleScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setPage(Math.round(el.scrollLeft / el.clientWidth));
  };

  const scrollToCard = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    // behavior:"smooth" は環境によっては無効化されて動かないので指定しない
    el.scrollTo({ left: i * el.clientWidth });
    setPage(i);
  };

  return (
    <section>
      <button
        onClick={isWatching ? onStop : onStart}
        className={`mb-2 w-full rounded-lg py-3 font-semibold ${
          isWatching ? "bg-danger text-on-danger" : "bg-invert text-on-invert"
        }`}
      >
        {geo.status === "loading"
          ? "取得中…"
          : isWatching
            ? "位置情報の追跡を停止"
            : "位置情報の追跡を開始"}
      </button>
      {isWatching && (
        <p className="mb-4 text-center text-xs text-stamp-ink">
          ● 追跡中（移動すると自動更新されます）
        </p>
      )}

      {geo.status === "error" && (
        <p className="mb-4 rounded bg-danger-weak p-3 text-sm text-danger-ink">{geo.message}</p>
      )}

      {fix && (
        <p className="mb-4 text-xs text-ink-weak">
          現在地: {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)} （精度 ±
          {Math.round(fix.accuracy)}m / 最終更新{" "}
          {new Date(fix.at).toLocaleTimeString("ja-JP")}）
        </p>
      )}

      {fix && cards.length > 0 && (
        <>
          {/* 1枚目=最寄り、2枚目=最寄りの未踏。指で滑らせて切り替える */}
          <div
            ref={trackRef}
            onScroll={handleScroll}
            className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {cards.map((c) => (
              <div key={c.label} className="w-full shrink-0 snap-start">
                <StoreCard
                  label={c.label}
                  item={c.item}
                  visited={visitedIds.has(c.item.store.id)}
                  onStamp={onStamp}
                />
              </div>
            ))}
          </div>

          {cards.length > 1 && (
            <div className="mt-2 flex justify-center gap-2">
              {cards.map((c, i) => (
                <button
                  key={c.label}
                  aria-label={`${c.label}を表示`}
                  onClick={() => scrollToCard(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === page ? "w-5 bg-accent" : "w-2 bg-line"
                  }`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Googleマップは住所ではなく座標を渡す。公式ピンなので店の位置に正確に落ちる
function mapUrl(store: Store): string {
  return `https://www.google.com/maps/search/?api=1&query=${store.lat},${store.lng}`;
}

function StoreNameLink({
  store,
  className,
}: {
  store: Store;
  className?: string;
}) {
  return (
    <a
      href={mapUrl(store)}
      target="_blank"
      rel="noopener"
      className={`text-accent underline decoration-accent/40 underline-offset-2 ${className ?? ""}`}
    >
      {shortName(store.name)}
    </a>
  );
}

function StoreCard({
  label,
  item,
  visited,
  onStamp,
}: {
  label: string;
  item: NearItem;
  visited: boolean;
  onStamp: (id: string) => void;
}) {
  const store = item.store;
  const inRange = item.distance <= STAMP_RADIUS_M;
  return (
    <div className="h-full rounded-lg border border-line p-4">
      <div className="text-xs text-ink-weak">
        {label}
        {visited && "（訪問済）"}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <StoreNameLink store={store} className="text-lg font-bold" />
        <KindBadge kind={store.kind} />
        {store.scale && (
          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink">
            {store.scale}
          </span>
        )}
      </div>
      <div className="text-sm text-ink-weak">{store.address}</div>
      <dl className="mt-2 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-sm">
        {store.hours && (
          <>
            <dt className="text-ink-weak">営業時間</dt>
            <dd>{store.hours}</dd>
          </>
        )}
        {store.parking && (
          <>
            <dt className="text-ink-weak">駐車場</dt>
            <dd>{store.parking}</dd>
          </>
        )}
        <dt className="text-ink-weak">電話番号</dt>
        <dd>
          {isDialable(store.phone) ? (
            <a
              href={`tel:${store.phone!.replace(/[^0-9+]/g, "")}`}
              className="text-accent underline"
            >
              {store.phone}
            </a>
          ) : (
            <span className="text-ink-weak">{store.phone || "—"}</span>
          )}
        </dd>
        <dt className="text-ink-weak">距離</dt>
        <dd className="font-mono">{formatDistance(item.distance)}</dd>
      </dl>
      <button
        disabled={!inRange || visited}
        onClick={() => onStamp(store.id)}
        className={`mt-4 w-full rounded-lg py-3 font-semibold transition ${
          !inRange || visited
            ? "bg-disabled text-on-invert"
            : "bg-stamp text-on-stamp active:opacity-90"
        }`}
      >
        {visited
          ? "スタンプ獲得済み"
          : inRange
            ? "スタンプを押す！"
            : `半径${STAMP_RADIUS_M}m以内で活性化`}
      </button>
    </div>
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
      const va = visitMap.get(a.id);
      const vb = visitMap.get(b.id);
      if (!va !== !vb) return va ? -1 : 1;
      // 訪問済どうしは訪問日の古い順（最初に行った店が上）
      if (va && vb) {
        const d = Date.parse(va) - Date.parse(vb);
        if (d !== 0) return d;
      }
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

  // 並び替えや絞り込みを変えたら先頭に戻す。
  // そのままだと途中の位置に着地して、並びが変わっていないように見えるため
  const topRef = useRef<HTMLDivElement>(null);
  // 並びを変えたらリストの先頭に戻す。そのままだと途中の位置に着地して、
  // 並びが変わっていないように見えるため。
  // 並び替え後は高さが変わるので、描画前と描画後の2回動かす
  // （requestAnimationFrame は非表示タブで止まるため使わない）。
  const backToTop = () => {
    const move = () => {
      const el = topRef.current;
      if (!el) return;
      const y = el.getBoundingClientRect().top + window.scrollY - 8;
      window.scrollTo(0, Math.max(0, y));
    };
    move();
    setTimeout(move, 0);
  };

  const toggle = (pref: string) => {
    const next = new Set(open);
    if (next.has(pref)) next.delete(pref);
    else next.add(pref);
    setTouched(true);
    setOpened(next);
  };

  return (
    <section>
      <div ref={topRef} className="mb-2 flex gap-1 [overflow-anchor:none]">
        <SortButton
          active={sort === "pref"}
          onClick={() => {
            setSort("pref");
            backToTop();
          }}
        >
          都道府県順
        </SortButton>
        <SortButton
          active={sort === "near"}
          onClick={() => {
            setSort("near");
            backToTop();
          }}
        >
          近い順
        </SortButton>
        <SortButton
          active={sort === "visited"}
          onClick={() => {
            setSort("visited");
            backToTop();
          }}
        >
          訪問済が先
        </SortButton>
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={onlyUnvisited}
          onChange={(e) => {
            setOnlyUnvisited(e.target.checked);
            backToTop();
          }}
          className="h-4 w-4"
        />
        未訪問のみ表示（{stores.length - visitMap.size} 店）
      </label>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-weak">
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
                    done ? "bg-stamp-weak" : "bg-surface"
                  }`}
                >
                  <span className="font-semibold">
                    {g.pref}
                    {g.stores.length === 0 && (
                      <span className="ml-2 text-xs font-normal text-ink-weak">
                        （表示なし）
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-sm">
                    <span className={done ? "text-stamp-ink" : "text-ink-weak"}>
                      {g.visited} / {g.total}
                    </span>
                    <span className="text-ink-faint">{isOpen ? "▲" : "▼"}</span>
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

// 最新の出店情報を1件だけ出す。詳しくは /news/ へ
function NewsBanner() {
  const [latest, setLatest] = useState<NewsItem | null>(null);

  useEffect(() => {
    let alive = true;
    fetchNews().then((result) => {
      if (alive) setLatest(result.items[0] ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!latest) return null;

  return (
    <Link
      href="/news"
      className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2"
    >
      <span className="shrink-0 rounded-full bg-stamp-weak px-2 py-0.5 text-xs font-semibold text-stamp-ink">
        {latest.renewal ? "リニューアル" : "新店"}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{latest.storeName}</span>
      <span className="shrink-0 text-xs text-ink-faint">{latest.date}</span>
    </Link>
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
        active ? "bg-invert text-on-invert" : "bg-mute text-ink"
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
      {/* 絵文字だと色が固定でテーマから浮くので、文字と背景で描く */}
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          visitedAt
            ? "bg-stamp text-on-stamp"
            : "border border-line bg-mute text-ink-faint"
        }`}
      >
        {visitedAt ? (
          <span className="text-lg leading-none font-bold">✓</span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="leading-tight font-semibold break-words">
            <StoreNameLink store={store} />
          </div>
          <KindBadge kind={store.kind} />
        </div>
        <div className="truncate text-xs text-ink-weak">{store.address}</div>
        {visitedAt ? (
          <div className="text-xs text-stamp-ink">
            訪問: {new Date(visitedAt).toLocaleDateString("ja-JP")}
          </div>
        ) : distance !== undefined ? (
          <div className="text-xs text-ink-weak">距離 {formatDistance(distance)}</div>
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
