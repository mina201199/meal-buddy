@echo off
rem Double-click to start the app with Jev (opens http://localhost:5173)
cd /d "%~dp0"
python server.py --open
pause
