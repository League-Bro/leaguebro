@echo off
rem Bumps the version, commits and pushes it, and starts the release and website workflows.
rem Usage: release            (next patch version)
rem        release 0.2.0      (a specific version)
rem        release -Yes       (no question before pushing)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1" %*
exit /b %ERRORLEVEL%
