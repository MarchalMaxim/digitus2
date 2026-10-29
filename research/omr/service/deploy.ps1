# Builds the scan service image, pushes it to Artifact Registry, deploys it to Cloud Run and smokes it.
# Safe to run again: it is also how the service comes back after Google removed it.
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [string]$Region = 'europe-west4',
  [string]$Service = 'digitus2-scan',
  [string]$Repository = 'digitus2',
  # The bucket opted-in devices' scans are kept in (setup-cases.ps1); '' keeps nothing.
  [string]$CasesBucket = 'digitus2-scan-cases'
)
$ErrorActionPreference = 'Stop'
$RepoRoot = [IO.Path]::GetFullPath("$PSScriptRoot/../../..")

function Invoke-Checked([string]$What, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

# True when the command exits 0; its output is discarded. Windows PowerShell turns redirected
# native stderr into a terminating error under 'Stop', so the probe runs under 'Continue'.
function Test-Native([scriptblock]$Command) {
  $ErrorActionPreference = 'Continue'
  & $Command 2>&1 | Out-Null
  return $LASTEXITCODE -eq 0
}

$Sha = (& git -C $RepoRoot rev-parse --short HEAD)
if ($LASTEXITCODE -ne 0 -or -not $Sha) { throw 'Reading the git commit failed' }
$Sha = "$Sha".Trim()
$Changes = (& git -C $RepoRoot status --porcelain -- research/omr)
if ($LASTEXITCODE -ne 0) { throw 'Reading the git status failed' }
if ($Changes) { $Sha = "$Sha-dirty" }
$Registry = "$Region-docker.pkg.dev"
$Image = "$Registry/$Project/$Repository/${Service}:$Sha"

Invoke-Checked 'Enabling the APIs' {
  gcloud services enable run.googleapis.com artifactregistry.googleapis.com --project $Project
}

if (-not (Test-Native { gcloud artifacts repositories describe $Repository --location $Region --project $Project })) {
  Invoke-Checked 'Creating the Artifact Registry repository' {
    gcloud artifacts repositories create $Repository --repository-format docker --location $Region --project $Project --description 'digitus2 scan service images'
  }
}

# The image the service serves now keeps the tag live, so the policy below keeps it; on the first
# deploy there is no service yet and nothing to tag.
if (Test-Native { gcloud run services describe $Service --region $Region --project $Project }) {
  $ServingImage = (& gcloud run services describe $Service --region $Region --project $Project --format 'value(spec.template.spec.containers[0].image)')
  if ($LASTEXITCODE -eq 0 -and $ServingImage) {
    $ServingImage = "$ServingImage".Trim()
    Invoke-Checked 'Tagging the serving image live' {
      gcloud artifacts docker tags add $ServingImage "$Registry/$Project/$Repository/${Service}:live" --quiet
    }
  }
}

# Keep the most recent version of each image and the one tagged live (the image the serving revision
# runs, which a revision needs to start an instance), and delete the rest; Keep wins over Delete.
$Policy = @'
[
  { "name": "keep-most-recent", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 1 } },
  { "name": "keep-live", "action": { "type": "Keep" }, "condition": { "tagState": "tagged", "tagPrefixes": ["live"] } },
  { "name": "delete-older", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }
]
'@
$PolicyFile = Join-Path ([IO.Path]::GetTempPath()) "digitus2-cleanup-policy-$PID.json"
[IO.File]::WriteAllText($PolicyFile, $Policy, (New-Object Text.UTF8Encoding($false)))
try {
  Invoke-Checked 'Setting the cleanup policy' {
    gcloud artifacts repositories set-cleanup-policies $Repository --location $Region --project $Project --policy $PolicyFile --no-dry-run
  }
} finally {
  Remove-Item -LiteralPath $PolicyFile -ErrorAction SilentlyContinue
}

# The service runs as its own account with no project role; its one grant, from setup-cases.ps1, is to
# create objects in the cases bucket. The Compute Engine default account, which
# Cloud Run would use otherwise, is Editor on a project without an organization: code reached through a
# recogniser could then take its token and reach the kill-switch or the budget.
$RunAccount = "$Service-run@$Project.iam.gserviceaccount.com"
if (-not (Test-Native { gcloud iam service-accounts describe $RunAccount --project $Project })) {
  Invoke-Checked 'Creating the service account the service runs as' {
    gcloud iam service-accounts create "$Service-run" --display-name 'digitus2 scan service (no roles)' --project $Project
  }
}

Invoke-Checked 'Configuring Docker for Artifact Registry' { gcloud auth configure-docker $Registry --quiet }
Invoke-Checked 'Building the image' {
  docker build -f "$RepoRoot/research/omr/service/Dockerfile" -t $Image "$RepoRoot/research/omr"
}
Invoke-Checked 'Pushing the image' { docker push $Image }

Invoke-Checked 'Deploying to Cloud Run' {
  # Cloud Run does not expose the 4 vCPU allotment through the cgroup or the affinity mask (the
  # service detected 9), so the thread budget is set explicitly to the vCPU count. --set-env-vars
  # replaces the whole list, so the cases bucket is named here too.
  gcloud run deploy $Service --image $Image --region $Region --project $Project `
    --cpu 4 --memory 8Gi --concurrency 4 --max-instances 1 --min-instances 0 --timeout 240 `
    --cpu-boost --execution-environment gen2 --allow-unauthenticated --ingress all --port 8080 `
    --set-env-vars "DIGITUS2_OMR_THREADS=4,DIGITUS2_CASES_BUCKET=$CasesBucket" --service-account $RunAccount --quiet
}

$Url = (& gcloud run services describe $Service --region $Region --project $Project --format 'value(status.url)')
if ($LASTEXITCODE -ne 0 -or -not $Url) { throw 'Reading the service URL failed' }
$Url = "$Url".Trim()
Write-Host "Service URL: $Url"
Write-Host "Image: $Image"

$SmokeArgs = @("$RepoRoot/research/omr/service/smoke.mjs", $Url)
$Pdf = Get-ChildItem -LiteralPath "$RepoRoot/research/omr/results/acceptance/fixtures-v1" -Filter '*.pdf' -Recurse -File -ErrorAction SilentlyContinue |
  Sort-Object FullName | Select-Object -First 1
if ($Pdf) { $SmokeArgs += @('--pdf', $Pdf.FullName) } else { Write-Host 'No PDF fixture under research/omr/results/acceptance/fixtures-v1: the PDF route was not smoked.' }
Invoke-Checked 'The smoke test' { node @SmokeArgs }
# The serving image keeps the tag live, so the cleanup policy never deletes it.
Invoke-Checked 'Tagging the image live' { gcloud artifacts docker tags add $Image "$Registry/$Project/$Repository/${Service}:live" --quiet }
