import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { MarketAnalysis } from "../types.js";

export function selectBestPrediction(
  markets: MarketAnalysis[]
): MarketAnalysis | null {
  const config = getConfig();

  const eligible = markets.filter((m) => {
    if (m.confidence < config.MIN_MARKET_CONFIDENCE) {
      logger.debug(
        `Mercado descartado (confianza ${m.confidence.toFixed(2)} < ${config.MIN_MARKET_CONFIDENCE}): ${m.market.question}`
      );
      return false;
    }

    if (m.liquidity < config.MIN_LIQUIDITY_USD) {
      logger.debug(
        `Mercado descartado (liquidez $${m.liquidity} < $${config.MIN_LIQUIDITY_USD}): ${m.market.question}`
      );
      return false;
    }

    return true;
  });

  if (eligible.length === 0) {
    return null;
  }

  const exactScore = eligible.filter((m) => m.type === "exact_score");
  if (exactScore.length > 0) {
    const best = exactScore[0];
    logger.info(
      `Mercado seleccionado (exact_score): ${best.market.question} - confianza: ${(best.confidence * 100).toFixed(1)}%`
    );
    return best;
  }

  const markets1X2 = eligible.filter((m) => m.type === "1x2");
  if (markets1X2.length > 0) {
    const best = markets1X2[0];
    logger.info(
      `Mercado seleccionado (1X2): ${best.market.question} - confianza: ${(best.confidence * 100).toFixed(1)}%`
    );
    return best;
  }

  return null;
}
