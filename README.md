# daniellesimoes.com

Site acadêmico de Danielle Marques Simões, hospedado no GitHub Pages.

## Arquivos

- `index.html`: a página inteira (HTML e CSS no mesmo arquivo).
- `CNAME`: contém `daniellesimoes.com`. Não apague, é o que liga o domínio ao site.
- `.nojekyll`: diz ao GitHub para publicar os arquivos como estão.
- `Danielle_Marques_CV.pdf`: o CV da Dani. Para atualizar, suba o novo PDF com o mesmo nome.

## Como editar

Abra `index.html` no próprio GitHub (ícone de lápis), altere o texto e clique em **Commit changes**. O site atualiza em 1 a 2 minutos.

Trechos com fundo amarelo (`<span class="todo">`) ainda precisam ser completados: LinkedIn, Google Scholar e as fotos.

A cor de destaque fica na variável `--accent` no início do CSS.

## Fotos

Os quadros tracejados (`<div class="ph">`) são espaços reservados. Para trocar por uma foto:

1. Suba a imagem numa pasta `images/` (ex.: `images/perfil.jpg`).
2. Troque o `<div class="ph ...">...</div>` por `<img src="images/perfil.jpg" alt="Danielle Marques Simões">`.

## DNS (no registrador do domínio)

| Tipo  | Nome | Valor                   |
|-------|------|-------------------------|
| A     | @    | 185.199.108.153         |
| A     | @    | 185.199.109.153         |
| A     | @    | 185.199.110.153         |
| A     | @    | 185.199.111.153         |
| CNAME | www  | USUARIO.github.io       |

Troque `USUARIO` pelo nome de usuário da Dani no GitHub.
