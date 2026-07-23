@echo off
rem Double-click entry point for the PSAT uninstaller.
rem
rem Removes the application and shortcuts. Projects and survey data are KEPT --
rem run uninstall_psat.ps1 -IncludeData if they should go too.
rem
rem Goes through cmd because PowerShell's execution policy blocks scripts by
rem default on many machines. -ExecutionPolicy Bypass applies to this process
rem only; nothing is changed system-wide and no admin rights are needed.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall_psat.ps1"
if errorlevel 1 pause
