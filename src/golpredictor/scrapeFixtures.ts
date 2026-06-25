import { chromium, type BrowserContext, type Page } from "playwright";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { Fixture } from "../types.js";

const BASE_URL = "https://golpredictor.com";

export async function scrapeFixtures(
  context: BrowserContext
): Promise<Fixture[]> {
  const config = getConfig();
  const page = await context.newPage();

  try {
    const poolUrl = config.GOLPREDICTOR_POOL_ID
      ? `${BASE_URL}/pooldetail.aspx?pid=${encodeURIComponent(config.GOLPREDICTOR_POOL_ID)}`
      : config.GOLPREDICTOR_URL;

    logger.info(`Navegando a ${poolUrl}`);
    await page.goto(poolUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (config.GOLPREDICTOR_POOL_ID) {
      logger.info("En pool detail page");
    } else {
      await navigateToPool(page);
    }

    const allFixtures: Fixture[] = [];
    let pageNum = 1;

    while (true) {
      logger.info(`Parseando página ${pageNum}...`);
      
      if (pageNum === 3 && process.env.DEBUG_PAGE3 === "true") {
        logger.info("DEBUG: Pausando en página 3 - presiona Enter para continuar");
        await new Promise<void>((resolve) => {
          process.stdin.once("data", () => resolve());
        });
      }

      try {
        const fixtures = await extractFixtures(page, pageNum);
        allFixtures.push(...fixtures);
        logger.info(`  ${fixtures.length} partidos en página ${pageNum}`);
      } catch (e) {
        logger.error(`Error en página ${pageNum}: ${e}`);
        break;
      }

      let hasNextPage = false;
      try {
        hasNextPage = await goToNextPage(page);
      } catch (e) {
        logger.warn(`Error navegando a página siguiente: ${e}`);
        break;
      }

      if (!hasNextPage) {
        logger.info("No hay más páginas");
        break;
      }
      pageNum++;
    }

    logger.info(`Total de partidos encontrados: ${allFixtures.length}`);

    const pendingFixtures = allFixtures.filter((f) => f.status === "pending" && !f.predictionHome);
    logger.info(`Partidos sin pronóstico: ${pendingFixtures.length}`);

    const upcomingFixtures = filterUpcoming(allFixtures, config);
    logger.info(
      `Partidos en ventana de actualización (${config.RUN_WINDOW_MAX_MINUTES_BEFORE}-${config.RUN_WINDOW_MIN_MINUTES_BEFORE} min): ${upcomingFixtures.length}`
    );

    for (const f of upcomingFixtures) {
      const minutesLeft = getMinutesUntilKickoff(f);
      logger.info(
        `  → ${f.homeTeam} vs ${f.awayTeam} (${f.kickoffLocal}) - ${minutesLeft.toFixed(0)} min para kickoff`
      );
    }

    await page.screenshot({
      path: "screenshots/fixtures_scraped.png",
      fullPage: true,
    });

    return allFixtures;
  } finally {
    await page.close();
  }
}

async function navigateToPool(page: Page): Promise<void> {
  const poolLink = page.locator(
    "#ctl00_ContentPlaceInner_gvPollas_ctl02_lnkUrlPronostico"
  );

  if (await poolLink.isVisible()) {
    await poolLink.click();
    await page.waitForLoadState("networkidle");
    logger.info("Navegado a la polla de pronósticos");
  } else {
    logger.warn("No se encontró link de pronósticos, buscando alternativa...");
    const firstPool = page.locator("a[id*='lnkUrlPronostico']").first();
    if (await firstPool.isVisible()) {
      await firstPool.click();
      await page.waitForLoadState("networkidle");
    }
  }
}

async function goToNextPage(page: Page): Promise<boolean> {
  const currentPageEl = page.locator(
    "#ctl00_ContentPlaceInner_gvPartidos tr.paginador span"
  );
  const currentPageText = await currentPageEl
    .first()
    .innerText()
    .catch(() => "0");
  const currentPage = parseInt(currentPageText);
  const nextPage = currentPage + 1;

  const nextPageLink = page.locator(
    `#ctl00_ContentPlaceInner_gvPartidos tr.paginador a:text-is("${nextPage}")`
  );

  const linkCount = await nextPageLink.count();
  if (linkCount === 0) {
    return false;
  }

  try {
    await nextPageLink.click();
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForSelector("#ctl00_ContentPlaceInner_gvPartidos", {
      state: "attached",
      timeout: 10000,
    });
    await page.waitForSelector("#ctl00_ContentPlaceInner_gvPartidos tbody tr", {
      state: "attached",
      timeout: 10000,
    });
    await new Promise((r) => setTimeout(r, 500));
  } catch (e) {
    logger.debug(`Timeout en paginación, continuando...`);
  }

  return true;
}

async function extractFixtures(page: Page, pageNum: number): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];

  const tableExists = await page
    .locator("#ctl00_ContentPlaceInner_gvPartidos")
    .count();
  logger.debug(`Tabla gvPartidos existe: ${tableExists > 0}`);

  const rows = await page
    .locator("#ctl00_ContentPlaceInner_gvPartidos tbody tr")
    .all();

  logger.debug(`Filas encontradas: ${rows.length}`);

  let skippedHeader = 0;
  let skippedPagination = 0;
  let skippedCells = 0;
  let parsed = 0;

  for (const row of rows) {
    const isHeader = await row.locator("th").count().then((c) => c > 0).catch(() => false);
    if (isHeader) { skippedHeader++; continue; }

    const hasPagination = await row
      .locator("td[colspan] table")
      .count()
      .then((c) => c > 0)
      .catch(() => false);
    if (hasPagination) { skippedPagination++; continue; }

    try {
      const cells = await row.locator("td").all();
      if (cells.length < 6) {
        skippedCells++;
        const debugId = await row.getAttribute("id").catch(() => "no-id");
        logger.debug(`Fila ${debugId} descartada: ${cells.length} celdas`);
        continue;
      }

      const matchId = await safeText(cells[0]);
      const kickoffLocal = await safeText(cells[1]);
      const matchName = await safeText(cells[2]);

      const homeScoreText = await safeText(
        row.locator("span[id*='lblGolLocal']")
      );
      const awayScoreText = await safeText(
        row.locator("span[id*='lblGolVisitante']")
      );

      const result = await safeText(cells[4]);

      const rowIdx = await row
        .locator("a[id*='lnkUrlPartido']")
        .getAttribute("id", { timeout: 1500 })
        .then((id) => {
          const match = id?.match(/ctl(\d+)_/);
          return match ? match[1] : "";
        })
        .catch(() => "");

      const teamParts = matchName.split(" - ");
      const homeTeam = teamParts[0]?.trim() || matchName;
      const awayTeam = teamParts[1]?.trim() || "";

      const kickoffUTC = parseKickoff(kickoffLocal);

      fixtures.push({
        rowIdx,
        pageNum,
        matchId,
        homeTeam,
        awayTeam,
        kickoffLocal,
        kickoffUTC,
        predictionHome: homeScoreText || null,
        predictionAway: awayScoreText || null,
        result: result || null,
        status: result ? "scored" : "pending",
      });
      parsed++;
      
      if (!homeScoreText && !awayScoreText) {
        logger.debug(`  ${homeTeam} vs ${awayTeam}: Sin pronóstico`);
      } else {
        logger.debug(`  ${homeTeam} vs ${awayTeam}: Pronóstico ${homeScoreText}-${awayScoreText}`);
      }
    } catch (e) {
      logger.debug(`Error parseando fila: ${e}`);
    }
  }

  logger.debug(`Filas parseadas: ${parsed}, headers: ${skippedHeader}, paginación: ${skippedPagination}, pocas celdas: ${skippedCells}`);

  return fixtures;
}

