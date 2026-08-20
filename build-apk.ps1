# ============================================================
# Reconstruit l'APK Android à partir des fichiers du jeu (index.html, manifest.json, sw.js, js/,
# icons/). À relancer à chaque fois que le jeu change et qu'il faut une nouvelle APK.
#
# Utilisation : clic droit > "Exécuter avec PowerShell"
# (ou en ligne de commande : powershell -ExecutionPolicy Bypass -File build-apk.ps1)
#
# Prérequis déjà en place sur ce poste : Node.js, JDK 17 (Temurin), SDK Android dans C:\Android\Sdk.
# ============================================================

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Node.js n'est pas forcément dans le PATH de toutes les sessions PowerShell.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $env:PATH = "$env:PATH;C:\Program Files\nodejs"
}
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17"
$env:ANDROID_HOME = "C:\Android\Sdk"

Write-Host "1/3 Copie des fichiers du jeu dans www/..." -ForegroundColor Cyan
$www = Join-Path $root "www"
if (Test-Path $www) { Remove-Item $www -Recurse -Force }
New-Item -ItemType Directory -Path $www | Out-Null
Copy-Item "$root\index.html" $www
Copy-Item "$root\manifest.json" $www
Copy-Item "$root\sw.js" $www
Copy-Item "$root\js" "$www\js" -Recurse
Copy-Item "$root\icons" "$www\icons" -Recurse

Write-Host "2/3 Synchronisation du projet Android (Capacitor)..." -ForegroundColor Cyan
Push-Location $root
npx cap sync android
Pop-Location

Write-Host "3/3 Compilation de l'APK debug (Gradle)..." -ForegroundColor Cyan
Push-Location "$root\android"
.\gradlew.bat assembleDebug
Pop-Location

$apk = "$root\android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apk) {
  $dest = "$root\Migration-debug.apk"
  Copy-Item $apk $dest -Force
  Write-Host ""
  Write-Host "APK prête : $dest" -ForegroundColor Green
} else {
  Write-Host "APK introuvable, la compilation a probablement échoué (voir les messages ci-dessus)." -ForegroundColor Red
}
