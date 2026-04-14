import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
// GitHub Pages でリポジトリ配下（https://<user>.github.io/<repo>/）に
// デプロイする場合は repo 名を指定する。ユーザー/Org ルートなら空文字でよい。
const basePath = isProd ? process.env.NEXT_PUBLIC_BASE_PATH ?? "" : "";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath,
  trailingSlash: true,
};

export default nextConfig;