function parseKickoff(dateStr: string): Date {
  const match = dateStr.match(/(\d+)\s+(\w+)\s*-\s*(\d+):(\d+)/);
  if (!match) return new Date();

  const day = parseInt(match[1]);
  const monthStr = match[2];
  const hours = parseInt(match[3]);
  const minutes = parseInt(match[4]);

  const monthMap: Record<string, number> = {
    Ene: 0, Feb: 1, Mar: 2, Abr: 3, May: 4, Jun: 5,
    Jul: 6, Ago: 7, Sep: 8, Oct: 9, Nov: 10, Dic: 11,
    Jan: 0, Apr: 3, Aug: 7, Dec: 11,
  };

  const month = monthMap[monthStr] ?? 0;
  const now = new Date();
  const year = now.getFullYear();

  return new Date(Date.UTC(year, month, day, hours, minutes, 0));
}

async function safeText(el: any): Promise<string> {
  const timeout = (ms: number) =>
    new Promise<string>((resolve) => setTimeout(() => resolve(""), ms));
  const text = el.innerText().then((t: string) => t.trim()).catch(() => "");
  return Promise.race([text, timeout(1500)]);
}

function filterOpenFixtures(
  fixtures: Fixture[],
  config: ReturnType<typeof getConfig>
): Fixture[] {
  return fixtures.filter((f) => f.status === "pending" && !f.predictionHome);
}

function filterUpcoming(
  fixtures: Fixture[],
  config: ReturnType<typeof getConfig>
): Fixture[] {
  const maxMinutes = config.RUN_WINDOW_MAX_MINUTES_BEFORE;
  const minMinutes = config.RUN_WINDOW_MIN_MINUTES_BEFORE;

  return fixtures.filter((f) => {
    if (f.status === "scored") return false;
    const diffMinutes = getMinutesUntilKickoff(f);
    return diffMinutes >= minMinutes && diffMinutes <= maxMinutes;
  });
}

export function getMinutesUntilKickoff(fixture: Fixture): number {
  const now = new Date();
  const diffMs = fixture.kickoffUTC.getTime() - now.getTime();
  return diffMs / (1000 * 60);
}
