export interface AssetReturns {
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  sixMonth: number | null;
  oneYear: number | null;
  twoYear: number | null;
  threeYear: number | null;
  fiveYear: number | null;
}

export interface HistoryPoint {
  date: string | Date;
  close: number;
}

export interface AssetData {
  symbol: string;
  name: string;
  type: 'index' | 'commodity';
  region: string;
  lastPrice: number;
  lastUpdated: string | Date;
  returns: AssetReturns;
  history: HistoryPoint[];
  riskMetrics: {
    [key in '1Y' | '2Y' | '3Y' | '5Y']?: {
      volatility: number | null;
      maxDrawdown: number | null;
      sharpeRatio: number | null;
    };
  };
}
