#requires -Version 5.1
<#
.SYNOPSIS
  Cold-start orchestrator for the SKKU 2.5D Navigation full stack.

.DESCRIPTION
  Steps:
    1. Bring up Docker Postgres+PostGIS (skku_nav_db)
    2. Ensure psycopg2-binary is installed
    3. Seed the DB via scripts/seed.py (wraps backend's import_to_db.py)
    4. Start Spring Boot (gradlew bootRun) as a background job
    5. Smoke-test /api/nodes + /api/graph
    6. Run npm dev server in foreground

.PARAMETER BackendPath
  Path to the SKKU-2.5D-Navigation repo. Defaults to ..\..\SKKU-2.5D-Navigation
  relative to this script. Override via $env:SKKU_BACKEND_DIR or this flag.

.PARAMETER SkipSeed
  Skip the seed step.

.PARAMETER NoFrontend
  Bring backend up only; do not run the Webpack dev server.

.PARAMETER StopDocker
  Run `docker compose down` on exit. Default leaves the DB up so reruns are fast.
#>
[CmdletBinding()]
param(
  [string]$BackendPath = $env:SKKU_BACKEND_DIR,
  [switch]$SkipSeed,
  [switch]$NoFrontend,
  [switch]$StopDocker
)

$ErrorActionPreference = 'Stop'
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$FrontendRoot = Split-Path -Parent $ScriptRoot

if (-not $BackendPath) {
  $candidate = Join-Path $FrontendRoot '..\..\SKKU-2.5D-Navigation'
  $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
  if ($resolved) { $BackendPath = $resolved.Path }
}
if (-not $BackendPath -or -not (Test-Path $BackendPath)) {
  Write-Error "Backend path not found. Pass -BackendPath or set `$env:SKKU_BACKEND_DIR."
  exit 1
}
$BackendPath = (Resolve-Path $BackendPath).Path

$Gradle = Join-Path $BackendPath 'gradlew.bat'
$Compose = Join-Path $BackendPath 'docker-compose.yaml'
if (-not (Test-Path $Gradle))  { Write-Error "gradlew.bat not found at $Gradle"; exit 1 }
if (-not (Test-Path $Compose)) { Write-Error "docker-compose.yaml not found at $Compose"; exit 1 }

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ---- Step 1: Docker DB up ----
Write-Step 'Docker: bringing up PostgreSQL/PostGIS'
Push-Location $BackendPath
try {
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed' }

  Write-Host 'Waiting for skku_nav_db to be healthy...'
  $deadline = (Get-Date).AddSeconds(60)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    $line = docker compose ps 2>$null | Select-String -Pattern 'db' -SimpleMatch | Select-Object -First 1
    if ($line -and ($line.ToString() -match 'healthy|running|Up')) { $healthy = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $healthy) { throw 'DB did not become healthy within 60s' }
  Write-Host 'DB is up.' -ForegroundColor Green
} finally {
  Pop-Location
}

# ---- Step 2 + 3: Seed ----
if (-not $SkipSeed) {
  Write-Step 'Seed: ensuring psycopg2-binary'
  python -m pip show psycopg2-binary > $null 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing psycopg2-binary...'
    python -m pip install --quiet psycopg2-binary
    if ($LASTEXITCODE -ne 0) { throw 'pip install psycopg2-binary failed' }
  }

  Write-Step 'Seed: running scripts/seed.py'
  Push-Location $FrontendRoot
  try {
    python scripts/seed.py --backend $BackendPath --frontend $FrontendRoot
    if ($LASTEXITCODE -ne 0) { throw 'seed wrapper failed' }
  } finally {
    Pop-Location
  }
} else {
  Write-Step 'Seed: skipped (-SkipSeed)'
}

# ---- Step 4: Backend boot ----
Write-Step 'Backend: starting Spring Boot (gradlew bootRun)'
$backendJob = Start-Job -Name 'skku-backend' -ArgumentList $BackendPath -ScriptBlock {
  param($Path)
  Set-Location $Path
  & .\gradlew.bat bootRun 2>&1
}

Write-Host 'Polling http://localhost:8080/api/nodes ...'
$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:8080/api/nodes' -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  Start-Sleep -Seconds 3
}
if (-not $ready) {
  Write-Host '--- backend log (last 60 lines) ---' -ForegroundColor Yellow
  Receive-Job -Name 'skku-backend' -Keep | Select-Object -Last 60 | ForEach-Object { Write-Host $_ }
  Stop-Job -Name 'skku-backend' -ErrorAction SilentlyContinue
  Remove-Job -Name 'skku-backend' -ErrorAction SilentlyContinue
  Write-Error 'Backend did not respond on :8080 within 120s.'
  exit 1
}
Write-Host 'Backend is up.' -ForegroundColor Green

# ---- Step 5: Smoke test ----
Write-Step 'Smoke test: /api/nodes and /api/graph'
try {
  $nodes = Invoke-RestMethod 'http://localhost:8080/api/nodes'
  $graph = Invoke-RestMethod 'http://localhost:8080/api/graph'
  $nodeCount = @($nodes).Count
  $edgeCount = @($graph.edges).Count
  Write-Host "Seeded: $nodeCount nodes, $edgeCount edges" -ForegroundColor Green
  if ($nodeCount -eq 0 -or $edgeCount -eq 0) {
    throw 'Seed produced an empty graph; investigate seed.py output and Flyway logs.'
  }
} catch {
  Write-Error "Smoke test failed: $_"
  Stop-Job -Name 'skku-backend' -ErrorAction SilentlyContinue
  Remove-Job -Name 'skku-backend' -ErrorAction SilentlyContinue
  exit 1
}

# ---- Cleanup handler ----
$cleanup = {
  Write-Host "`nStopping backend..." -ForegroundColor Yellow
  Stop-Job -Name 'skku-backend' -ErrorAction SilentlyContinue
  Remove-Job -Name 'skku-backend' -ErrorAction SilentlyContinue
  if ($script:StopDocker) {
    Write-Host 'Stopping Docker stack...' -ForegroundColor Yellow
    Push-Location $script:BackendPath
    docker compose down
    Pop-Location
  }
}

# ---- Step 6: Frontend ----
if ($NoFrontend) {
  Write-Step 'Frontend: skipped (-NoFrontend)'
  Write-Host 'Backend is running. Press Ctrl+C to stop.'
  try {
    while ($true) { Start-Sleep -Seconds 5 }
  } finally {
    & $cleanup
  }
} else {
  Write-Step 'Frontend: npm run dev (Webpack on :8082)'
  Push-Location $FrontendRoot
  try {
    if (-not (Test-Path 'node_modules')) {
      Write-Host 'Installing npm dependencies...'
      npm install --silent
    }
    npm run dev
  } finally {
    Pop-Location
    & $cleanup
  }
}
