import { logger } from "../logger.js";
import type { ScorePrediction } from "../types.js";

interface SanityGuardContext {
  hasGoalSignals: boolean;
  hasBothTeamsScoreSignal: boolean;
  hasExactScoreMarket: boolean;
  under25Probability?: number;
  drawProbability?: number;
}

export function applyScoreSanityGuard(
  prediction: ScorePrediction,
  context: SanityGuardContext
): ScorePrediction {
  if (prediction.source === "exact_score_market" || prediction.source === "manual_override") {
    return prediction;
  }

  const { homeScore, awayScore } = prediction;
  const totalGoals = homeScore + awayScore;
  const margin = Math.abs(homeScore - awayScore);
  const homeWins = homeScore > awayScore;
  const awayWins = awayScore > homeScore;
  const isDraw = homeScore === awayScore;

  let newHome = homeScore;
  let newAway = awayScore;
  let reason: string | null = null;

  if (homeScore === 0 && awayScore === 0) {
    const under25 = context.under25Probability ?? 0;
    const draw = context.drawProbability ?? 0;
    const strongUnder25 = under25 > 0.55;
    const strongDraw = draw > 0.40;

    if (!strongUnder25 || !strongDraw) {
      const hw = prediction.resultProbabilities?.homeWin ?? 0.33;
      const aw = prediction.resultProbabilities?.awayWin ?? 0.33;
      const diff = Math.abs(hw - aw);

      if (diff > 0.15 && hw > aw) {
        newHome = 1;
        newAway = 0;
        reason = `0-0 sin señal under25 fuerte (${(under25 * 100).toFixed(0)}%) y local con ventaja; ajustado a 1-0`;
      } else if (diff > 0.15 && aw > hw) {
        newHome = 0;
        newAway = 1;
        reason = `0-0 sin señal under25 fuerte (${(under25 * 100).toFixed(0)}%) y visitante con ventaja; ajustado a 0-1`;
      } else {
        newHome = 1;
        newAway = 1;
        reason = `0-0 sin señales under25/draw fuertes; ajustado a 1-1`;
      }
    }
  }

  if (!reason && !context.hasGoalSignals && !context.hasBothTeamsScoreSignal) {
    if ((homeScore === 2 && awayScore === 3) || (homeScore === 3 && awayScore === 2)) {
      if (homeWins) {
        newHome = 2;
        newAway = 1;
      } else {
        newHome = 1;
        newAway = 2;
      }
      reason = `3-2/2-3 sin señales de over; ajustado a ${newHome}-${newAway}`;
    } else if ((homeScore === 0 && awayScore === 3) || (homeScore === 3 && awayScore === 0)) {
      if (homeWins) {
        newHome = 2;
        newAway = 0;
      } else {
        newHome = 0;
        newAway = 2;
      }
      reason = `3-0/0-3 sin señales; reducido a ${newHome}-${newAway}`;
    } else if (totalGoals > 4) {
      if (homeWins) {
        newHome = 2;
        newAway = 1;
      } else if (awayWins) {
        newHome = 1;
        newAway = 2;
      } else {
        newHome = 1;
        newAway = 1;
      }
      reason = `total goles ${totalGoals} alto sin señales de over/bts; limitado a ${newHome}-${newAway}`;
    } else if (margin >= 3) {
      if (homeWins) {
        newHome = 2;
        newAway = 0;
      } else {
        newAway = 2;
        newHome = 0;
      }
      reason = `margen ${margin} alto sin señales de goles; reducido a ${newHome}-${newAway}`;
    }
  }

  if (!reason && !context.hasGoalSignals && !isDraw && margin <= 1) {
    const diff = Math.abs(
      (prediction.resultProbabilities?.homeWin ?? 0.33) -
      (prediction.resultProbabilities?.awayWin ?? 0.33)
    );
    if (diff < 0.15) {
      newHome = 1;
      newAway = 1;
      reason = `partido parejo (diff=${diff.toFixed(2)}) sin señales de goles; ajustado a 1-1`;
    }
  }

  if (!reason) {
    logger.info(
      `score_sanity_guard_used=false | score=${homeScore}-${awayScore} | sin ajuste necesario`
    );
    return prediction;
  }

  logger.info(
    `score_sanity_guard_used=true | original_score=${homeScore}-${awayScore} | adjusted_score=${newHome}-${newAway} | reason=${reason}`
  );

  const adjustedConfidence = Math.max(0, prediction.confidence * 0.9);

  return {
    ...prediction,
    homeScore: newHome,
    awayScore: newAway,
    confidence: adjustedConfidence,
    scoreProbability: prediction.scoreProbability !== undefined
      ? Math.max(0, prediction.scoreProbability * 0.9)
      : prediction.scoreProbability,
    reasoning: `${prediction.reasoning}. Sanity guard: ${reason}`,
  };
}
