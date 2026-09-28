# PSK_RECRUTER — Canon/WIA local scanner agent
# Windows 10/11. The agent exposes localhost:8765 to the CRM.
# It uses Windows WIA so the installed Canon MF212w driver handles network scanning.
$ErrorActionPreference = 'Stop'
$Port = 8765
$Prefix = "http://127.0.0.1:$Port/"

function Send-Json($ctx, $status, $obj) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = 'application/json; charset=utf-8'
  $ctx.Response.Headers.Add('Access-Control-Allow-Origin','*')
  $ctx.Response.Headers.Add('Access-Control-Allow-Methods','GET,POST,OPTIONS')
  $ctx.Response.Headers.Add('Access-Control-Allow-Headers','Content-Type')
  $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length)
  $ctx.Response.Close()
}

function Get-ScannedImageBase64 {
  $wia = New-Object -ComObject WIA.CommonDialog
  $img = $wia.ShowAcquireImage(1,0,4,'{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}', $false, $false)
  if ($null -eq $img) { throw 'Сканування скасовано.' }
  $temp = Join-Path $env:TEMP ("psk_scan_" + [guid]::NewGuid().ToString() + '.jpg')
  try {
    $img.SaveFile($temp)
    return [Convert]::ToBase64String([IO.File]::ReadAllBytes($temp))
  } finally {
    Remove-Item $temp -Force -ErrorAction SilentlyContinue
  }
}

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($Prefix)
$listener.Start()
Write-Host "PSK Scanner Agent running at $Prefix"
Write-Host "Canon MF212w must be installed as a Windows WIA scanner."

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    if ($ctx.Request.HttpMethod -eq 'OPTIONS') {
      $ctx.Response.StatusCode = 204
      $ctx.Response.Headers.Add('Access-Control-Allow-Origin','*')
      $ctx.Response.Headers.Add('Access-Control-Allow-Methods','GET,POST,OPTIONS')
      $ctx.Response.Headers.Add('Access-Control-Allow-Headers','Content-Type')
      $ctx.Response.Close(); continue
    }
    if ($ctx.Request.HttpMethod -eq 'GET' -and $ctx.Request.Url.AbsolutePath -eq '/health') {
      Send-Json $ctx 200 @{ ok=$true; agent='PSK Scanner Agent'; port=$Port }; continue
    }
    if ($ctx.Request.HttpMethod -eq 'POST' -and $ctx.Request.Url.AbsolutePath -eq '/scan') {
      try {
        $base64 = Get-ScannedImageBase64
        Send-Json $ctx 200 @{ ok=$true; mime='image/jpeg'; fileName=('scan_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.jpg'); data=$base64 }
      } catch { Send-Json $ctx 400 @{ ok=$false; error=$_.Exception.Message } }
      continue
    }
    Send-Json $ctx 404 @{ ok=$false; error='Not found' }
  } catch { Write-Warning $_.Exception.Message }
}
