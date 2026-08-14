"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ChainData } from "@/lib/types";
import { readRaw, CHAIN_KEY } from "@/lib/storage";
import { fetchNews, normalizeStoreName, type NewsItem } from "@/lib/news";

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 取得は非同期なので、返ってきたコールバックの中で状態を更新する
    let alive = true;
    fetchNews().then((result) => {
      if (!alive) return;
      setItems(result.items);
      setError(result.ok ? null : result.error);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 手元の店舗一覧に載っているか。載っていなければデータ更新の合図になる
  const known = useMemo(() => {
    const raw = readRaw(CHAIN_KEY);
    if (!raw) return null;
    try {
      const stores = (JSON.parse(raw) as ChainData).stores ?? [];
      return new Set(stores.map((s) => normalizeStoreName(s.name)));
    } catch {
      return null;
    }
  }, []);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-4 pb-24">
      <header className="mb-4">
        <Link href="/" className="text-sm text-accent underline">
          ← スタンプラリーに戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">出店情報</h1>
        <p className="mt-1 text-xs text-ink-weak">
          ブックオフの新規オープン・リニューアルのお知らせです。
          ブックオフグループの公式サイトから取得しています。
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-danger-line bg-danger-weak p-3 text-sm text-danger-ink">
          お知らせを取得できませんでした（{error}）。
          <a
            href="https://www.bookoffgroup.co.jp/news/"
            target="_blank"
            rel="noopener"
            className="ml-1 underline"
          >
            公式サイトで見る
          </a>
        </div>
      )}

      {loading && items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-weak">
          読み込み中…
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-weak">
          お知らせがありません
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => {
            const missing =
              known !== null && !known.has(normalizeStoreName(n.storeName));
            return (
              <li key={n.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-ink-weak">{n.date}</span>
                  {n.renewal ? (
                    <span className="rounded-full border border-accent-mid bg-accent-weak px-2 py-0.5 text-xs font-semibold text-accent-ink">
                      リニューアル
                    </span>
                  ) : (
                    <span className="rounded-full border border-stamp-ink/40 bg-stamp-weak px-2 py-0.5 text-xs font-semibold text-stamp-ink">
                      新店
                    </span>
                  )}
                  {missing && (
                    <span className="rounded-full border border-danger-line bg-danger-weak px-2 py-0.5 text-xs font-semibold text-danger-ink">
                      一覧に無い
                    </span>
                  )}
                </div>
                <div className="mt-1 leading-tight font-semibold">{n.storeName}</div>
                <p className="mt-1 line-clamp-3 text-xs text-ink-weak">{n.excerpt}</p>
                <a
                  href={n.link}
                  target="_blank"
                  rel="noopener"
                  className="mt-2 inline-block text-xs text-accent underline"
                >
                  公式のお知らせを読む
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
