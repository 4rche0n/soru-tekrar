# Uygulamayı http://localhost:8765 adresinde yayınlar (PowerShell, kurulum gerektirmez).
# Kullanım: sağ tık > "PowerShell ile çalıştır"  ya da:  powershell -ExecutionPolicy Bypass -File sunucu.ps1
param([int]$Port = 8765, [string]$Root = $PSScriptRoot, [string]$Extra = '')
$mime = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.png' = 'image/png'; '.pdf' = 'application/pdf'; '.webmanifest' = 'application/manifest+json'; '.svg' = 'image/svg+xml' }
$l = [System.Net.HttpListener]::new()
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Soru Tekrar calisiyor: http://localhost:$Port/  (kapatmak icin bu pencereyi kapat)"
if (-not $Extra) { Start-Process "http://localhost:$Port/" }
while ($l.IsListening) {
  $ctx = $l.GetContext()
  try {
    $p = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    $base = $Root
    if ($Extra -and $p.StartsWith('/t/')) { $base = $Extra; $p = $p.Substring(2) }
    if ($p -eq '/' -or $p -eq '') { $p = '/index.html' }
    $f = [IO.Path]::GetFullPath((Join-Path $base $p.TrimStart('/')))
    # kök klasörün dışına (ör. "app-yedek" gibi kardeş klasörlere) çıkılmasın: ayraçla birlikte, harf duyarsız karşılaştır
    $rootFull = [IO.Path]::GetFullPath($base).TrimEnd('\') + '\'
    if (-not $f.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $f -PathType Leaf)) { $ctx.Response.StatusCode = 404 }
    else {
      $b = [IO.File]::ReadAllBytes($f)
      $ext = [IO.Path]::GetExtension($f).ToLower()
      $ctx.Response.ContentType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
      $ctx.Response.OutputStream.Write($b, 0, $b.Length)
    }
  } catch {} finally { $ctx.Response.Close() }
}
