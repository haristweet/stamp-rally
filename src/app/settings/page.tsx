"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { ChainData, Store, VisitRecord } from "@/lib/types";
import {
  saveVisits,
  clearChain,
  readRaw,
  subscribeStorage,
  CHAIN_KEY,
  VISITS_KEY,
} from "@/lib/storage";
import {
  THEMES,
  THEME_KEY,
  isThemeId,
  saveTheme,
  type ThemeId,
} from "@/lib/theme";
import {
  buildExport,
  parseImport,
  mergeVisits,
  downloadJson,
  type MergePreview,
} from "@/lib/transfer";

type Pending = MergePreview & { unknownIds: string[]; total: number };

export default function SettingsPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // 取り込み後の値。保存済みより優先する（同一タブでは storage イベントが飛ばないため）
  const [applied, setApplied] = useState<VisitRecord[] | null>(null);

  // localStorage は React の外にある状態なので、購読して読む
  const chainRaw = useSyncExternalStore(
    subscribeStorage,
    () => readRaw(CHAIN_KEY),
    () => null
  );
  const visitsRaw = useSyncExternalStore(
    subscribeStorage,
    () => readRaw(VISITS_KEY),
    () => null
  );

  const stores = useMemo<Store[]>(() => {
    if (!chainRaw) return [];
    try {
      return (JSON.parse(chainRaw) as ChainData).stores ?? [];
    } catch {
      return [];
    }
  }, [chainRaw]);

  const saved = useMemo<VisitRecord[]>(() => {
    if (!visitsRaw) return [];
    try {
      return JSON.parse(visitsRaw) as VisitRecord[];
    } catch {
      return [];
    }
  }, [visitsRaw]);

  const visits = applied ?? saved;

  // 選択中のテーマ。保存済みが無ければ既定
  const themeRaw = useSyncExternalStore(
    subscribeStorage,
    () => readRaw(THEME_KEY),
    () => null
  );
  const [picked, setTheme] = useState<ThemeId | null>(null);
  const theme: ThemeId = picked ?? (isThemeId(themeRaw) ? themeRaw : "default");

  const handleExport = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(`stamp-rally-${stamp}.json`, buildExport(visits));
  };

  const handleFile = async (file: File) => {
    setError(null);
    setDone(null);
    setPending(null);
    const parsed = parseImport(await file.text(), stores);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const preview = mergeVisits(visits, parsed.records);
    setPending({
      ...preview,
      unknownIds: parsed.unknownIds,
      total: parsed.records.length,
    });
  };

  const handleReset = () => {
    if (!confirm("スタンプ履歴をすべて削除します。よろしいですか？")) return;
    clearChain();
    // 店舗リストごと消えるので、トップに戻って読み直させる
    location.href = process.env.NEXT_PUBLIC_BASE_PATH
      ? `${process.env.NEXT_PUBLIC_BASE_PATH}/`
      : "/";
  };

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-4 pb-24">
      <header className="mb-4">
        <Link href="/" className="text-sm text-accent underline">
          ← スタンプラリーに戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">設定</h1>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">外見</h2>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((t) => {
            const active = t.id === theme;
            return (
              <button
                key={t.id}
                onClick={() => {
                  saveTheme(t.id);
                  setTheme(t.id);
                }}
                className={`rounded-lg border p-3 text-left transition ${
                  active ? "border-accent bg-accent-weak" : "border-line bg-surface"
                }`}
              >
                <span className="flex gap-1">
                  {t.swatch.map((c) => (
                    <span
                      key={c}
                      className="h-5 w-5 rounded-full border border-line"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                <span className="mt-2 block text-sm font-semibold">
                  {t.name}
                  {active && <span className="ml-1 text-accent">✓</span>}
                </span>
                <span className="block text-xs text-ink-weak">{t.note}</span>
              </button>
            );
          })}
        </div>
      </section>

      {stores.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-weak">
          店舗リストがまだ読み込まれていません。
          <br />
          先にスタンプラリーを開いてください。
        </p>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-2 font-semibold">記録の持ち運び</h2>
            <p className="mb-3 text-xs text-ink-weak">
              スタンプはこの端末の中だけに保存されています。別の端末に移すときは、
              書き出したファイルを移してから読み込んでください。読み込んだ内容が
              外部に送信されることはありません。
            </p>

            <div className="space-y-3">
              <button
                onClick={handleExport}
                className="w-full rounded-lg bg-invert py-2.5 text-sm font-semibold text-on-invert"
              >
                記録を書き出す（{visits.length}店）
              </button>

              <label className="block w-full cursor-pointer rounded-lg border border-line bg-surface py-2.5 text-center text-sm font-semibold text-ink">
                記録を読み込む
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                    e.target.value = "";
                  }}
                />
              </label>

              {error && <p className="text-sm text-danger">{error}</p>}
              {done && <p className="text-sm text-stamp-ink">{done}</p>}

              {pending && (
                <div className="rounded-lg border border-accent-mid bg-accent-weak p-3 text-sm">
                  <div className="font-semibold text-accent-ink">読み込む内容</div>
                  <ul className="mt-1 space-y-0.5 text-accent-ink">
                    <li>認識した記録: {pending.total} 店</li>
                    <li>新しく増える: {pending.added} 店</li>
                    <li>訪問日が古いほうに直る: {pending.updated} 店</li>
                    <li>変わらない: {pending.unchanged} 店</li>
                    {pending.unknownIds.length > 0 && (
                      <li className="text-accent-ink">
                        店舗一覧に無いため取り込めない: {pending.unknownIds.length} 件
                      </li>
                    )}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        saveVisits(pending.merged);
                        setApplied(pending.merged);
                        setDone(
                          `取り込みました（${pending.added}店を追加、${pending.updated}店の日付を更新）`
                        );
                        setPending(null);
                      }}
                      className="flex-1 rounded-lg bg-stamp py-2 font-semibold text-on-stamp"
                    >
                      取り込む
                    </button>
                    <button
                      onClick={() => setPending(null)}
                      className="flex-1 rounded-lg border border-line bg-surface py-2 text-ink"
                    >
                      やめる
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-danger-line bg-danger-weak p-4">
            <h2 className="font-semibold text-danger-ink">スタンプ履歴のリセット</h2>
            <p className="mt-1 mb-3 text-xs text-danger-ink">
              押したスタンプ{visits.length}件をすべて削除します。元に戻せません。
              心配なときは、先に上の「記録を書き出す」で控えを取ってください。
            </p>
            <button
              onClick={handleReset}
              className="w-full rounded-lg bg-danger py-2.5 text-sm font-semibold text-on-danger"
            >
              スタンプ履歴をリセット
            </button>
          </section>
        </>
      )}
    </main>
  );
}
