import { getConfig } from "./config.js";
import { logger } from "./logger.js";
import { loginManual, createSession, closeSession, saveSession } from "./golpredictor/session.js";
import { scrapeFixtures, getMinutesUntilKickoff } from "./golpredictor/scrapeFixtures.js";
import { searchMarkets } from "./polymarket/searchMarket.js";
import { selectBestPrediction } from "./polymarket/selectPrediction.js";
import { findBestExactScorePrediction, deriveScoreFromMarketSignals } from "./strategy/scoreMapper.js";
import { adjustPredictionForFixtureContext } from "./strategy/competitiveContext.js";
import { applyScoreSanityGuard } from "./strategy/scoreSanityGuard.js";
import { savePredictionHistory } from "./history/predictionHistory.js";
import { submitPrediction } from "./golpredictor/submitPrediction.js";
import type { PredictionResult, MarketAnalysis, ScorePrediction } from "./types.js";

async function runLogin(): Promise<void> {
  await loginManual();
}

async function runDiscover(): Promise<void> {
  const config = getConfig();
  const session = await createSession();

  try {
    const fixtures = await scrapeFixtures(session.context);
    if (fixtures.length === 0) {
      logger.info("No hay partidos abiertos en la ventana de tiempo actual");
      return;
    }

    for (const fixture of fixtures) {
      logger.info(
        `\n--- ${fixture.homeTeam} vs ${fixture.awayTeam} (${fixture.kickoffLocal}) ---`
      );

      const markets = await searchMarkets(
        fixture.homeTeam,
        fixture.awayTeam,
        fixture.kickoffUTC
      );

      if (markets.length === 0) {
        logger.info("  No se encontraron mercados en Polymarket");
        continue;
      }

      const exactScore = findBestExactScorePrediction(
        markets,
        fixture.homeTeam,
        fixture.awayTeam
      );

      const rawScore = exactScore || deriveScoreFromMarketSignals(
        markets,
        fixture.homeTeam,
        fixture.awayTeam
      );
      const score = adjustPredictionForFixtureContext(fixture, rawScore);
      logger.info(
        `  Marcador sugerido: ${score.homeScore}-${score.awayScore} (${(score.confidence * 100).toFixed(1)}%) [${score.source}]`
      );
    }
  } finally {
    await closeSession(session);
  }
}

async function runPredict(): Promise<void> {
  const config = getConfig();
  logger.info(
    `Iniciando predicciones (DRY_RUN=${config.DRY_RUN ? "true" : "false"})`
  );

  const session = await createSession();

  try {
    const allFixtures = await scrapeFixtures(session.context);
    if (allFixtures.length === 0) {
      logger.info("No se encontraron partidos");
      return;
    }

    const pendingFixtures = allFixtures.filter((f) => f.status === "pending" && !f.predictionHome);
    const upcomingFixtures = allFixtures.filter((f) => {
      if (f.status === "scored") return false;
      const diffMinutes = getMinutesUntilKickoff(f);
      return diffMinutes >= config.RUN_WINDOW_MIN_MINUTES_BEFORE && diffMinutes <= config.RUN_WINDOW_MAX_MINUTES_BEFORE;
    });

    logger.info(`Partidos sin pronóstico: ${pendingFixtures.length}`);
    logger.info(`Partidos en ventana de actualización: ${upcomingFixtures.length}`);

    const fixturesToProcess = [...pendingFixtures, ...upcomingFixtures.filter((f) => !pendingFixtures.includes(f))];
    logger.info(`Total a procesar: ${fixturesToProcess.length}`);

    if (fixturesToProcess.length === 0) {
      logger.info("No hay partidos para procesar en este momento");
      return;
    }

    const results: PredictionResult[] = [];

    for (let i = 0; i < fixturesToProcess.length; i++) {
      const fixture = fixturesToProcess[i];
      const progress = `[${i + 1}/${fixturesToProcess.length}]`;
      logger.info(
        `\n${progress} ${fixture.homeTeam} vs ${fixture.awayTeam} (${fixture.kickoffLocal})`
      );

      const minutesLeft = getMinutesUntilKickoff(fixture);
      logger.info(`  Minutos para kickoff: ${minutesLeft.toFixed(0)}`);

      const markets = await searchMarkets(
        fixture.homeTeam,
        fixture.awayTeam,
        fixture.kickoffUTC
      );

      let score: ScorePrediction;
      let usedMarket: MarketAnalysis | null = null;

      const hasGoalSignals = markets.some(
        (m) => m.market.question.toLowerCase().includes("over") ||
               m.market.question.toLowerCase().includes("under") ||
               m.market.question.toLowerCase().includes("both teams")
      );
      const hasBtsSignal = markets.some(
        (m) => m.market.question.toLowerCase().includes("both teams") &&
               m.market.question.toLowerCase().includes("score")
      );

      if (markets.length === 0) {
        logger.info("  No se encontraron mercados en Polymarket → usando heurística por defecto");
        const rawScore = deriveScoreFromMarketSignals(
          markets,
          fixture.homeTeam,
          fixture.awayTeam
        );
        const guardedScore = applyScoreSanityGuard(rawScore, {
          hasGoalSignals: false,
          hasBothTeamsScoreSignal: false,
          hasExactScoreMarket: false,
        });
        score = adjustPredictionForFixtureContext(fixture, guardedScore);
      } else {
        const exactScore = findBestExactScorePrediction(
          markets,
          fixture.homeTeam,
          fixture.awayTeam
        );

        if (exactScore) {
          score = exactScore;
          const exactMarket = markets.find(
            (m) => m.market.id === exactScore.marketId
          );
          usedMarket = exactMarket || null;
          logger.info(
            `  Fuente: exact_score | Marcador: ${score.homeScore}-${score.awayScore} | Confianza: ${(score.confidence * 100).toFixed(1)}%`
          );
        } else {
          const rawScore = deriveScoreFromMarketSignals(
            markets,
            fixture.homeTeam,
            fixture.awayTeam
          );
          const guardedScore = applyScoreSanityGuard(rawScore, {
            hasGoalSignals,
            hasBothTeamsScoreSignal: hasBtsSignal,
            hasExactScoreMarket: false,
          });
          score = adjustPredictionForFixtureContext(fixture, guardedScore);
          const best1x2 = selectBestPrediction(markets);
          usedMarket = best1x2;
          logger.info(
            `  Fuente: ${score.source} | Marcador: ${score.homeScore}-${score.awayScore} | Confianza: ${(score.confidence * 100).toFixed(1)}%`
          );
        }
      }

      const result = await submitPrediction(session.context, fixture, score);
      results.push(result);

      const historyStatus = result.status === "submitted" ? "submitted" :
                            result.status === "dry_run" ? "dry_run" :
                            result.status === "error" ? "error" : result.status;
      savePredictionHistory(
        fixture.matchId,
        fixture.homeTeam,
        fixture.awayTeam,
        fixture.kickoffLocal,
        {
          homeScore: score.homeScore,
          awayScore: score.awayScore,
          source: score.source,
          confidence: score.confidence,
          scoreProbability: score.scoreProbability,
          modelFit: score.modelFit,
          reasoning: score.reasoning,
        },
        historyStatus,
        usedMarket?.market.question
      );

      logger.info(
        `  Resultado: ${result.status} | Mercado: ${usedMarket?.market.question || "N/A"} | Marcador: ${score.homeScore}-${score.awayScore} | Confianza: ${(score.confidence * 100).toFixed(1)}%`
      );
    }

    printSummary(results);
  } finally {
    await closeSession(session);
  }
}

