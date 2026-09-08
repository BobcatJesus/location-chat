$ErrorActionPreference = 'Stop'

$projectPorts = @(4000, 5173, 5174)
$connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $projectPorts -contains $_.LocalPort } |
  Select-Object -ExpandProperty OwningProcess -Unique

foreach ($processId in $connections) {
  if ($processId -and $processId -ne $PID) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'Starting one clean Side Quest development stack...'
npm run dev