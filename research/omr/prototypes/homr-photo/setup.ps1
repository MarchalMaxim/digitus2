param([string]$Root = 'research/omr/results/photo-options/toolchain')
$ErrorActionPreference = 'Stop'
$Commit = 'ab369ac54277afab582afa4725441f7cbba76593'
$AbsoluteRoot = [IO.Path]::GetFullPath($Root)
New-Item -ItemType Directory -Force -Path "$AbsoluteRoot/downloads" | Out-Null
$Archive = "$AbsoluteRoot/downloads/homr-$Commit.zip"
$Url = "https://github.com/liebharc/homr/archive/$Commit.zip"
if (-not (Test-Path -LiteralPath $Archive)) { Invoke-WebRequest -Uri $Url -OutFile $Archive }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Archive).Hash -ne '23C81D6783C995866C256DBA403BFA374639AEB20DF64B738A0FC0034D160315') { throw 'Pinned source archive digest mismatch' }
if (-not (Test-Path -LiteralPath "$AbsoluteRoot/homr-$Commit")) { Expand-Archive -LiteralPath $Archive -DestinationPath $AbsoluteRoot }
$Python = "$AbsoluteRoot/venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $Python)) { python -m venv "$AbsoluteRoot/venv" }
& $Python -m pip --cache-dir "$AbsoluteRoot/pip-cache" install --only-binary=:all: -r "$PSScriptRoot/requirements-cpu.txt"
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }
& $Python -m pip freeze | Set-Content "$AbsoluteRoot/installed.txt"
Get-FileHash -Algorithm SHA256 -LiteralPath $Archive | ConvertTo-Json | Set-Content "$AbsoluteRoot/source-archive.json"
& $Python "$PSScriptRoot/prepare_patched.py" --toolchain $AbsoluteRoot --verify-pristine-only
if ($LASTEXITCODE -ne 0) { throw 'Pristine source validation failed' }
$env:PYTHONPATH = "$AbsoluteRoot/homr-$Commit"
& $Python -m homr.main --init --no-title --gpu no
if ($LASTEXITCODE -ne 0) { throw 'Model initialization failed' }
Get-ChildItem -LiteralPath "$AbsoluteRoot/homr-$Commit/homr" -Filter '*.onnx' -Recurse | Get-FileHash -Algorithm SHA256 | ConvertTo-Json | Set-Content "$AbsoluteRoot/models.json"

$ExpectedModels = @{
  'segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f.onnx' = '6ED36640DB4EF5D223098B6D5EFE4EDA97C66B24A2C72FAAB8A018C749003A8D'
  'encoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx' = '92BD18338DC8DA3C9B00185008AB14719FF9F912EFE785CA42D7B623E06E0C6B'
  'decoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx' = '18801C1E3657BDEA1B031DB90B10D66E15ACCFC1D607780F09A9E059133E886A'
}
Get-ChildItem -LiteralPath "$AbsoluteRoot/homr-$Commit/homr" -Filter '*.onnx' -Recurse | ForEach-Object {
  if ($ExpectedModels[$_.Name] -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash) { throw 'Pinned model digest mismatch' }
}

& $Python "$PSScriptRoot/prepare_patched.py" --toolchain $AbsoluteRoot
if ($LASTEXITCODE -ne 0) { throw 'Combined source patch validation failed' }

