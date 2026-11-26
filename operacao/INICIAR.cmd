@echo off
rem ============================================================
rem  Roleta Constelacao - inicia o servidor local e abre o totem
rem  Uso: INICIAR.cmd        (versao 2D)
rem       INICIAR.cmd 3d     (versao 3D)
rem ============================================================
setlocal
cd /d "%~dp0"
set PORTA=4173
set "PERFIL=%LOCALAPPDATA%\RoletaConstelacao\perfil-navegador"
set CAMINHO=
if /I "%~1"=="3d" set CAMINHO=3d/
set "URL=http://localhost:%PORTA%/%CAMINHO%"

if not exist "%~dp0site\index.html" (
  echo.
  echo  Pasta "site" nao encontrada ao lado do INICIAR.cmd.
  echo  Copie a pasta inteira do pacote ^(INICIAR.cmd, servir.ps1 e site^).
  pause
  exit /b 1
)

rem --- 1. servidor (so sobe se ainda nao estiver no ar) ---
call :no_ar
if not errorlevel 1 goto abrir

start "Roleta - servidor (nao feche)" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servir.ps1" -Pasta "%~dp0site" -Porta %PORTA%
call :esperar
if not errorlevel 1 goto abrir

rem Plano B automatico: servidor do Python, se existir
where python >nul 2>&1
if errorlevel 1 goto sem_servidor
echo  Servidor PowerShell nao respondeu. Tentando com Python...
start "Roleta - servidor Python (nao feche)" /min python -m http.server %PORTA% --bind 127.0.0.1 --directory "%~dp0site"
call :esperar
if not errorlevel 1 goto abrir

:sem_servidor
echo.
echo  Nenhum servidor respondeu em http://localhost:%PORTA%/
echo  Veja a janela minimizada "Roleta - servidor" para o motivo e chame o suporte.
pause
exit /b 1

:abrir
rem --- 2. navegador em tela cheia, com perfil proprio (os dados ficam nele) ---
set "NAV="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "NAV=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined NAV goto edge

start "" "%NAV%" --kiosk --user-data-dir="%PERFIL%" --no-first-run --no-default-browser-check --disable-pinch --overscroll-history-navigation=0 --disable-session-crashed-bubble --hide-crash-restore-bubble --noerrdialogs --disable-features=Translate --autoplay-policy=no-user-gesture-required "%URL%"
exit /b 0

:edge
rem Sem Chrome: Edge em TELA CHEIA com perfil proprio.
rem NUNCA usar "msedge --kiosk": ele roda em InPrivate e APAGA os dados da roleta ao fechar.
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
start "" "%EDGE%" --start-fullscreen --user-data-dir="%PERFIL%" --no-first-run --no-default-browser-check --disable-pinch --overscroll-history-navigation=0 --hide-crash-restore-bubble --disable-features=Translate --autoplay-policy=no-user-gesture-required "%URL%"
exit /b 0

:esperar
for /L %%i in (1,1,15) do (
  timeout /t 1 /nobreak >nul
  call :no_ar
  if not errorlevel 1 exit /b 0
)
exit /b 1

:no_ar
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:%PORTA%/' | Out-Null; exit 0 } catch { exit 1 }"
exit /b %errorlevel%
