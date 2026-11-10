# Подготовка рабочего места (Windows, PowerShell 5.1 и новее). Запуск из корня репозитория:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\bootstrap.ps1
# Скрипт можно запускать повторно: уже сделанное он пропускает.
# Файл хранится в UTF-8 с BOM: без него Windows PowerShell 5.1 читает кириллицу как cp1251 и не разбирает скрипт.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$done = New-Object System.Collections.Generic.List[string]

function Stop-Setup([string]$Message) {
    Write-Host ""
    Write-Host "ОШИБКА: $Message" -ForegroundColor Red
    exit 1
}

# Нативные команды не подчиняются $ErrorActionPreference, поэтому код возврата проверяем сами.
function Invoke-Native([string]$What, [string]$Hint, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup "не удалось: $What (код $LASTEXITCODE). $Hint"
    }
}

# Вывод команды целиком, без остановки на stderr (в PowerShell 5.1 он превращается в ошибку).
function Get-NativeOutput([scriptblock]$Command) {
    $saved = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $text = (& $Command 2>&1 | Out-String)
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $saved
    }
    return [pscustomobject]@{ Code = $code; Text = $text }
}

Write-Host "Репозиторий: $root"

# 0. Что должно быть до запуска: git, gh, uv.
foreach ($tool in @(
        @{ Name = "git"; Hint = "winget install --id Git.Git -e" },
        @{ Name = "gh"; Hint = "winget install --id GitHub.cli -e" },
        @{ Name = "uv"; Hint = "winget install --id astral-sh.uv -e" })) {
    if (-not (Get-Command $tool.Name -ErrorAction SilentlyContinue)) {
        Stop-Setup "не найден $($tool.Name). Установите: $($tool.Hint) - затем перезапустите терминал и запустите скрипт снова."
    }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warning "не найден Node.js. Он нужен с этапа 2: winget install --id OpenJS.NodeJS.LTS -e"
}

# 1. Папка под облачной синхронизацией ломает .git; чужой CLAUDE.md выше по дереву меняет правила сессий.
if ($root -match "OneDrive|iCloud") {
    Write-Warning "репозиторий лежит в синхронизируемой папке. Перенесите его, например в домашнюю папку."
}
$dir = Split-Path -Parent $root
while ($dir) {
    if (Test-Path (Join-Path $dir "CLAUDE.md")) {
        Write-Warning "Найден $dir\CLAUDE.md - его правила попадут в сессии проекта. Перенесите репозиторий или уберите файл."
    }
    $parent = Split-Path -Parent $dir
    if ($parent -eq $dir) { break }
    $dir = $parent
}

# 2. Вход в GitHub.
$auth = Get-NativeOutput { gh auth status }
if ($auth.Code -ne 0) {
    Stop-Setup "нет входа в GitHub. Выполните: gh auth login - затем запустите скрипт снова."
}
$done.Add("вход в GitHub проверен")

# 3. Адрес для коммитов: служебный адрес GitHub, чтобы личная почта не попала в историю.
Push-Location $root
try {
    $gitEmail = "$((Get-NativeOutput { git config user.email }).Text)".Trim()
    if ($gitEmail -like "*@users.noreply.github.com") {
        $done.Add("адрес коммитов служебный")
    } else {
        Write-Warning "адрес для коммитов не задан или не служебный ('$gitEmail'). Задайте его по docs/ONBOARDING.md, раздел 1."
    }

    # 4. gitleaks нужен хуку pre-commit как системная программа.
    # После установки winget PATH этого окна старый: при повторном запуске ищем gitleaks в папке winget.
    $wingetGitleaks = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Filter gitleaks.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (Get-Command gitleaks -ErrorAction SilentlyContinue) {
        Write-Host "gitleaks уже есть"
    } elseif ($wingetGitleaks) {
        $env:Path = "$env:Path;$($wingetGitleaks.DirectoryName)"
        Write-Host "gitleaks уже установлен, добавлен в PATH этого окна"
    } else {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            Stop-Setup "не найден winget, поэтому gitleaks не поставить. Скачайте gitleaks вручную: https://github.com/gitleaks/gitleaks/releases"
        }
        Invoke-Native "установка gitleaks" "Попробуйте вручную: winget install --id Gitleaks.Gitleaks -e" {
            winget install --id Gitleaks.Gitleaks -e --accept-package-agreements --accept-source-agreements
        }
        $done.Add("установлен gitleaks")
    }

    # 5. pre-commit через uv. Python для него uv берёт сам.
    Invoke-Native "установка pre-commit" "Проверьте сеть и повторите запуск." { uv tool install pre-commit }
    $shell = Get-NativeOutput { uv tool update-shell }
    if ($shell.Code -ne 0) {
        Write-Warning "uv tool update-shell не сработал. Добавьте папку из «uv tool dir --bin» в PATH вручную."
    }
    # В этом терминале PATH ещё старый, поэтому pre-commit вызываем по полному пути.
    # Без «| Select-Object -First 1»: он обрывает uv до выхода, и код возврата становится -1.
    $bin = @(& uv tool dir --bin)[0]
    if ($LASTEXITCODE -ne 0 -or -not $bin) {
        Stop-Setup "не удалось узнать папку программ uv (uv tool dir --bin)."
    }
    $precommit = Join-Path $bin "pre-commit.exe"
    if (-not (Test-Path $precommit)) {
        Stop-Setup "не найден $precommit после установки pre-commit."
    }
    Invoke-Native "pre-commit install" "Запустите вручную: $precommit install" { & $precommit install }
    $done.Add("хуки pre-commit установлены")

    # 6. Файл .env из образца. Значения секретов передаёт владелец зоны А (docs/ONBOARDING.md, раздел 5).
    if ((Test-Path ".env.example") -and -not (Test-Path ".env")) {
        Copy-Item ".env.example" ".env"
        $done.Add("создан .env из образца - заполните значения")
    }

    # 7. Зависимости продукта (с этапа 2).
    if (Test-Path "app\package.json") {
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            Stop-Setup "не найден npm, а продукт уже есть. Установите Node.js и запустите скрипт снова."
        }
        Push-Location "app"
        try {
            Invoke-Native "npm ci в app" "Проверьте сеть и повторите запуск." { npm ci }
        } finally {
            Pop-Location
        }
        $done.Add("зависимости продукта установлены")
    }

    # 8. Учёт читается.
    Invoke-Native "tracker.py due" "Запустите вручную: uv run tools/tracker.py due" { uv run tools/tracker.py due }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Готово. Сделано:" -ForegroundColor Green
foreach ($item in $done) { Write-Host "  - $item" }
Write-Host ""
Write-Host "Закройте терминал и откройте новый: иначе gitleaks и pre-commit не найдутся в PATH."
Write-Host "Затем:  cd `"$root`"; claude    и первой командой наберите /start"
