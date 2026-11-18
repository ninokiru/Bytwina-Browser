# M6: đo RAM làm việc của Nova Browser sau một khoảng nghỉ.
# Cách dùng (PowerShell trên Windows):
#   pwsh scripts/bench.ps1 -Exe "C:\path\nova-browser.exe" -IdleSeconds 30
# Lưu ý: msedgewebview2 có thể được trình duyệt Edge/ứng dụng khác dùng chung,
# nên số đo WebView2 chỉ đáng tin khi đóng các ứng dụng WebView2 khác.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [int]$IdleSeconds = 30,
  [string]$Out = "bench-results.csv"
)
$ErrorActionPreference = "Stop"
$key = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
$webview = (Get-ItemProperty $key -ErrorAction SilentlyContinue).pv
$start = Get-Date
$proc = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds $IdleSeconds
$app = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
$wv = @(Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue)
$wvBytes = ($wv | Measure-Object -Property WorkingSet64 -Sum).Sum
[pscustomobject]@{
  Timestamp           = $start.ToString("s")
  WebView2Runtime     = $webview
  IdleSeconds         = $IdleSeconds
  AppWorkingSetMB     = if ($app) { [math]::Round($app.WorkingSet64 / 1MB, 1) } else { $null }
  WebView2WorkingSetMB = [math]::Round(([double]$wvBytes) / 1MB, 1)
  WebView2Processes   = $wv.Count
} | Export-Csv -Path $Out -Append -NoTypeInformation
Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue
Write-Host "Đã ghi $Out. Tiến trình WebView2 con có thể cần đóng thủ công."
