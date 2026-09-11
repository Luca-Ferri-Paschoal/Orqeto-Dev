# Orqeto Dev para VS Code

Integra o Explorer do VS Code com o aplicativo desktop Orqeto Dev no Windows.

- **Enviar para Orqeto Dev** aceita arquivos, pastas ou multiseleção. O aplicativo identifica qual projeto aberto contém todos os paths, foca a aba correspondente e adiciona o conteúdo somente nela.
- **Remover do contexto Orqeto** aceita arquivos, pastas ou multiseleção e remove somente as entradas correspondentes do contexto em memória. Nenhum arquivo do projeto é excluído.
- **Abrir no Orqeto Dev** aceita uma pasta. Se a mesma root já estiver aberta, apenas foca sua aba; caso contrário o aplicativo reutiliza uma aba vazia ou cria uma nova.

Se uma seleção de envio ou remoção não pertencer integralmente a nenhum projeto aberto, nenhuma aba é alterada e o Orqeto Dev mostra o aviso.

Os comandos só ficam disponíveis enquanto o Orqeto Dev estiver rodando. A extensão consulta o executável registrado pelo aplicativo e atualiza a disponibilidade dos menus automaticamente.

Se o Orqeto Dev não estiver rodando, fechar durante a operação ou ocorrer uma falha ao consultar/encaminhar a ação, a extensão não inicia o aplicativo e encerra a ação silenciosamente.
