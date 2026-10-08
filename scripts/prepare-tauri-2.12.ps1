# Migra os lockfiles locais para o Tauri 2.12.x e valida o aplicativo no Windows.
# Execute da raiz: powershell -NoProfile -File .\scripts\prepare-tauri-2.12.ps1
# Funciona na main ou em outra branch; nao faz git commit nem git push.
# NAO envie commits antes de todos os testes e o build passarem.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $root
try {
    $branch = (& git branch --show-current)
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel consultar a branch Git." }
    Write-Host "[Tauri] Executando diretamente na branch $($branch.Trim()); nenhuma branch ou commit sera criado."

    $rustVersionText = (& rustc --version)
    if ($LASTEXITCODE -ne 0) { throw "rustc indisponivel; instale/atualize Rust com rustup update stable." }
    if ($rustVersionText -notmatch '^rustc (\d+\.\d+\.\d+)') {
        throw "Nao foi possivel identificar a versao de Rust: $rustVersionText"
    }
    if ([version]$Matches[1] -lt [version]"1.90.0") {
        throw "Rust $($Matches[1]) e antigo. Execute rustup update stable e repita. O Tauri 2.12 requer >= 1.90."
    }

    Write-Host "[Tauri] Atualizando package-lock.json com o npm (checksums oficiais)..."
    & npm install --package-lock-only --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install --package-lock-only falhou." }

    Write-Host "[Tauri] Atualizando src-tauri/Cargo.lock com o Cargo (checksums oficiais)..."
    & cargo update --manifest-path "src-tauri/Cargo.toml"
    if ($LASTEXITCODE -ne 0) { throw "cargo update falhou." }

    Write-Host "[Tauri] Instalando as dependencias exatamente dos lockfiles..."
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci falhou." }
    & npm ci --prefix integrations/vscode
    if ($LASTEXITCODE -ne 0) { throw "npm ci da extensao VS Code falhou." }

    Write-Host "[Tauri] Confirmando grafo Rust Windows..."
    & node --test "scripts/windows-rust-dependency-graph.test.mjs"
    if ($LASTEXITCODE -ne 0) { throw "Testes do grafo Windows falharam." }
    & node "scripts/check-windows-rust-deps.mjs"
    if ($LASTEXITCODE -ne 0) { throw "A verificacao de dependencias Windows falhou." }

    Write-Host "[Tauri] Validando TypeScript, lint e formatacao..."
    & npm run validate
    if ($LASTEXITCODE -ne 0) { throw "npm run validate falhou." }

    Write-Host "[Tauri] Executando testes Node e Rust..."
    & npm test
    if ($LASTEXITCODE -ne 0) { throw "npm test falhou." }

    Write-Host "[Tauri] Auditando dependencias npm..."
    & npm run audit:security
    if ($LASTEXITCODE -ne 0) { throw "npm run audit:security falhou." }

    Write-Host "[Tauri] Gerando instalador Windows..."
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build falhou." }

    Write-Host "[Tauri] SUCESSO. Revise package-lock.json e src-tauri/Cargo.lock antes do commit." -ForegroundColor Green
    Write-Host "[Tauri] A vulnerabilidade Linux de glib < 0.20 continua pendente no Tauri 2.12."
    & git status --short
    if ($LASTEXITCODE -ne 0) { throw "git status falhou." }
}
finally {
    Pop-Location
}
