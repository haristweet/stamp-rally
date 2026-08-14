"use client";

// 外見（配色）。実際の色は globals.css の [data-theme="..."] 側に置く。
// ここは一覧と保存・適用だけを持つ。

export const THEME_KEY = "stamp-rally:theme";

export type ThemeId = "default" | "bookoff" | "dark" | "paper";

export type Theme = {
  id: ThemeId;
  name: string;
  note: string;
  // 設定画面に出す色見本（面 / 強調 / スタンプ）
  swatch: [string, string, string];
};

export const THEMES: Theme[] = [
  {
    id: "default",
    name: "ふつう",
    note: "白地に青。既定の見た目",
    swatch: ["#ffffff", "#2563eb", "#059669"],
  },
  {
    id: "bookoff",
    name: "ブックオフ",
    note: "看板の青・黄・赤",
    swatch: ["#0068b7", "#fdd000", "#e5171f"],
  },
  {
    id: "dark",
    name: "ダーク",
    note: "黒基調。夜の掘り出しに",
    swatch: ["#0b0b0d", "#3b82f6", "#10b981"],
  },
  {
    id: "paper",
    name: "スタンプ帳",
    note: "生成りの紙に朱色のスタンプ",
    swatch: ["#f7f3e8", "#8a6a3b", "#c0392b"],
  },
];

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
}

export function saveTheme(id: ThemeId): void {
  localStorage.setItem(THEME_KEY, id);
  applyTheme(id);
}
