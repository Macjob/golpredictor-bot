import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import type { Fixture, ScorePrediction } from "../types.js";

export interface TeamGroupContext {
  teamName: string;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  matchesPlayed: number;
}

export interface MatchCompetitiveContext {
  home: TeamGroupContext;
  away: TeamGroupContext;
  isFinalGroupMatch: boolean;
  homeNeedsWin: boolean;
  awayNeedsWin: boolean;
  homeLikelyQualified: boolean;
  awayLikelyQualified: boolean;
  homeLikelyEliminated: boolean;
  awayLikelyEliminated: boolean;
}

type GroupContextFile = Record<string, Omit<TeamGroupContext, "teamName" | "goalDifference"> & {
  goalDifference?: number;
}>;

let cachedGroupContext: Map<string, TeamGroupContext> | null | undefined;

function normalizeTeamName(name: string): string {
  const normalized = name
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
    "sudafrica": "south africa",
    "uzbekistan": "uzbekistan",
  };

  return teamMap[normalized] || normalized;
}

function loadGroupContext(): Map<string, TeamGroupContext> | null {
  if (cachedGroupContext !== undefined) return cachedGroupContext;

  const filePath = join(process.cwd(), "data", "group_context.json");
  if (!existsSync(filePath)) {
    cachedGroupContext = null;
    logger.debug("competitive_context_used=false | data/group_context.json no existe");
    return cachedGroupContext;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as GroupContextFile;
    const context = new Map<string, TeamGroupContext>();

    for (const [teamName, value] of Object.entries(parsed)) {
      const goalsFor = Number(value.goalsFor ?? 0);
      const goalsAgainst = Number(value.goalsAgainst ?? 0);
      const goalDifference = Number(
        value.goalDifference ?? goalsFor - goalsAgainst
      );

      context.set(normalizeTeamName(teamName), {
        teamName,
        points: Number(value.points ?? 0),
        goalsFor,
        goalsAgainst,
        goalDifference,
        matchesPlayed: Number(value.matchesPlayed ?? 0),
      });
    }

    cachedGroupContext = context;
    return context;
  } catch (error) {
    logger.warn(`competitive_context_used=false | Error leyendo data/group_context.json: ${error}`);
    cachedGroupContext = null;
    return cachedGroupContext;
  }
}

function needsWin(team: TeamGroupContext, opponent: TeamGroupContext): boolean {
  if (team.matchesPlayed < 2) return false;
  if (team.points <= 1) return true;
  if (team.points <= 3 && team.goalDifference <= opponent.goalDifference) return true;
  return false;
}

function likelyQualified(team: TeamGroupContext): boolean {
  if (team.matchesPlayed < 2) return false;
  if (team.points >= 6) return true;
  return team.points >= 4 && team.goalDifference >= 2;
}

function likelyEliminated(team: TeamGroupContext): boolean {
  return team.matchesPlayed >= 2 && team.points <= 1 && team.goalDifference <= -2;
}

export function getMatchCompetitiveContext(
  fixture: Fixture
): MatchCompetitiveContext | null {
  const groupContext = loadGroupContext();
  if (!groupContext) return null;

  const home = groupContext.get(normalizeTeamName(fixture.homeTeam));
  const away = groupContext.get(normalizeTeamName(fixture.awayTeam));

  if (!home || !away) {
    logger.debug(
      `competitive_context_used=false | Sin contexto completo para ${fixture.homeTeam} vs ${fixture.awayTeam}`
    );
    return null;
  }

  const isFinalGroupMatch = home.matchesPlayed >= 2 && away.matchesPlayed >= 2;

  return {
    home,
    away,
    isFinalGroupMatch,
    homeNeedsWin: isFinalGroupMatch && needsWin(home, away),
    awayNeedsWin: isFinalGroupMatch && needsWin(away, home),
    homeLikelyQualified: likelyQualified(home),
    awayLikelyQualified: likelyQualified(away),
    homeLikelyEliminated: likelyEliminated(home),
    awayLikelyEliminated: likelyEliminated(away),
  };
}

