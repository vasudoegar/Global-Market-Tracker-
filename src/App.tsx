import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, TrendingDown, Search, ArrowUpDown, ChevronRight, 
  Download, Globe, Database, Activity, Filter, RefreshCw
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Legend, ReferenceLine 
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { AssetData } from './types';
import { cn, formatPercent, formatCurrency, formatDate } from './lib/utils';

const USD_TO_INR = 83.5; // Fixed rate for simplicity in prototype

export default function App() {
  const [data, setData] = useState<AssetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<AssetData | null>(null);
  const [currency, setCurrency] = useState<'USD' | 'INR'>('USD');
  const [sortConfig, setSortConfig] = useState<{ key: keyof AssetData | string, direction: 'asc' | 'desc' } | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'index' | 'commodity'>('all');
  const [timeframe, setTimeframe] = useState<'1Y' | '2Y' | '3Y'>('3Y');

  const chartData = useMemo(() => {
    if (!selectedAsset?.history || selectedAsset.history.length === 0) return [];
    
    const now = new Date();
    const cutoff = new Date();
    if (timeframe === '1Y') cutoff.setFullYear(now.getFullYear() - 1);
    else if (timeframe === '2Y') cutoff.setFullYear(now.getFullYear() - 2);
    else cutoff.setFullYear(now.getFullYear() - 3);
    
    const targetTime = cutoff.getTime();
    
    return selectedAsset.history
      .map(p => {
        // Robust date parsing for ISO strings, Dates, or Firestore Timestamps
        let d: Date;
        const rawDate = p.date as any;
        if (typeof rawDate === 'string') d = new Date(rawDate);
        else if (rawDate && typeof rawDate.seconds === 'number') d = new Date(rawDate.seconds * 1000);
        else d = new Date(rawDate);
        
        return {
          ...p,
          timestamp: d.getTime()
        };
      })
      .filter(p => !isNaN(p.timestamp) && p.timestamp >= targetTime)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [selectedAsset, timeframe]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/market-data');
      if (!response.ok) throw new Error('Failed to fetch data');
      const json = await response.json();
      if (Array.isArray(json) && json.length > 0) {
        setData(json);
        if (!selectedAsset) {
          setSelectedAsset(json[0]);
        }
      } else {
        throw new Error('No quantitative data available for the current sector.');
      }
    } catch (err: any) {
      setError(err.message || 'Error loading market data. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedData = useMemo(() => {
    let result = data.filter(asset => {
      const matchesSearch = asset.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          asset.symbol.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFilter = activeFilter === 'all' || asset.type === activeFilter;
      return matchesSearch && matchesFilter;
    });

    if (sortConfig) {
      result.sort((a, b) => {
        let aVal: any, bVal: any;
        
        if (sortConfig.key.includes('.')) {
          const [parent, child] = sortConfig.key.split('.');
          aVal = (a as any)[parent]?.[child];
          bVal = (b as any)[parent]?.[child];
        } else {
          aVal = (a as any)[sortConfig.key];
          bVal = (b as any)[sortConfig.key];
        }

        const aNum = aVal ?? -Infinity;
        const bNum = bVal ?? -Infinity;

        if (aNum < bNum) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aNum > bNum) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [data, searchTerm, sortConfig, activeFilter]);

  const exportToCSV = () => {
    const exportData = filteredAndSortedData.map(asset => ({
      Name: asset.name,
      Symbol: asset.symbol,
      Price: currency === 'USD' ? asset.lastPrice : asset.lastPrice * USD_TO_INR,
      Currency: currency,
      'Daily %': formatPercent(asset.returns?.daily),
      'Weekly %': formatPercent(asset.returns?.weekly),
      'Monthly %': formatPercent(asset.returns?.monthly),
      '6M %': formatPercent(asset.returns?.sixMonth),
      '1Y %': formatPercent(asset.returns?.oneYear),
      '2Y %': formatPercent(asset.returns?.twoYear),
      '3Y %': formatPercent(asset.returns?.threeYear),
      '5Y %': formatPercent(asset.returns?.fiveYear),
    }));

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `market_data_${formatDate(new Date()).replace(/\//g, '-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getReturnColor = (val: number | null) => {
    if (val === null) return 'text-zinc-500';
    return val >= 0 ? 'text-[#00C087]' : 'text-[#FF3B30]';
  };

  const currentPrice = (price: number) => {
    return currency === 'USD' ? formatCurrency(price) : formatCurrency(price * USD_TO_INR, 'INR');
  };

  if (error && data.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-[#0B0E14] text-[#E1E4E8] items-center justify-center font-mono p-10 text-center">
        <Activity className="w-8 h-8 text-[#FF3B30] mb-4 opacity-50" />
        <p className="text-sm text-[#FF3B30] uppercase mb-4">{error}</p>
        <button 
          onClick={() => fetchData()}
          className="px-6 py-2 bg-[#2D3139] border border-[#FF3B30]/30 rounded text-[10px] font-semibold uppercase hover:bg-[#FF3B30]/10 transition-colors"
        >
          Re-initialize Session
        </button>
      </div>
    );
  }

  if (loading && data.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-[#0B0E14] text-[#E1E4E8] items-center justify-center font-mono">
        <Activity className="w-8 h-8 animate-pulse text-[#3B82F6] mb-4" />
        <div className="space-y-1 text-center">
          <p className="text-xs tracking-[0.2em] opacity-50 uppercase">Syncing Terminal...</p>
          <p className="text-[9px] text-[#3B82F6] opacity-40 uppercase">Establishing secure quant link</p>
        </div>
      </div>
    );
  }

  if (!selectedAsset) return null;

  return (
    <div className="flex flex-col h-screen bg-[#0B0E14] text-[#E1E4E8] font-sans overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#2D3139] bg-[#0B0E14]">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-[#3B82F6] flex items-center justify-center rounded">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">
            GLOBAL MARKET INDICES TRACKER <span className="text-[#3B82F6] font-mono text-sm ml-2 tracking-normal">V.1.04</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex bg-[#1E222D] rounded px-2 py-1 items-center border border-[#2D3139]">
            <Search className="w-4 h-4 text-gray-400 mr-2" />
            <input 
              type="text" 
              placeholder="Search asset..." 
              className="bg-transparent border-none text-xs focus:outline-none w-48 text-white placeholder-gray-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            <button 
              onClick={exportToCSV}
              className="px-3 py-1 bg-[#2D3139] rounded text-[10px] font-semibold uppercase hover:bg-gray-700 transition-colors"
            >
              Export CSV
            </button>
            <button 
              onClick={() => setCurrency(currency === 'USD' ? 'INR' : 'USD')}
              className="px-3 py-1 bg-[#3B82F6] rounded text-[10px] font-semibold uppercase text-white hover:bg-blue-600 transition-colors"
            >
              CURRENCY: {currency}
            </button>
          </div>
        </div>
      </header>

      <nav className="flex items-center gap-6 px-6 py-2 border-b border-[#2D3139] bg-[#151921] text-[11px] font-bold uppercase tracking-wider text-gray-400">
        <span 
          className={cn("pb-1 cursor-pointer transition-colors", activeFilter === 'all' ? "text-[#3B82F6] border-b border-[#3B82F6]" : "hover:text-white")}
          onClick={() => setActiveFilter('all')}
        >
          Overview
        </span>
        <span 
          className={cn("pb-1 cursor-pointer transition-colors", activeFilter === 'index' ? "text-[#3B82F6] border-b border-[#3B82F6]" : "hover:text-white")}
          onClick={() => setActiveFilter('index')}
        >
          Indices
        </span>
        <span 
          className={cn("pb-1 cursor-pointer transition-colors", activeFilter === 'commodity' ? "text-[#3B82F6] border-b border-[#3B82F6]" : "hover:text-white")}
          onClick={() => setActiveFilter('commodity')}
        >
          Commodities
        </span>
        <div className="ml-auto flex items-center gap-4 text-[10px] font-mono">
          <span className="text-[#00C087]">● MARKET OPEN</span>
          <span className="text-gray-500 text-[9px]">NEXT SYNC: 23:30 IST</span>
        </div>
      </nav>

      <main className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto custom-scrollbar">
        {/* Top Section: Table */}
        <div className="bg-[#151921] border border-[#2D3139] rounded shadow-2xl flex-shrink-0 max-h-[50%] overflow-y-auto custom-scrollbar">
          <table className="w-full text-left text-[11px] border-collapse">
            <thead>
              <tr className="bg-[#1E222D] text-gray-400 font-mono sticky top-0 z-10">
                <th className="p-3 border-b border-[#2D3139] font-medium uppercase">Asset</th>
                <th onClick={() => handleSort('region')} className="p-3 border-b border-[#2D3139] font-medium text-left uppercase cursor-pointer hover:text-white">Market</th>
                <th onClick={() => handleSort('lastPrice')} className="p-3 border-b border-[#2D3139] font-medium text-right uppercase cursor-pointer hover:text-white">Price</th>
                <th onClick={() => handleSort('returns.daily')} className="p-3 border-b border-[#2D3139] font-medium text-right uppercase cursor-pointer hover:text-white">1D %</th>
                <th onClick={() => handleSort('returns.weekly')} className="p-3 border-b border-[#2D3139] font-medium text-right uppercase cursor-pointer hover:text-white">1W %</th>
                <th onClick={() => handleSort('returns.monthly')} className="p-3 border-b border-[#2D3139] font-medium text-right uppercase cursor-pointer hover:text-white">1M %</th>
                <th onClick={() => handleSort('returns.sixMonth')} className="p-3 border-b border-[#2D3139] font-medium text-right uppercase cursor-pointer hover:text-white">6M %</th>
                <th onClick={() => handleSort('returns.oneYear')} className="p-3 border-b border-[#2D3139] font-medium text-right uppercase cursor-pointer hover:text-white text-[#3B82F6]">1Y %</th>
                <th onClick={() => handleSort('returns.twoYear')} className="p-3 border-b border-[#2D3139] font-medium text-right uppercase cursor-pointer hover:text-white">2Y %</th>
                <th onClick={() => handleSort('returns.threeYear')} className="p-3 border-b border-[#2D3139] font-medium text-right uppercase cursor-pointer hover:text-white">3Y %</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <AnimatePresence mode="popLayout">
                {filteredAndSortedData.map((asset) => (
                  <motion.tr 
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    key={asset.symbol}
                    onClick={() => setSelectedAsset(asset)}
                    className={cn(
                      "border-b border-[#2D3139] transition-colors cursor-pointer",
                      selectedAsset?.symbol === asset.symbol ? "bg-[#1E222D]" : "hover:bg-[#1E222D]/50"
                    )}
                  >
                    <td className="p-3 font-sans font-bold flex items-center gap-2">
                      <span className={cn(
                        "text-[10px]",
                        asset.type === 'index' ? "text-blue-500" : "text-yellow-500"
                      )}>●</span> 
                      {asset.name}
                    </td>
                    <td className="p-3 text-[10px] font-mono text-gray-500 uppercase">
                      {asset.type === 'index' ? asset.region : ''}
                    </td>
                    <td className="p-3 text-right">{currentPrice(asset.lastPrice)}</td>
                    <td className={cn("p-3 text-right", getReturnColor(asset.returns?.daily))}>{formatPercent(asset.returns?.daily)}</td>
                    <td className={cn("p-3 text-right", getReturnColor(asset.returns?.weekly))}>{formatPercent(asset.returns?.weekly)}</td>
                    <td className={cn("p-3 text-right", getReturnColor(asset.returns?.monthly))}>{formatPercent(asset.returns?.monthly)}</td>
                    <td className={cn("p-3 text-right", getReturnColor(asset.returns?.sixMonth))}>{formatPercent(asset.returns?.sixMonth)}</td>
                    <td className={cn("p-3 text-right font-bold", getReturnColor(asset.returns?.oneYear))}>{formatPercent(asset.returns?.oneYear)}</td>
                    <td className={cn("p-3 text-right", getReturnColor(asset.returns?.twoYear))}>{formatPercent(asset.returns?.twoYear)}</td>
                    <td className={cn("p-3 text-right", getReturnColor(asset.returns?.threeYear))}>{formatPercent(asset.returns?.threeYear)}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Bottom Section: Chart and Risk Panels */}
        <div className="flex flex-col lg:flex-row gap-4 flex-shrink-0 mb-8">
          <div className="flex-1 bg-[#151921] border border-[#2D3139] rounded p-4 flex flex-col shadow-xl min-w-0 min-h-[450px] overflow-hidden">
            {selectedAsset ? (
              <>
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-4">
                    <h3 className="text-[10px] font-bold uppercase text-gray-500 tracking-widest flex items-center gap-2">
                      <div className="w-2 h-2 bg-[#3B82F6] rounded-full animate-pulse" />
                      HISTORICAL PERFORMANCE: {selectedAsset.name} ({
                        timeframe === '1Y' ? '12M' : 
                        timeframe === '2Y' ? '24M' : '36M'
                      })
                    </h3>
                    <div className="flex bg-[#1E222D] rounded border border-[#2D3139] p-0.5">
                      {(['1Y', '2Y', '3Y'] as const).map((tf) => (
                        <button 
                          key={tf}
                          onClick={() => setTimeframe(tf)}
                          className={cn(
                            "px-2 py-0.5 text-[9px] rounded font-mono transition-colors",
                            timeframe === tf ? "bg-[#3B82F6] text-white" : "text-gray-400 hover:text-white"
                          )}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-4 text-[10px] items-center">
                    <span className="font-mono text-[#3B82F6]">{currentPrice(selectedAsset.lastPrice)}</span>
                    <span className={cn("font-mono", getReturnColor(selectedAsset.returns?.daily))}>
                      {formatPercent(selectedAsset.returns?.daily)}
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-h-[400px] relative mt-2">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 20, right: 60, left: 20, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2D3139" vertical={false} opacity={0.3} />
                        <XAxis 
                          dataKey="date" 
                          hide
                        />
                        <YAxis 
                          domain={['dataMin - (dataMax - dataMin) * 0.2', 'dataMax + (dataMax - dataMin) * 0.2']}
                          orientation="right"
                          tick={{ fontSize: 10, fontFamily: 'monospace', fill: '#94A3B8' }}
                          axisLine={false}
                          tickLine={false}
                          width={55}
                          tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(1)}k` : val.toFixed(0)}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#1E222D', 
                            border: '1px solid #2D3139', 
                            color: '#E1E4E8', 
                            fontFamily: 'monospace', 
                            fontSize: '10px',
                            borderRadius: '4px'
                          }}
                          itemStyle={{ color: '#E1E4E8' }}
                          labelFormatter={(val) => formatDate(val)}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="close" 
                          stroke="#3B82F6" 
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, fill: '#3B82F6', stroke: '#0B0E14', strokeWidth: 2 }}
                          animationDuration={500}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center opacity-30 uppercase font-mono text-[9px] tracking-widest gap-2 bg-[#0B0E14]/30 rounded">
                      <Database className="w-4 h-4" />
                      No historical ticks found for selected range
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center opacity-30 uppercase font-mono text-[10px] tracking-widest">
                Select asset for performance visual
              </div>
            )}
          </div>

          <div className="flex-1 bg-[#151921] border border-[#2D3139] rounded p-4 flex flex-col gap-4 shadow-xl min-h-[450px] custom-scrollbar overflow-y-auto overflow-x-hidden">
            <h3 className="text-[10px] font-bold uppercase text-gray-400 tracking-widest flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-[#00C087] rounded-full" />
              Risk & Technicals ({timeframe})
            </h3>
            
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">Volatility ({timeframe} Ann. Std Dev)</span>
                  <span className="text-[#00C087] font-mono">
                    {selectedAsset.riskMetrics[timeframe]?.volatility ? `${selectedAsset.riskMetrics[timeframe]?.volatility?.toFixed(1)}%` : '--'}
                  </span>
                </div>
                <div className="h-1 w-full bg-[#1E222D] rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ 
                      width: `${Math.min((selectedAsset.riskMetrics[timeframe]?.volatility || 0) * 2, 100)}%`
                    }}
                    className="h-full bg-[#00C087]"
                  />
                </div>
              </div>
              
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">Max Drawdown ({timeframe})</span>
                  <span className="text-[#FF3B30] font-mono">
                    {selectedAsset.riskMetrics[timeframe]?.maxDrawdown ? `${selectedAsset.riskMetrics[timeframe]?.maxDrawdown?.toFixed(1)}%` : '--'}
                  </span>
                </div>
                <div className="h-1 w-full bg-[#1E222D] rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ 
                      width: `${Math.min(Math.abs(selectedAsset.riskMetrics[timeframe]?.maxDrawdown || 0) * 2, 100)}%`
                    }}
                    className="h-full bg-[#FF3B30]"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">Sharpe Ratio ({timeframe})</span>
                  <span className="text-[#3B82F6] font-mono">
                    {selectedAsset.riskMetrics[timeframe]?.sharpeRatio ? selectedAsset.riskMetrics[timeframe]?.sharpeRatio?.toFixed(2) : '--'}
                  </span>
                </div>
                <div className="h-1 w-full bg-[#1E222D] rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ 
                      width: `${Math.min((selectedAsset.riskMetrics[timeframe]?.sharpeRatio || 0) * 25, 100)}%`
                    }}
                    className="h-full bg-[#3B82F6]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="bg-[#1E222D] p-2 rounded border border-[#2D3139]">
                  <p className="text-[8px] text-gray-500 uppercase font-bold mb-1">CAGR ({timeframe})</p>
                  <p className={cn("text-xs font-mono font-bold", getReturnColor(selectedAsset.riskMetrics[timeframe]?.cagr))}>
                    {formatPercent(selectedAsset.riskMetrics[timeframe]?.cagr)}
                  </p>
                </div>
                <div className="bg-[#1E222D] p-2 rounded border border-[#2D3139]">
                  <p className="text-[8px] text-gray-500 uppercase font-bold mb-1">Sortino ({timeframe})</p>
                  <p className="text-xs font-mono font-bold text-[#00C087]">
                    {selectedAsset.riskMetrics[timeframe]?.sortinoRatio?.toFixed(2) || '--'}
                  </p>
                </div>
                <div className="bg-[#1E222D] p-2 rounded border border-[#2D3139]">
                  <p className="text-[8px] text-gray-500 uppercase font-bold mb-1">Calmar ({timeframe})</p>
                  <p className="text-xs font-mono font-bold text-[#F59E0B]">
                    {selectedAsset.riskMetrics[timeframe]?.calmarRatio?.toFixed(2) || '--'}
                  </p>
                </div>
                <div className="bg-[#1E222D] p-2 rounded border border-[#2D3139]">
                  <p className="text-[8px] text-gray-500 uppercase font-bold mb-1">Beta (vs S&P)</p>
                  <p className="text-xs font-mono font-bold text-[#8B5CF6]">
                    {selectedAsset.riskMetrics[timeframe]?.beta?.toFixed(2) || '--'}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-auto border-t border-[#2D3139] pt-3">
              <div className="bg-[#1E222D] p-3 rounded">
                <p className="text-[9px] text-gray-500 leading-tight uppercase mb-1 font-bold tracking-widest">Quant Sentinel</p>
                <p className="text-[11px] text-[#E1E4E8] italic leading-snug">
                  {selectedAsset 
                    ? `Current technical structure for ${selectedAsset.name} indicates ${selectedAsset.returns?.daily && selectedAsset.returns?.daily > 0 ? 'bullish momentum' : 'corrective pressure'}. `
                    : "Terminal awaiting target selection for quantitative analysis segment."}
                  {selectedAsset?.riskMetrics[timeframe] && (
                    <span className="opacity-70 ml-1">
                      Period CAGR at {formatPercent(selectedAsset.riskMetrics[timeframe]?.cagr)} with a Sharpe Ratio of {selectedAsset.riskMetrics[timeframe]?.sharpeRatio?.toFixed(2)}. 
                      Systematic risk (Beta) relative to S&P 500 is {selectedAsset.riskMetrics[timeframe]?.beta?.toFixed(2)}.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="flex items-center justify-between px-6 py-2 border-t border-[#2D3139] bg-[#0B0E14] text-[9px] font-mono text-gray-500 uppercase tracking-tighter">
        <div className="flex gap-4">
          <span>SYSTEM STATUS: <span className="text-[#00C087]">OPTIMAL</span></span>
          <span>LATENCY: <span className="text-blue-500">0.02ms</span></span>
          <span>LAST SYNC: {formatDate(new Date())} {new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST</span>
        </div>
        <div>© 2026 GLOBAL QUANTITATIVE TERMINAL</div>
      </footer>
    </div>
  );
}

