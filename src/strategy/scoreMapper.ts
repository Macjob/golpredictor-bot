import { logger } from "../logger.js";
import type { MarketAnalysis, PolymarketMarket, ScorePrediction } from "../types.js";
import { deriveMostLikelyScore, type MarketSignals } from "./poissonScoreModel.js";

interface ExactScoreCandidate {
  homeGoals: number;
  awayGoals: number;
  probability: number;
  marketId: string;
  question: string;
  volume: number;
}

const EXCLUDED_TERMS = [
  "advance", "qualify", "penalties", "penalty",
  "extra time", "winner", "champion", "lift trophy",
  "to lift", "golden boot", "top scorer",
];

const SCORE_TERMS = [
  "exact score", "correct score", "scoreline",
  "final score", "exact result",
];

export interface ExactScoreResult extends ScorePrediction {
  marketId: string;
}

export function findBestExactScorePrediction(
  markets: MarketAnalysis[],
  homeTeam: string,
  awayTeam: string
): ExactScoreResult | null {
  const candidates: ExactScoreCandidate[] = [];

  for (const analysis of markets) {
    const market = analysis.market;
    const question = market.question.toLowerCase();

    if (EXCLUDED_TERMS.some((t) => question.includes(t))) continue;

    const isExactScore = SCORE_TERMS.some((t) => question.includes(t));
    const hasScoreOutcomes = analysis.outcomes.some((o) =>
      /^\d+\s*-\s*\d+$/.test(o.label)
    );

    if (!isExactScore && !hasScoreOutcomes) continue;

    const parsed = parseExactScoreMarket(market, analysis);
    candidates.push(...parsed);
  }

  if (candidates.length === 0) {
    logger.info("exact_score_found=false | No se encontraron mercados de marcador exacto");
    return null;
  }

  candidates.sort((a, b) => b.probability - a.probability);

  const best = candidates[0];

  const totalProb = candidates.reduce((s, c) => s + c.probability, 0);

  logger.info(
    `exact_score_found=true | selected_score=${best.homeGoals}-${best.awayGoals} | probability=${(best.probability * 100).toFixed(1)}% | market="${best.question}" | total_candidates=${candidates.length} | combined_prob=${(totalProb * 100).toFixed(1)}%`
  );

  return {
    homeScore: best.homeGoals,
    awayScore: best.awayGoals,
    confidence: best.probability,
    source: "exact_score_market",
    marketId: best.marketId,
    reasoning: `Marcador exacto de Polymarket: ${best.homeGoals}-${best.awayGoals} con ${(best.probability * 100).toFixed(1)}% (${best.question})`,
  };
}

export function deriveScoreFromMarketSignals(
  markets: MarketAnalysis[],
  homeTeam: string,
  awayTeam: string
): ScorePrediction {
  const signals = extractMarketSignals(markets, homeTeam, awayTeam);

  if (hasComplete1X2Signals(signals)) {
    return deriveMostLikelyScore(signals);
  }

  logger.info(
    "poisson_model_used=false | señales 1X2 incompletas; usando fallback heurístico seguro"
  );
  return deriveHeuristicScoreFromSignals(signals);
}

function normalizeText(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const teamMap: Record<string, string> = {
    "curazao": "curacao",
    "costa de marfil": "ivory coast",
    "cote divoire": "ivory coast",
    "paises bajos": "netherlands",
    "estados unidos": "usa",
    "alemania": "germany",
    "japon": "japan",
    "suecia": "sweden",
    "tunez": "tunisia",
    "turquia": "turkey",
    "brasil": "brazil",
    "argentina": "argentina",
    "espana": "spain",
    "francia": "france",
    "inglaterra": "england",
    "portugal": "portugal",
    "colombia": "colombia",
    "mexico": "mexico",
    "uruguay": "uruguay",
    "ecuador": "ecuador",
    "senegal": "senegal",
    "irak": "iraq",
    "iran": "iran",
    "croacia": "croatia",
    "ghana": "ghana",
    "australia": "australia",
    "paraguay": "paraguay",
    "noruega": "norway",
    "belgica": "belgium",
    "nueva zelanda": "new zealand",
    "panama": "panama",
    "egipto": "egypt",
    "argelia": "algeria",
    "austria": "austria",
    "jordania": "jordan",
    "arabia saudita": "saudi arabia",
    "cabo verde": "cape verde",
    "rd congo": "dr congo",
    "uzbekistan": "uzbekistan",
  };

  return teamMap[normalized] || normalized;
}

