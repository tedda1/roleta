# Roleta Constelação · Convenção 2026

Roleta de brindes para a confraternização **OncologyGroup — "A nossa força é brilhar juntos"**,
feita para rodar numa **tela touch** (totem) em um PC desconhecido, **sem internet**.

- **Versão 2D com detalhes 3D** (`/`): roleta em canvas com perspectiva, espessura, aro metálico, brilho e céu da identidade visual. Leve: só anima `transform`.
- **Versão 3D interativa** (`/3d/`): three.js; a roleta "descola" da tela e ganha volume, câmera viva com parallax, agarrar-e-lançar com o dedo, faíscas ao tocar o céu e revelação com estrelas que formam uma estrela. Se o PC não aguentar, cai sozinha para o 2D sem perder nada.
- **Diagnóstico** (`/diagnostico/`): roda no PC do evento e diz se use 2D ou 3D.

## Regras do sorteio

| Regra | Como é garantida |
|---|---|
| Probabilidades iguais | Cada **tipo** de brinde com estoque é uma fatia de mesmo tamanho: chance **1/N**. Sorteio com `crypto.getRandomValues` e amostragem por rejeição (sem viés). |
| Item retirado some | O estoque é derivado das jogadas; quando um tipo zera, a fatia sai e as chances viram 1/(N−1). |
| Um CPF, uma jogada | CPF validado (dígitos verificadores) e transformado em chave PBKDF2 com sal do evento; índice **único** no IndexedDB. |
| Resultado honesto | O brinde é **sorteado e gravado antes** da animação. O giro (botão ou dedo) só define força e sentido; a animação para exatamente na fatia gravada. |
| Queda de energia / recarga | Jogada gravada e não revelada volta como resultado ao reabrir. Ninguém joga duas vezes, nenhum brinde se perde. |

> `"modoSorteio": "porUnidade"` em `brindes.json` muda para chance proporcional ao estoque (ex.: 10 canecas pesam 10×).

## Configurar os brindes

Copie `public/brindes.exemplo.json` para `public/brindes.json` (fora do git) e edite:

```json
{
  "evento": "Convenção 2026 · Constelação OncologyGroup",
  "pin": "202612",
  "modoSorteio": "porTipo",
  "som": true,
  "brindes": [
    { "id": "caneca", "nome": "Caneca Constelação", "rotulo": "Caneca", "quantidade": 15 }
  ]
}
```

`rotulo` é o texto curto da fatia; `nome` aparece no resultado. Até 24 tipos.

## Desenvolvimento

Requer Node 20.9+ (testado com Node 26 LTS).

```bash
npm install
npm run dev          # http://localhost:3000
npm run verificar    # lint + tipos + testes + build
```

Estrutura:

```
src/core/      regras puras e testadas: cpf, sorteio, geometria do giro, IndexedDB, máquina de estados
src/arte/      paleta, face da roleta (canvas), céu da identidade
src/palco2d/   roleta 2D
src/palco3d/   cena three.js, detecção de GPU e fallback
src/ui/        totem, painel, teclado numérico, administrador, gesto, kiosk
operacao/      servidor local (PowerShell), INICIAR.cmd e guia do dia
```

## Levar para o totem

```bash
npm run build        # gera out/ (site estático)
npm run pacote       # gera pacote-totem/ (site + INICIAR.cmd + servir.ps1 + LEIA-ME.txt)
```

Copie `pacote-totem/` para o PC do evento e dê dois cliques em `INICIAR.cmd`
(ou `INICIAR.cmd 3d`). Não precisa instalar Node. Detalhes em `operacao/LEIA-ME.txt`.

**Atenção:** os dados ficam no navegador para o endereço `http://localhost:4173`. Use sempre o
`INICIAR.cmd` (mesma porta, mesmo perfil). Nunca use `msedge --kiosk` (InPrivate apaga tudo).

Administrador: **5 toques no canto superior esquerdo** ou `Ctrl+Shift+A`, depois o PIN.

## Identidade visual

Paleta oficial do PDF (`#ffffff #6982b0 #616d85 #4c5262 #374254 #0a2248 #11203d #1c2134`);
cores das fitas da capa só como luz/acento. Títulos em **Resagokr** (coloque os `.woff2` em
`public/fonts/`; sem eles usa Jura como reserva) e textos em **Inria Serif**.

## Privacidade (LGPD)

O CPF nunca é gravado: guardamos só uma chave derivada (PBKDF2-SHA-256 com sal do evento).
Isso é **pseudonimização**, não anonimização. Ao fim do evento use *Encerrar evento e apagar dados*
e apague os backups exportados.
