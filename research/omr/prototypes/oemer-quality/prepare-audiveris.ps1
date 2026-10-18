# Portable administrative extraction, never a product install (/i).
$ErrorActionPreference = 'Stop'
$repoRoot = (Get-Location).Path
if (-not (Test-Path 'apps/web/package.json')) { throw 'Run from repository root' }
$toolchainRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'research/omr/results/quality-wave/toolchain'))
# Windows PowerShell 5.1 has no [IO.Path]::GetRelativePath; compare full paths instead.
$rootPrefix = [IO.Path]::GetFullPath($repoRoot).TrimEnd('\') + '\'
if (-not $toolchainRoot.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe extraction target' }
New-Item -ItemType Directory -Force $toolchainRoot | Out-Null
$packagePath = Join-Path $toolchainRoot 'audiveris-5.11.0.msi'
$url = 'https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windowsConsole-x86_64.msi'
if (-not (Test-Path -LiteralPath $packagePath)) { Invoke-WebRequest $url -OutFile $packagePath }
if ((Get-FileHash -LiteralPath $packagePath).Hash -ne '5F1B4E96A12C53C7DA426814B76E599363C4181E291855996E0A6878DDA95F71') { throw 'MSI hash mismatch' }
$portableRoot = Join-Path $toolchainRoot 'portable'
if (Test-Path -LiteralPath $portableRoot) { throw 'Extraction exists; preserve it or use the existing runtime' }
New-Item -ItemType Directory $portableRoot | Out-Null
# Some Audiveris class files have 120-character paths; Windows Installer fails with 1603 when the
# full path passes 260 characters, so a deep checkout extracts through its 8.3 short path.
$extractTarget = $portableRoot
try { $extractTarget = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($portableRoot).ShortPath } catch { }
$extractProcess = Start-Process -FilePath 'msiexec.exe' -WindowStyle Hidden -Wait -PassThru -ArgumentList @('/a',('"' + $packagePath + '"'),'/qn',('TARGETDIR="' + $extractTarget + '"'))
if ($extractProcess.ExitCode -ne 0) {
  Remove-Item -LiteralPath $portableRoot -Recurse -Force
  throw "Administrative extraction failed: $($extractProcess.ExitCode). Move the repository to a shorter folder path if this persists."
}
if (-not (Test-Path (Join-Path $portableRoot 'Audiveris/runtime/bin/java.exe'))) { throw 'Missing portable Java runtime' }
Write-Output 'Prepared isolated runtime. Pass --runtime-root research/omr/results/quality-wave/toolchain to run-audiveris.py'
