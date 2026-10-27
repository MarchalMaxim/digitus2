# One-time setup of the GitHub Actions deploy of the scan service (.github/workflows/scan-service.yml).
# The owner runs it once, with gcloud and gh signed in. It creates a deployer service account with the
# three roles a deploy needs, a Workload Identity pool and provider that trust GitHub's OIDC tokens for
# pushes to main of this repository only, and the two repository variables the workflow reads. It creates
# no key: the workflow authenticates keylessly. Safe to run again.
# Cost: everything here is free except Artifact Registry storage above 0.5 GB; one image of about 0.7 GB
# is about 0.03 USD a month.
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [string]$Region = 'europe-west4',
  [string]$Service = 'digitus2-scan',
  [string]$Repository = 'digitus2',
  [string]$GitHubRepo = 'MarchalMaxim/digitus2'
)
$ErrorActionPreference = 'Stop'

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

Invoke-Checked 'Enabling the APIs' {
  gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project $Project
}

$Deployer = "$Service-deploy@$Project.iam.gserviceaccount.com"
$RunAccount = "$Service-run@$Project.iam.gserviceaccount.com"
if (-not (Test-Native { gcloud iam service-accounts describe $Deployer --project $Project })) {
  Invoke-Checked 'Creating the deployer service account' {
    gcloud iam service-accounts create "$Service-deploy" --display-name 'digitus2 scan service deployer (GitHub Actions)' --project $Project
  }
}

# The roles, each as narrow as it can be: deploy revisions on the project, push to this repository only,
# and act as the run account only (the service runs as it, with no role of its own).
Invoke-Checked 'Granting Cloud Run Developer' {
  gcloud projects add-iam-policy-binding $Project --member "serviceAccount:$Deployer" --role roles/run.developer --condition None --quiet | Out-Null
}
Invoke-Checked 'Granting Artifact Registry Writer on the repository' {
  gcloud artifacts repositories add-iam-policy-binding $Repository --location $Region --project $Project --member "serviceAccount:$Deployer" --role roles/artifactregistry.writer --quiet | Out-Null
}
Invoke-Checked 'Granting Service Account User on the run account' {
  gcloud iam service-accounts add-iam-policy-binding $RunAccount --project $Project --member "serviceAccount:$Deployer" --role roles/iam.serviceAccountUser --quiet | Out-Null
}

if (-not (Test-Native { gcloud iam workload-identity-pools describe github --location global --project $Project })) {
  Invoke-Checked 'Creating the Workload Identity pool' {
    gcloud iam workload-identity-pools create github --location global --display-name 'GitHub Actions' --project $Project
  }
}
# Only tokens of pushes to main of this repository are accepted.
$Condition = "assertion.repository=='$GitHubRepo' && assertion.ref=='refs/heads/main'"
if (-not (Test-Native { gcloud iam workload-identity-pools providers describe github --workload-identity-pool github --location global --project $Project })) {
  Invoke-Checked 'Creating the OIDC provider' {
    gcloud iam workload-identity-pools providers create-oidc github --workload-identity-pool github --location global --project $Project `
      --issuer-uri 'https://token.actions.githubusercontent.com' `
      --attribute-mapping 'google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref' `
      --attribute-condition $Condition
  }
}

$ProjectNumber = (& gcloud projects describe $Project --format 'value(projectNumber)')
if ($LASTEXITCODE -ne 0 -or -not $ProjectNumber) { throw 'Reading the project number failed' }
$ProjectNumber = "$ProjectNumber".Trim()
$Principal = "principalSet://iam.googleapis.com/projects/$ProjectNumber/locations/global/workloadIdentityPools/github/attribute.repository/$GitHubRepo"
Invoke-Checked 'Letting the repository act as the deployer' {
  gcloud iam service-accounts add-iam-policy-binding $Deployer --project $Project --role roles/iam.workloadIdentityUser --member $Principal --quiet | Out-Null
}

# Keep the most recent version of each image and the one tagged live (the image the serving revision
# runs, which a revision needs to start an instance), and delete the rest; Keep wins over Delete. The
# same policy deploy.ps1 sets.
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

$Provider = (& gcloud iam workload-identity-pools providers describe github --workload-identity-pool github --location global --project $Project --format 'value(name)')
if ($LASTEXITCODE -ne 0 -or -not $Provider) { throw 'Reading the provider name failed' }
$Provider = "$Provider".Trim()
Write-Host "SCAN_DEPLOY_PROVIDER = $Provider"
Write-Host "SCAN_DEPLOY_ACCOUNT  = $Deployer"

Invoke-Checked 'Setting SCAN_DEPLOY_PROVIDER' { gh variable set SCAN_DEPLOY_PROVIDER --repo $GitHubRepo --body $Provider }
Invoke-Checked 'Setting SCAN_DEPLOY_ACCOUNT' { gh variable set SCAN_DEPLOY_ACCOUNT --repo $GitHubRepo --body $Deployer }
Write-Host 'Done: the next merge to main that changes the service deploys it.'