export function adjustScoreForCompetitiveContext(
  basePrediction: ScorePrediction,
  context: MatchCompetitiveContext | null
): ScorePrediction {
  if (!context || basePrediction.source === "exact_score_market") {
    return basePrediction;
  }

  const originalScore = `${basePrediction.homeScore}-${basePrediction.awayScore}`;
  let homeScore = basePrediction.homeScore;
  let awayScore = basePrediction.awayScore;
  let adjustmentReason: string | null = null;

  const totalGoals = homeScore + awayScore;
  const homeWins = homeScore > awayScore;
  const awayWins = awayScore > homeScore;
  const isHighMargin = Math.abs(homeScore - awayScore) >= 3;

  if (context.homeLikelyQualified && context.awayNeedsWin && homeWins) {
    if (isHighMargin) {
      homeScore = 2;
      awayScore = 1;
      adjustmentReason = "local probablemente clasificado y visita necesita ganar; se suaviza goleada";
    } else if (homeScore === 2 && awayScore === 0 && basePrediction.confidence < 0.7) {
      homeScore = 1;
      awayScore = 1;
      adjustmentReason = "local probablemente clasificado con confianza media; se evita 2-0 automático";
    }
  } else if (context.awayLikelyQualified && context.homeNeedsWin && awayWins) {
    if (isHighMargin) {
      homeScore = 1;
      awayScore = 2;
      adjustmentReason = "visita probablemente clasificada y local necesita ganar; se suaviza goleada";
    } else if (homeScore === 0 && awayScore === 2 && basePrediction.confidence < 0.7) {
      homeScore = 1;
      awayScore = 1;
      adjustmentReason = "visita probablemente clasificada con confianza media; se evita 0-2 automático";
    }
  } else if (context.homeLikelyQualified && context.awayLikelyQualified && totalGoals >= 3) {
    if (homeWins) {
      homeScore = 1;
      awayScore = 0;
    } else if (awayWins) {
      homeScore = 0;
      awayScore = 1;
    } else {
      homeScore = 1;
      awayScore = 1;
    }
    adjustmentReason = "ambos equipos probablemente clasificados; se baja agresividad";
  } else if (context.homeNeedsWin && context.awayNeedsWin && homeScore === 0 && awayScore === 0) {
    homeScore = 1;
    awayScore = 1;
    adjustmentReason = "ambos necesitan resultado; se evita 0-0";
  } else if (context.homeNeedsWin && context.awayLikelyEliminated && homeWins && homeScore === 1 && awayScore === 0 && basePrediction.confidence > 0.6) {
    homeScore = 2;
    awayScore = 0;
    adjustmentReason = "local necesita ganar y rival viene muy débil; se permite mayor margen";
  } else if (context.awayNeedsWin && context.homeLikelyEliminated && awayWins && homeScore === 0 && awayScore === 1 && basePrediction.confidence > 0.6) {
    homeScore = 0;
    awayScore = 2;
    adjustmentReason = "visita necesita ganar y rival viene muy débil; se permite mayor margen";
  }

  const adjustedScore = `${homeScore}-${awayScore}`;
  logger.info(
    `competitive_context_used=true | homeNeedsWin=${context.homeNeedsWin} | awayNeedsWin=${context.awayNeedsWin} | homeLikelyQualified=${context.homeLikelyQualified} | awayLikelyQualified=${context.awayLikelyQualified} | original_score=${originalScore} | adjusted_score=${adjustedScore} | adjustment_reason=${adjustmentReason || "sin ajuste"}`
  );

  if (!adjustmentReason) return basePrediction;

  return {
    ...basePrediction,
    homeScore,
    awayScore,
    confidence: Math.max(0.15, basePrediction.confidence * 0.95),
    reasoning: `${basePrediction.reasoning}. Ajuste contexto competitivo: ${adjustmentReason}`,
  };
}

export function adjustPredictionForFixtureContext(
  fixture: Fixture,
  prediction: ScorePrediction
): ScorePrediction {
  const context = getMatchCompetitiveContext(fixture);
  return adjustScoreForCompetitiveContext(prediction, context);
}
