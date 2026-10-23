@echo off
rem Shortcut for scripts\bump-version.cmd, run from the project folder.
rem Usage: bump            (next patch version, e.g. 0.1.13 -> 0.1.14)
rem        bump 0.2.0      (a specific version)
call "%~dp0scripts\bump-version.cmd" %*
exit /b %ERRORLEVEL%
