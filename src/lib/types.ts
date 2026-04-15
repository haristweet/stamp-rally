export type Store = {
  id: string; // `${name}__${lat}_${lng}` などでユニーク化
  name: string;
  address: string;
  lat: number;
  lng: number;
  storeId?: string;
  kind?: string; // 直営 / FC / 新店/未登録 / 不明
  phone?: string;
  scale?: string; // 大 / 中 / 小
  visited?: boolean; // KML由来の訪問済フラグ
};

export type VisitRecord = {
  storeId: string;
  visitedAt: string; // ISO8601
};

export type ChainData = {
  chainName: string; // CSVファイル名などから推測
  importedAt: string;
  stores: Store[];
};
