@echo off
setlocal
title SHEAL LAUNCHER - Servidor de desarrollo
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] No se encontro Node.js en este equipo.
  echo      Descargalo en: https://nodejs.org
  echo      Instala la version LTS y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo  Instalando dependencias por primera vez...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [!] Fallo la instalacion. Revisa tu conexion a internet.
    pause
    exit /b 1
  )
)

echo.
echo  Iniciando SHEAL LAUNCHER en http://localhost:8443
echo.
call npm run dev
pause
