# Creates the monthly budget and the kill-switch function that unlinks billing when it is reached.
# Safe to run again: run it with -Simulate false once the published-message test passes (see the README).
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [Parameter(Mandatory = $true)][string]$BillingAccount,
  [decimal]$Amount = 10,
  [string]$Topic = 'digitus2-scan-budget',
  # A string so that `powershell -File budget.ps1 -Simulate $false` works too: -File passes text.
  [string]$Simulate = 'true'
)
$ErrorActionPreference = 'Stop'
$Region = 'europe-west4'
$Function = 'stop-billing'
$Budget = 'digitus2-scan'
$RepoRoot = [IO.Path]::GetFullPath("$PSScriptRoot/../../../..")
$Source = "$RepoRoot/research/omr/service/budget"
$Account = "$Function@$Project.iam.gserviceaccount.com"

switch ("$Simulate".Trim().TrimStart('$').ToLowerInvariant()) {
  { $_ -in 'true', '1' } { $SimulateValue = 'true' }
  { $_ -in 'false', '0' } { $SimulateValue = 'false' }
  default { throw "-Simulate must be true or false, not '$Simulate'" }
}
$AmountText = $Amount.ToString([Globalization.CultureInfo]::InvariantCulture)

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
  gcloud services enable cloudbilling.googleapis.com billingbudgets.googleapis.com pubsub.googleapis.com `
    cloudfunctions.googleapis.com cloudbuild.googleapis.com eventarc.googleapis.com run.googleapis.com `
    artifactregistry.googleapis.com iam.googleapis.com --project $Project
}

if (-not (Test-Native { gcloud pubsub topics describe $Topic --project $Project })) {
  Invoke-Checked 'Creating the topic' { gcloud pubsub topics create $Topic --project $Project }
}

# The function runs as its own service account, so the billing role never reaches the Compute Engine
# default account or the account the public scan service runs as.
if (-not (Test-Native { gcloud iam service-accounts describe $Account --project $Project })) {
  Invoke-Checked 'Creating the function service account' {
    gcloud iam service-accounts create $Function --display-name 'digitus2 billing kill-switch' --project $Project
  }
}
# On the project: log writer for its Cloud Logging entry; Browser (resourcemanager.projects.get) to read
# the billing state; Project Billing Manager to unlink. Without an organization, the billing account
# role below does not reach the project, so these are needed too (Google: billing/docs/how-to/modify-project).
foreach ($Role in 'roles/logging.logWriter', 'roles/browser', 'roles/billing.projectManager') {
  Invoke-Checked "Granting the function $Role" {
    gcloud projects add-iam-policy-binding $Project --member "serviceAccount:$Account" --role $Role --condition=None --quiet
  }
}

Invoke-Checked 'Deploying the function' {
  gcloud functions deploy $Function --gen2 --runtime python312 --region $Region --source $Source `
    --entry-point stop_billing --trigger-topic $Topic --set-env-vars "SIMULATE=$SimulateValue" `
    --service-account $Account --project $Project --quiet
}

# The Pub/Sub trigger calls the function as the same account; without this binding every call is
# refused as unauthenticated and the kill-switch never runs.
Invoke-Checked 'Letting the trigger invoke the function' {
  gcloud run services add-iam-policy-binding $Function --region $Region --project $Project `
    --member "serviceAccount:$Account" --role roles/run.invoker --quiet
}

# As Google's guide does: the function's service account becomes Billing Account Administrator.
$FunctionAccount = (& gcloud functions describe $Function --region $Region --project $Project --format 'value(serviceConfig.serviceAccountEmail)')
if ($LASTEXITCODE -ne 0 -or -not $FunctionAccount) { throw "Reading the function's service account failed" }
$FunctionAccount = "$FunctionAccount".Trim()
Invoke-Checked 'Granting the function billing access' {
  gcloud billing accounts add-iam-policy-binding $BillingAccount --member "serviceAccount:$FunctionAccount" --role roles/billing.admin --billing-project $Project
}

$TopicName = "projects/$Project/topics/$Topic"
$Existing = (& gcloud billing budgets list --billing-account $BillingAccount --filter "displayName=$Budget" --format 'value(name)' --billing-project $Project)
if ($LASTEXITCODE -ne 0) { throw 'Listing the budgets failed' }
$Existing = @($Existing | Where-Object { $_ })
if ($Existing.Count -gt 1) { throw "More than one budget is named $Budget; delete the extra ones in the console" }
if ($Existing.Count -eq 1) {
  Invoke-Checked 'Updating the budget' {
    gcloud billing budgets update $Existing[0] --budget-amount $AmountText --filter-projects "projects/$Project" `
      --notifications-rule-pubsub-topic $TopicName --billing-project $Project
  }
} else {
  Invoke-Checked 'Creating the budget' {
    gcloud billing budgets create --billing-account $BillingAccount --display-name $Budget --budget-amount $AmountText `
      --filter-projects "projects/$Project" --threshold-rule percent=0.5 --threshold-rule percent=0.9 `
      --threshold-rule percent=1.0 --notifications-rule-pubsub-topic $TopicName --billing-project $Project
  }
}

Write-Host "Budget $Budget at $AmountText a month; the function runs with SIMULATE=$SimulateValue."
# The quoting the test message needs differs by shell: Windows PowerShell 5.1 strips plain double
# quotes on the way to gcloud's Python, PowerShell 7.3+ passes them intact and keeps backslashes literally.
Write-Host 'Test it with a message over the budget; use the line for your shell:'
Write-Host "  Windows PowerShell 5.1:  gcloud pubsub topics publish $Topic --project $Project --message '{\`"costAmount\`": 6, \`"budgetAmount\`": 5}'"
Write-Host "  PowerShell 7.3+, Git Bash:  gcloud pubsub topics publish $Topic --project $Project --message '{`"costAmount`": 6, `"budgetAmount`": 5}'"
Write-Host 'Then read the function log. The test passes when it shows "Getting billing info" and "simulation: nothing was changed" and no ERROR line:'
Write-Host "  gcloud functions logs read $Function --gen2 --region $Region --project $Project --limit 20"
Write-Host "  or the console: Cloud Run functions, $Function, Logs"
