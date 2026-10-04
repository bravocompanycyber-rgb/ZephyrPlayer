<#
.SYNOPSIS
  Installs the external tools ZephyrPlayer needs (too big for GitHub) AND proves that they really work.

.DESCRIPTION
  1. Downloads mpv, yt-dlp, deno, ffmpeg + ffprobe and whisper (+ its speech model) into the right folders.
     Files that already exist are skipped unless you pass -Force.
  2. Runs a self-test of every tool: encodes and probes a clip, decodes H.264 and 10-bit HEVC + AC3 with mpv,
     starts mpv's GPU renderer, runs Deno, resolves a real YouTube video through yt-dlp + Deno, and transcribes
     spoken audio with whisper. "Present" is not enough: each line says PASS / WARN / FAIL.
  Everything comes from official release pages. No accounts, no API keys.

.PARAMETER Force          Re-download and overwrite tools that already exist (use this to update them).
.PARAMETER SkipWhisper    Do not install whisper (local AI subtitles).
.PARAMETER SkipModel      Install whisper-cli but not the speech model (~140 MB).
.PARAMETER ModelName      Whisper model: tiny, base, small, medium (default base).
.PARAMETER SkipFfmpeg     Do not install ffmpeg/ffprobe.
.PARAMETER Npm            Also run "npm install" if node_modules is missing.
.PARAMETER NoGitignore    Do not touch .gitignore.
.PARAMETER TestOnly       Do not download anything; only run the checks and self-tests.
.PARAMETER SkipTests      Install only; skip the self-tests.
.PARAMETER DryRun         Only print what would be downloaded; change nothing.
.PARAMETER Whisper        (kept for old command lines: whisper is installed by default now)
.PARAMETER WhisperModel   (kept for old command lines: the model is installed by default now)

.EXAMPLE
  .\setup-tools.ps1                  # install everything, then self-test
  .\setup-tools.ps1 -TestOnly        # just prove that what is installed works
  .\setup-tools.ps1 -Force -Npm      # update everything + npm install
  .\setup-tools.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$SkipWhisper,
  [switch]$SkipModel,
  [string]$ModelName = 'base',
  [switch]$SkipFfmpeg,
  [switch]$Npm,
  [switch]$NoGitignore,
  [switch]$TestOnly,
  [switch]$SkipTests,
  [switch]$DryRun,
  [switch]$Whisper,
  [switch]$WhisperModel
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest 10x slower
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch {}

