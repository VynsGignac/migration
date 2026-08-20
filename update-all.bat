@echo off
REM Enchaine les deux etapes : reconstruit l'APK (build-apk.ps1) puis publie le site
REM (publish-web.ps1). Chacune tourne dans son propre processus PowerShell (pas juste appelee
REM depuis celui-ci) : sinon un "exit" a l'interieur de l'une fermerait tout ce script d'un coup
REM au lieu de passer proprement a l'etape suivante.

echo === 1/2 : APK Android ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1"
if errorlevel 1 goto :error

echo.
echo === 2/2 : Site web ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-web.ps1"
if errorlevel 1 goto :error

echo.
echo Tout est a jour.
goto :end

:error
echo.
echo Une etape a echoue, voir les messages ci-dessus.

:end
echo.
pause
