export interface Fixture {
  rowIdx: string;
  pageNum: number;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffLocal: string;
  kickoffUTC: Date;
  predictionHome: string | null;
  predictionAway: string | null;
  result: string | null;
  status: "pending" | "scored";
}

export interface PolymarketEvent {
  id: string;
  slug: string;
  title: string;
  description?: string;
  startDate: string;
  active: boolean;
  closed: boolean;
  markets: PolymarketMarket[];
}

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  endDate: string;
  groupItemTitle?: string;
}

export interface MarketAnalysis {
  event: PolymarketEvent;
  market: PolymarketMarket;
  type: "exact_score" | "1x2" | "total_goals" | "both_teams_score";
  confidence: number;
  liquidity: number;
  outcomes: OutcomeProb[];
}

export interface OutcomeProb {
  label: string;
  probability: number;
}

export interface ScorePrediction {
  homeScore: number;
  awayScore: number;
  confidence: number;
  source: "exact_score_market" | "1x2_derived" | "poisson_derived" | "fallback" | "fallback_heuristic";
  reasoning: string;
  scoreProbability?: number;
  modelFit?: number;
  resultProbabilities?: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
}

export interface PredictionResult {
  fixture: Fixture;
  prediction: ScorePrediction | null;
  market: MarketAnalysis | null;
  status:
    | "predicted"
    | "dry_run"
    | "no_market"
    | "low_confidence"
    | "manual_review"
    | "submitted"
    | "error";
  error?: string;
}
