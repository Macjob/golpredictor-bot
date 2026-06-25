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
  const searchQueries = buildSearchQueries(homeTeam, awayTeam);

  logger.debug(
    `Queries Polymarket para ${homeTeam} vs ${awayTeam}: ${searchQueries.join(" | ")}`
  );

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

function buildSearchQueries(homeTeam: string, awayTeam: string): string[] {
  const homeAliases = getTeamAliases(homeTeam).slice(0, 4);
  const awayAliases = getTeamAliases(awayTeam).slice(0, 4);
  const queries = new Set<string>();

  for (const home of homeAliases) {
    for (const away of awayAliases) {
      queries.add(`${home} vs ${away}`);
      queries.add(`${away} vs ${home}`);
      queries.add(`${home} ${away}`);
    }
  }

  return [...queries].slice(0, 18);
}

function filterByTeamsAndDate(
  events: PolymarketEvent[],
  homeTeam: string,
  awayTeam: string,
  matchDate: Date
): PolymarketEvent[] {
  const homeAliases = getTeamAliases(homeTeam).map(normalizeText);
  const awayAliases = getTeamAliases(awayTeam).map(normalizeText);

  logger.debug(`Buscando eventos para ${homeTeam} vs ${awayTeam}`);
  logger.debug(`Aliases home: ${homeAliases.join(", ")}`);
  logger.debug(`Aliases away: ${awayAliases.join(", ")}`);

  return events.filter((event) => {
    const title = normalizeText(event.title);
    logger.debug(`Evento: ${event.title} → ${title}`);

    const hasHome = homeAliases.some((alias) => title.includes(alias));
    const hasAway = awayAliases.some((alias) => title.includes(alias));

    const hasHomeReverse = awayAliases.some((alias) => title.includes(alias));
    const hasAwayReverse = homeAliases.some((alias) => title.includes(alias));

    if ((!hasHome || !hasAway) && (!hasHomeReverse || !hasAwayReverse)) {
      logger.debug(`  Rechazado: no contiene ambos equipos`);
      return false;
    }

    logger.debug(`  Aceptado`);
    return true;
  });
}

function normalizeText(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function getTeamAliases(name: string): string[] {
  const normalized = normalizeText(name);

  const aliasMap: Record<string, string[]> = {
    "curazao": ["curacao", "curaçao"],
    "curacao": ["curazao", "curaçao"],
    "costa de marfil": ["ivory coast", "cote divoire", "cote d ivoire"],
    "ivory coast": ["costa de marfil", "cote divoire", "cote d ivoire"],
    "cote divoire": ["ivory coast", "costa de marfil", "cote d ivoire"],
    "paises bajos": ["netherlands", "holland"],
    "netherlands": ["paises bajos", "holland"],
    "estados unidos": ["united states", "usa", "usmnt"],
    "united states": ["estados unidos", "usa", "usmnt"],
    "usa": ["united states", "estados unidos", "usmnt"],
    "alemania": ["germany"],
    "germany": ["alemania"],
    "japon": ["japan"],
    "japan": ["japon"],
    "suecia": ["sweden"],
    "sweden": ["suecia"],
    "tunez": ["tunisia"],
    "tunisia": ["tunez"],
    "turquia": ["turkey"],
    "turkey": ["turquia"],
    "brasil": ["brazil"],
    "brazil": ["brasil"],
    "espana": ["spain"],
    "spain": ["espana"],
    "francia": ["france"],
    "france": ["francia"],
    "inglaterra": ["england"],
    "england": ["inglaterra"],
    "irak": ["iraq"],
    "iraq": ["irak"],
    "iran": ["ir irán", "ir iran", "irán"],
    "ir irán": ["iran", "ir iran"],
    "ir iran": ["iran", "ir irán"],
    "croacia": ["croatia"],
    "croatia": ["croacia"],
    "noruega": ["norway"],
    "norway": ["noruega"],
    "belgica": ["belgium"],
    "belgium": ["belgica"],
    "nueva zelanda": ["new zealand"],
    "new zealand": ["nueva zelanda"],
    "egipto": ["egypt"],
    "egypt": ["egipto"],
    "argelia": ["algeria"],
    "algeria": ["argelia"],
    "jordania": ["jordan"],
    "jordan": ["jordania"],
    "arabia saudita": ["saudi arabia"],
    "saudi arabia": ["arabia saudita"],
    "cabo verde": ["cape verde"],
    "cape verde": ["cabo verde"],
    "rd congo": ["dr congo", "congo dr", "democratic republic of congo"],
    "dr congo": ["rd congo", "congo dr", "democratic republic of congo"],
  };

  return unique([
    ...(aliasMap[normalized] || []),
    normalized,
  ]);
}

function normalizeTeam(name: string): string {
  return getTeamAliases(name)[0] || normalizeText(name);
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
