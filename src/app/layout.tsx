import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "非公式ブックオフスタンプラリー",
  description: "ブックオフスタンプラリー",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

// 描画される前に配色を決める。React の初期化を待つと、既定色から選択色へ
// 一瞬ちらつくため、保存済みの設定を head の中で読んでしまう。
const applyThemeBeforePaint = `try{var t=localStorage.getItem("stamp-rally:theme");if(t)document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-theme は下のスクリプトが描画前に付ける。JSX 側では指定しない
    // （指定するとハイドレーション時に食い違う）
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-app text-ink">
        <Script id="theme-init" strategy="beforeInteractive">
          {applyThemeBeforePaint}
        </Script>
        {children}
      </body>
    </html>
  );
}
