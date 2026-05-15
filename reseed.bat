@echo off
echo Reseeding database with demo data...
cd /d "%~dp0server"
node src/database/seed.js
echo Done.
pause
