@echo off
"%~dp0node.exe" "%~dp0arkvoryctl.mjs" %*
exit /b %errorlevel%
