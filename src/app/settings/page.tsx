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
        <Link href="/" className="text-sm text-blue-600 underline">
          ← スタンプラリーに戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">設定</h1>
      </header>

      {stores.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          店舗リストがまだ読み込まれていません。
          <br />
          先にスタンプラリーを開いてください。
        </p>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-2 font-semibold">記録の持ち運び</h2>
            <p className="mb-3 text-xs text-gray-600">
              スタンプはこの端末の中だけに保存されています。別の端末に移すときは、
              書き出したファイルを移してから読み込んでください。読み込んだ内容が
              外部に送信されることはありません。
            </p>

            <div className="space-y-3">
              <button
                onClick={handleExport}
                className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white"
              >
                記録を書き出す（{visits.length}店）
              </button>

              <label className="block w-full cursor-pointer rounded-lg border border-gray-400 bg-white py-2.5 text-center text-sm font-semibold text-gray-700">
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

              {error && <p className="text-sm text-red-600">{error}</p>}
              {done && <p className="text-sm text-emerald-700">{done}</p>}

              {pending && (
                <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm">
                  <div className="font-semibold text-blue-900">読み込む内容</div>
                  <ul className="mt-1 space-y-0.5 text-blue-900">
                    <li>認識した記録: {pending.total} 店</li>
                    <li>新しく増える: {pending.added} 店</li>
                    <li>訪問日が古いほうに直る: {pending.updated} 店</li>
                    <li>変わらない: {pending.unchanged} 店</li>
                    {pending.unknownIds.length > 0 && (
                      <li className="text-blue-700">
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
                      className="flex-1 rounded-lg bg-emerald-600 py-2 font-semibold text-white"
                    >
                      取り込む
                    </button>
                    <button
                      onClick={() => setPending(null)}
                      className="flex-1 rounded-lg border border-gray-400 bg-white py-2 text-gray-700"
                    >
                      やめる
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h2 className="font-semibold text-red-800">スタンプ履歴のリセット</h2>
            <p className="mt-1 mb-3 text-xs text-red-700">
              押したスタンプ{visits.length}件をすべて削除します。元に戻せません。
              心配なときは、先に上の「記録を書き出す」で控えを取ってください。
            </p>
            <button
              onClick={handleReset}
              className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white"
            >
              スタンプ履歴をリセット
            </button>
          </section>
        </>
      )}
    </main>
  );
}
