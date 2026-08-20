# ============================================================
# Publie le jeu sur GitHub Pages (https://vynsgignac.github.io/migration/) : ajoute tous les
# fichiers modifiés, commit, et pousse sur la branche master. Pages se redéploie automatiquement
# à chaque push — pas d'étape de build séparée, le site sert directement ces fichiers.
#
# Utilisation : clic droit sur publish-web.bat > "Ouvrir" (ou double-clic)
# (ou en ligne de commande : powershell -ExecutionPolicy Bypass -File publish-web.ps1)
# ============================================================

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Push-Location $root

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "git est introuvable dans le PATH." -ForegroundColor Red
  Pop-Location
  exit 1
}

Write-Host "1/3 Ajout des fichiers modifiés..." -ForegroundColor Cyan
git add -A

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "Rien à publier : aucun fichier modifié depuis le dernier envoi." -ForegroundColor Yellow
  Pop-Location
  exit 0
}

Write-Host "2/3 Commit..." -ForegroundColor Cyan
$date = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "Mise a jour du site - $date"

Write-Host "3/3 Envoi vers GitHub..." -ForegroundColor Cyan
git push

Write-Host ""
Write-Host "Publié : https://vynsgignac.github.io/migration/" -ForegroundColor Green
Write-Host "(le redéploiement de la page peut prendre une minute ou deux)" -ForegroundColor Green

Pop-Location
