@echo off
rem Runs bump-version.ps1 without needing to change PowerShell's script policy first.
rem Usage: scripts\bump-version.cmd 0.1.7
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bump-version.ps1" %*
exit /b %ERRORLEVEL%
