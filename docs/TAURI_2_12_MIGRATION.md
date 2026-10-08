# Migracao coordenada do Tauri 2.11 para Tauri 2.12 (Windows)

## Escopo

Versoes verificadas nas publicacoes oficiais de 26/09/2026 e 31/08/2026:

- Rust `tauri` 2.12.0 e `tauri-build` 2.7.0.
- JavaScript `@tauri-apps/api` e `@tauri-apps/cli` 2.12.0.
- Clipboard Manager Rust/JS 2.3.3.
- Dialog Rust/JS 2.7.3.
- Single Instance Rust 2.4.5.
- SQL Rust 2.4.1.
- Rust minimo 1.90 (Tauri 2.12 deixa de oferecer suporte oficial ao Windows 7).

Outras dependencias diretas foram preservadas para nao misturar migracoes independentes. A regeneracao de `Cargo.lock` atualiza tambem dependencias transitivas compativeis. `npm install --package-lock-only` reconcilia a resolucao JS com as novas restricoes.

## Importante: a vulnerabilidade `glib` ainda existe no Linux

A versao estavel Tauri 2.12.0 **continua dependendo de GTK3 `0.18`** no Linux, que usa a linha vulneravel de `glib 0.18`. Nao force glib 0.20, nao altere checksums de Cargo.lock e nao dispense o alerta Dependabot. A versao Tauri 3.0.0-alpha.4 nao e uma solucao estavel comprovada para remover o GTK3 de toda a arvore. Essa migracao nao pretende zerar o alerta Linux.

Referencias:
- https://tauri.app/release/
- https://tauri.app/blog/tauri-2.12/
- https://github.com/tauri-apps/tauri/issues/7335
- https://github.com/advisories/GHSA-wrw7-89jp-8q8g

## Pre-requisitos e aplicacao

1. Confirme `git status` antes de iniciar. Evite misturar o backport experimental de glib (vendor) com esta atualizacao.
2. Crie uma branch **antes** de aplicar o ZIP: `git switch -c experiment/tauri-2-12`.
3. Aplique os arquivos completos do ZIP na raiz do projeto via Orqeto Dev (Modo Arquivos).
4. Atualize Rust se necessario: `rustup update stable`; verifique `rustc --version` (minimo `1.90.0`).
5. Execute `powershell -NoProfile -File .\scripts\prepare-tauri-2.12.ps1` na raiz. O script regenera `package-lock.json` e `src-tauri/Cargo.lock` por gerenciadores oficiais, instala os pacotes, audita e roda testes/build. Pode levar varios minutos; exige acesso aos registries npm e crates.io.
6. Teste manualmente o `.exe` e o instalador NSIS gerado, inclusive abertura de projetos, SQLite, integracao VS Code, drag-and-drop, Apply/Undo e integracao Windows Explorer.
7. Somente depois de tudo verde, revise `git diff --stat`, `git diff --check` e `git status` e envie a branch ao GitHub. O workflow Windows usa `npm ci` e `cargo metadata --locked`; por isso os **dois lockfiles regenerados devem ir para o commit**.
8. Revise o Dependabot apos atualizar. Se o alerta `glib` permanecer, e esperado nesta geracao GTK3.

## Reversao

Se qualquer etapa falhar, **nao mescle** a branch e envie o log para analise. O script interrompe no primeiro erro e nao faz commit ou push. Para recuperar a versao Windows anterior, retorne a branch `main`, que fica intacta, sem descartar manualmente arquivos de trabalho nao revisados.

## Limites de validacao

Neste pacote os manifestos foram preparados e analisados, mas os lockfiles finais exigem Cargo/npm e nao foram fabricados. O executavel Windows so podera ser considerado validado **apos executar os testes e build no Windows**. Linux e macOS ainda precisam de testes proprios.