function getOutcomeProbability(analysis: MarketAnalysis, label: string): number {
  return analysis.outcomes.find(
    (o) => o.label.toLowerCase() === label.toLowerCase()
  )?.probability || 0;
}

function questionTargetsTeam(
  analysis: MarketAnalysis,
  homeTeam: string,
  awayTeam: string
): "home" | "away" | null {
  const questionTeam = normalizeText(analysis.market.groupItemTitle || "");
  const question = normalizeText(analysis.market.question);
  const home = normalizeText(homeTeam);
  const away = normalizeText(awayTeam);

  if (questionTeam) {
    if (home.includes(questionTeam) || questionTeam.includes(home)) return "home";
    if (away.includes(questionTeam) || questionTeam.includes(away)) return "away";
  }

  if (question.includes(home)) return "home";
  if (question.includes(away)) return "away";

  return null;
}

function extractMarketSignals(
  markets: MarketAnalysis[],
  homeTeam: string,
  awayTeam: string
): MarketSignals {
  const signals: MarketSignals = {
    homeWinProbability: 0,
    drawProbability: 0,
    awayWinProbability: 0,
  };

  for (const analysis of markets) {
    const question = analysis.market.question.toLowerCase();

    if (question.includes("win") || question.includes("gana")) {
      const yesProb = getOutcomeProbability(analysis, "yes");
      const target = questionTargetsTeam(analysis, homeTeam, awayTeam);

      if (target === "home" && yesProb > signals.homeWinProbability) {
        signals.homeWinProbability = yesProb;
      }
      if (target === "away" && yesProb > signals.awayWinProbability) {
        signals.awayWinProbability = yesProb;
      }

      if (!target) {
        logger.debug(
          `Mercado win sin equipo objetivo claro; no se usa NO como victoria rival: ${analysis.market.question}`
        );
      }
    }

    if (question.includes("draw") || question.includes("empate")) {
      const yesProb = getOutcomeProbability(analysis, "yes");
      if (yesProb > signals.drawProbability) signals.drawProbability = yesProb;
    }

    if (question.includes("over") && question.includes("2.5")) {
      const yesProb = getOutcomeProbability(analysis, "yes");
      const noProb = getOutcomeProbability(analysis, "no");
      if (yesProb > 0) signals.over25Probability = yesProb;
      if (noProb > 0) signals.under25Probability = noProb;
    }

    if (question.includes("under") && question.includes("2.5")) {
      const yesProb = getOutcomeProbability(analysis, "yes");
      const noProb = getOutcomeProbability(analysis, "no");
      if (yesProb > 0) signals.under25Probability = yesProb;
      if (noProb > 0) signals.over25Probability = noProb;
    }

    if (question.includes("both teams") && question.includes("score")) {
      const yesProb = getOutcomeProbability(analysis, "yes");
      const noProb = getOutcomeProbability(analysis, "no");
      if (yesProb > 0) signals.bothTeamsScoreYesProbability = yesProb;
      if (noProb > 0) signals.bothTeamsScoreNoProbability = noProb;
    }
  }

  if (hasComplete1X2Signals(signals)) {
    const total = signals.homeWinProbability + signals.drawProbability + signals.awayWinProbability;
    signals.homeWinProbability /= total;
    signals.drawProbability /= total;
    signals.awayWinProbability /= total;
  }

  logger.info(
    `Señales extraídas: homeWin=${signals.homeWinProbability.toFixed(2)} draw=${signals.drawProbability.toFixed(2)} awayWin=${signals.awayWinProbability.toFixed(2)} over25=${signals.over25Probability?.toFixed(2) || "N/A"} under25=${signals.under25Probability?.toFixed(2) || "N/A"} bts=${signals.bothTeamsScoreYesProbability?.toFixed(2) || "N/A"}`
  );

  return signals;
}

