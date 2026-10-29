# Creates the private bucket the scan service keeps opted-in devices' scans in, as validation cases
# (issue 233, docs/scan-service.md). Run once from the owner's machine, with gcloud signed in, before
# the service is deployed with DIGITUS2_CASES_BUCKET; safe to run again. It does not deploy.
param(
  # The owner's Google account, given read access to the cases (for example you@gmail.com).
  [Parameter(Mandatory = $true)][string]$Reader,
  [string]$Project = 'digitus2-scan',
  [string]$Region = 'europe-west4',
  [string]$Bucket = 'digitus2-scan-cases',
  [string]$Service = 'digitus2-scan'
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

# The account the service runs as (deploy.ps1); it gets to create objects in this bucket and nothing else.
$RunAccount = "$Service-run@$Project.iam.gserviceaccount.com"

Invoke-Checked 'Enabling the Cloud Storage API' {
  gcloud services enable storage.googleapis.com --project $Project
}

if (-not (Test-Native { gcloud storage buckets describe "gs://$Bucket" --project $Project })) {
  Invoke-Checked 'Creating the bucket' {
    gcloud storage buckets create "gs://$Bucket" --project $Project --location $Region `
      --uniform-bucket-level-access --public-access-prevention --default-storage-class STANDARD
  }
}

# A case is deleted 365 days after it was kept.
$Lifecycle = '{ "rule": [ { "action": { "type": "Delete" }, "condition": { "age": 365 } } ] }'
$LifecycleFile = Join-Path ([IO.Path]::GetTempPath()) "digitus2-cases-lifecycle-$PID.json"
[IO.File]::WriteAllText($LifecycleFile, $Lifecycle, (New-Object Text.UTF8Encoding($false)))
try {
  # Repeated on every run, so a bucket created by hand also ends up with these settings.
  Invoke-Checked 'Setting uniform access, public access prevention and the 365-day lifecycle' {
    gcloud storage buckets update "gs://$Bucket" --project $Project `
      --uniform-bucket-level-access --public-access-prevention --lifecycle-file $LifecycleFile
  }
} finally {
  Remove-Item -LiteralPath $LifecycleFile -ErrorAction SilentlyContinue
}

# Create only: the service cannot read, list, replace or delete a case, so code reached through a
# recogniser that takes the account's token can add objects here and do nothing else.
Invoke-Checked 'Letting the service create cases' {
  gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --project $Project `
    --member "serviceAccount:$RunAccount" --role roles/storage.objectCreator
}
Invoke-Checked 'Letting the owner read cases' {
  gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --project $Project `
    --member "user:$Reader" --role roles/storage.objectViewer
}

Write-Host "Bucket: gs://$Bucket ($Region), cases deleted after 365 days"
Write-Host "Writer: $RunAccount (create only); reader: $Reader"
Write-Host "Copy the cases to the validation store with: gcloud storage rsync -r gs://$Bucket/cases `$env:DIGITUS2_SCAN_CASES"
