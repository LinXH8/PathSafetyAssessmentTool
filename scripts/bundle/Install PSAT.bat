@echo off
rem Double-click entry point for the PSAT installer.
rem
rem Goes through cmd rather than running the .ps1 directly because PowerShell's
rem execution policy blocks scripts by default on many machines, and asking a
rem non-technical user to change a security setting is not acceptable.
rem -ExecutionPolicy Bypass applies to this process only; nothing is changed
rem system-wide, and no administrator rights are needed.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_psat.ps1"
if errorlevel 1 pause