function hasComplete1X2Signals(signals: MarketSignals): boolean {
  return (
    signals.homeWinProbability > 0 &&
    signals.drawProbability > 0 &&
    signals.awayWinProbability > 0
  );
}

function deriveHeuristicScoreFromSignals(signals: MarketSignals): ScorePrediction {
  const hw = signals.homeWinProbability;
  const d = signals.drawProbability;
  const aw = signals.awayWinProbability;
  const over25 = signals.over25Probability ?? (
    signals.under25Probability !== undefined ? 1 - signals.under25Probability : 0
  );
  const under25 = signals.under25Probability ?? (
    signals.over25Probability !== undefined ? 1 - signals.over25Probability : 0
  );
  const btsYes = signals.bothTeamsScoreYesProbability ?? 0;

  logger.info(
    `smart_fallback_used=true | homeWin=${hw.toFixed(2)} draw=${d.toFixed(2)} awayWin=${aw.toFixed(2)} over25=${over25.toFixed(2)} under25=${under25.toFixed(2)} bts=${btsYes.toFixed(2)}`
  );

  if (hw >= d && hw >= aw && hw > 0) {
    if (hw > 0.72) {
      if (over25 > 0.55 && btsYes > 0.45) return makePrediction(3, 1, hw, "fallback_heuristic", "Local favorito fuerte; partido abierto y ambos anotan");
      if (over25 > 0.55) return makePrediction(3, 0, hw, "fallback_heuristic", "Local favorito fuerte; over 2.5 alto");
      if (btsYes > 0.45) return makePrediction(2, 1, hw, "fallback_heuristic", "Local favorito fuerte; ambos pueden anotar");
      return makePrediction(2, 0, hw, "fallback_heuristic", "Local favorito fuerte con señales limitadas");
    }
    if (hw > 0.5) {
      if (btsYes > 0.45) return makePrediction(2, 1, hw, "fallback_heuristic", "Local favorito moderado; ambos pueden anotar");
      if (under25 > 0.55) return makePrediction(1, 0, hw, "fallback_heuristic", "Local favorito moderado; under 2.5 alto");
      return makePrediction(2, 0, hw, "fallback_heuristic", "Local favorito moderado con señales limitadas");
    }
    return makePrediction(1, 0, hw, "fallback_heuristic", "Local con ventaja leve en mercado incompleto");
  }

  if (aw >= d && aw >= hw && aw > 0) {
    if (aw > 0.72) {
      if (over25 > 0.55 && btsYes > 0.45) return makePrediction(1, 3, aw, "fallback_heuristic", "Visitante favorito fuerte; partido abierto y ambos anotan");
      if (over25 > 0.55) return makePrediction(0, 3, aw, "fallback_heuristic", "Visitante favorito fuerte; over 2.5 alto");
      if (btsYes > 0.45) return makePrediction(1, 2, aw, "fallback_heuristic", "Visitante favorito fuerte; ambos pueden anotar");
      return makePrediction(0, 2, aw, "fallback_heuristic", "Visitante favorito fuerte con señales limitadas");
    }
    if (aw > 0.5) {
      if (btsYes > 0.45) return makePrediction(1, 2, aw, "fallback_heuristic", "Visitante favorito moderado; ambos pueden anotar");
      if (under25 > 0.55) return makePrediction(0, 1, aw, "fallback_heuristic", "Visitante favorito moderado; under 2.5 alto");
      return makePrediction(0, 2, aw, "fallback_heuristic", "Visitante favorito moderado con señales limitadas");
    }
    return makePrediction(0, 1, aw, "fallback_heuristic", "Visitante con ventaja leve en mercado incompleto");
  }

  if (d > 0) {
    if (under25 > 0.55) return makePrediction(0, 0, d, "fallback_heuristic", "Empate con under 2.5 alto");
    return makePrediction(1, 1, d, "fallback_heuristic", "Empate como señal principal");
  }

  return makePrediction(1, 1, 0.3, "fallback_heuristic", "Sin señales 1X2 suficientes, usando 1-1 por defecto");
}

