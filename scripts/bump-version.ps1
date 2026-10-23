<#
.SYNOPSIS
  Sets League Bro's version in every file that holds it.

.DESCRIPTION
  Updates the version in:
    - src-tauri/tauri.conf.json   (the one the app and the updater use)
    - package.json
    - src-tauri/Cargo.toml
    - package-lock.json           (its two copies of the app's own version)
    - src-tauri/Cargo.lock        (the leaguebro entry)

  Refuses a version that isn't higher than the current one or than any v* release
  tag this copy knows about, because installed copies only update to a higher
  version. Nothing is written unless every file can be updated.

.PARAMETER Version
  The new version, like 0.1.7. Leave it out to bump the patch number
  (0.1.13 -> 0.1.14, or one above the newest v* tag if that's higher).

.EXAMPLE
  scripts\bump-version.cmd 0.1.7

.EXAMPLE
  bump
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Version,
  # Project folder; defaults to the one above this script. Used by tests.
  [string]$Root
)

$ErrorActionPreference = 'Stop'
# Set here, not as the param default: Windows PowerShell 5.1 leaves $PSScriptRoot
# empty while evaluating param() defaults.
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$utf8 = New-Object System.Text.UTF8Encoding $false

function Fail([string]$message) {
  Write-Host "bump-version: $message" -ForegroundColor Red
  exit 1
}

if ($Version -and $Version -notmatch '^\d+\.\d+\.\d+$') {
  Fail "'$Version' isn't a version like 0.1.7 (three numbers, no 'v')."
}

$files = [ordered]@{
  tauri    = Join-Path $Root 'src-tauri/tauri.conf.json'
  package  = Join-Path $Root 'package.json'
  cargo    = Join-Path $Root 'src-tauri/Cargo.toml'
  pkglock  = Join-Path $Root 'package-lock.json'
  cargolck = Join-Path $Root 'src-tauri/Cargo.lock'
}
$text = @{}
foreach ($key in $files.Keys) {
  if (-not (Test-Path $files[$key])) { Fail "missing $($files[$key])" }
  $text[$key] = [IO.File]::ReadAllText($files[$key])
}

# The current version, which all three main files must agree on.
$current = ($text.tauri | ConvertFrom-Json).version
$pkgVersion = ($text.package | ConvertFrom-Json).version
$cargoMatch = [regex]::Match($text.cargo, '(?m)^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"')
if (-not $cargoMatch.Success) { Fail "couldn't find the [package] version in Cargo.toml." }
$cargoVersion = $cargoMatch.Groups[1].Value
if ($current -ne $pkgVersion -or $current -ne $cargoVersion) {
  Fail "the files disagree before bumping: tauri.conf.json $current, package.json $pkgVersion, Cargo.toml $cargoVersion. Fix them by hand first."
}

# Release tags this copy knows about (run 'git fetch --tags' to see the latest ones).
$tags = @()
if (Get-Command git -ErrorAction SilentlyContinue) {
  $tags = @(git -C $Root tag -l 'v*' 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^v\d+\.\d+\.\d+$' })
}
$highestTag = $tags | ForEach-Object { [version]$_.Substring(1) } | Sort-Object | Select-Object -Last 1

# No version given: one patch above the current version or the newest tag, whichever is higher.
if (-not $Version) {
  $base = [version]$current
  if ($highestTag -and $highestTag -gt $base) { $base = $highestTag }
  $Version = "$($base.Major).$($base.Minor).$($base.Build + 1)"
}

$new = [version]$Version
if ($new -le [version]$current) {
  Fail "$Version isn't higher than the current version $current. Installed copies only update to a higher version."
}

if ($highestTag -and $new -le $highestTag) {
  Fail "$Version isn't higher than the release tag v$highestTag. Pick a version above v$highestTag."
}

# Replaces exactly $count matches of $pattern (group 1 = text before the version,
# group 2 = text after) or fails without writing anything.
function Replace-Version([string]$key, [string]$pattern, [int]$count, [string]$where) {
  $regex = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
  $found = $regex.Matches($text[$key]).Count
  if ($found -ne $count) { Fail "expected $count $where in $(Split-Path -Leaf $files[$key]), found $found. Nothing was changed." }
  $text[$key] = $regex.Replace($text[$key], { param($m) $m.Groups[1].Value + $Version + $m.Groups[2].Value })
}

$old = [regex]::Escape($current)
Replace-Version 'tauri'    "\A(\{[^{}]*?""version"":\s*"")$old("")" 1 'top-level "version"'
Replace-Version 'package'  "\A(\{[^{}]*?""version"":\s*"")$old("")" 1 'top-level "version"'
Replace-Version 'cargo'    "(^\[package\][\s\S]*?^version\s*=\s*"")$old("")" 1 '[package] version'
Replace-Version 'pkglock'  "((?:\A\{|""""\s*:\s*\{)\s*""name"":\s*""leaguebro"",\s*""version"":\s*"")$old("")" 2 'leaguebro "version" entries'
Replace-Version 'cargolck' "(^name = ""leaguebro""\r?\nversion = "")$old("")" 1 'leaguebro entry'

foreach ($key in $files.Keys) {
  [IO.File]::WriteAllText($files[$key], $text[$key], $utf8)
}

# Read back the three main files to confirm.
$after = @(
  ([IO.File]::ReadAllText($files.tauri) | ConvertFrom-Json).version,
  ([IO.File]::ReadAllText($files.package) | ConvertFrom-Json).version,
  [regex]::Match([IO.File]::ReadAllText($files.cargo), '(?m)^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"').Groups[1].Value
)
if (($after | Where-Object { $_ -ne $Version }).Count -gt 0) {
  Fail "read-back failed: tauri.conf.json $($after[0]), package.json $($after[1]), Cargo.toml $($after[2])."
}

Write-Host "League Bro $current -> $Version" -ForegroundColor Green
Write-Host "Updated tauri.conf.json, package.json, Cargo.toml, package-lock.json and Cargo.lock."
Write-Host ""
Write-Host "Next: commit those five files, push, then run Actions -> Release Windows installer."
