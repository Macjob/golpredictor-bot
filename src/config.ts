import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  DRY_RUN: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  GOLPREDICTOR_STORAGE_STATE: z
    .string()
    .default(".auth/golpredictor.json"),
  GOLPREDICTOR_URL: z
    .string()
    .url()
    .default("https://golpredictor.com/myaccount.aspx"),
  GOLPREDICTOR_POOL_ID: z.string().optional(),
  GOLPREDICTOR_USERNAME: z.string().optional(),
  GOLPREDICTOR_PASSWORD: z.string().optional(),
  RUN_WINDOW_MAX_MINUTES_BEFORE: z.coerce.number().default(20),
  RUN_WINDOW_MIN_MINUTES_BEFORE: z.coerce.number().default(12),
  TIMEZONE: z.string().default("America/Santiago"),
  POLYMARKET_GAMMA_BASE_URL: z
    .string()
    .url()
    .default("https://gamma-api.polymarket.com"),
  MIN_MARKET_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.45),
  MIN_LIQUIDITY_USD: z.coerce.number().min(0).default(0),
  HEADLESS: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error("Error de configuración:", result.error.flatten().fieldErrors);
      process.exit(1);
    }
    _config = result.data;
  }
  return _config;
}
