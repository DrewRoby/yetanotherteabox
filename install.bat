@echo off
setlocal enabledelayedexpansion
rem Installs/runs Teabox for a Windows test deploy. Keep this file, teabox.exe, and
rem (optionally) config.env together in one folder — e.g. on a USB drive or copied
rem straight onto the target PC. Nothing is installed elsewhere; teabox.db is
rem created next to teabox.exe on first run, right here in this same folder.

set "SCRIPT_DIR=%~dp0"
set "EXE=%SCRIPT_DIR%teabox.exe"
set "URL=http://localhost:4000"

if not exist "%EXE%" (
  echo Could not find teabox.exe next to this installer.
  echo Build one with: cd server ^&^& npm run build:windows
  echo Then copy dist-bin\teabox.exe next to this install.bat.
  pause
  exit /b 1
)

echo Starting Teabox...
echo A console window will open for it - that's normal, leave it open.
echo (If PORT is customized in config.env, check that port instead of 4000 below.)
echo.

start "Teabox" "%EXE%"

set "UP="
for /l %%i in (1,1,20) do (
  curl -sf "%URL%/api/health" >nul 2>&1
  if not errorlevel 1 (
    set "UP=1"
    goto :checked
  )
  timeout /t 1 >nul
)
:checked

if defined UP (
  echo Teabox is up at %URL% - it should open in your browser automatically.
  echo If not, open %URL% yourself.
) else (
  echo.
  echo Teabox did NOT come up at %URL% after 20 seconds.
  echo.
  echo Check the "Teabox" console window that opened - if it's still open, read
  echo whatever it printed. If it already closed, look for a log at:
  echo   %SCRIPT_DIR%teabox-error.log
  echo.
  echo Common causes:
  echo   - Another copy of Teabox is already running (check Task Manager for
  echo     teabox.exe, close it, then run this installer again).
  echo   - This folder isn't writable ^(e.g. running straight off a locked USB
  echo     drive^) - copy the whole folder onto the PC's own drive and retry.
  echo   - Windows Defender/antivirus blocked or removed teabox.exe - check
  echo     Windows Security ^> Protection history.
  echo   - The Microsoft Visual C++ Redistributable ^(x64^) isn't installed.
)

echo.
echo To run Teabox again later, just double-click teabox.exe (or this file).
pause
