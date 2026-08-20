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

Write-Host "1/4 Ajout des fichiers modifiés..." -ForegroundColor Cyan
git add -A

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "Rien à publier : aucun fichier modifié depuis le dernier envoi." -ForegroundColor Yellow
  Pop-Location
  exit 0
}

# Fait ici, PAS avant le check ci-dessus (sinon sw.js "changerait" à chaque lancement même sans
# rien de neuf, et "Rien à publier" ne se déclencherait plus jamais). Le service worker sert le
# jeu en cache-d'abord (voir sw.js) : sans ce changement de CACHE_NAME à CHAQUE vraie publication,
# les navigateurs qui ont déjà visité le site continuent de servir l'ancienne version indéfiniment
# — vécu une fois pour de vrai (plusieurs mises à jour de suite invisibles sur le site), ne plus
# jamais l'oublier en le rendant automatique plutôt que manuel.
Write-Host "2/4 Invalidation du cache hors-ligne (sw.js)..." -ForegroundColor Cyan
$swPath = Join-Path $root "sw.js"
$sw = Get-Content $swPath -Raw
$version = Get-Date -Format "yyyyMMddHHmmss"
$sw = $sw -replace "const CACHE_NAME = '[^']*';", "const CACHE_NAME = 'migration-$version';"
Set-Content -Path $swPath -Value $sw -NoNewline -Encoding utf8
git add $swPath

Write-Host "3/4 Commit..." -ForegroundColor Cyan
$date = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "Mise a jour du site - $date"

Write-Host "4/4 Envoi vers GitHub..." -ForegroundColor Cyan
git push

Write-Host ""
Write-Host "Publié : https://vynsgignac.github.io/migration/" -ForegroundColor Green
Write-Host "(le redéploiement de la page peut prendre une minute ou deux)" -ForegroundColor Green

Pop-Location
