$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$p = (& $adb -s 94a21c57 shell pidof com.financeme.app).Trim()
Write-Host "App PID: $p"
& $adb -s 94a21c57 forward tcp:9223 "localabstract:webview_devtools_remote_$p"
Start-Sleep -Milliseconds 500
node scratch/check_phone_and_web.js
