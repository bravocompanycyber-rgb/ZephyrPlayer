<#
.SYNOPSIS
  Downloads the external tools ZephyrPlayer needs (they are too big for GitHub) and puts them in the right folders.

.DESCRIPTION
  Safe to run repeatedly: files that already exist are skipped unless you pass -Force.
  Everything comes from the official release pages (GitHub / 7-zip.org / gyan.dev / huggingface.co). No accounts, no API keys.

.PARAMETER Force          Re-download and overwrite tools that already exist (use this to update them).
.PARAMETER Whisper        Also install whisper-cli + DLLs (local AI subtitles).
.PARAMETER WhisperModel   Also download a Whisper model (default: base, ~140 MB). Implies -Whisper.
.PARAMETER ModelName      Whisper model: tiny, base, small, medium (default base).
.PARAMETER SkipFfmpeg     Do not install ffmpeg/ffprobe.
.PARAMETER Npm            Also run "npm install" if node_modules is missing.
.PARAMETER NoGitignore    Do not touch .gitignore.
.PARAMETER DryRun         Only print what would be downloaded; change nothing.

.EXAMPLE
  .\setup-tools.ps1                      # mpv, yt-dlp, deno, ffmpeg, ffprobe
  .\setup-tools.ps1 -Whisper -WhisperModel -Npm
  .\setup-tools.ps1 -Force               # update everything
  .\setup-tools.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$Whisper,
  [switch]$WhisperModel,
  [string]$ModelName = 'base',
  [switch]$SkipFfmpeg,
  [switch]$Npm,
  [switch]$NoGitignore,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest 10x slower
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch {}

