# SPEC — Manga/Comic → E-reader Converter

## Objetivo

Aplicação que converte arquivos de mangá/quadrinhos (CBR, CBZ, ZIP/RAR de
imagens) em formatos otimizados para leitura em e-readers, com foco em Kindle.
A entrega principal é um **web app** (upload → conversão → download), com um CLI
de conveniência sobre o mesmo núcleo.

---

## 1. Extração de arquivos

- **CBR** = arquivo RAR renomeado. RAR3/4 usam compressão proprietária;
  `unrar-free` e `bsdtar` (libarchive) **falham** na descompressão. A solução
  confiável é o wheel pré-compilado **`unrar2-cffi`** do PyPI, importável como
  `unrar.cffi.rarfile`.
- **Quirk crítico:** nessa lib, ler vários membros do mesmo handle pode lançar
  `BadRarFile error 12`. Ler **um membro por vez** com `rf.read(name)` resolve.
- Arquivos de origem ocasionalmente têm **1 imagem corrompida**. Uma página ruim
  **não pode abortar o lote** — pula-se e registra-se a falha
  (`ExtractionReport.skipped`).
- **CBZ/ZIP** = trivial, `zipfile` nativo do Python.
- Detecção de formato por **magic bytes** primeiro (`PK` = zip, `Rar!\x1a\x07`
  = rar), com fallback para a extensão.

Implementado em `mangaconv/core/extract.py`.

## 2. Ordenação de páginas

Alfabético ≠ ordem de leitura. Casos tratados:

- Numeração sem zero-padding (`1, 2, … 10`) → **natural sort** (números
  comparados como inteiros).
- Prefixos de capítulo (`ch17/page03`) → tokens numéricos por segmento.
- Spreads (`004-005`) → detecção via `is_spread()`.
- Sufixos de letra (`000a, 000b`) → preservados pela tokenização texto/número.
- Extras/créditos/omake → **vão para o fim**; capas → **vão para o início**
  (`separate_matter`, configurável).

Implementado em `mangaconv/core/ordering.py`.

## 3. Decisão de formato (a parte mais importante)

- **PDF é ruim no Kindle**: não reflui, texto pequeno, arquivo grande.
- **AZW3/MOBI descontinuado** no Send to Kindle (só via USB+Calibre hoje).
- **EPUB de layout fixo (fixed-layout / pre-paginated)** é a escolha certa:
  aceito pelo Send to Kindle, convertido nativamente, cada página ocupa a tela.

PDF permanece disponível como opção secundária (`img2pdf`).

## 4. Otimização qualidade × tamanho

- **Resolução nativa exata** do dispositivo é a chave para texto nítido
  (Paperwhite 11/12 gen = **1236×1648**). Reduzir "no escuro" (ex: 1050px)
  degrada o texto. A imagem é encaixada (fit) na tela preservando proporção,
  com reamostragem **Lanczos**.
- E-ink é grayscale → converter para modo `L` (8-bit cinza) economiza muito
  espaço sem perda visual.
- `ImageOps.autocontrast(cutoff=1)` melhora o contraste para e-ink.
- **Limite de 50 MB** do Send to Kindle → **dividir o volume em N partes**
  preserva resolução nativa em vez de degradar qualidade. Budget padrão por
  parte: ~48 MB (folga para o container).
- **Qualidade JPEG adaptativa:** busca binária do maior `q` (≤ cap) que mantém
  cada parte abaixo do budget.

Implementado em `mangaconv/core/imageopt.py` e `mangaconv/core/splitter.py`.

## 5. Estrutura do EPUB fixed-layout (requisitos que funcionaram)

- `mimetype` deve ser a **primeira entrada** do ZIP e **não comprimido**
  (`ZIP_STORED`). Construímos o ZIP à mão para garantir isso; o EbookLib é usado
  só para **validação** do resultado.
- OPF: `rendition:layout = pre-paginated`, `rendition:orientation = portrait`,
  `rendition:spread = none`.
- Cada página: um XHTML com `<meta name="viewport" content="width=W,
  height=H">` correspondente à imagem, e `<img object-fit: contain>`.
- `page-progression-direction` = `rtl` para mangá.
- Primeira imagem marcada como `cover-image`.
- Validação com `EbookLib` (`epub.read_epub`) antes de entregar.

Implementado em `mangaconv/core/epubbuilder.py`.

---

## Stack

Python 3.11 · Pillow · `unrar2-cffi` · `zipfile` · `EbookLib` (validação) ·
`img2pdf` (PDF opcional) · FastAPI + Uvicorn + Jinja2 (web).

## Arquitetura

```
mangaconv/
  core/
    devices.py       # perfis de dispositivo (resolução, limites)
    extract.py       # CBZ/CBR/ZIP/RAR → páginas
    ordering.py      # ordem de leitura (natural sort + front/back matter)
    imageopt.py      # resize nativo, grayscale, autocontrast, q adaptativo, spreads
    epubbuilder.py   # EPUB 3 fixed-layout + validação
    splitter.py      # divisão por budget de tamanho
    converter.py     # orquestra a pipeline
  web/
    app.py           # FastAPI: / , /api/devices , /api/convert
    templates/, static/
  cli.py             # CLI (convert / devices / serve)
```

---

## Roadmap / funcionalidades futuras

- [x] Perfis de resolução (Paperwhite, Basic, Oasis, Scribe, Colorsoft, Kobo,
      reMarkable, tablet genérico).
- [x] Splitting automático por limite de tamanho configurável.
- [x] Detecção de spreads (landscape) com opção de dividir em duas páginas.
- [x] Batch de múltiplos volumes (CLI).
- [ ] **Detecção automática de modelo** de Kindle a partir do contexto.
- [ ] **Preview** das primeiras páginas antes de processar (web).
- [ ] Detecção de spread baseada em conteúdo (não só aspect ratio/filename).
- [ ] Upload em batch pela interface web com fila de progresso.
- [ ] Perfis adicionais e ajuste fino de gamma por dispositivo.
