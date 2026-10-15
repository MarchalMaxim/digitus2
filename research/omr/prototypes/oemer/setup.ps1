# Run from repository root. Downloads remain ignored; no system installation.
$ErrorActionPreference = 'Stop'
$experimentRoot = Join-Path (Get-Location) 'research/omr/results/local-options'
$prototypeRoot = Join-Path (Get-Location) 'research/omr/prototypes/oemer'
if (-not (Test-Path 'apps/web/package.json')) { throw 'Run from repository root' }
New-Item -ItemType Directory -Force $experimentRoot | Out-Null
function Fetch-Checked($url, $path, $sha) {
    if (-not (Test-Path -LiteralPath $path)) { Invoke-WebRequest $url -OutFile $path }
    if ($sha -and (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $sha) { throw "Hash mismatch: $path" }
}
$revision = 'dbe2a933d630d0f74805d717960eb259473f5978'
Fetch-Checked "https://api.github.com/repos/BreezeWhite/oemer/git/trees/${revision}?recursive=1" (Join-Path $experimentRoot 'oemer-tree.json') $null
$tree = Get-Content (Join-Path $experimentRoot 'oemer-tree.json') -Raw | ConvertFrom-Json
if ($tree.sha -ne $revision) { throw 'Wrong source revision' }
if ($tree.tree | Where-Object { $_.mode -eq '120000' }) { throw 'Source symlinks require separate inspection' }
Fetch-Checked "https://api.github.com/repos/BreezeWhite/oemer/tarball/$revision" (Join-Path $experimentRoot 'oemer-source.tar.gz') '68C2E15412410894A48532C4E9DBAD91121F8D72AB4505304FA324A646C89C73'
$sourceRoot = Join-Path $experimentRoot 'source'
New-Item -ItemType Directory -Force $sourceRoot | Out-Null
$archive = Join-Path $experimentRoot 'oemer-source.tar.gz'
$entries = & tar -tzf $archive
if ($LASTEXITCODE -ne 0 -or ($entries | Where-Object { $_ -match '(^/|^[A-Za-z]:|(^|/)\.\.(/|$))' })) { throw 'Unsafe source archive paths' }
& tar -xzf $archive -C $sourceRoot --strip-components=1
if ($LASTEXITCODE -ne 0) { throw 'Source extraction failed' }
Fetch-Checked 'https://github.com/BreezeWhite/oemer/releases/download/checkpoints/1st_model.onnx' (Join-Path $experimentRoot '1st_model.onnx') '37512E858731096439746F60B377C049F07055B4A23EC6EB9A178CE92CFBA174'
Copy-Item (Join-Path $experimentRoot '1st_model.onnx') (Join-Path $sourceRoot 'oemer/checkpoints/unet_big/model.onnx')
Fetch-Checked 'https://github.com/BreezeWhite/oemer/releases/download/checkpoints/2nd_model.onnx' (Join-Path $sourceRoot 'oemer/checkpoints/seg_net/model.onnx') 'ED2E1A86EA75712EE6CDC740E96F7A36753543CF9BB980227C071C9256D9D82E'
Fetch-Checked 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.22.0.tgz' (Join-Path $experimentRoot 'onnxruntime-web-1.22.0.tgz') 'E293551F9D36D003E293D0F2937FEE7B3DFDCEF76D71D1449B55E2D4157C7AEA'
$ortRoot = Join-Path $experimentRoot 'ort-web'
New-Item -ItemType Directory -Force $ortRoot | Out-Null
& tar -xzf (Join-Path $experimentRoot 'onnxruntime-web-1.22.0.tgz') -C $ortRoot
if ($LASTEXITCODE -ne 0) { throw 'ORT extraction failed' }
foreach ($name in @('export-safe-svc.py','run-oemer-native.py','oemer-worker.mjs','index.html','run-browser-full.mjs','reconstruct-browser-full.py','render-output.mjs','static-server.mjs','check-model-shapes.mjs')) { Copy-Item (Join-Path $prototypeRoot $name) (Join-Path $experimentRoot $name) }
Set-Content (Join-Path $experimentRoot 'probe.html') '<!doctype html><title>Local OMR research</title>'
& python -c 'import sys; assert sys.version_info[:2] == (3,11), sys.version'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 is required' }
$venvRoot = Join-Path $experimentRoot '.venv'
if (-not (Test-Path (Join-Path $venvRoot 'Scripts/python.exe'))) { & python -m venv $venvRoot }
if ($LASTEXITCODE -ne 0) { throw 'Venv creation failed; Python 3.11 is required' }
$pythonPath = Join-Path $venvRoot 'Scripts/python.exe'
& $pythonPath -m pip install -r (Join-Path $prototypeRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
& $pythonPath (Join-Path $experimentRoot 'export-safe-svc.py')
if ($LASTEXITCODE -ne 0) { throw 'Safe classifier conversion failed' }
Write-Output 'Prepared. Run node research/omr/results/local-options/run-browser-full.mjs'
