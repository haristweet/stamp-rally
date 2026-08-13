export type Store = {
  id: string; // 店舗ID（5桁）。旧データは `${name}__${lat}_${lng}`
  name: string;
  address: string;
  lat: number;
  lng: number;
  storeId?: string;
  kind?: string; // 直営（2xxxx） / フランチャイズ（1xxxx）
  phone?: string;
  scale?: string; // 大型店舗 / 中型店舗 / 小型店舗
  hours?: string; // 営業時間
  parking?: string; // 駐車場（「なし」「60台」「1,590台」など）
  visited?: boolean; // KML由来の訪問済フラグ
};

export type VisitRecord = {
  storeId: string;
  visitedAt: string; // ISO8601
};

export type ChainData = {
  chainName: string;
  importedAt: string;
  version?: number; // 店舗データの版。上がったら保存済みを捨ててCSVを読み直す
  stores: Store[];
};
