@echo off
rem Stop the process listening on port 5174
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue; if ($c) { $c.OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force; Write-Host ('stopped PID ' + $_) } } else { Write-Host 'no server running' }"
