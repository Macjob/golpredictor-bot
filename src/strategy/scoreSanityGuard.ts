import { logger } from "../logger.js";
import type { ScorePrediction } from "../types.js";

interface SanityGuardContext {
  hasGoalSignals: boolean;
  hasBothTeamsScoreSignal: boolean;
  hasExactScoreMarket: boolean;
}

export function applyScoreSanityGuard(
  prediction: ScorePrediction,
  context: SanityGuardContext
): ScorePrediction {
  if (prediction.source === "exact_score_market") {
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

  if (!context.hasGoalSignals && !context.hasBothTeamsScoreSignal) {
    if (totalGoals > 4) {
      if (homeWins) {
        newHome = Math.min(homeScore, 3);
        newAway = Math.min(awayScore, 1);
        if (newHome + newAway > 4) {
          newHome = 2;
          newAway = 1;
        }
      } else if (awayWins) {
        newHome = Math.min(homeScore, 1);
        newAway = Math.min(awayScore, 3);
        if (newHome + newAway > 4) {
          newHome = 1;
          newAway = 2;
        }
      } else {
        newHome = 2;
        newAway = 2;
      }
      reason = `total goles ${totalGoals} alto sin señales de over/bts; limitado a ${newHome}-${newAway}`;
    } else if (margin >= 3) {
      if (homeWins) {
        newHome = Math.max(2, homeScore - 1);
        newAway = 0;
      } else {
        newAway = Math.max(2, awayScore - 1);
        newHome = 0;
      }
      reason = `margen ${margin} alto sin señales de goles; reducido a ${newHome}-${newAway}`;
    } else if (totalGoals === 5 && (homeWins || awayWins)) {
      if (homeWins) {
        newHome = 2;
        newAway = 1;
      } else {
        newHome = 1;
        newAway = 2;
      }
      reason = `5 goles sin señales; reducido a ${newHome}-${newAway}`;
    } else if ((homeScore === 2 && awayScore === 3) || (homeScore === 3 && awayScore === 2)) {
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

  return {
    ...prediction,
    homeScore: newHome,
    awayScore: newAway,
    confidence: Math.max(0.15, prediction.confidence * 0.9),
    reasoning: `${prediction.reasoning}. Sanity guard: ${reason}`,
  };
}
