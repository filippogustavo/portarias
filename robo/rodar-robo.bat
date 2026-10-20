@echo off
rem ==========================================================
rem  Robo de varredura de portarias do site do campus
rem  Executado pelo Agendador de Tarefas do Windows.
rem  O resultado de cada execucao fica em robo\robo.log
rem ==========================================================
cd /d "%~dp0.."
set "LOG=robo\robo.log"

echo.>> "%LOG%"
echo ===== %date% %time% =====>> "%LOG%"

if not exist "robo\credenciais.env" (
  echo ERRO: arquivo robo\credenciais.env nao encontrado.>> "%LOG%"
  exit /b 1
)

rem Mantem as dependencias em dia (rapido quando nada mudou)
call "C:\Program Files\nodejs\npm.cmd" install --no-audit --no-fund --silent >> "%LOG%" 2>&1

"C:\Program Files\nodejs\node.exe" --env-file=robo\credenciais.env robo\varrer-portarias.js >> "%LOG%" 2>&1
