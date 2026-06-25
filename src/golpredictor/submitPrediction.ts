import { type BrowserContext, type Page } from "playwright";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { Fixture, ScorePrediction, PredictionResult } from "../types.js";

export async function submitPrediction(
  context: BrowserContext,
  fixture: Fixture,
  prediction: ScorePrediction
): Promise<PredictionResult> {
  const config = getConfig();
  const page = await context.newPage();

  try {
    const poolUrl = config.GOLPREDICTOR_POOL_ID
      ? `https://golpredictor.com/pooldetail.aspx?pid=${encodeURIComponent(config.GOLPREDICTOR_POOL_ID)}`
      : config.GOLPREDICTOR_URL;

    await page.goto(poolUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (fixture.pageNum > 1) {
      await navigateToPage(page, fixture.pageNum);
    }

    await page.screenshot({
      path: `screenshots/${fixture.matchId}_before.png`,
      fullPage: true,
    });
    logger.info(`Screenshot antes: ${fixture.matchId}_before.png`);

    const minutesLeft = getMinutesUntilKickoff(fixture);
    if (minutesLeft < 10) {
      logger.warn(
        `Faltan ${minutesLeft.toFixed(0)} minutos para ${fixture.homeTeam} vs ${fixture.awayTeam}. Mínimo 10 minutos requerido.`
      );
      return {
        fixture,
        prediction,
        market: null,
        status: "error",
        error: `Faltan ${minutesLeft.toFixed(0)} minutos, mínimo 10 requerido`,
      };
    }

    await fillScoreInputs(page, fixture, prediction);

    if (config.DRY_RUN) {
      logger.info(
        `[DRY RUN] Pronóstico para ${fixture.homeTeam} vs ${fixture.awayTeam}: ${prediction.homeScore}-${prediction.awayScore}`
      );

      await page.screenshot({
        path: `screenshots/${fixture.matchId}_dryrun.png`,
        fullPage: true,
      });

      return {
        fixture,
        prediction,
        market: null,
        status: "dry_run",
      };
    }

    await clickSave(page);

    await page.waitForTimeout(2000);

    const verified = await verifyPrediction(page, fixture, prediction);

    await page.screenshot({
      path: `screenshots/${fixture.matchId}_after.png`,
      fullPage: true,
    });
    logger.info(`Screenshot después: ${fixture.matchId}_after.png`);

    if (verified) {
      logger.info(
        `Pronóstico guardado: ${fixture.homeTeam} vs ${fixture.awayTeam} → ${prediction.homeScore}-${prediction.awayScore}`
      );
      return {
        fixture,
        prediction,
        market: null,
        status: "submitted",
      };
    } else {
      logger.warn(
        `No se pudo verificar el pronóstico para ${fixture.homeTeam} vs ${fixture.awayTeam}`
      );
      return {
        fixture,
        prediction,
        market: null,
        status: "error",
        error: "No se pudo verificar persistencia del pronóstico",
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`Error enviando pronóstico: ${msg}`);

    await page.screenshot({
      path: `screenshots/${fixture.matchId}_error.png`,
      fullPage: true,
    }).catch(() => {});

    return {
      fixture,
      prediction,
      market: null,
      status: "error",
      error: msg,
    };
  } finally {
    await page.close();
  }
}

async function navigateToPage(page: Page, targetPage: number): Promise<void> {
  const currentPageEl = page.locator(
    "#ctl00_ContentPlaceInner_gvPartidos tr.paginador span"
  );
  const currentPageText = await currentPageEl
    .first()
    .innerText()
    .catch(() => "1");
  const currentPage = parseInt(currentPageText);

  if (currentPage === targetPage) {
    return;
  }

  const targetPageLink = page.locator(
    `#ctl00_ContentPlaceInner_gvPartidos tr.paginador a:text-is("${targetPage}")`
  );

  if (await targetPageLink.isVisible()) {
    await targetPageLink.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
    logger.info(`Navegado a página ${targetPage}`);
  } else {
    logger.warn(`No se encontró link de página ${targetPage}`);
  }
}

async function fillScoreInputs(
  page: Page,
  fixture: Fixture,
  prediction: ScorePrediction
): Promise<void> {
  const row = page.locator(`#ctl00_ContentPlaceInner_gvPartidos tbody tr`)
    .filter({ hasText: `${fixture.homeTeam} - ${fixture.awayTeam}` });

  const homeInput = row.locator("input[name*='txtGolLocal']");
  const awayInput = row.locator("input[name*='txtGolVisitante']");

  const homeVisible = await homeInput.isVisible().catch(() => false);
  const awayVisible = await awayInput.isVisible().catch(() => false);

  if (homeVisible && awayVisible) {
    await homeInput.fill(String(prediction.homeScore));
    await awayInput.fill(String(prediction.awayScore));
    logger.info(
      `Inputs llenados: ${prediction.homeScore}-${prediction.awayScore}`
    );
  } else {
    logger.error("No se encontraron inputs de marcador en la página");
  }
}

async function clickSave(
  page: Page
): Promise<void> {
  const saveButton = page.locator(
    "#ctl00_ContentPlaceInner_butGuardar"
  );

  if (await saveButton.isVisible()) {
    await saveButton.click();
    logger.info("Botón GUARDAR clickeado");
  } else {
    const altSave = page.locator("input[type='image'][name*='butGuardar']").first();
    if (await altSave.isVisible()) {
      await altSave.click();
      logger.info("Botón GUARDAR clickeado (alternativo)");
    } else {
      logger.warn("No se encontró botón GUARDAR");
    }
  }
}

async function verifyPrediction(
  page: Page,
  fixture: Fixture,
  prediction: ScorePrediction
): Promise<boolean> {
  const successMsg = page.locator("text=Pronóstico almacenado con éxito");
  const hasSuccess = await successMsg.isVisible({ timeout: 5000 }).catch(() => false);
  if (hasSuccess) {
    logger.info("Verificación OK: mensaje de éxito detectado");
    return true;
  }

  const row = page.locator(`#ctl00_ContentPlaceInner_gvPartidos tbody tr`)
    .filter({ hasText: `${fixture.homeTeam} - ${fixture.awayTeam}` });

  const homeVal = await row.locator("input[name*='txtGolLocal']").inputValue().catch(() => "");
  const awayVal = await row.locator("input[name*='txtGolVisitante']").inputValue().catch(() => "");

  if (homeVal === String(prediction.homeScore) && awayVal === String(prediction.awayScore)) {
    logger.info(`Verificación OK: ${homeVal}-${awayVal}`);
    return true;
  }

  const homeSpan = await row.locator("span[id*='lblGolLocal']").innerText().catch(() => "");
  const awaySpan = await row.locator("span[id*='lblGolVisitante']").innerText().catch(() => "");

  if (homeSpan.trim() === String(prediction.homeScore) && awaySpan.trim() === String(prediction.awayScore)) {
    logger.info(`Verificación OK (spans): ${homeSpan}-${awaySpan}`);
    return true;
  }

  logger.warn(
    `Verificación fallida: esperado ${prediction.homeScore}-${prediction.awayScore}, inputs: ${homeVal}-${awayVal}, spans: ${homeSpan}-${awaySpan}`
  );
  return false;
}

function getMinutesUntilKickoff(fixture: Fixture): number {
  const now = new Date();
  const diffMs = fixture.kickoffUTC.getTime() - now.getTime();
  return diffMs / (1000 * 60);
}
