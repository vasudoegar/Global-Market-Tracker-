import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import YahooFinancePkg from 'yahoo-finance2';
import { subDays, subMonths, subYears } from 'date-fns';
import dotenv from 'dotenv';

dotenv.config();

// Assets to track (Reduced for reliability)
const ASSETS = [
  { symbol: '^GSPC', name: 'S&P 500', type: 'index', region: 'USA' },
  { symbol: '^IXIC', name: 'Nasdaq 100', type: 'index', region: 'USA' },
  { symbol: '^NSEI', name: 'Nifty 50', type: 'index', region: 'India' },
  { symbol: '^N225', name: 'Nikkei 225', type: 'index', region: 'Japan' },
  { symbol: '^HSI', name: 'Hang Seng Index', type: 'index', region: 'Hong Kong' },
  { symbol: '^FTSE', name: 'FTSE 100', type: 'index', region: 'UK' },
  { symbol: 'GC=F', name: 'Gold', type: 'commodity', region: 'Global' },
  { symbol: 'CL=F', name: 'Crude Oil', type: 'commodity', region: 'Global' },
];

const YahooFinance: any = (YahooFinancePkg as any).default || YahooFinancePkg;
const yahooFinance = new YahooFinance({
  suppressNotices: ['ripHistorical']
});

if (yahooFinance.setGlobalConfig) {
  yahooFinance.setGlobalConfig({
    validation: { logErrors: false, logOptionsErrors: false }
  });
}

async function fetchHistoricalData(symbol: string) {
  try {
    const end = new Date();
    const start = subYears(end, 3); // Reduced from 6 to 3 years
    
    // Explicit timeout for safety
    const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
    
    const chartPromise = yahooFinance.chart(symbol, {
      period1: start,
      period2: end,
      interval: '1d'
    }, { validateResult: false });

    const chartResult = await Promise.race([chartPromise, timeout(4000)]) as any;
    
    if (chartResult && chartResult.quotes) {
      return chartResult.quotes
        .map((q: any) => ({
          date: q.date,
          close: q.close || q.adjclose
        }))
        .filter((point: any) => point && point.close !== null && point.close !== undefined);
    }
    return [];
  } catch (error) {
    return [];
  }
}

function calculateReturns(history: any[]) {
  if (!history || history.length === 0) return null;
  const current = history[history.length - 1].close;
  const findPrice = (date: Date) => {
    const targetTime = date.getTime();
    let closest = history[0];
    for (const point of history) {
      if (new Date(point.date).getTime() <= targetTime) closest = point;
      else break;
    }
    return closest ? closest.close : null;
  };

  const getReturn = (pastDate: Date) => {
    const pastPrice = findPrice(pastDate);
    if (!pastPrice || pastPrice === 0) return null;
    return ((current / pastPrice) - 1) * 100;
  };

  const now = new Date();
  return {
    daily: getReturn(subDays(now, 1)),
    weekly: getReturn(subDays(now, 7)),
    monthly: getReturn(subMonths(now, 1)),
    sixMonth: getReturn(subMonths(now, 6)),
    oneYear: getReturn(subYears(now, 1)),
    twoYear: getReturn(subYears(now, 2)),
    threeYear: getReturn(subYears(now, 3)),
    fiveYear: getReturn(subYears(now, 5)),
  };
}

