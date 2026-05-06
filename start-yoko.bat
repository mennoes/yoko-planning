@echo off
cd /d "D:\Dropbox\studio yoko\Website\Planning tool\yoko-planner"
start "" /B npm run dev
timeout /t 3 /nobreak >nul
start http://localhost:3000
