"use client";

// ブックオフの「出店情報」を取ってくる。
// bookoff.co.jp にRSSは無く、bookoffgroup.co.jp のRSS（/feed/）は CORS ヘッダが
// 無いのでブラウザから読めない。同じ内容が WordPress の REST API から JSON で
// 取れて、そちらは CORS が通るのでこれを使う。
//
// カテゴリ 124 =「出店情報」。オープンとリニューアルオープンの両方が入る
// （閉店・移転の告知はこのサイトには無い）。

const ENDPOINT =
  "https://www.bookoffgroup.co.jp/wp-json/wp/v2/posts" +
  "?categories=124&per_page=30&_fields=id,date,link,title,excerpt";

const CACHE_KEY = "stamp-rally:news";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type NewsItem = {
  id: number;
  date: string; // YYYY-MM-DD
  title: string;
  storeName: string; // 見出しから「オープンのお知らせ」を落としたもの
  renewal: boolean;
  excerpt: string;
  link: string;
};

type Cache = { fetchedAt: number; items: NewsItem[] };

function stripTags(html: string): string {
  const el = document.createElement("textarea");
  el.innerHTML = html.replace(/<[^>]+>/g, "");
  return el.value.replace(/\s+/g, " ").trim();
}

// 「BOOKOFF○○店 リニューアルオープンのお知らせ」→「BOOKOFF○○店」
function toStoreName(title: string): string {
  return title
    .replace(/[　\s]*(リニューアル)?オープン(の)?お知らせ$/, "")
    .replace(/[　\s]*出店(の)?お知らせ$/, "")
    .trim();
}

// グループには別業態（Japan TCG Center・ハグオール・あそビバ・Rehello・BINGO）も
// あるが、このアプリが扱うのは BOOKOFF 本体だけなので絞る。
// BOOKOFF を冠していても、FASHION や総合買取窓口は店舗一覧に入れていないので外す。
// （残すと「一覧に無い」の印が永久に付き、本当の新店の合図が埋もれるため）
const OTHER_FORMATS = /FASHION|総合買取窓口|買取窓口|買取センター|買取専門|Rehello/i;

function isRallyTarget(title: string): boolean {
  const t = title.normalize("NFKC").trim();
  return /^(BOOKOFF|ブックオフ)/i.test(t) && !OTHER_FORMATS.test(t);
}

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cache;
    if (!c.fetchedAt || !Array.isArray(c.items)) return null;
    return c;
  } catch {
    return null;
  }
}

export type NewsResult =
  | { ok: true; items: NewsItem[]; stale: boolean }
  | { ok: false; error: string; items: NewsItem[] };

export async function fetchNews(): Promise<NewsResult> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, items: cached.items, stale: false };
  }
  try {
    const res = await fetch(ENDPOINT, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as Array<{
      id: number;
      date: string;
      link: string;
      title: { rendered: string };
      excerpt: { rendered: string };
    }>;
    const items: NewsItem[] = raw
      .map((p) => {
        const title = stripTags(p.title.rendered);
        return {
          id: p.id,
          date: p.date.slice(0, 10),
          title,
          storeName: toStoreName(title),
          renewal: title.includes("リニューアル"),
          excerpt: stripTags(p.excerpt.rendered),
          link: p.link,
        };
      })
      .filter((x) => isRallyTarget(x.title));
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), items } satisfies Cache)
    );
    return { ok: true, items, stale: false };
  } catch (e) {
    // 取れなくてもアプリは壊さない。前回の内容があれば古いまま見せる
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      items: cached?.items ?? [],
    };
  }
}

// 店舗一覧に載っているかどうか（載っていなければデータ更新の合図）
export function normalizeStoreName(name: string): string {
  return name
    .normalize("NFKC")
    .split("/")[0]
    .replace(/[（(].*?[）)]/g, "")
    .replace(/(BOOKOFF|ブックオフ)/gi, "")
    .replace(/(SUPER BAZAAR|PLUS\+?|FASHION)/gi, "")
    .replace(/[\s　・･]/g, "")
    .toLowerCase();
}
