export type Store = {
  id: string; // `${name}__${lat}_${lng}` などでユニーク化
  name: string;
  address: string;
  lat: number;
  lng: number;
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
