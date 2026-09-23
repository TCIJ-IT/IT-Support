$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot 'cloudflare-push')
try {
 & npm.cmd ci --no-audit --no-fund
 if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }
 & node setup.mjs
 if ($LASTEXITCODE -ne 0) { throw 'Push setup failed' }
} finally { Pop-Location }
