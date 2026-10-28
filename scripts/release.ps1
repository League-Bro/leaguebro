<#
.SYNOPSIS
  Bumps League Bro's version and releases it.

.DESCRIPTION
  From the main branch, with nothing uncommitted:
    1. checks that main has everything from GitHub and fetches the release tags
    2. bumps the version (scripts\bump-version.ps1) and asks before going on
    3. commits the version files as "bump to x.y.z" and pushes main
    4. starts the "Release installers" workflow (it makes the vx.y.z tag and
       the GitHub release itself) and the "Publish website" workflow

  Answering no at the question puts the version files back as they were.
  Needs the GitHub CLI (gh), signed in.

.PARAMETER Version
  The new version, like 0.2.0. Leave it out for the next patch version.

.PARAMETER Yes
  Don't ask before committing and pushing.

.EXAMPLE
  release

.EXAMPLE
  release 0.2.0
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Version,
  [switch]$Yes
)

$repo = 'doliaro/leaguebro'
$root = Split-Path -Parent $PSScriptRoot
$versionFiles = @('src-tauri/tauri.conf.json', 'package.json', 'src-tauri/Cargo.toml', 'package-lock.json', 'src-tauri/Cargo.lock')

function Fail([string]$message) {
  Write-Host "release: $message" -ForegroundColor Red
  exit 1
}

# Runs git in the project folder and stops the release if it fails.
function Run-Git {
  & git -C $root @args
  if ($LASTEXITCODE -ne 0) { Fail "git $($args -join ' ') failed." }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "git isn't installed." }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "the GitHub CLI isn't installed: winget install GitHub.cli, then gh auth login." }
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Fail "the GitHub CLI isn't signed in: run gh auth login." }

$branch = (Run-Git rev-parse --abbrev-ref HEAD | Out-String).Trim()
if ($branch -ne 'main') { Fail "releases go from main, and this folder is on $branch." }
if ((Run-Git status --porcelain | Out-String).Trim()) { Fail "there are uncommitted changes. Commit or put them aside first." }

Write-Host "Checking GitHub for new commits and release tags..."
Run-Git fetch --quiet --tags origin main
$behind = [int](Run-Git rev-list --count HEAD..origin/main | Out-String).Trim()
if ($behind -gt 0) { Fail "main is $behind commit(s) behind GitHub. Run git pull first." }

$bumpArgs = @{ NoNextSteps = $true }
if ($Version) { $bumpArgs.Version = $Version }
& (Join-Path $PSScriptRoot 'bump-version.ps1') @bumpArgs
if ($LASTEXITCODE -ne 0) { exit 1 }
$new = ([IO.File]::ReadAllText((Join-Path $root 'src-tauri/tauri.conf.json')) | ConvertFrom-Json).version

$ahead = [int](Run-Git rev-list --count origin/main..HEAD | Out-String).Trim()
if (-not $Yes) {
  Write-Host ""
  $also = if ($ahead -gt 0) { " (plus $ahead commit(s) of yours not on GitHub yet)" } else { '' }
  $answer = Read-Host "Commit 'bump to $new', push main$also and release v$new? [y/N]"
  if ($answer -notmatch '^(y|yes)$') {
    Run-Git checkout '--' @versionFiles
    Write-Host "Stopped. The version files are back to how they were."
    exit 1
  }
}

Run-Git add '--' @versionFiles
Run-Git commit --quiet -m "bump to $new"
Run-Git push --quiet origin main
Write-Host "Pushed 'bump to $new' to main." -ForegroundColor Green

# The push went through, so from here a failure only needs the workflow started by hand.
gh workflow run build-windows.yml --repo $repo --ref main
if ($LASTEXITCODE -ne 0) { Fail "couldn't start the release. Run it from Actions -> Release installers -> Run workflow." }
gh workflow run pages.yml --repo $repo --ref main
if ($LASTEXITCODE -ne 0) { Fail "the release started, but the website didn't. Run Actions -> Publish website -> Run workflow." }

Write-Host ""
Write-Host "Started the v$new release (about 15 minutes) and the website update." -ForegroundColor Green
Write-Host "Follow them: https://github.com/$repo/actions (or gh run list --limit 3)."
