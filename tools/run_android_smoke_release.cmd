@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_ROOT=%%~fI"
cd /d "%REPO_ROOT%"
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%\scripts\android-release-smoke.ps1"
