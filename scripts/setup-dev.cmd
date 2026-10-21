@echo off
rem Runs setup-dev.ps1 without needing to change PowerShell's script policy first.
rem Usage: scripts\setup-dev.cmd [-Build]
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-dev.ps1" %*
exit /b %ERRORLEVEL%
