# Creates or updates the shared library's store (docs/shared-library.md): the Google Cloud project
# with no billing account, Firebase on it, the Firestore database in europe-west4, the index for the
# shelf, and this folder's rules. Needs only gcloud, signed in as the owner. Safe to run again; a
# second run only redeploys the rules.
#   pwsh -File library-store/setup.ps1   (PowerShell 7; Windows PowerShell 5 garbles the API calls)
param([string]$Project = 'digitus2-library')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Run([string[]]$arguments) {
  & gcloud @arguments
  if ($LASTEXITCODE -ne 0) { throw "gcloud $($arguments -join ' ') failed ($LASTEXITCODE)" }
}
function Api([string]$method, [string]$uri, $body) {
  $headers = @{ Authorization = "Bearer $(gcloud auth print-access-token)"; 'x-goog-user-project' = $Project }
  $json = if ($null -eq $body) { $null } else { $body | ConvertTo-Json -Depth 8 }
  try {
    Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $json
  } catch {
    throw "$method $uri failed: $($_.ErrorDetails.Message)"
  }
}

gcloud projects describe $Project --format='value(projectId)' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Run @('projects', 'create', $Project, '--name=digitus2 library') }

# The point of a project of its own: it must never have billing, so it cannot cost money.
$billing = gcloud billing projects describe $Project --format='value(billingEnabled)' 2>$null
if ($billing -eq 'True') { throw "$Project has billing enabled; unlink it before deploying." }

Run @('services', 'enable', 'firebase.googleapis.com', 'firestore.googleapis.com', 'firebaserules.googleapis.com', "--project=$Project")

$firebase = $null
try { $firebase = Api Get "https://firebase.googleapis.com/v1beta1/projects/$Project" $null } catch { }
if (-not $firebase -or -not $firebase.state) {
  Api Post "https://firebase.googleapis.com/v1beta1/projects/${Project}:addFirebase" @{} | Out-Null
}

$database = gcloud firestore databases list --project=$Project --format='value(name)' 2>$null
if (-not $database) { Run @('firestore', 'databases', 'create', '--location=europe-west4', "--project=$Project") }

# The shelf's query: status equal, newest first.
$indexes = gcloud firestore indexes composite list --project=$Project --format='value(name)' 2>$null
if (-not $indexes) {
  Run @('firestore', 'indexes', 'composite', 'create', '--collection-group=shared', '--query-scope=collection',
    '--field-config=field-path=status,order=ascending', '--field-config=field-path=created,order=descending',
    "--project=$Project", '--async')
}

# The rules: a new ruleset from firestore.rules, then the Firestore release pointed at it.
$source = Get-Content -Raw firestore.rules
$ruleset = Api Post "https://firebaserules.googleapis.com/v1/projects/$Project/rulesets" @{
  source = @{ files = @(@{ name = 'firestore.rules'; content = $source }) }
}
$release = "projects/$Project/releases/cloud.firestore"
try {
  Api Patch "https://firebaserules.googleapis.com/v1/$release" @{ release = @{ name = $release; rulesetName = $ruleset.name } } | Out-Null
} catch {
  Api Post "https://firebaserules.googleapis.com/v1/projects/$Project/releases" @{ name = $release; rulesetName = $ruleset.name } | Out-Null
}
Write-Host "Rules deployed ($($ruleset.name))."
Write-Host "Moderate at https://console.firebase.google.com/project/$Project/firestore/data"
