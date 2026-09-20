@echo off
rem ---------------------------------------------------------------------
rem  Magpie - the collector browser for Karakeep.
rem
rem  Double-click it, or pin it to the taskbar. Builds first (fast), then
rem  launches the browser window and closes this console behind itself.
rem
rem  Any extra arguments are passed straight through, so the review harness
rem  still works:   Magpie.bat --shot=C:\temp\look.png
rem ---------------------------------------------------------------------
setlocal
cd /d "%~dp0"

set "ELECTRON=node_modules\electron\dist\electron.exe"
set "BUILDLOG=%TEMP%\magpie-build.log"

if not exist "%ELECTRON%" (
  echo Installing dependencies, this only happens once...
  call npm install || goto :installfailed
)

echo Building...
call npm run build >"%BUILDLOG%" 2>&1 || goto :buildfailed

rem Launched detached so the console does not sit on the taskbar all session.
rem If something goes wrong after this point, the tray menu's drop log is the
rem place to look.
start "" "%ELECTRON%" . --browser %*
exit /b 0

:installfailed
echo.
echo Could not install dependencies. Is Node installed and on PATH?
echo.
pause
exit /b 1

:buildfailed
echo.
echo Build failed. The output is below and in %BUILDLOG%
echo.
type "%BUILDLOG%"
echo.
pause
exit /b 1
