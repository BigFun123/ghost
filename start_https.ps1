param([string]$Controller = 'http://ghost-controller.local')
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'devserver/https-proxy.js') $Controller
exit $LASTEXITCODE
