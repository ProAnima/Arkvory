@echo off
"%~dp0node.exe" "%~dp0depotctl.mjs" %*
exit /b %errorlevel%
