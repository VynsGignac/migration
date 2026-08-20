# ============================================================
# Petit serveur local pour tester le jeu sur d'autres appareils (téléphone, tablette...)
# du même réseau Wi-Fi que ce PC. Basé sur un socket TCP brut (pas HttpListener) pour ne
# jamais demander les droits administrateur.
#
# Utilisation : clic droit sur ce fichier > "Exécuter avec PowerShell"
# (ou en ligne de commande : powershell -ExecutionPolicy Bypass -File serve.ps1)
#
# Puis, sur ton téléphone (connecté au même Wi-Fi), ouvre dans le navigateur l'une des
# adresses affichées au lancement (http://<IP-de-ce-PC>:8123).
# ============================================================

param(
  [string]$Root = $PSScriptRoot,
  [int]$Port = 8123
)

$mime = @{
  ".html" = "text/html"; ".js" = "application/javascript"; ".css" = "text/css";
  ".json" = "application/json"; ".png" = "image/png"; ".jpg" = "image/jpeg";
  ".svg" = "image/svg+xml"; ".ico" = "image/x-icon";
}

$tcpListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
try {
  $tcpListener.Start()
} catch {
  Write-Host "Impossible de démarrer le serveur sur le port $Port (déjà utilisé ?)." -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}

$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.254\.'
} | Select-Object -ExpandProperty IPAddress

Write-Host "Serveur démarré. Sur ton téléphone (même Wi-Fi que ce PC), ouvre :"
foreach ($ip in $ips) { Write-Host "  http://${ip}:$Port" -ForegroundColor Yellow }
Write-Host "Sur ce PC : http://localhost:$Port"
Write-Host "Ctrl+C pour arrêter."
Write-Host ""

$rootFull = (Resolve-Path $Root).Path

while ($true) {
  $client = $tcpListener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $requestLine = $reader.ReadLine()
    while (($line = $reader.ReadLine()) -and $line -ne "") { } # consomme les en-têtes sans les utiliser

    $status = 200
    $body = [byte[]]@()
    $contentType = "text/plain"

    if ($requestLine -match '^GET\s+([^\s\?]+)') {
      $reqPath = [Uri]::UnescapeDataString($matches[1])
      if ($reqPath -eq "/") { $reqPath = "/index.html" }
      $relative = $reqPath.TrimStart("/") -replace '/', [System.IO.Path]::DirectorySeparatorChar
      $filePath = Join-Path $rootFull $relative

      # Empêche de sortir du dossier du jeu (ex: "/../../secret.txt")
      $resolved = $null
      if (Test-Path $filePath -PathType Leaf) { $resolved = (Resolve-Path $filePath).Path }

      if ($resolved -and $resolved.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        $ext = [System.IO.Path]::GetExtension($resolved)
        if ($mime.ContainsKey($ext)) { $contentType = $mime[$ext] } else { $contentType = "application/octet-stream" }
        $body = [System.IO.File]::ReadAllBytes($resolved)
      } else {
        $status = 404
        $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
      }
    } else {
      $status = 400
      $body = [System.Text.Encoding]::UTF8.GetBytes("Bad request")
    }

    $statusText = if ($status -eq 200) { "OK" } elseif ($status -eq 404) { "Not Found" } else { "Bad Request" }
    $headerText = "HTTP/1.1 $status $statusText`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($body, 0, $body.Length)
    $stream.Flush()
  } catch {
  } finally {
    $client.Close()
  }
}