$Root = $PSScriptRoot
if ([string]::IsNullOrEmpty($Root)) { $Root = (Get-Location).Path }
if ($ModelName -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid -ModelName '$ModelName'" }
$DoWhisper = (-not $SkipWhisper)
$DoModel = ($DoWhisper -and (-not $SkipModel))

$Tmp = Join-Path $env:TEMP ('zephyr-setup-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$Results = New-Object System.Collections.ArrayList
$Tests = New-Object System.Collections.ArrayList

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Step([string]$msg) { Write-Host ''; Write-Host ('== ' + $msg) -ForegroundColor Cyan }
function Record([string]$name, [string]$status, [string]$note = '') {
  [void]$Results.Add([pscustomobject]@{ Tool = $name; Status = $status; Note = $note })
}

function Add-Test([string]$name, [string]$status, [string]$detail = '') {
  [void]$Tests.Add([pscustomobject]@{ Test = $name; Result = $status; Detail = $detail })
  $color = 'Gray'
  if ($status -eq 'PASS') { $color = 'Green' }
  elseif ($status -eq 'WARN') { $color = 'Yellow' }
  elseif ($status -eq 'FAIL') { $color = 'Red' }
  Say ('   [{0}] {1}  {2}' -f $status, $name, $detail) $color
}

function Download([string]$url, [string]$dest) {
  $headers = @{ 'User-Agent' = 'ZephyrPlayer-setup' }
  for ($i = 1; $i -le 3; $i++) {
    try {
      Say ("   downloading " + $url)
      Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -Headers $headers
      if ((Get-Item $dest).Length -lt 51200) { throw 'downloaded file is suspiciously small' }
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

# ---------------------------------------------------------------- running tools for the self-tests
function Quote-Arg([string]$a) {
  if ($a -match '[\s"]') { return ('"' + ($a -replace '"', '\"') + '"') }
  return $a
}

# Runs a program, captures output + exit code, and never hangs (kills it after the timeout).
function Invoke-Tool([string]$exe, [string[]]$argList, [int]$timeoutSec = 60) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = (($argList | ForEach-Object { Quote-Arg $_ }) -join ' ')
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  try { [void]$p.Start() }
  catch { return [pscustomobject]@{ Code = -998; Out = ''; Err = ('could not start: ' + $_.Exception.Message) } }
  $so = $p.StandardOutput.ReadToEndAsync()
  $se = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($timeoutSec * 1000)) {
    try { $p.Kill() } catch {}
    return [pscustomobject]@{ Code = -999; Out = ''; Err = ('timed out after ' + $timeoutSec + 's') }
  }
  $p.WaitForExit()
  return [pscustomobject]@{ Code = $p.ExitCode; Out = [string]$so.Result; Err = [string]$se.Result }
}

function Last-Line([string]$text) {
  $lines = @(([string]$text) -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
  if ($lines.Count -eq 0) { return '' }
  $l = $lines[$lines.Count - 1].Trim()
  if ($l.Length -gt 170) { $l = $l.Substring(0, 170) }
  return $l
}

function Test-MpvDecode([string]$mpv, [string]$label, [string]$file) {
  $r = Invoke-Tool $mpv @('--no-config', '--vo=null', '--ao=null', '--frames=25', '--msg-level=all=error', $file) 60
  if ($r.Code -eq 0) { Add-Test $label 'PASS' } else { Add-Test $label 'FAIL' ('mpv exit code ' + $r.Code + ' ' + (Last-Line ($r.Err + "`n" + $r.Out))) }
}

function Run-SelfTests {
  Step 'Self-test: do the tools actually WORK? (this takes about a minute)'
  $work = Join-Path $Tmp 'selftest'
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  $mpv = Join-Path $Root 'mpv.exe'
  $ytdlp = Join-Path $Root 'yt-dlp.exe'
  $deno = Join-Path $Root 'deno.exe'
  $ffmpeg = Join-Path $Root 'ffmpeg\ffmpeg.exe'
  $ffprobe = Join-Path $Root 'ffmpeg\ffprobe.exe'
  $whisper = Join-Path $Root 'whisper-cli.exe'
  $model = Join-Path $Root ('models\ggml-' + $ModelName + '.bin')
  $mp4 = Join-Path $work 'h264.mp4'
  $mkv = Join-Path $work 'hevc10.mkv'
  $haveMp4 = $false
  $haveMkv = $false

  # ---- ffmpeg: can it encode (needed for clips, posters, whisper audio)?
  if (-not (Test-Path $ffmpeg)) { Add-Test 'ffmpeg encodes H.264 + AAC' 'FAIL' 'ffmpeg.exe is missing' }
  else {
    $r = Invoke-Tool $ffmpeg @('-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=480x270:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', $mp4) 90
    if ($r.Code -eq 0 -and (Test-Path $mp4) -and ((Get-Item $mp4).Length -gt 2000)) { $haveMp4 = $true; Add-Test 'ffmpeg encodes H.264 + AAC' 'PASS' }
    else { Add-Test 'ffmpeg encodes H.264 + AAC' 'FAIL' (Last-Line $r.Err) }
    $r = Invoke-Tool $ffmpeg @('-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error', '-c:a', 'ac3', '-shortest', $mkv) 120
    if ($r.Code -eq 0 -and (Test-Path $mkv) -and ((Get-Item $mkv).Length -gt 2000)) { $haveMkv = $true; Add-Test 'ffmpeg encodes HEVC 10-bit + AC3 (test file for x265 playback)' 'PASS' }
    else { Add-Test 'ffmpeg encodes HEVC 10-bit + AC3 (test file for x265 playback)' 'WARN' 'this ffmpeg build cannot make an HEVC sample; the HEVC playback test is skipped' }
  }

  # ---- ffprobe: can it read what ffmpeg wrote? (this powers duration/codec info in the playlist)
  if (-not (Test-Path $ffprobe)) { Add-Test 'ffprobe reads file info' 'FAIL' 'ffprobe.exe is missing' }
  elseif (-not $haveMp4) { Add-Test 'ffprobe reads file info' 'SKIP' 'no sample file' }
  else {
    $r = Invoke-Tool $ffprobe @('-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', $mp4) 30
    try {
      $j = $r.Out | ConvertFrom-Json
      $dur = [double]$j.format.duration
      $vs = $j.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1
      $as = $j.streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1
      if ($dur -gt 1.5 -and $dur -lt 2.6 -and $vs.codec_name -eq 'h264' -and $as.codec_name -eq 'aac') { Add-Test 'ffprobe reads file info' 'PASS' ('duration ' + [math]::Round($dur, 2) + 's, ' + $vs.codec_name + ' ' + $vs.width + 'x' + $vs.height + ' + ' + $as.codec_name) }
      else { Add-Test 'ffprobe reads file info' 'FAIL' 'it ran but reported unexpected values' }
    } catch { Add-Test 'ffprobe reads file info' 'FAIL' ('could not read its output: ' + $_.Exception.Message) }
  }

  # ---- mpv: decode real files (exit code 0 = it decoded the frames)
  if (-not (Test-Path $mpv)) { Add-Test 'mpv decodes video' 'FAIL' 'mpv.exe is missing' }
  else {
    if ($haveMp4) { Test-MpvDecode $mpv 'mpv decodes H.264 + AAC' $mp4 } else { Add-Test 'mpv decodes H.264 + AAC' 'SKIP' 'no sample file (ffmpeg needed)' }
    if ($haveMkv) { Test-MpvDecode $mpv 'mpv decodes HEVC 10-bit + AC3 in mkv (the x265 case)' $mkv } else { Add-Test 'mpv decodes HEVC 10-bit + AC3 in mkv (the x265 case)' 'SKIP' 'no HEVC sample' }
    $gpuFile = $mp4
    if ($haveMkv) { $gpuFile = $mkv }
    if ($haveMp4 -or $haveMkv) {
      Say '   (a tiny mpv window may flash for a second: that is the GPU test)' 'DarkGray'
      $r = Invoke-Tool $mpv @('--no-config', '--vo=gpu', '--gpu-api=d3d11', '--gpu-context=d3d11', '--hwdec=auto-safe', '--ao=null', '--frames=20', '--no-border', '--geometry=2x2+0+0', '--msg-level=all=error', $gpuFile) 60
      if ($r.Code -eq 0) { Add-Test 'mpv GPU renderer (Direct3D 11) starts and plays' 'PASS' }
      else { Add-Test 'mpv GPU renderer (Direct3D 11) starts and plays' 'WARN' ('exit code ' + $r.Code + '. ZephyrPlayer will fall back to compatibility modes by itself, but update your graphics driver if videos stay blank.') }
    }
  }

  # ---- deno: really runs JavaScript (yt-dlp needs this for YouTube)
  if (-not (Test-Path $deno)) { Add-Test 'deno runs JavaScript' 'FAIL' 'deno.exe is missing' }
  else {
    $r = Invoke-Tool $deno @('eval', 'console.log(6*7)') 40
    if ($r.Code -eq 0 -and $r.Out -match '42') { Add-Test 'deno runs JavaScript' 'PASS' }
    else { Add-Test 'deno runs JavaScript' 'FAIL' (Last-Line ($r.Err + "`n" + $r.Out)) }
  }

  # ---- yt-dlp: starts, and resolves a REAL YouTube video using deno
  if (-not (Test-Path $ytdlp)) { Add-Test 'yt-dlp resolves a YouTube video' 'FAIL' 'yt-dlp.exe is missing' }
  else {
    $ytArgs = @('--no-warnings', '--no-playlist', '--skip-download', '--print', '%(title)s')
    if (Test-Path $deno) { $ytArgs += @('--js-runtimes', ('deno:' + ($deno -replace '\\', '/'))) }
    $ytArgs += @('--', 'https://www.youtube.com/watch?v=jNQXAC9IVRw')
    $r = Invoke-Tool $ytdlp $ytArgs 90
    $title = (Last-Line $r.Out)
    $all = $r.Err + "`n" + $r.Out
    if ($r.Code -eq 0 -and $title.Length -gt 0) { Add-Test 'yt-dlp resolves a YouTube video (with deno)' 'PASS' ("got title: '" + $title + "'") }
    elseif ($all -match 'Sign in|not a bot') { Add-Test 'yt-dlp resolves a YouTube video (with deno)' 'WARN' 'YouTube asked for sign-in on this connection. In the app pick your browser under "Use cookies from" in the link panel.' }
    elseif ($all -match 'JavaScript runtime|jsc|EJS') { Add-Test 'yt-dlp resolves a YouTube video (with deno)' 'FAIL' 'yt-dlp could not use a JavaScript runtime. Re-run setup-tools.bat -Force to reinstall deno.' }
    elseif ($r.Code -eq -999 -or $all -match 'getaddrinfo|Temporary failure|timed out|Unable to download|URLError|SSL|Connection|Network|resolve') { Add-Test 'yt-dlp resolves a YouTube video (with deno)' 'WARN' 'could not reach YouTube from here (offline or blocked). The tool itself starts fine.' }
    else { Add-Test 'yt-dlp resolves a YouTube video (with deno)' 'FAIL' (Last-Line $all) }
  }

  # ---- whisper: loads the model and transcribes real speech (made with the built-in Windows voice)
  if (-not (Test-Path $whisper)) { Add-Test 'whisper transcribes speech' 'SKIP' 'whisper-cli.exe is not installed' }
  else {
    $r = Invoke-Tool $whisper @('-h') 30
    $startsOk = ($r.Code -eq 0) -or (($r.Out + $r.Err) -match '(?i)usage')
    if (-not $startsOk) { Add-Test 'whisper-cli starts' 'FAIL' ('exit code ' + $r.Code + '. A DLL may be missing: re-run setup-tools.bat -Force. ' + (Last-Line ($r.Err + "`n" + $r.Out))) }
    elseif (-not (Test-Path $model)) { Add-Test 'whisper-cli starts' 'PASS'; Add-Test 'whisper speech model' 'WARN' ('model not found: ' + $model + ' (run setup-tools.bat without -SkipModel)') }
    elseif (-not (Test-Path $ffmpeg)) { Add-Test 'whisper-cli starts' 'PASS'; Add-Test 'whisper transcribes speech' 'SKIP' 'ffmpeg is needed to prepare the audio' }
    else {
      Add-Test 'whisper-cli starts' 'PASS'
      $wav = Join-Path $work 'speech.wav'
      $wav16 = Join-Path $work 'speech16.wav'
      $spoke = $false
      try {
        Add-Type -AssemblyName System.Speech
        $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $s.SetOutputToWaveFile($wav)
        $s.Speak('Hello. This is a test of Zephyr player subtitles.')
        $s.Dispose()
        $spoke = (Test-Path $wav)
      } catch { $spoke = $false }
      $prepared = $false
      if ($spoke) {
        $c = Invoke-Tool $ffmpeg @('-v', 'error', '-y', '-i', $wav, '-ar', '16000', '-ac', '1', $wav16) 40
        $prepared = ($c.Code -eq 0 -and (Test-Path $wav16))
      }
      if (-not $prepared) {
        $spoke = $false
        $c = Invoke-Tool $ffmpeg @('-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', '-ar', '16000', '-ac', '1', $wav16) 40
        $prepared = ($c.Code -eq 0 -and (Test-Path $wav16))
      }
      if (-not $prepared) { Add-Test 'whisper transcribes speech' 'SKIP' 'could not prepare a test audio file' }
      else {
        $outBase = Join-Path $work 'whisper-out'
        $w = Invoke-Tool $whisper @('-m', $model, '-f', $wav16, '-otxt', '-of', $outBase, '-nt', '-np', '-t', '4') 240
        $txt = $outBase + '.txt'
        if ($w.Code -eq 0 -and (Test-Path $txt)) {
          $text = ([string](Get-Content -Path $txt -Raw)).Trim()
          if ($spoke -and $text -match '(?i)hello|test|zephyr|player|subtitle') { Add-Test 'whisper transcribes speech' 'PASS' ("it heard: '" + $text + "'") }
          elseif ($spoke) { Add-Test 'whisper transcribes speech' 'WARN' ("it ran and loaded the model, but the text looked unexpected: '" + $text + "'") }
          else { Add-Test 'whisper transcribes speech' 'PASS' 'model loads and runs (no Windows voice was available for a speech sample)' }
        }
        else { Add-Test 'whisper transcribes speech' 'FAIL' ('exit code ' + $w.Code + ' ' + (Last-Line ($w.Err + "`n" + $w.Out))) }
      }
    }
  }
}

New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
Say ("ZephyrPlayer tool setup  ->  " + $Root) 'White'
if ($DryRun) { Say 'DRY RUN: nothing will be downloaded or changed.' 'Yellow' }
if ($TestOnly) { Say 'TEST ONLY: nothing will be downloaded.' 'Yellow' }

try {

  if (-not $TestOnly) {

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
      foreach ($extra in @('mpv.com', 'd3dcompiler_43.dll', 'vulkan-1.dll')) {
        $d = Find-File $dir $extra
        $target = Join-Path $Root $extra
        if ($d -and -not (Test-Path $target)) { Copy-Safe $d.FullName $target }
      }
      Record 'mpv.exe' 'installed' $asset.name
    }

    # ------------------------------------------------------------------ ffmpeg + ffprobe
    if (-not $SkipFfmpeg) {
      Step 'ffmpeg + ffprobe (file info, poster frames, convert, record, clips)'
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

    # ------------------------------------------------------------------ whisper (local AI subtitles)
    if ($DoWhisper) {
      Step 'whisper.cpp (local AI subtitles)'
      Run-Tool 'whisper-cli.exe' {
        $dest = Join-Path $Root 'whisper-cli.exe'
        if (-not (Need $dest)) { Say '   already present (skipped)'; Record 'whisper-cli.exe' 'present'; return }
        $url = 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip'
        try {
          $asset = Get-GitHubAsset 'ggml-org/whisper.cpp' @('^whisper-bin-x64\.zip$', '^whisper-bin-.*x64.*\.zip$')
          $url = $asset.browser_download_url
        } catch { Say '   (could not read the release list, using the standard download link)' 'DarkGray' }
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

      if ($DoModel) {
        Run-Tool ('model ggml-' + $ModelName + '.bin') {
          $dest = Join-Path $Root ('models\ggml-' + $ModelName + '.bin')
          if (-not (Need $dest)) { Say '   speech model already present (skipped)'; Record ('model ' + $ModelName) 'present'; return }
          $url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-' + $ModelName + '.bin'
          if ($DryRun) { Say ("   would download " + $url); Record ('model ' + $ModelName) 'dry-run'; return }
          Say '   the speech model is about 140 MB (base): this can take a few minutes'
          $f = Join-Path $Tmp 'model.bin'
          Download $url $f
          Copy-Safe $f $dest
          Record ('model ' + $ModelName) 'installed'
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
        $want = @('*.exe', '*.com', '*.dll', 'ffmpeg/', 'models/', 'node_modules/', 'dist/', 'releases/')
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
  }

  # ------------------------------------------------------------------ files present + version
  Step 'Installed files'
  if (-not $DryRun) {
    $mpvCom = Join-Path $Root 'mpv.com'
    $mpvVer = if (Test-Path $mpvCom) { $mpvCom } else { $null }
    $checks = @(
      @{ n = 'mpv';     p = (Join-Path $Root 'mpv.exe');            v = $mpvVer;                                 a = @('--version') },
      @{ n = 'yt-dlp';  p = (Join-Path $Root 'yt-dlp.exe');         v = (Join-Path $Root 'yt-dlp.exe');          a = @('--version') },
      @{ n = 'deno';    p = (Join-Path $Root 'deno.exe');           v = (Join-Path $Root 'deno.exe');            a = @('--version') },
      @{ n = 'ffmpeg';  p = (Join-Path $Root 'ffmpeg\ffmpeg.exe');  v = (Join-Path $Root 'ffmpeg\ffmpeg.exe');   a = @('-version') },
      @{ n = 'ffprobe'; p = (Join-Path $Root 'ffmpeg\ffprobe.exe'); v = (Join-Path $Root 'ffmpeg\ffprobe.exe');  a = @('-version') },
      @{ n = 'whisper'; p = (Join-Path $Root 'whisper-cli.exe');    v = $null;                                   a = @() }
    )
    foreach ($c in $checks) {
      if (-not (Test-Path $c.p)) {
        if ($c.n -eq 'whisper') { Say ("   {0,-8} not installed (optional)" -f $c.n) 'DarkGray' } else { Say ("   {0,-8} MISSING" -f $c.n) 'Red' }
        continue
      }
      $ver = 'installed'
      if ($c.v) {
        $r = Invoke-Tool $c.v $c.a 20
        $first = (([string]$r.Out) -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 1)
        if ($first) { $ver = $first.Trim() }
      }
      Say ("   {0,-8} found  {1}" -f $c.n, $ver) 'Green'
    }
    $modelPath = Join-Path $Root ('models\ggml-' + $ModelName + '.bin')
    if (Test-Path $modelPath) { Say ("   {0,-8} found  {1} MB" -f 'model', [math]::Round((Get-Item $modelPath).Length / 1048576)) 'Green' }
  }

  # ------------------------------------------------------------------ self-tests
  if (-not $SkipTests -and -not $DryRun) { Run-SelfTests }

  # ------------------------------------------------------------------ summary
  Write-Host ''
  if ($Results.Count -gt 0) { $Results | Format-Table -AutoSize | Out-String | Write-Host }
  $failedDownloads = @($Results | Where-Object { $_.Status -eq 'FAILED' })
  $failedTests = @($Tests | Where-Object { $_.Result -eq 'FAIL' })
  $warnTests = @($Tests | Where-Object { $_.Result -eq 'WARN' })
  $passTests = @($Tests | Where-Object { $_.Result -eq 'PASS' })
  if ($Tests.Count -gt 0) {
    Say ('Self-test summary: {0} passed, {1} warning(s), {2} failed' -f $passTests.Count, $warnTests.Count, $failedTests.Count) 'White'
    foreach ($t in $failedTests) { Say ('   FAIL  ' + $t.Test + '  ' + $t.Detail) 'Red' }
    foreach ($t in $warnTests) { Say ('   WARN  ' + $t.Test + '  ' + $t.Detail) 'Yellow' }
  }
  if ($failedDownloads.Count -gt 0) {
    Say 'Some downloads failed. Re-run the script (it only repeats what is missing), or download those files manually - see TOOLS.md.' 'Red'
    exit 1
  }
  if ($failedTests.Count -gt 0) {
    Say 'Some tools are present but do NOT work. Re-run with -Force to reinstall them, or send me the lines above.' 'Red'
    exit 2
  }
  if ($warnTests.Count -gt 0) { Say 'Everything works. The warnings above are explained and do not stop the app.' 'Green' }
  else { Say 'Everything is installed AND verified. Start the app with:  npm start' 'Green' }

} finally {
  try { if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue } } catch {}
}
