import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import YahooFinancePkg from 'yahoo-finance2';
import { subDays, subMonths, subYears } from 'date-fns';
import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore/lite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fix for ESM JSON import on Vercel/Node
const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(readFileSync(firebaseConfigPath, 'utf-8'));

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

// Assets to track
const ASSETS = [
  { symbol: '^GSPC', name: 'S&P 500', type: 'index', region: 'USA' },
  { symbol: '^IXIC', name: 'Nasdaq 100', type: 'index', region: 'USA' },
  { symbol: '^NSEI', name: 'Nifty 50', type: 'index', region: 'India' },
  { symbol: '^IBEX', name: 'IBEX 35', type: 'index', region: 'Spain' },
  { symbol: '^BVSP', name: 'IBOVESPA', type: 'index', region: 'Brazil' },
  { symbol: 'URTH', name: 'MSCI World', type: 'index', region: 'Global' },
  { symbol: 'EEM', name: 'MSCI Emerging Markets', type: 'index', region: 'Global' },
  { symbol: '^N225', name: 'Nikkei 225', type: 'index', region: 'Japan' },
  { symbol: '^HSI', name: 'Hang Seng Index', type: 'index', region: 'Hong Kong' },
  { symbol: '^FTSE', name: 'FTSE 100', type: 'index', region: 'UK' },
  { symbol: '^GDAXI', name: 'DAX Performance-Index', type: 'index', region: 'Germany' },
  { symbol: '^FCHI', name: 'CAC 40', type: 'index', region: 'France' },
  { symbol: 'GC=F', name: 'Gold', type: 'commodity', region: 'Global' },
  { symbol: 'SI=F', name: 'Silver', type: 'commodity', region: 'Global' },
  { symbol: 'CL=F', name: 'Crude Oil', type: 'commodity', region: 'Global' },
  { symbol: 'BTC-USD', name: 'Bitcoin', type: 'crypto', region: 'Global' },
  { symbol: 'ETH-USD', name: 'Ethereum', type: 'crypto', region: 'Global' },
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
    const start = subYears(end, 5); 
    
    // Explicit timeout for safety
    const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
    
    const chartPromise = yahooFinance.chart(symbol, {
      period1: start,
      period2: end,
      interval: '1d'
    }, { validateResult: false });

    // Tighter timeout for parallel execution on Vercel (10s hobby limit)
    const chartResult = await Promise.race([chartPromise, timeout(7000)]) as any; 
    
    if (chartResult && chartResult.quotes) {
      return chartResult.quotes
        .map((q: any) => ({
          date: q.date instanceof Date ? q.date.toISOString() : new Date(q.date).toISOString(),
          close: q.close || q.adjclose
        }))
        .filter((point: any) => point && typeof point.close === 'number' && point.close > 0);
    }
    return [];
  } catch (error) {
    console.error(`Yahoo Finance Fetch Error [${symbol}]:`, error);
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

async function setupFrontend() {
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    try {
      const { createServer: createViteServer } = await import('vite');
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

function getSnapshotId() {
  const now = new Date();
  const utcHours = now.getUTCHours();
  
  // 11:30 PM IST = 6:00 PM (18:00) UTC
  // If before 6PM UTC, use yesterday's date
  if (utcHours < 18) {
    const yesterday = new Date(now);
    yesterday.setUTCDate(now.getUTCDate() - 1);
    return yesterday.toISOString().split('T')[0];
  }
  return now.toISOString().split('T')[0];
}

app.get('/api/market-data', async (req, res) => {
  try {
    const snapshotId = `v8_${getSnapshotId()}`;
    const snapshotRef = doc(db, 'snapshots', snapshotId);
    
    // 1. Check Cache First
    const cachedDoc = await getDoc(snapshotRef);
    if (cachedDoc.exists()) {
      console.log(`>>> CACHE HIT: Serving snapshot ${snapshotId}`);
      return res.json(cachedDoc.data().assets);
    }

    console.log(`>>> CACHE MISS: Generating snapshot ${snapshotId}`);
    const now = new Date();
    const sp500History = await fetchHistoricalData('^GSPC');
    
    const bench5Y = filterHistoryByDate(sp500History, subYears(now, 5));
    const bench3Y = filterHistoryByDate(sp500History, subYears(now, 3));
    const bench2Y = filterHistoryByDate(sp500History, subYears(now, 2));
    const bench1Y = filterHistoryByDate(sp500History, subYears(now, 1));
    
    // Fully parallel fetching for Vercel speed
    const results = await Promise.all(ASSETS.map(async (asset) => {
      try {
        const fullHistory = await fetchHistoricalData(asset.symbol);
        if (!fullHistory || fullHistory.length === 0) throw new Error('No data');
        const returns = calculateReturns(fullHistory);
        const history5Y = filterHistoryByDate(fullHistory, subYears(now, 5));
        const riskMetrics: any = {
          '1Y': calculateRiskMetrics(filterHistoryByDate(fullHistory, subYears(now, 1)), bench1Y),
          '2Y': calculateRiskMetrics(filterHistoryByDate(fullHistory, subYears(now, 2)), bench2Y),
          '3Y': calculateRiskMetrics(filterHistoryByDate(fullHistory, subYears(now, 3)), bench3Y),
          '5Y': calculateRiskMetrics(history5Y, bench5Y),
        };
        const lastPoint = fullHistory[fullHistory.length - 1];
        return { ...asset, lastPrice: lastPoint.close, lastUpdated: lastPoint.date, returns, riskMetrics, history: history5Y };
      } catch (err) {
        return { ...asset, lastPrice: 0, lastUpdated: new Date(), returns: null, riskMetrics: {}, history: [] };
      }
    }));

    // 2. Save to Cache ONLY if we have valid results with history
    const hasValidData = results.some(r => r.history && r.history.length > 0);
    if (hasValidData) {
      await setDoc(snapshotRef, {
        date: snapshotId,
        assets: results,
        updatedAt: serverTimestamp()
      });
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