function printSummary(results: PredictionResult[]): void {
  logger.info("\n========================================");
  logger.info("RESUMEN DE PREDICCIONES");
  logger.info("========================================");

  const counts = {
    predicted: 0,
    dry_run: 0,
    submitted: 0,
    low_confidence: 0,
    manual_review: 0,
    error: 0,
  };

  for (const r of results) {
    counts[r.status as keyof typeof counts]++;
    const status = r.status.toUpperCase();
    const match = `${r.fixture.homeTeam} vs ${r.fixture.awayTeam}`;
    const score = r.prediction
      ? `${r.prediction.homeScore}-${r.prediction.awayScore}`
      : "N/A";
    const conf = r.prediction
      ? `${(r.prediction.confidence * 100).toFixed(1)}%`
      : "N/A";

    logger.info(`  [${status}] ${match} → ${score} (${conf})`);
  }

  logger.info("----------------------------------------");
  logger.info(
    `Total: ${results.length} | ` +
      `Enviados: ${counts.submitted + counts.dry_run} | ` +
      `Baja confianza: ${counts.low_confidence} | ` +
      `Errores: ${counts.error}`
  );
  logger.info("========================================");
}

const command = process.argv[2];

function forceExitAfter(ms: number): void {
  setTimeout(() => {
    logger.warn(`Timeout de ${ms}ms después de cierre, forzando salida`);
    process.exit(0);
  }, ms).unref();
}

switch (command) {
  case "login":
    runLogin().catch((e) => {
      logger.error(e);
      process.exit(1);
    });
    break;
  case "discover":
    runDiscover()
      .then(() => forceExitAfter(10_000))
      .catch((e) => {
        logger.error(e);
        process.exit(1);
      });
    break;
  case "predict":
    runPredict()
      .then(() => forceExitAfter(10_000))
      .catch((e) => {
        logger.error(e);
        process.exit(1);
      });
    break;
  default:
    console.log(`
GolPredictor Bot - Automatización de pronósticos

Uso:
  npm run login      Login manual en GolPredictor (headed browser)
  npm run discover   Descubrir partidos abiertos y mercados
  npm run dry-run    Ejecutar predicciones sin guardar (DRY_RUN=true)
  npm run predict    Ejecutar predicciones (respeta DRY_RUN de .env)
    `);
    break;
}