function parseExactScoreMarket(
  market: PolymarketMarket,
  analysis: MarketAnalysis
): ExactScoreCandidate[] {
  const candidates: ExactScoreCandidate[] = [];

  try {
    const outcomes: string[] = JSON.parse(market.outcomes);
    const prices: number[] = JSON.parse(market.outcomePrices);
    const volume = parseFloat(market.volume || "0");

    if (outcomes.length !== prices.length) return candidates;

    const hasScoreFormat = outcomes.some((o) => /^\d+\s*-\s*\d+$/.test(o));

    if (hasScoreFormat) {
      for (let i = 0; i < outcomes.length; i++) {
        const label = outcomes[i];
        const match = label.match(/^(\d+)\s*-\s*(\d+)$/);
        if (!match) continue;

        const prob = prices[i] || 0;
        if (prob <= 0) continue;

        candidates.push({
          homeGoals: parseInt(match[1]),
          awayGoals: parseInt(match[2]),
          probability: prob,
          marketId: market.id,
          question: market.question,
          volume,
        });
      }
    } else {
      const scoreMatch = market.question.match(
        /(\d+)\s*-\s*(\d+)/
      );
      if (scoreMatch) {
        const yesIdx = outcomes.findIndex(
          (o) => o.toLowerCase() === "yes"
        );
        if (yesIdx >= 0) {
          const prob = prices[yesIdx] || 0;
          if (prob > 0) {
            candidates.push({
              homeGoals: parseInt(scoreMatch[1]),
              awayGoals: parseInt(scoreMatch[2]),
              probability: prob,
              marketId: market.id,
              question: market.question,
              volume,
            });
          }
        }
      }
    }
  } catch (e) {
    logger.debug(`Error parseando mercado exact score ${market.id}: ${e}`);
  }

  return candidates;
}

export function mapToExactScore(market: MarketAnalysis): ScorePrediction {
  if (market.type === "exact_score") {
    return mapExactScore(market);
  }

  return map1X2ToScore(market);
}

function mapExactScore(market: MarketAnalysis): ScorePrediction {
  const scoreOutcomes = market.outcomes
    .filter((o) => /^\d+\s*-\s*\d+$/.test(o.label))
    .sort((a, b) => b.probability - a.probability);

  if (scoreOutcomes.length === 0) {
    logger.warn("Mercado exact_score sin outcomes de marcador válido");
    return map1X2ToScore(market);
  }

  const best = scoreOutcomes[0];
  const [home, away] = best.label.split(/\s*-\s*/).map(Number);

  logger.info(
    `Marcador exacto: ${home}-${away} (${(best.probability * 100).toFixed(1)}%)`
  );

  return {
    homeScore: home,
    awayScore: away,
    confidence: best.probability,
    source: "exact_score_market",
    reasoning: `Mercado de marcador exacto: ${best.label} con ${(best.probability * 100).toFixed(1)}% probabilidad`,
  };
}

function map1X2ToScore(market: MarketAnalysis): ScorePrediction {
  const question = market.market.question.toLowerCase();
  const yesProb = getOutcomeProbability(market, "yes");
  const drawProb = getOutcomeProbability(market, "draw") || getOutcomeProbability(market, "empate");

  logger.info(
    `Fallback legacy 1X2: question="${market.market.question}" yes=${yesProb.toFixed(2)} draw=${drawProb.toFixed(2)}`
  );

  if (question.includes("draw") || question.includes("empate") || drawProb > 0) {
    return makePrediction(1, 1, Math.max(yesProb, drawProb, 0.3), "1x2_derived",
      "Empate como resultado más probable"
    );
  }

  if (yesProb > 0.65) {
    return makePrediction(2, 0, yesProb, "1x2_derived",
      "Equipo objetivo con alta probabilidad de victoria (>65%)"
    );
  }
  if (yesProb > 0.45) {
    return makePrediction(2, 1, yesProb, "1x2_derived",
      "Equipo objetivo con probabilidad media de victoria (45-65%)"
    );
  }

  return makePrediction(1, 1, 0.3, "fallback",
    "Sin tendencia clara, usando 1-1 como predicción por defecto"
  );
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
