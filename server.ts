import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import YahooFinancePkg from 'yahoo-finance2';
import { subDays, subMonths, subYears } from 'date-fns';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Assets to track
const ASSETS = [
  { symbol: '^GSPC', name: 'S&P 500', type: 'index', region: 'USA' },
  { symbol: '^IXIC', name: 'Nasdaq 100', type: 'index', region: 'USA' },
  { symbol: '000001.SS', name: 'SSE Composite', type: 'index', region: 'China' },
  { symbol: '^HSI', name: 'Hang Seng Index', type: 'index', region: 'Hong Kong' },
  { symbol: '^FTSE', name: 'FTSE 100', type: 'index', region: 'UK' },
  { symbol: '^GDAXI', name: 'DAX', type: 'index', region: 'Germany' },
  { symbol: '^IBEX', name: 'IBEX 35', type: 'index', region: 'Spain' },
  { symbol: '^BVSP', name: 'Bovespa', type: 'index', region: 'Brazil' },
  { symbol: '^NSEI', name: 'Nifty 50', type: 'index', region: 'India' },
  { symbol: '^N225', name: 'Nikkei 225', type: 'index', region: 'Japan' },
  { symbol: '^KS11', name: 'KOSPI', type: 'index', region: 'South Korea' },
  { symbol: 'VNM', name: 'VN Index (ETF)', type: 'index', region: 'Vietnam' },
  { symbol: '^J203.JO', name: 'FTSE/JSE All Share', type: 'index', region: 'South Africa' },
  { symbol: 'EEM', name: 'MSCI Emerging Markets', type: 'index', region: 'Emerging Markets' },
  { symbol: 'URTH', name: 'MSCI World Index', type: 'index', region: 'Global' },
  { symbol: 'GC=F', name: 'Gold', type: 'commodity', region: 'Global' },
  { symbol: 'SI=F', name: 'Silver', type: 'commodity', region: 'Global' },
  { symbol: 'CL=F', name: 'Crude Oil', type: 'commodity', region: 'Global' },
];

let yahooFinance: any;
try {
  // Use the pattern that worked in the diagnostic script
  const YahooFinance: any = (YahooFinancePkg as any).default || YahooFinancePkg;
  yahooFinance = new YahooFinance({
    suppressNotices: ['ripHistorical']
  });
  if (yahooFinance.setGlobalConfig) {
    yahooFinance.setGlobalConfig({
      validation: { logErrors: false, logOptionsErrors: false }
    });
  }
} catch (e) {
  console.error('Yahoo Finance initialization failed:', e);
}

async function fetchHistoricalData(symbol: string) {
  if (!yahooFinance) {
    console.error('Yahoo Finance client not initialized');
    return [];
  }
  try {
    const end = new Date();
    const start = subYears(end, 6);
    
    // Switch to chart() as historical() is deprecated by Yahoo
    const chartResult = await yahooFinance.chart(symbol, {
      period1: start,
      period2: end,
      interval: '1d'
    }, { validateResult: false });
    
    if (chartResult && chartResult.quotes) {
      const results = chartResult.quotes
        .map((q: any) => ({
          date: q.date,
          close: q.close || q.adjclose
        }))
        .filter((point: any) => point && point.close !== null && point.close !== undefined);
        
      if (results.length === 0) {
        console.warn(`No data points after filtering for ${symbol}`);
      }
      return results;
    }
    
    console.warn(`No quotes returned in chart result for ${symbol}`);
    return [];
  } catch (error: any) {
    console.error(`Chart fetch failed for ${symbol}: ${error.message}`);
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
      if (new Date(point.date).getTime() <= targetTime) {
        closest = point;
      } else {
        break;
      }
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

function calculateRiskMetrics(history: any[]) {
  if (!history || history.length < 20) return null;

  // 1. Calculate Daily Returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].close;
    const curr = history[i].close;
    if (prev > 0) {
      dailyReturns.push((curr / prev) - 1);
    }
  }

  if (dailyReturns.length < 10) return null;

  // 2. Annualized Volatility (Std Dev of Returns * sqrt(252))
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (dailyReturns.length - 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;

  // 3. Max Drawdown
  let maxDD = 0;
  let peak = -Infinity;
  for (const point of history) {
    if (point.close > peak) {
      peak = point.close;
    }
    const dd = ((point.close / peak) - 1) * 100;
    if (dd < maxDD) {
      maxDD = dd;
    }
  }

  // 4. Sharpe Ratio (Approx: Annualized Return - RF) / Annualized Volatility
  const lastPrice = history[history.length - 1].close;
  const firstPrice = history[0].close;
  const years = (new Date(history[history.length-1].date).getTime() - new Date(history[0].date).getTime()) / (1000 * 60 * 60 * 24 * 365);
  const annualizedReturn = (Math.pow(lastPrice / firstPrice, 1 / years) - 1) * 100;
  
  const riskFreeRate = 2.0; // 2% prototype RF
  const sharpeRatio = volatility > 0 ? (annualizedReturn - riskFreeRate) / volatility : 0;

  return {
    volatility,
    maxDrawdown: maxDD,
    sharpeRatio
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // 1. OPEN PORT IMMEDIATELY
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`>>> SERVER LISTENING ON PORT ${PORT}`);
  });

  app.use(express.json());

  // 2. STABLE API ROUTES
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  function filterHistoryByDate(history: any[], pastDate: Date) {
  const targetTime = pastDate.getTime();
  return history.filter(point => new Date(point.date).getTime() >= targetTime);
}

app.get('/api/market-data', async (req, res) => {
  try {
    const now = new Date();
    const results = await Promise.all(ASSETS.map(async (asset) => {
      const fullHistory = await fetchHistoricalData(asset.symbol);
      const returns = calculateReturns(fullHistory);
      
      const history5Y = filterHistoryByDate(fullHistory, subYears(now, 5));
      const history3Y = filterHistoryByDate(fullHistory, subYears(now, 3));
      const history2Y = filterHistoryByDate(fullHistory, subYears(now, 2));
      const history1Y = filterHistoryByDate(fullHistory, subYears(now, 1));

      const riskMetrics: any = {
        '1Y': calculateRiskMetrics(history1Y),
        '2Y': calculateRiskMetrics(history2Y),
        '3Y': calculateRiskMetrics(history3Y),
        '5Y': calculateRiskMetrics(history5Y),
      };

      const lastPoint = fullHistory[fullHistory.length - 1];
      
      return {
        ...asset,
        lastPrice: lastPoint ? lastPoint.close : 0,
        lastUpdated: lastPoint ? lastPoint.date : new Date(),
        returns,
        riskMetrics,
        history: history5Y // Send 5Y historical context to client
      };
    }));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

  // 3. VITE INTEGRATION
  try {
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
    }
  } catch (viteError) {
    console.error('Vite initialization error:', viteError);
  }
}

startServer().catch(err => {
    console.error('CRITICAL SERVER ERROR:', err);
});