$Root = $PSScriptRoot
if ([string]::IsNullOrEmpty($Root)) { $Root = (Get-Location).Path }
if ($WhisperModel) { $Whisper = $true }
if ($ModelName -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid -ModelName '$ModelName'" }

$Tmp = Join-Path $env:TEMP ('zephyr-setup-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$Results = New-Object System.Collections.ArrayList

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Step([string]$msg) { Write-Host ''; Write-Host ('== ' + $msg) -ForegroundColor Cyan }
function Record([string]$name, [string]$status, [string]$note = '') {
  [void]$Results.Add([pscustomobject]@{ Tool = $name; Status = $status; Note = $note })
}

function Download([string]$url, [string]$dest) {
  $headers = @{ 'User-Agent' = 'ZephyrPlayer-setup' }
  for ($i = 1; $i -le 3; $i++) {
    try {
      Say ("   downloading " + $url)
      Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -Headers $headers
      if ((Get-Item $dest).Length -lt 50KB) { throw 'downloaded file is suspiciously small' }
      return
    } catch {
      if ($i -eq 3) { throw }
      Say ("   retry $i after error: " + $_.Exception.Message) 'Yellow'
      Start-Sleep -Seconds (2 * $i)
    }
  }
}

function Get-GitHubAsset([string]$repo, [string[]]$patterns) {
  $headers = @{ 'User-Agent' = 'ZephyrPlayer-setup'; 'Accept' = 'application/vnd.github+json' }
  $rel = Invoke-RestMethod -Uri ("https://api.github.com/repos/$repo/releases/latest") -Headers $headers
  foreach ($p in $patterns) {
    $a = $rel.assets | Where-Object { $_.name -match $p } | Select-Object -First 1
    if ($a) { return $a }
  }
  throw "No matching download found in the latest $repo release"
}

function Need([string]$path) { return ($Force -or -not (Test-Path $path)) }

function Find-File([string]$dir, [string]$name) {
  return (Get-ChildItem -Path $dir -Filter $name -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Copy-Safe([string]$src, [string]$dest) {
  $dir = Split-Path $dest -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  try { Copy-Item -LiteralPath $src -Destination $dest -Force }
  catch { throw ("Could not write " + $dest + " - close ZephyrPlayer/mpv and run again. (" + $_.Exception.Message + ")") }
}

function Run-Tool([string]$label, [scriptblock]$work) {
  try { & $work }
  catch {
    Say ("   FAILED: " + $_.Exception.Message) 'Red'
    Record $label 'FAILED' $_.Exception.Message
  }
}

New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
Say ("ZephyrPlayer tool setup  ->  " + $Root) 'White'
if ($DryRun) { Say 'DRY RUN: nothing will be downloaded or changed.' 'Yellow' }

try {

  # ------------------------------------------------------------------ yt-dlp
  Step 'yt-dlp (YouTube + other sites)'
  Run-Tool 'yt-dlp.exe' {
    $dest = Join-Path $Root 'yt-dlp.exe'
    if (-not (Need $dest)) { Say '   already present (skipped)'; Record 'yt-dlp.exe' 'present'; return }
    $url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    if ($DryRun) { Say ("   would download " + $url); Record 'yt-dlp.exe' 'dry-run'; return }
    $f = Join-Path $Tmp 'yt-dlp.exe'
    Download $url $f
    Copy-Safe $f $dest
    Record 'yt-dlp.exe' 'installed'
  }

  # ------------------------------------------------------------------ deno
  Step 'deno (JavaScript runtime yt-dlp needs for YouTube)'
  Run-Tool 'deno.exe' {
    $dest = Join-Path $Root 'deno.exe'
    if (-not (Need $dest)) { Say '   already present (skipped)'; Record 'deno.exe' 'present'; return }
    $url = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'
    if ($DryRun) { Say ("   would download " + $url); Record 'deno.exe' 'dry-run'; return }
    $zip = Join-Path $Tmp 'deno.zip'
    $dir = Join-Path $Tmp 'deno'
    Download $url $zip
    Expand-Archive -Path $zip -DestinationPath $dir -Force
    $exe = Find-File $dir 'deno.exe'
    if (-not $exe) { throw 'deno.exe not found inside the archive' }
    Copy-Safe $exe.FullName $dest
    Record 'deno.exe' 'installed'
  }

  # ------------------------------------------------------------------ mpv
  Step 'mpv (plays mkv / HEVC / everything)'
  Run-Tool 'mpv.exe' {
    $dest = Join-Path $Root 'mpv.exe'
    if (-not (Need $dest)) { Say '   already present (skipped)'; Record 'mpv.exe' 'present'; return }
    # shinchiro builds: plain x86_64 works on every PC (the "-v3" build needs a newer CPU with AVX2)
    $asset = Get-GitHubAsset 'shinchiro/mpv-winbuild-cmake' @('^mpv-x86_64-\d{8}-git-[0-9a-f]+\.7z$', '^mpv-x86_64-\d.*\.7z$')
    if ($DryRun) { Say ("   would download " + $asset.browser_download_url); Record 'mpv.exe' 'dry-run'; return }
    # .7z needs the tiny standalone 7-Zip extractor (PowerShell cannot open .7z by itself)
    $sevenZip = Join-Path $Tmp '7zr.exe'
    Download 'https://www.7-zip.org/a/7zr.exe' $sevenZip
    $arc = Join-Path $Tmp $asset.name
    $dir = Join-Path $Tmp 'mpv'
    Download $asset.browser_download_url $arc
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    & $sevenZip x $arc ("-o" + $dir) -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "7zr failed to extract the archive (exit $LASTEXITCODE)" }
    $exe = Find-File $dir 'mpv.exe'
    if (-not $exe) { throw 'mpv.exe not found inside the archive' }
    Copy-Safe $exe.FullName $dest
    foreach ($dll in @('d3dcompiler_43.dll', 'vulkan-1.dll')) {
      $d = Find-File $dir $dll
      $target = Join-Path $Root $dll
      if ($d -and -not (Test-Path $target)) { Copy-Safe $d.FullName $target }
    }
    Record 'mpv.exe' 'installed' $asset.name
  }

  # ------------------------------------------------------------------ ffmpeg + ffprobe
  if (-not $SkipFfmpeg) {
    Step 'ffmpeg + ffprobe (file info, poster frames, convert, record)'
    Run-Tool 'ffmpeg' {
      $ff = Join-Path $Root 'ffmpeg\ffmpeg.exe'
      $fp = Join-Path $Root 'ffmpeg\ffprobe.exe'
      if (-not ((Need $ff) -or (Need $fp))) { Say '   already present (skipped)'; Record 'ffmpeg + ffprobe' 'present'; return }
      $urls = @(
        'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
      )
      if ($DryRun) { Say ("   would download " + $urls[0] + "  (fallback: " + $urls[1] + ")"); Record 'ffmpeg + ffprobe' 'dry-run'; return }
      $zip = Join-Path $Tmp 'ffmpeg.zip'
      $ok = $false
      foreach ($u in $urls) {
        try { Download $u $zip; $ok = $true; break } catch { Say ("   source failed: " + $_.Exception.Message) 'Yellow' }
      }
      if (-not $ok) { throw 'All ffmpeg download sources failed' }
      $dir = Join-Path $Tmp 'ffmpeg'
      Expand-Archive -Path $zip -DestinationPath $dir -Force
      $a = Find-File $dir 'ffmpeg.exe'
      $b = Find-File $dir 'ffprobe.exe'
      if (-not $a -or -not $b) { throw 'ffmpeg.exe / ffprobe.exe not found inside the archive' }
      Copy-Safe $a.FullName $ff
      Copy-Safe $b.FullName $fp
      Record 'ffmpeg + ffprobe' 'installed'
    }
  }

  # ------------------------------------------------------------------ whisper (optional)
  if ($Whisper) {
    Step 'whisper.cpp (local AI subtitles)'
    Run-Tool 'whisper-cli.exe' {
      $dest = Join-Path $Root 'whisper-cli.exe'
      if (-not (Need $dest)) { Say '   already present (skipped)'; Record 'whisper-cli.exe' 'present'; return }
      $url = 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip'
      if ($DryRun) { Say ("   would download " + $url); Record 'whisper-cli.exe' 'dry-run'; return }
      $zip = Join-Path $Tmp 'whisper.zip'
      $dir = Join-Path $Tmp 'whisper'
      Download $url $zip
      Expand-Archive -Path $zip -DestinationPath $dir -Force
      $exe = Find-File $dir 'whisper-cli.exe'
      if (-not $exe) { throw 'whisper-cli.exe not found inside the archive (the release layout may have changed)' }
      Copy-Safe $exe.FullName $dest
      Get-ChildItem -Path $exe.DirectoryName -Filter '*.dll' -File | ForEach-Object { Copy-Safe $_.FullName (Join-Path $Root $_.Name) }
      Record 'whisper-cli.exe' 'installed' 'with DLLs'
    }

    if ($WhisperModel) {
      Run-Tool ("model ggml-$ModelName.bin") {
        $dest = Join-Path $Root ("models\ggml-$ModelName.bin")
        if (-not (Need $dest)) { Say '   model already present (skipped)'; Record "model $ModelName" 'present'; return }
        $url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$ModelName.bin"
        if ($DryRun) { Say ("   would download " + $url); Record "model $ModelName" 'dry-run'; return }
        $f = Join-Path $Tmp 'model.bin'
        Download $url $f
        Copy-Safe $f $dest
        Record "model $ModelName" 'installed'
      }
    }
  }

  # ------------------------------------------------------------------ npm
  if ($Npm) {
    Step 'npm install (Electron + dependencies)'
    Run-Tool 'npm install' {
      if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm not found - install Node.js LTS from https://nodejs.org first' }
      if ((Test-Path (Join-Path $Root 'node_modules')) -and -not $Force) { Say '   node_modules present (skipped)'; Record 'npm install' 'present'; return }
      if ($DryRun) { Say '   would run: npm install'; Record 'npm install' 'dry-run'; return }
      Push-Location $Root
      try { & npm install; if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" } } finally { Pop-Location }
      Record 'npm install' 'installed'
    }
  }

  # ------------------------------------------------------------------ .gitignore
  if (-not $NoGitignore -and -not $DryRun) {
    Step '.gitignore (keep big binaries out of GitHub)'
    Run-Tool '.gitignore' {
      $gi = Join-Path $Root '.gitignore'
      $want = @('*.exe', '*.dll', 'ffmpeg/', 'models/', 'node_modules/', 'dist/', 'releases/')
      $have = @()
      if (Test-Path $gi) { $have = @(Get-Content $gi) }
      $missing = @($want | Where-Object { $have -notcontains $_ })
      if ($missing.Count -eq 0) { Say '   already up to date'; Record '.gitignore' 'present'; return }
      $block = @('', '# ZephyrPlayer external tools (run setup-tools.ps1 to fetch them)') + $missing
      Add-Content -Path $gi -Value $block
      Say ("   added: " + ($missing -join ', '))
      Record '.gitignore' 'updated'
    }
  }

  # ------------------------------------------------------------------ verify
  Step 'Verify'
  if (-not $DryRun) {
    $checks = @(
      @{ n = 'mpv';     p = (Join-Path $Root 'mpv.exe');            a = @('--version') },
      @{ n = 'yt-dlp';  p = (Join-Path $Root 'yt-dlp.exe');         a = @('--version') },
      @{ n = 'deno';    p = (Join-Path $Root 'deno.exe');           a = @('--version') },
      @{ n = 'ffmpeg';  p = (Join-Path $Root 'ffmpeg\ffmpeg.exe');  a = @('-version') },
      @{ n = 'ffprobe'; p = (Join-Path $Root 'ffmpeg\ffprobe.exe'); a = @('-version') }
    )
    foreach ($c in $checks) {
      if (-not (Test-Path $c.p)) { Say ("   {0,-8} MISSING" -f $c.n) 'Red'; continue }
      try {
        $v = (& $c.p $c.a 2>&1 | Select-Object -First 1)
        Say ("   {0,-8} OK   {1}" -f $c.n, $v) 'Green'
      } catch { Say ("   {0,-8} found but did not start: {1}" -f $c.n, $_.Exception.Message) 'Yellow' }
    }
    $w = Join-Path $Root 'whisper-cli.exe'
    if (Test-Path $w) { Say '   whisper  OK' 'Green' } else { Say '   whisper  not installed (optional: run with -Whisper -WhisperModel)' 'DarkGray' }
  }

  Write-Host ''
  $Results | Format-Table -AutoSize | Out-String | Write-Host
  $failed = @($Results | Where-Object { $_.Status -eq 'FAILED' })
  if ($failed.Count -gt 0) {
    Say 'Some downloads failed. Re-run the script (it only repeats what is missing), or download those files manually - see TOOLS.md.' 'Red'
    exit 1
  }
  Say 'All done. Start the app with:  npm start' 'Green'

} finally {
  try { if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue } } catch {}
}