function calculateRiskMetrics(history: any[], benchmarkHistory?: any[]) {
  if (!history || history.length < 20) return null;
  const dailyReturns: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].close;
    const curr = history[i].close;
    if (prev > 0) dailyReturns.push((curr / prev) - 1);
  }
  if (dailyReturns.length < 10) return null;

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (dailyReturns.length - 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;

  let maxDD = 0;
  let peak = -Infinity;
  for (const point of history) {
    if (point.close > peak) peak = point.close;
    const dd = ((point.close / peak) - 1) * 100;
    if (dd < maxDD) maxDD = dd;
  }

  const lastPrice = history[history.length - 1].close;
  const firstPrice = history[0].close;
  const years = (new Date(history[history.length - 1].date).getTime() - new Date(history[0].date).getTime()) / (1000 * 60 * 60 * 24 * 365);
  const cagr = (Math.pow(lastPrice / firstPrice, 1 / years) - 1) * 100;

  const riskFreeRate = 2.0; 
  const sharpeRatio = volatility > 0 ? (cagr - riskFreeRate) / volatility : 0;

  const negativeReturns = dailyReturns.filter(r => r < 0);
  const downsideVariance = negativeReturns.length > 0 
    ? negativeReturns.reduce((a, b) => a + Math.pow(b, 2), 0) / dailyReturns.length 
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252) * 100;
  const sortinoRatio = downsideDeviation > 0 ? (cagr - riskFreeRate) / downsideDeviation : 0;

  const calmarRatio = Math.abs(maxDD) > 0 ? cagr / Math.abs(maxDD) : 0;

  let beta = null;
  if (benchmarkHistory && benchmarkHistory.length > 20) {
    const assetReturns: number[] = [];
    const benchReturns: number[] = [];
    const benchMap = new Map(benchmarkHistory.map(h => [new Date(h.date).toDateString(), h.close]));
    for (let i = 1; i < history.length; i++) {
      const dateStr = new Date(history[i].date).toDateString();
      const prevDateStr = new Date(history[i-1].date).toDateString();
      const benchCurr = benchMap.get(dateStr);
      const benchPrev = benchMap.get(prevDateStr);
      if (benchCurr && benchPrev && benchPrev > 0) {
        assetReturns.push((history[i].close / history[i-1].close) - 1);
        benchReturns.push((benchCurr / benchPrev) - 1);
      }
    }
    if (benchReturns.length > 10) {
      const benchMean = benchReturns.reduce((a, b) => a + b, 0) / benchReturns.length;
      const assetMean = assetReturns.reduce((a, b) => a + b, 0) / assetReturns.length;
      let covariance = 0;
      let benchVariance = 0;
      for (let i = 0; i < benchReturns.length; i++) {
        covariance += (assetReturns[i] - assetMean) * (benchReturns[i] - benchMean);
        benchVariance += Math.pow(benchReturns[i] - benchMean, 2);
      }
      beta = benchVariance > 0 ? covariance / benchVariance : 1;
    }
  }

  return { volatility, maxDrawdown: maxDD, sharpeRatio, sortinoRatio, calmarRatio, cagr, beta };
}

function filterHistoryByDate(history: any[], pastDate: Date) {
  const targetTime = pastDate.getTime();
  return history.filter(point => new Date(point.date).getTime() >= targetTime);
}

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupFrontend() {
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error('Vite error:', e);
    }
  } else if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
    // Local production build serving (if ever needed)
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
}

setupFrontend();

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/market-data', async (req, res) => {
  try {
    const now = new Date();
    const sp500History = await fetchHistoricalData('^GSPC');
    const bench3Y = filterHistoryByDate(sp500History, subYears(now, 3));
    const bench2Y = filterHistoryByDate(sp500History, subYears(now, 2));
    const bench1Y = filterHistoryByDate(sp500History, subYears(now, 1));
    
    const results: any[] = [];
    const batchSize = 4; // Smaller batch for stability
    
    for (let i = 0; i < ASSETS.length; i += batchSize) {
      const batch = ASSETS.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async (asset) => {
        try {
          const fullHistory = await fetchHistoricalData(asset.symbol);
          if (!fullHistory || fullHistory.length === 0) throw new Error('No data');
          const returns = calculateReturns(fullHistory);
          const history3Y = filterHistoryByDate(fullHistory, subYears(now, 3));
          const riskMetrics: any = {
            '1Y': calculateRiskMetrics(filterHistoryByDate(fullHistory, subYears(now, 1)), bench1Y),
            '2Y': calculateRiskMetrics(filterHistoryByDate(fullHistory, subYears(now, 2)), bench2Y),
            '3Y': calculateRiskMetrics(history3Y, bench3Y),
          };
          const lastPoint = fullHistory[fullHistory.length - 1];
          return { ...asset, lastPrice: lastPoint.close, lastUpdated: lastPoint.date, returns, riskMetrics, history: history3Y };
        } catch (err) {
          return { ...asset, lastPrice: 0, lastUpdated: new Date(), returns: null, riskMetrics: {}, history: [] };
        }
      }));
      results.push(...batchResults);
    }
    res.json(results);
  } catch (error: any) {
    console.error('Market Data API Root Error:', error);
    res.status(500).json({ error: error.message || 'Quantum link timeout. Retrying...' });
  }
});

export default app;

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Local server: http://localhost:${PORT}`);
  });
}
