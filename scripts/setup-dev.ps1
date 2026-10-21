<#
.SYNOPSIS
  Sets up a Windows PC to develop League Buddy.

.DESCRIPTION
  Checks for, and installs with winget when missing:
    - Git
    - Node.js LTS (22.12 or newer)
    - Rust (rustup, stable MSVC toolchain)
    - Visual Studio 2022 Build Tools with the C++ workload (Rust needs its linker)
    - Microsoft Edge WebView2 Runtime (already part of Windows 10/11 in most cases)
  Then lets npm run in PowerShell and installs the project's npm packages.

  Safe to run again at any time: anything already installed is skipped.

.PARAMETER Build
  Also compiles the Rust side once (about 5 minutes), so the first
  `npm run tauri dev` starts quickly.

.EXAMPLE
  scripts\setup-dev.cmd
  scripts\setup-dev.cmd -Build
#>
[CmdletBinding()]
param(
    [switch]$Build
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$failures = New-Object System.Collections.Generic.List[string]

function Write-Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "    [ok] $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "    $text" }
function Write-Warn($text) { Write-Host "    [!] $text" -ForegroundColor Yellow }

function Update-SessionPath {
    # Pick up PATH changes from installers without reopening the terminal.
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
    $env:Path = "$machine;$user;$cargoBin"
}

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Install-WithWinget([string]$id, [string]$label, [string[]]$extraArgs = @()) {
    if (-not (Test-Command 'winget')) {
        Write-Warn "winget isn't available, so $label can't be installed automatically. Install 'App Installer' from the Microsoft Store, or install $label manually."
        return $false
    }
    Write-Info "Installing $label with winget (a Windows permission prompt may appear)..."
    $wingetArgs = @('install', '--id', $id, '-e', '--accept-package-agreements', '--accept-source-agreements') + $extraArgs
    & winget @wingetArgs
    # winget returns non-zero for "already installed" too, so check the result afterwards instead.
    Update-SessionPath
    return $true
}

function Get-NodeVersion {
    if (-not (Test-Command 'node')) { return $null }
    $raw = (& node --version) -replace '^v', ''
    try { return [version]$raw } catch { return $null }
}

function Test-VcTools {
    $pf86 = ${env:ProgramFiles(x86)}
    if (-not $pf86) { return $false }
    $vswhere = Join-Path $pf86 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { return $false }
    $path = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    return [bool]$path
}

function Test-WebView2 {
    $key = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($root in @('HKLM:', 'HKCU:')) {
        $item = Get-ItemProperty -Path "$root\$key" -Name pv -ErrorAction SilentlyContinue
        if ($item -and $item.pv -and $item.pv -ne '0.0.0.0') { return $true }
    }
    $userKey = 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    $item = Get-ItemProperty -Path $userKey -Name pv -ErrorAction SilentlyContinue
    return [bool]($item -and $item.pv -and $item.pv -ne '0.0.0.0')
}

Write-Host 'League Buddy dev setup' -ForegroundColor White
Write-Host "Project folder: $repoRoot"
Update-SessionPath

# --- Git -------------------------------------------------------------------
Write-Step 'Git'
if (Test-Command 'git') {
    Write-Ok (& git --version)
} else {
    Install-WithWinget 'Git.Git' 'Git' | Out-Null
    if (Test-Command 'git') { Write-Ok (& git --version) } else { $failures.Add('Git') }
}

# --- Node.js ---------------------------------------------------------------
Write-Step 'Node.js (22.12 or newer)'
$minNode = [version]'22.12.0'
$node = Get-NodeVersion
if ($node -and $node -ge $minNode) {
    Write-Ok "Node $node"
} else {
    if ($node) { Write-Warn "Node $node is too old; installing the current LTS." }
    Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS' | Out-Null
    $node = Get-NodeVersion
    if ($node -and $node -ge $minNode) { Write-Ok "Node $node" } else { $failures.Add('Node.js 22.12+') }
}

# --- Visual Studio C++ Build Tools -------------------------------------------
Write-Step 'Visual Studio C++ Build Tools (needed by Rust)'
if (Test-VcTools) {
    Write-Ok 'C++ build tools found'
} else {
    Write-Info 'This download is large (a few GB) and takes a while.'
    Install-WithWinget 'Microsoft.VisualStudio.2022.BuildTools' 'Visual Studio 2022 Build Tools' @(
        '--override', '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
    ) | Out-Null
    if (Test-VcTools) { Write-Ok 'C++ build tools installed' } else { $failures.Add('Visual Studio C++ Build Tools (Desktop development with C++)') }
}

# --- Rust ----------------------------------------------------------------------
Write-Step 'Rust'
if (-not (Test-Command 'rustup')) {
    Install-WithWinget 'Rustlang.Rustup' 'Rust (rustup)' | Out-Null
}
if (Test-Command 'rustup') {
    # Make sure a stable MSVC toolchain is installed and is the default.
    & rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal | Out-Host
    & rustup default stable-x86_64-pc-windows-msvc | Out-Null
    if (Test-Command 'cargo') { Write-Ok (& cargo --version) } else { $failures.Add('Rust (cargo not found after install)') }
} else {
    $failures.Add('Rust (rustup)')
}

# --- WebView2 ------------------------------------------------------------------
Write-Step 'WebView2 Runtime'
if (Test-WebView2) {
    Write-Ok 'WebView2 found'
} else {
    Install-WithWinget 'Microsoft.EdgeWebView2Runtime' 'WebView2 Runtime' | Out-Null
    if (Test-WebView2) { Write-Ok 'WebView2 installed' } else { Write-Warn "Couldn't confirm WebView2. It ships with Windows 11; if the app window stays blank, install it from https://developer.microsoft.com/microsoft-edge/webview2/" }
}

# --- PowerShell script policy ----------------------------------------------------
Write-Step 'PowerShell script policy (so npm works in PowerShell)'
$policy = Get-ExecutionPolicy -Scope CurrentUser
if ($policy -in @('RemoteSigned', 'Unrestricted', 'Bypass')) {
    Write-Ok "CurrentUser policy is $policy"
} else {
    try {
        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
        Write-Ok 'Set CurrentUser policy to RemoteSigned (Microsoft''s recommended setting for developers)'
    } catch {
        Write-Warn "Couldn't change it ($($_.Exception.Message)). Use npm.cmd instead of npm, or run: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"
    }
}

# --- Project packages --------------------------------------------------------------
if ($failures.Count -eq 0) {
    Write-Step 'npm packages'
    Push-Location $repoRoot
    try {
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { $failures.Add('npm install') } else { Write-Ok 'npm packages installed' }

        if ($Build -and $failures.Count -eq 0) {
            Write-Step 'Compiling the Rust side once (about 5 minutes)'
            Push-Location (Join-Path $repoRoot 'src-tauri')
            try {
                & cargo build
                if ($LASTEXITCODE -ne 0) { $failures.Add('cargo build') } else { Write-Ok 'Rust build done' }
            } finally { Pop-Location }
        }
    } finally { Pop-Location }
}

# --- Summary ---------------------------------------------------------------------------
Write-Host ''
if ($failures.Count -eq 0) {
    Write-Host 'All set.' -ForegroundColor Green
    Write-Host 'Open a NEW terminal (so it sees the updated PATH), then run:'
    Write-Host "    cd `"$repoRoot`""
    Write-Host '    npm run tauri dev'
    exit 0
} else {
    Write-Host 'Setup finished with problems:' -ForegroundColor Red
    foreach ($f in $failures) { Write-Host "  - $f" -ForegroundColor Red }
    Write-Host 'Fix those (see README > Development > Manual setup), then run this script again.'
    exit 1
}
