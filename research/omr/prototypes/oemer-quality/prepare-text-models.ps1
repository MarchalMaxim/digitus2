# Compatible legacy+LSTM English model for Audiveris, no system installation.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path 'apps/web/package.json')) { throw 'Run from repository root' }
$modelRoot = Join-Path (Get-Location) 'research/omr/results/quality-wave/text-models'
New-Item -ItemType Directory -Force $modelRoot | Out-Null
$modelPath = Join-Path $modelRoot 'eng.traineddata'
$commit = '4767ea922bcc460e70b87b1d303ebdfed0897da8'
if (-not (Test-Path -LiteralPath $modelPath)) {
    Invoke-WebRequest "https://raw.githubusercontent.com/tesseract-ocr/tessdata/$commit/eng.traineddata" -OutFile $modelPath
}
if ((Get-FileHash -LiteralPath $modelPath).Hash -ne 'DAA0C97D651C19FBA3B25E81317CD697E9908C8208090C94C3905381C23FC047') {
    throw 'English OCR model hash mismatch'
}
$licensePath = Join-Path $modelRoot 'LICENSE'
if (-not (Test-Path -LiteralPath $licensePath)) {
    Invoke-WebRequest "https://raw.githubusercontent.com/tesseract-ocr/tessdata/$commit/LICENSE" -OutFile $licensePath
}
Write-Output 'Pass --text-models research/omr/results/quality-wave/text-models; do not use LSTM-only tessdata_fast.'
