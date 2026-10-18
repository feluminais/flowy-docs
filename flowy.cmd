@echo off
rem Starts Flowy Docs on the repo you are standing in. Takes the same flags as `npx flowy-docs`.
rem Builds on first run. After a git pull, delete dist\ to rebuild.
if not exist "%~dp0dist\cli.js" (
  call npm --prefix "%~dp0." install && call npm --prefix "%~dp0." run build
  if errorlevel 1 exit /b 1
)
node "%~dp0dist\cli.js" %*
