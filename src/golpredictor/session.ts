import { chromium, type BrowserContext, type Browser } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";

export interface Session {
  context: BrowserContext;
  browser: Browser;
}

export async function createSession(): Promise<Session> {
  const config = getConfig();
  const storagePath = config.GOLPREDICTOR_STORAGE_STATE;

  const storageDir = dirname(storagePath);
  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true });
  }

  const hasStorage = existsSync(storagePath);

  const browser = await chromium.launch({ headless: config.HEADLESS });
  const context = await browser.newContext({
    ...(hasStorage ? { storageState: storagePath } : {}),
  });

  if (config.GOLPREDICTOR_USERNAME && config.GOLPREDICTOR_PASSWORD) {
    const page = await context.newPage();
    try {
      await page.goto(config.GOLPREDICTOR_URL, { timeout: 30000 });
      const isLoggedIn = await page
        .locator("#ctl00_Header1_UserInfo1_LoginView1_LoginName1")
        .isVisible()
        .catch(() => false);

      if (!isLoggedIn) {
        logger.info("Sesión expirada, haciendo login automático...");
        await page.goto("https://golpredictor.com/login.aspx", { timeout: 30000 });
        await page.waitForLoadState("networkidle");
        
        await page.fill("#ctl00_ContentPlaceInner_txtUserName", config.GOLPREDICTOR_USERNAME);
        await page.fill("#ctl00_ContentPlaceInner_txtPassword", config.GOLPREDICTOR_PASSWORD);
        await page.click("#ctl00_ContentPlaceInner_btnLogin");
        await page.waitForLoadState("networkidle");
        await context.storageState({ path: storagePath });
        logger.info("Login automático exitoso, sesión guardada");
      }
      await page.close();
    } catch (e) {
      logger.warn(`Error en login automático: ${e}`);
      await page.close();
    }
  }

  return { context, browser };
}

export async function closeSession(session: Session): Promise<void> {
  try {
    await session.context.close();
  } catch (e) {
    logger.debug("Error cerrando contexto");
  }
  try {
    await session.browser.close();
  } catch (e) {
    logger.debug("Error cerrando browser");
  }
  logger.info("Browser cerrado");
}

export async function saveSession(context: BrowserContext): Promise<void> {
  const config = getConfig();
  await context.storageState({ path: config.GOLPREDICTOR_STORAGE_STATE });
  logger.info(`Sesión guardada en ${config.GOLPREDICTOR_STORAGE_STATE}`);
}

export async function loginManual(): Promise<void> {
  const config = getConfig();
  logger.info("Iniciando login manual en GolPredictor...");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(config.GOLPREDICTOR_URL);
  logger.info("Navegando a GolPredictor...");

  logger.info(
    "Por favor, completa el login manual en el navegador abierto."
  );
  logger.info(
    "Una vez que veas tu cuenta (Mi Cuenta), presiona Enter aquí para continuar."
  );

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  const isLoggedIn = await page
    .locator("#ctl00_Header1_UserInfo1_LoginView1_LoginName1")
    .isVisible()
    .catch(() => false);

  if (!isLoggedIn) {
    logger.error("No se detectó login exitoso. Verifica que estés en tu cuenta.");
    await browser.close();
    process.exit(1);
  }

  const storageDir = dirname(config.GOLPREDICTOR_STORAGE_STATE);
  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true });
  }

  await context.storageState({ path: config.GOLPREDICTOR_STORAGE_STATE });
  logger.info(`Login exitoso. Sesión guardada en ${config.GOLPREDICTOR_STORAGE_STATE}`);

  await browser.close();
}
