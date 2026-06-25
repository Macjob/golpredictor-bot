# GolPredictor Bot

Automatización de pronósticos para [GolPredictor](https://golpredictor.com) usando datos de [Polymarket](https://polymarket.com).

## Instalación

```bash
cd golpredictor-bot
npm install
npx playwright install chromium
cp .env.example .env
```

## Configuración

Edita `.env` con tus preferencias:

```env
DRY_RUN=true                          # No guardar pronósticos (solo mostrar)
GOLPREDICTOR_STORAGE_STATE=.auth/golpredictor.json
GOLPREDICTOR_URL=https://golpredictor.com/myaccount.aspx
GOLPREDICTOR_POOL_ID=                 # ID de tu polla (opcional)
RUN_WINDOW_MAX_MINUTES_BEFORE=20      # Ventana máxima antes del partido
RUN_WINDOW_MIN_MINUTES_BEFORE=12      # Ventana mínima antes del partido
TIMEZONE=America/Santiago
POLYMARKET_GAMMA_BASE_URL=https://gamma-api.polymarket.com
MIN_MARKET_CONFIDENCE=0.45            # Confianza mínima del mercado
MIN_LIQUIDITY_USD=0                   # Liquidez mínima en USD
```

## Uso

### 1. Login manual (primera vez)

```bash
npm run login
```

Se abrirá un navegador Chromium. Inicia sesión en GolPredictor manualmente. Cuando veas tu cuenta, presiona Enter en la terminal. La sesión se guardará en `.auth/golpredictor.json`.

### 2. Descubrir partidos

```bash
npm run discover
```

Lista los partidos abiertos en la ventana de tiempo y muestra qué mercados encontró en Polymarket.

### 3. Ejecutar predicciones (dry-run)

```bash
npm run dry-run
```

Ejecuta el flujo completo sin guardar. Muestra qué pronóstico habría puesto.

### 4. Ejecutar predicciones (real)

```bash
# Primero editar .env y poner DRY_RUN=false
npm run predict
```

## Cron Job (Linux/Mac)

Ejecutar cada 5 minutos:

```bash
crontab -e
```

Agregar:

```bash
*/5 * * * * cd /ruta/golpredictor-bot && npm run predict >> logs/cron.log 2>&1
```

## Windows Task Scheduler

1. Abrir Task Scheduler
2. Crear tarea básica
3. Trigger: cada 5 minutos
4. Action: `cmd /c cd D:\ruta\golpredictor-bot && npm run predict >> logs\cron.log 2>&1`

## Estructura

```
src/
├── config.ts                    # Configuración con Zod
├── types.ts                     # Interfaces
├── logger.ts                    # Pino logger
├── golpredictor/
│   ├── session.ts              # Login manual + storageState
│   ├── scrapeFixtures.ts       # Scraping de partidos
│   └── submitPrediction.ts     # Envío de predicciones
├── polymarket/
│   ├── searchMarket.ts         # Búsqueda Gamma API
│   └── selectPrediction.ts     # Selección de mercado
├── strategy/
│   └── scoreMapper.ts          # Conversión prob → marcador
└── index.ts                     # CLI principal
```

## Estrategia

1. Si existe mercado de marcador exacto en Polymarket → usar el de mayor probabilidad
2. Si solo existe mercado 1X2:
   - Local gana >65% → 2-0
   - Local gana 45-65% → 2-1
   - Local gana 35-45% → 1-0
   - Empate >40% → 1-1
   - Visitante gana >65% → 0-2
   - Visitante gana 45-65% → 1-2
   - Visitante gana 35-45% → 0-1
   - Sin tendencia → 1-1 (fallback)

## Logs

Los logs se guardan en `logs/` y se muestran en consola con formato:
```
2024-06-25 14:30:00 [INFO] === Brasil vs Argentina (25 Jun - 20:00) ===
2024-06-25 14:30:01 [INFO] Mercado seleccionado (1X2): Brazil vs Argentina - confianza: 62.3%
2024-06-25 14:30:01 [INFO] Marcador sugerido: 2-1 (62.3%)
```

## Troubleshooting

- **"No storage state found"**: Ejecutar `npm run login` primero
- **"No se encontraron inputs"**: Los selectores CSS pueden haber cambiado. Verificar la estructura HTML de GolPredictor
- **"Faltan X minutos"**: El partido está fuera de la ventana (20-12 min antes). Ajustar `RUN_WINDOW_*` en `.env`
- **Polymarket no encuentra mercado**: Los equipos pueden tener nombres diferentes. El bot intenta varias variaciones
