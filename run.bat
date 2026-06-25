@echo off
cd /d D:\Proyectos\golpredictor-bot
npx tsx src/index.ts predict >> logs\cron.log 2>&1
