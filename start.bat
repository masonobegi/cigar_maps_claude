@echo off
echo Starting Habano...
start "Habano API" cmd /k "cd /d "%~dp0server" && node src/index.js"
timeout /t 2 >nul
start "Habano App" cmd /k "cd /d "%~dp0client" && npm run dev"
timeout /t 3 >nul
start http://localhost:3000
echo.
echo Habano is running at http://localhost:3000
echo API running at http://localhost:3001
echo.
echo Demo accounts:
echo   Smoker:  smoker@demo.com / password123
echo   Store 1: store1@demo.com / password123
echo   Store 2: store2@demo.com / password123
echo   Store 3: store3@demo.com / password123
