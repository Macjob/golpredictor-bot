import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";

interface PredictionHistoryRecord {
  createdAt: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffLocal: string;
  prediction: {
    homeScore: number;
    awayScore: number;
    source: string;
    confidence: number;
    scoreProbability?: number;
    modelFit?: number;
    reasoning: string;
  };
  status: string;
  marketQuestion?: string;
}

function ensureDataDir(): void {
  const dataDir = join(process.cwd(), "data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

export function savePredictionHistory(
  matchId: string,
  homeTeam: string,
  awayTeam: string,
  kickoffLocal: string,
  prediction: {
    homeScore: number;
    awayScore: number;
    source: string;
    confidence: number;
    scoreProbability?: number;
    modelFit?: number;
    reasoning: string;
  },
  status: string,
  marketQuestion?: string
): void {
  try {
    ensureDataDir();

    const record: PredictionHistoryRecord = {
      createdAt: new Date().toISOString(),
      matchId,
      homeTeam,
      awayTeam,
      kickoffLocal,
      prediction: {
        homeScore: prediction.homeScore,
        awayScore: prediction.awayScore,
        source: prediction.source,
        confidence: prediction.confidence,
        scoreProbability: prediction.scoreProbability,
        modelFit: prediction.modelFit,
        reasoning: prediction.reasoning,
      },
      status,
      marketQuestion,
    };

    const filePath = join(process.cwd(), "data", "prediction_history.jsonl");
    appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");

    logger.debug(`prediction_history_written | match=${homeTeam} vs ${awayTeam} | status=${status}`);
  } catch (e) {
    logger.warn(`prediction_history_error | ${e}`);
  }
}
