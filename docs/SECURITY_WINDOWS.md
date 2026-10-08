# Segurança e validação do Windows

## Escopo e estado

O aplicativo permanece em Tauri 2 estável. **Esta alteração não migra GTK/WebKitGTK nem corrige o alerta Linux** `GHSA-wrw7-89jp-8q8g` / `RUSTSEC-2024-0429`, presente em `glib 0.18.5` no `src-tauri/Cargo.lock`. A versão corrigida é `glib >= 0.20.0`, que não é intercambiável com os bindings GTK 0.18 existentes. Não edite o lockfile para trocar essa versão manualmente e não dispense o alerta como falso positivo.

O Cargo.lock abrange pacotes de todas as plataformas, incluindo os que não são compilados no Windows. Para Windows, a verificação `scripts/check-windows-rust-deps.mjs` executa `cargo metadata --locked --filter-platform x86_64-pc-windows-msvc` e percorre somente o grafo de dependências alcançáveis; a verificação falha se `glib` for incluída nele. Isso verifica um cenário **específico**: não é uma auditoria universal de todas as crates, nem prova que não haja outras vulnerabilidades.

## Validação em Windows

Instale Node.js 22+, Rust com target MSVC, dependências do Tauri 2 para Windows e o Git.

Na raiz do projeto, no PowerShell:

```powershell
npm ci
npm ci --prefix integrations/vscode
npm run audit:security
node --test scripts/windows-rust-dependency-graph.test.mjs
node scripts/check-windows-rust-deps.mjs
npm run validate
npm test
npm run build
```

O workflow `.github/workflows/windows-validation.yml` executa essa sequência em um runner Windows do GitHub Actions. A conclusão verde confirma que a suíte, o grafo-alvo e a geração do instalador passaram **naquela execução**. Também é necessário testar a aplicação e o instalador em uma máquina Windows real, incluindo inicialização, integração VS Code, banco de dados, drag-and-drop e aplicação/Undo.

## Linux e macOS no futuro

Não considere o Linux validado por este workflow. Antes de distribuí-lo, atualize a cadeia Tauri/GTK/WebKitGTK para uma que resolva a vulnerabilidade de `glib`, rode `cargo tree --target x86_64-unknown-linux-gnu -i glib`, faça uma auditoria Rust e valide os recursos nativos em Linux.

Para macOS, rode compilação, testes, distribuição/assinatura e testes funcionais em macOS; a aprovação do workflow Windows não garante compatibilidade macOS.

## Critério para encerrar o alerta

Encerre a pendência somente quando houver uma atualização upstream compatível e o `Cargo.lock` deixar de carregar a versão vulnerável ou quando uma correção de código revisada e verificável tiver sido aplicada à dependência. Não confunda ausência no grafo Windows com correção do pacote Linux.
