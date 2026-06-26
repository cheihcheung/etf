export interface ETFBasic {
  id: number
  code: string
  name: string
  asset_type: string
  current_price: number
  change_pct: number
  update_time: string
}

export interface ETFHistory {
  tradeDate: string
  openPrice: number
  closePrice: number
  highPrice: number
  lowPrice: number
  volume: number
  amount: number
  changePct: number
}

export interface ETFQuote {
  code: string
  name: string
  currentPrice: number
  changePct: number
  openPrice: number
  highPrice: number
  lowPrice: number
  volume: number
  amount: number
}

export interface InitialRatio {
  id?: number
  etfCode: string
  etfName?: string
  assetType?: string
  ratio: number
}

export interface StrategyLevel {
  id?: number
  levelOrder: number
  threshold: number
  ratios: StrategyRatio[]
}

export interface StrategyRatio {
  etfCode: string
  targetRatio: number
}

export interface StrategyAConfig {
  enabled: boolean
  resetOnHigh: boolean
  drawdownLevels: StrategyLevel[]
  rallyLevels: StrategyLevel[]
  currentLevel?: { drawdown: number; rally: number }
}

export interface StrategyBConfig {
  enabled: boolean
  centralAnnual: number
  overvaluedLevels: StrategyLevel[]
  undervaluedLevels: StrategyLevel[]
  currentLevel?: number
}

export interface RebalanceConfig {
  threshold: number
  autoRebalance: boolean
  frequency: string
  feeRate: number
  feeExemptFive: boolean
}

export interface BacktestParams {
	startDate: string
	endDate: string
	initialCapital: number
	feeRate: number
	feeExemptFive: boolean
	etfs: { code: string; name: string }[]
	initialRatios: Record<string, number>
	strategyAConfig?: any
	strategyBConfig?: any
	rebalanceConfig?: any
	rebalanceThreshold: number
	tradeFrequency: string
	strategyPriority: string
	centralAnnual: number
	resetOnHigh: boolean
}

export interface BacktestResult {
  totalReturn: number
  annualReturn: number
  maxDrawdown: number
  annualVolatility: number
  sharpeRatio: number
  finalValue: number
  totalTrades: number
  benchmarkMetrics?: {
    name?: string
    totalReturn: number
    annualReturn: number
    maxDrawdown: number
    annualVolatility: number
    sharpeRatio: number
  }
  etfMetrics?: Record<string, {
    name: string
    totalReturn: number
    annualReturn: number
    maxDrawdown: number
    annualVolatility: number
    sharpeRatio: number
  }>
  tradeRecords: any[]
  dailyValues: { 
    date: string; 
    totalValue: number; 
    cash: number; 
    marketValue: number;
    benchmarkValue?: number;
    drawdown?: number;
    assetRatios?: Record<string, number>;
    etfPerformances?: Record<string, number>;
  }[]
  yearlyStats?: {
    year: string;
    strategyReturn: number;
    benchmarkReturn: number;
  }[]
}

export interface OptimizationParams {
  baseParams: BacktestParams
  optimizationRanges: Record<string, number[]>
}

export interface PortfolioHolding {
  etf_code: string
  name: string
  asset_type: string
  shares: number
  cost_price: number
  market_value: number
  ratio: number
  target_ratio: number
  current_price: number
  change_pct: number
}

export interface TradeRecord {
  id: number
  trade_time: string
  trade_type: string
  etf_code: string
  trade_direction: string
  shares: number
  price: number
  amount: number
  fee: number
  before_ratio: number
  after_ratio: number
  reason: string
}
