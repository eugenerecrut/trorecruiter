# Run once as Administrator.
# Installs a Scheduled Task that starts the PSK Scanner Agent at user logon.
$agent = Join-Path $PSScriptRoot 'PSK-Scanner-Agent.ps1'
$taskName = 'PSK_RECRUTER Scanner Agent'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $agent + '"')
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description 'PSK_RECRUTER local Canon MF212w WIA scanner bridge' | Out-Null
Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$agent
Write-Host 'PSK Scanner Agent installed and started.'
Write-Host 'Health check: http://127.0.0.1:8765/health'
