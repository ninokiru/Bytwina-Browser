# Builds brand assets from the original logo (Mark.png, transparent background).
# - public/brand-mark.png : trimmed mark used by the toolbar/terms UI.
# - src-tauri/icons/icon.ico : app/installer icon; white rounded tile behind the
#   black mark so it stays readable on the dark Windows taskbar.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-brand-assets.ps1
# Requires Windows PowerShell 5.1 (System.Drawing). Keep this file ASCII-only.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$desktop = [Environment]::GetFolderPath("Desktop")
$logoDir = Get-ChildItem -LiteralPath $desktop -Directory | Where-Object { $_.Name -like "Bytwina Logo*" } | Select-Object -First 1
if (-not $logoDir) { throw "Logo folder not found on Desktop (expected 'Bytwina Logo ...')." }
$markPath = Join-Path $logoDir.FullName "Mark.png"
if (-not (Test-Path -LiteralPath $markPath)) { throw "Mark.png not found: $markPath" }

$root = Split-Path -Parent $PSScriptRoot
$publicDir = Join-Path $root "public"
$iconPath = Join-Path $root "src-tauri\icons\icon.ico"
New-Item -ItemType Directory -Force -Path $publicDir | Out-Null

function Get-AlphaBounds([System.Drawing.Bitmap]$bmp) {
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    $minX = $bmp.Width; $minY = $bmp.Height; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $bmp.Height; $y++) {
      $row = $y * $data.Stride
      for ($x = 0; $x -lt $bmp.Width; $x++) {
        $i = $row + $x * 4
        # The source mark sits on a flat white background, so "content" means
        # visible alpha AND not near-white. Otherwise the crop stays full-size.
        $visible = $bytes[$i + 3] -gt 8 -and ($bytes[$i] -lt 250 -or $bytes[$i + 1] -lt 250 -or $bytes[$i + 2] -lt 250)
        if ($visible) {
          if ($x -lt $minX) { $minX = $x }
          if ($x -gt $maxX) { $maxX = $x }
          if ($y -lt $minY) { $minY = $y }
          if ($y -gt $maxY) { $maxY = $y }
        }
      }
    }
  } finally {
    $bmp.UnlockBits($data)
  }
  if ($maxX -lt $minX) { throw "Image is empty (no opaque pixels)." }
  return New-Object System.Drawing.Rectangle($minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1))
}

function New-RoundedPath([int]$size, [double]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $r = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $path.AddArc($r.X, $r.Y, $d, $d, 180, 90)
  $path.AddArc($r.Right - $d, $r.Y, $d, $d, 270, 90)
  $path.AddArc($r.Right - $d, $r.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($r.X, $r.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

$source = [System.Drawing.Bitmap]::FromFile($markPath)
try {
  $bounds = Get-AlphaBounds $source
  $trimmed = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $tg = [System.Drawing.Graphics]::FromImage($trimmed)
  $tg.DrawImage($source, (New-Object System.Drawing.Rectangle(0, 0, $bounds.Width, $bounds.Height)), $bounds, [System.Drawing.GraphicsUnit]::Pixel)
  $tg.Dispose()
  $trimmed.Save((Join-Path $publicDir "brand-mark.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $trimmed.Dispose()
  Write-Host ("Trimmed logo: {0}x{1}" -f $bounds.Width, $bounds.Height)
} finally {
  $source.Dispose()
}

# Multi-size ICO with embedded PNG frames (modern ICO layout).
$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$mark = [System.Drawing.Bitmap]::FromFile((Join-Path $publicDir "brand-mark.png"))
$images = @()
try {
  foreach ($size in $sizes) {
    $canvas = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $radius = [Math]::Max(3, $size * 0.22)
    $tile = New-RoundedPath $size $radius
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillPath($brush, $tile)
    $brush.Dispose()
    $tile.Dispose()

    $inner = $size * 0.72
    $ratio = [Math]::Min($inner / $mark.Width, $inner / $mark.Height)
    $w = [int][Math]::Round($mark.Width * $ratio)
    $h = [int][Math]::Round($mark.Height * $ratio)
    $x = [int][Math]::Round(($size - $w) / 2)
    $y = [int][Math]::Round(($size - $h) / 2)
    $dest = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
    $g.DrawImage($mark, $dest, (New-Object System.Drawing.Rectangle(0, 0, $mark.Width, $mark.Height)), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $canvas.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    $images += ,@($size, $ms.ToArray())
    $ms.Dispose()
  }
} finally {
  $mark.Dispose()
}

$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($img in $images) {
  $size = [int]$img[0]
  $len = $img[1].Length
  $dim = if ($size -ge 256) { 0 } else { $size }
  $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$len); $bw.Write([UInt32]$offset)
  $offset += $len
}
foreach ($img in $images) { $bw.Write([byte[]]$img[1]) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($iconPath, $out.ToArray())
$bw.Dispose(); $out.Dispose()
Write-Host ("Wrote {0} ({1} KB)" -f $iconPath, [Math]::Round((Get-Item -LiteralPath $iconPath).Length / 1KB, 1))
