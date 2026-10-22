# Free My TV: guide for AI assistants

The full guide is [CLAUDE.md](CLAUDE.md): read it first and follow it (it is written for any assistant, not only
Claude Code). Most people ask in plain words, like "Install Free My TV on my TV at 192.168.1.50. I live in Lisbon.",
and don't know what a terminal is: explain each step simply, and ask before anything that changes their TV or computer.

---

## Regras deste fork (`teintinu/free-my-tv`)

Esta seção vale para este fork. Ela não substitui o CLAUDE.md: acrescenta as regras que o dono do fork exige.

### Git: commit sempre com push, nunca com PR

- Quando o pedido for **"faça commit"**, faça o commit **e o push** para o fork, no remote `fork`
  (`https://github.com/teintinu/free-my-tv.git`). Commit sem push conta como tarefa pela metade.
- **Nunca** abrir Pull Request automaticamente, nem para o upstream (`simbasjungles/free-my-tv`) nem para o fork.
  PR só quando o dono pedir explicitamente, com essas palavras.
- Mensagem de commit **em português**, começando com o prefixo `teintinu: ` — por exemplo,
  `teintinu: corrige o brilho do foco no modo escuro`. O corpo também em português, explicando o *porquê*
  e como foi verificado, não só o *o quê*.
- Antes de commitar: `git status` limpo de lixo (nada de `*.ipk` intermediário, `config.properties`, chaves),
  e nunca commitar `config.properties`, `*.keystore` ou qualquer token/chave de API.

### Nunca deixe a tela da TV piscar (flicker)

O alvo real é uma TV LG com **webOS 4.x / Chromium 53**. Piscada nesse motor é o defeito mais visível e o mais
fácil de introduzir sem perceber. Regras:

- **Nunca** faça `innerHTML = ''` seguido de reconstrução num container que está visível. Atualize no lugar
  (`textContent` de cada nó) ou compare os dados antes e saia cedo (`if (same) return;`).
- **Nada de re-render periódico gratuito**: o tique de 30 s (clima, cotações, picks) só pode mexer no que mudou.
- **Primeiro quadro inteiro**: mantenha o palco invisível (`opacity: 0` em `#stage`) até a prateleira e os picks
  estarem pintados, e só então revele (`body.ready`), com um `setTimeout` de segurança para nunca ficar em preto.
- **Volta do app ao primeiro plano** não pode remontar a prateleira: guarde uma assinatura da lista de apps
  (`shelfSig`) e pule o render quando nada mudou.
- **Imagens**: troque a imagem de um nó que já existe; não recrie o card inteiro para trocar um pôster.
- **Animação só de `transform`/`opacity`**, nunca `width`, `height`, `top`, `left`, `filter` ou `box-shadow`
  em laço — o Chromium 53 não tem `backdrop-filter`, `grid` nem variáveis CSS.
- **Não injete CSS no meio de um seletor.** Regras novas vão no **fim** de `web/home.css` (quebrar o topo do
  arquivo já deixou a TV com a tela branca uma vez) e depois confirme com screenshot que o tema claro e o escuro
  continuam pintando.

Antes/depois de qualquer mudança de renderização, **meça**: conte mutações com um `MutationObserver` e compare
quadros da tela (diferença percentual entre screenshots consecutivos). Critério de aceite em repouso: no máximo
~2 mutações em 25 s e **0,0 %** de variação entre quadros. Já esteve em 181 mutações e 7,7 % por quadro.

### Qualidade geral

- 60 fps é requisito, não enfeite: nada de trabalho pesado na thread da UI, nada de alocação em laço de pintura,
  texto desenhado a cada quadro tem que ser cacheado.
- Depois de qualquer mudança no app webOS: `python3 webos/build.py` tem que terminar com
  `Built FreeMyTV-webos.ipk`, instalar na TV e **verificar na TV** (screenshot + leitura do DOM pelo DevTools),
  não só no navegador.
- Teste nos dois temas (dia e noite) e com a TV sem dados (sem chave do TMDB, sem rede): o app não pode quebrar
  nem mostrar placeholder eterno.
- Mexeu em texto de interface? Mantenha as duas metades do README (inglês e português) em sincronia.
- Não prometa o que a TV não entrega: cheque na TV antes de documentar (ex.: o Homebrew Channel **não** libera o
  inventário de apps no webOS 4.x sem root; o caminho que funciona é a API de controle remoto em
  `ws://127.0.0.1:3000`).
