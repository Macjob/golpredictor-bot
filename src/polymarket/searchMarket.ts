import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import type {
  PolymarketEvent,
  PolymarketMarket,
  MarketAnalysis,
  OutcomeProb,
} from "../types.js";

export async function searchMarkets(
  homeTeam: string,
  awayTeam: string,
  matchDate: Date
): Promise<MarketAnalysis[]> {
  const config = getConfig();
  const baseUrl = config.POLYMARKET_GAMMA_BASE_URL;

  const results: MarketAnalysis[] = [];

  const searchQueries = [
    `${homeTeam} vs ${awayTeam}`,
    `${awayTeam} vs ${homeTeam}`,
    `${homeTeam} ${awayTeam}`,
  ];

  for (const query of searchQueries) {
    try {
      const events = await searchByQuery(baseUrl, query);
      const matched = filterByTeamsAndDate(events, homeTeam, awayTeam, matchDate);

      for (const event of matched) {
        for (const market of event.markets) {
          if (!isRelevantMarket(market)) continue;

          const analysis = analyzeMarket(event, market);
          if (analysis) results.push(analysis);
        }
      }
    } catch (e) {
      logger.debug(`Error buscando "${query}": ${e}`);
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);

  const unique = results.filter(
    (r, i, arr) =>
      arr.findIndex((x) => x.market.id === r.market.id) === i
  );

  return unique;
}

async function searchByQuery(
  baseUrl: string,
  query: string
): Promise<PolymarketEvent[]> {
  const url = new URL("/public-search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("limit_per_type", "10");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.events || [];
}

function filterByTeamsAndDate(
  events: PolymarketEvent[],
  homeTeam: string,
  awayTeam: string,
  matchDate: Date
): PolymarketEvent[] {
  const homeNorm = normalizeTeam(homeTeam);
  const awayNorm = normalizeTeam(awayTeam);

  logger.debug(`Buscando eventos para ${homeTeam} vs ${awayTeam}`);
  logger.debug(`Normalizado: ${homeNorm} vs ${awayNorm}`);

  return events.filter((event) => {
    const title = normalizeTeam(event.title);
    logger.debug(`Evento: ${event.title} → ${title}`);
    
    const hasHome = title.includes(homeNorm);
    const hasAway = title.includes(awayNorm);
    
    const hasHomeReverse = title.includes(awayNorm);
    const hasAwayReverse = title.includes(homeNorm);

    if ((!hasHome || !hasAway) && (!hasHomeReverse || !hasAwayReverse)) {
      logger.debug(`  Rechazado: no contiene ambos equipos`);
      return false;
    }

    logger.debug(`  Aceptado`);
    return true;
  });
}

function normalizeTeam(name: string): string {
  const teamMap: Record<string, string> = {
    "curazao": "curacao",
    "costa de marfil": "cote divoire",
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
    "irán": "iran",
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

  const normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();

  return teamMap[normalized] || normalized;
}

function isRelevantMarket(market: PolymarketMarket): boolean {
  const question = market.question.toLowerCase();

  const excluded = [
    "clasifica", "campeón", "champion", "penal",
    "penalty", "penalties", "avanza", "advance",
    "qualif", "extra time", "winner", "group",
    "announcer", "say", "record", "golden boot",
    "top scorer", "lift trophy", "to lift",
  ];

  if (excluded.some((term) => question.includes(term))) return false;

  const hasExactScore =
    question.includes("exact score") ||
    question.includes("correct score") ||
    question.includes("scoreline") ||
    question.includes("final score") ||
    question.includes("exact result") ||
    question.includes("marcador exacto");

  const hasScorePattern = /\b\d{1,2}\s*[-–:]\s*\d{1,2}\b/.test(question);
  const hasTotalGoals =
    (question.includes("over") || question.includes("under")) &&
    question.includes("2.5");
  const hasBothTeamsScore =
    question.includes("both teams") &&
    question.includes("score");

  const hasWin = question.includes("win") || question.includes("gana");
  const hasDraw = question.includes("draw") || question.includes("empate");

  return hasExactScore || hasScorePattern || hasTotalGoals || hasBothTeamsScore || hasWin || hasDraw;
}

function analyzeMarket(
  event: PolymarketEvent,
  market: PolymarketMarket
): MarketAnalysis | null {
  try {
    const outcomes = parseOutcomes(market);
    const prices = parsePrices(market);

    if (outcomes.length === 0 || prices.length === 0) return null;
    if (outcomes.length !== prices.length) return null;

    const outcomeProbs: OutcomeProb[] = outcomes.map((label, i) => ({
      label,
      probability: prices[i] || 0,
    }));

    const maxProb = Math.max(...outcomeProbs.map((o) => o.probability));
    const liquidity = parseFloat(market.liquidity || "0");

    const type = detectMarketType(outcomeProbs, market.question);

    return {
      event,
      market,
      type,
      confidence: maxProb,
      liquidity,
      outcomes: outcomeProbs,
    };
  } catch (e) {
    logger.debug(`Error analizando mercado ${market.id}: ${e}`);
    return null;
  }
}

function parseOutcomes(market: PolymarketMarket): string[] {
  try {
    if (typeof market.outcomes === "string") {
      return JSON.parse(market.outcomes);
    }
    return [];
  } catch {
    return [];
  }
}

function parsePrices(market: PolymarketMarket): number[] {
  try {
    if (typeof market.outcomePrices === "string") {
      const parsed = JSON.parse(market.outcomePrices);
      return parsed.map((p: string) => parseFloat(p));
    }
    return [];
  } catch {
    return [];
  }
}

function detectMarketType(
  outcomes: OutcomeProb[],
  question: string
): "exact_score" | "1x2" | "total_goals" | "both_teams_score" {
  const hasScore = outcomes.some((o) => /^\d+\s*-\s*\d+$/.test(o.label));
  if (hasScore) return "exact_score";

  const questionLower = question.toLowerCase();
  const hasTotalGoals =
    (questionLower.includes("over") || questionLower.includes("under")) &&
    questionLower.includes("2.5");
  if (hasTotalGoals) return "total_goals";

  const hasBothTeamsScore =
    questionLower.includes("both teams") &&
    questionLower.includes("score");
  if (hasBothTeamsScore) return "both_teams_score";

  const hasWin = questionLower.includes("win") || questionLower.includes("gana");
  const hasDraw = questionLower.includes("draw") || questionLower.includes("empate");

  if (hasWin || hasDraw) return "1x2";

  const has1X2 =
    outcomes.some((o) =>
      ["home", "local", "yes", "team a"].includes(o.label.toLowerCase())
    ) ||
    outcomes.some((o) =>
      ["away", "visitante", "no", "team b"].includes(o.label.toLowerCase())
    );

  if (outcomes.length === 3 || has1X2) return "1x2";

  return "1x2";
}
