import { logger } from "../logger.js";
import type { ScorePrediction } from "../types.js";

const MAX_GOALS = 6;
const LAMBDA_MIN = 0.2;
const LAMBDA_MAX = 4.0;
const LAMBDA_STEP = 0.1;

export interface MarketSignals {
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  over25Probability?: number;
  under25Probability?: number;
  bothTeamsScoreYesProbability?: number;
  bothTeamsScoreNoProbability?: number;
}

interface LambdaResult {
  homeLambda: number;
  awayLambda: number;
  error: number;
  predictedHomeWin: number;
  predictedDraw: number;
  predictedAwayWin: number;
  predictedOver25: number;
  predictedBts: number;
  bestScoreHome: number;
  bestScoreAway: number;
  bestScoreProb: number;
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonProb(k: number, lambda: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function buildScoreMatrix(
  homeLambda: number,
  awayLambda: number
): number[][] {
  const matrix: number[][] = [];
  for (let h = 0; h <= MAX_GOALS; h++) {
    matrix[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      matrix[h][a] = poissonProb(h, homeLambda) * poissonProb(a, awayLambda);
    }
  }
  return matrix;
}

function deriveProbsFromMatrix(matrix: number[][]): {
  homeWin: number;
  draw: number;
  awayWin: number;
  over25: number;
  bts: number;
} {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over25 = 0;
  let bts = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const prob = matrix[h][a];
      if (h > a) homeWin += prob;
      else if (h === a) draw += prob;
      else awayWin += prob;

      if (h + a > 2.5) over25 += prob;
      if (h >= 1 && a >= 1) bts += prob;
    }
  }

  return { homeWin, draw, awayWin, over25, bts };
}

function findBestScore(matrix: number[][]): {
  h: number;
  a: number;
  prob: number;
} {
  let bestH = 0;
  let bestA = 0;
  let bestProb = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      if (matrix[h][a] > bestProb) {
        bestProb = matrix[h][a];
        bestH = h;
        bestA = a;
      }
    }
  }

  return { h: bestH, a: bestA, prob: bestProb };
}

export function deriveMostLikelyScore(
  signals: MarketSignals
): ScorePrediction {
  const {
    homeWinProbability: mHome,
    drawProbability: mDraw,
    awayWinProbability: mAway,
    over25Probability: rawOver25,
    under25Probability: rawUnder25,
    bothTeamsScoreYesProbability: mBts,
  } = signals;

  const mOver25 = rawOver25 ?? (
    rawUnder25 !== undefined ? 1 - rawUnder25 : undefined
  );
  const hasOver25 = mOver25 !== undefined && mOver25 > 0;
  const hasBts = mBts !== undefined && mBts > 0;

  const signalsUsed: string[] = ["1X2"];
  if (hasOver25) signalsUsed.push("Over/Under 2.5");
  if (hasBts) signalsUsed.push("Both Teams Score");

  let bestResult: LambdaResult | null = null;
  let bestError = Infinity;

  for (let hl = LAMBDA_MIN; hl <= LAMBDA_MAX; hl += LAMBDA_STEP) {
    for (let al = LAMBDA_MIN; al <= LAMBDA_MAX; al += LAMBDA_STEP) {
      const matrix = buildScoreMatrix(hl, al);
      const probs = deriveProbsFromMatrix(matrix);

      let error = 0;
      error += Math.abs(probs.homeWin - mHome);
      error += Math.abs(probs.draw - mDraw);
      error += Math.abs(probs.awayWin - mAway);

      if (hasOver25) {
        error += 2 * Math.abs(probs.over25 - mOver25!);
      }
      if (hasBts) {
        error += 2 * Math.abs(probs.bts - mBts!);
      }

      if (error < bestError) {
        bestError = error;
        const best = findBestScore(matrix);
        bestResult = {
          homeLambda: hl,
          awayLambda: al,
          error,
          predictedHomeWin: probs.homeWin,
          predictedDraw: probs.draw,
          predictedAwayWin: probs.awayWin,
          predictedOver25: probs.over25,
          predictedBts: probs.bts,
          bestScoreHome: best.h,
          bestScoreAway: best.a,
          bestScoreProb: best.prob,
        };
      }
    }
  }

  if (!bestResult) {
    return heuristicFallback(signals);
  }

  const confidence = Math.max(0.15, 1 - bestResult.error);

  logger.info(
    `poisson_model_used=true | home_lambda=${bestResult.homeLambda.toFixed(2)} | away_lambda=${bestResult.awayLambda.toFixed(2)} | selected_score=${bestResult.bestScoreHome}-${bestResult.bestScoreAway} | selected_score_probability=${(bestResult.bestScoreProb * 100).toFixed(1)}% | market_signals_used=[${signalsUsed.join(", ")}] | error=${bestResult.error.toFixed(4)}`
  );

  return {
    homeScore: bestResult.bestScoreHome,
    awayScore: bestResult.bestScoreAway,
    confidence,
    source: "poisson_derived",
    reasoning: `Modelo Poisson: λ_home=${bestResult.homeLambda.toFixed(2)}, λ_away=${bestResult.awayLambda.toFixed(2)} → ${bestResult.bestScoreHome}-${bestResult.bestScoreAway} (${(bestResult.bestScoreProb * 100).toFixed(1)}%). Señales: ${signalsUsed.join(", ")}. Predicciones Poisson: homeWin=${(bestResult.predictedHomeWin * 100).toFixed(1)}% draw=${(bestResult.predictedDraw * 100).toFixed(1)}% awayWin=${(bestResult.predictedAwayWin * 100).toFixed(1)}% over25=${(bestResult.predictedOver25 * 100).toFixed(1)}% bts=${(bestResult.predictedBts * 100).toFixed(1)}%`,
  };
}

export function heuristicFallback(signals: MarketSignals): ScorePrediction {
  const { homeWinProbability: hw, drawProbability: d, awayWinProbability: aw } = signals;

  logger.info(
    `poisson_model_used=false | heuristic_fallback | homeWin=${hw.toFixed(2)} draw=${d.toFixed(2)} awayWin=${aw.toFixed(2)}`
  );

  if (hw > 0.75) {
    return makePrediction(3, 0, hw, "fallback_heuristic", "Local dominante (>75%)");
  }
  if (hw > 0.62) {
    return makePrediction(2, 0, hw, "fallback_heuristic", "Local fuerte (62-75%)");
  }
  if (hw > 0.48) {
    return makePrediction(2, 1, hw, "fallback_heuristic", "Local moderado (48-62%)");
  }
  if (d > 0.35) {
    return makePrediction(1, 1, d, "fallback_heuristic", "Empate probable (>35%)");
  }
  if (aw > 0.75) {
    return makePrediction(0, 3, aw, "fallback_heuristic", "Visitante dominante (>75%)");
  }
  if (aw > 0.62) {
    return makePrediction(0, 2, aw, "fallback_heuristic", "Visitante fuerte (62-75%)");
  }
  if (aw > 0.48) {
    return makePrediction(1, 2, aw, "fallback_heuristic", "Visitante moderado (48-62%)");
  }

  return makePrediction(1, 1, 0.3, "fallback_heuristic", "Partido parejo, predicción por defecto");
}

function makePrediction(
  home: number,
  away: number,
  confidence: number,
  source: ScorePrediction["source"],
  reasoning: string
): ScorePrediction {
  logger.info(`Marcador sugerido: ${home}-${away} (${(confidence * 100).toFixed(1)}%)`);
  return {
    homeScore: home,
    awayScore: away,
    confidence,
    source,
    reasoning,
  };
}
