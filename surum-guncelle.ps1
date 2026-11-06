# sw.js içindeki VERSION değerini uygulama dosyalarının içeriğinden üretir.
# Her yayından önce çalıştırılmalı: dosyalardan biri değiştiyse sürüm değişir, iPad yeni sürümü eksiksiz indirir.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$sw = Join-Path $root 'sw.js'
$text = [IO.File]::ReadAllText($sw)
$m = [regex]::Match($text, "const SHELL = \[(.*?)\];", 'Singleline')
if (-not $m.Success) { throw 'sw.js içinde SHELL listesi bulunamadı' }
$files = [regex]::Matches($m.Groups[1].Value, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -ne './' }
$sha = [Security.Cryptography.SHA256]::Create()
$ms = New-Object IO.MemoryStream
foreach ($f in $files) {
  $p = Join-Path $root $f
  if (-not (Test-Path $p)) { throw "SHELL dosyası yok: $f" }
  $b = [IO.File]::ReadAllBytes($p); $ms.Write($b, 0, $b.Length)
}
$hash = ($sha.ComputeHash($ms.ToArray()) | ForEach-Object { $_.ToString('x2') }) -join ''
$ver = $hash.Substring(0, 12)
$new = [regex]::Replace($text, "const VERSION = '[^']*';", "const VERSION = '$ver';")
if ($new -ne $text) { [IO.File]::WriteAllText($sw, $new, [Text.UTF8Encoding]::new($false)) }
"VERSION = $ver"
