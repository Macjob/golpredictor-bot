import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import type { ScorePrediction } from "../types.js";

interface ManualOverride {
  homeScore: number;
  awayScore: number;
  reason: string;
}

type OverrideMap = Record<string, ManualOverride>;

let cachedOverrides: OverrideMap | undefined;

function loadOverrides(): OverrideMap {
  if (cachedOverrides !== undefined) return cachedOverrides;

  const filePath = join(process.cwd(), "data", "manual_overrides.json");
  if (!existsSync(filePath)) {
    cachedOverrides = {};
    return cachedOverrides;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    cachedOverrides = JSON.parse(raw) as OverrideMap;
    logger.debug(`manual_overrides_loaded | ${Object.keys(cachedOverrides).length} overrides`);
    return cachedOverrides;
  } catch (e) {
    logger.warn(`manual_overrides_error | ${e}`);
    cachedOverrides = {};
    return cachedOverrides;
  }
}

export function getManualOverride(
  homeTeam: string,
  awayTeam: string
): ScorePrediction | null {
  const overrides = loadOverrides();
  const key = `${homeTeam} vs ${awayTeam}`;
  const override = overrides[key];

  if (!override) return null;

  logger.info(
    `manual_override_found | ${key} → ${override.homeScore}-${override.awayScore} | reason: ${override.reason}`
  );

  return {
    homeScore: override.homeScore,
    awayScore: override.awayScore,
    confidence: 1,
    source: "manual_override",
    reasoning: `Override manual: ${override.reason}`,
  };
}
