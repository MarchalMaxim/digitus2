# Portable administrative extraction, never a product install (/i).
$ErrorActionPreference = 'Stop'
$repoRoot = (Get-Location).Path
if (-not (Test-Path 'apps/web/package.json')) { throw 'Run from repository root' }
$toolchainRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'research/omr/results/quality-wave/toolchain'))
$relativeTarget = [IO.Path]::GetRelativePath($repoRoot, $toolchainRoot)
if ([IO.Path]::IsPathRooted($relativeTarget) -or $relativeTarget -eq '..' -or $relativeTarget.StartsWith('..\')) { throw 'Unsafe extraction target' }
New-Item -ItemType Directory -Force $toolchainRoot | Out-Null
$packagePath = Join-Path $toolchainRoot 'audiveris-5.11.0.msi'
$url = 'https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windowsConsole-x86_64.msi'
if (-not (Test-Path -LiteralPath $packagePath)) { Invoke-WebRequest $url -OutFile $packagePath }
if ((Get-FileHash -LiteralPath $packagePath).Hash -ne '5F1B4E96A12C53C7DA426814B76E599363C4181E291855996E0A6878DDA95F71') { throw 'MSI hash mismatch' }
$portableRoot = Join-Path $toolchainRoot 'portable'
if (Test-Path -LiteralPath $portableRoot) { throw 'Extraction exists; preserve it or use the existing runtime' }
New-Item -ItemType Directory $portableRoot | Out-Null
$extractProcess = Start-Process -FilePath 'msiexec.exe' -WindowStyle Hidden -Wait -PassThru -ArgumentList @('/a',('"' + $packagePath + '"'),'/qn',('TARGETDIR="' + $portableRoot + '"'))
if ($extractProcess.ExitCode -ne 0) { throw "Administrative extraction failed: $($extractProcess.ExitCode)" }
if (-not (Test-Path (Join-Path $portableRoot 'Audiveris/runtime/bin/java.exe'))) { throw 'Missing portable Java runtime' }
Write-Output 'Prepared isolated runtime. Pass --runtime-root research/omr/results/quality-wave/toolchain to run-audiveris.py'
