# RN Genie

Prompt para Lovable — App de Automação de Chamadas de RN (Referência de Nível) em DXF

Contexto

Preciso de um app web para automatizar a criação de "chamadas" de RNs (Referências de Nível topográficas) sobre uma planta baixa georreferenciada em DXF (UTM). Cada RN tem coordenadas X/Y (UTM) e cota Z conhecidas. O app deve identificar automaticamente se a RN está fixada em um POSTE (bloco/INSERT no DXF) ou em um MURO/DIVISA (polilinha/linha no DXF), e desenhar a chamada correspondente no layout já usado no escritório.

Entradas do app

DXF modelo (referência de estrutura): um arquivo DXF de exemplo, já válido e usado normalmente no escritório, contendo pelo menos uma chamada de RN pronta (como nos exemplos de POSTE e MURO), a layer ELEVACAO_19_TEXTO_RNS, o estilo de texto Roman, e tabelas LAYER/STYLE/LTYPE completas e válidas. Esse arquivo NÃO é o desenho de trabalho — serve só como fonte de onde o app extrai (copia) as entradas de tabela (LAYER, STYLE) e o "molde" geométrico da chamada (formato do leader, proporções do sublinhado, espaçamento entre as duas linhas de texto), para reaplicar no arquivo de trabalho sem reconstruir nada do zero. Isso evita o erro de DXF inválido (ex: falta do código 390 na tabela LAYER), porque as entradas de tabela nunca são recriadas manualmente — são clonadas de um arquivo que o AutoCAD já sabe abrir.

DXF de trabalho: a planta baixa georreferenciada real, contendo:

os pontos das RNs já inseridos (como POINT ou bloco, na posição correta em UTM);

blocos (INSERT) que representam postes;

polilinhas/linhas (LWPOLYLINE/LINE) que representam muros, alinhamentos e divisas. É sobre este arquivo que as chamadas serão desenhadas e é ele que será exportado no final.

Planilha (CSV ou XLSX) com Nome (ex: RN35, RN43), X, Y, Z — fonte de verdade dos nomes e cotas das RNs, e da localização (X,Y) usada para casar cada nome com o ponto correspondente no DXF de trabalho (por proximidade: o ponto do DXF mais próximo das coordenadas da planilha recebe aquele nome). Aceitar também uma coluna GrupoChamada para indicar que duas RNs compartilham a mesma chamada visual (como nos exemplos: "RN35/37" e "RN43/45").

Parâmetros configuráveis na interface:

Raio de busca (metros) para casar planilha ↔ ponto no DXF, e para associar a RN ao elemento mais próximo — poste ou muro (padrão: 5 m, ajustável).

Nome(s) de layer(s) onde procurar blocos de poste (ex: POSTE, ILUMINACAO) — lista editável.

Nome(s) de layer(s) onde procurar muros/divisas (ex: MURO, DIVISA, EDIFICACAO) — lista editável.

Layer de saída fixo: ELEVACAO_19_TEXTO_RNS (herdada do DXF modelo).

Lógica de processamento (núcleo do app)

Para cada linha da planilha (ou grupo de RNs que compartilham chamada, via GrupoChamada):

Casar planilha com o DXF de trabalho: localizar, dentro do raio configurado, o ponto (POINT/bloco) do DXF de trabalho mais próximo das coordenadas X/Y daquela linha da planilha. Esse ponto do DXF é o "ponto RN" que vai ancorar a chamada. Se nenhum ponto for encontrado dentro do raio, marcar a linha como "sem ponto correspondente no DXF" e listar para revisão manual.

Classificar POSTE x MURO: a partir do ponto RN já casado, buscar dentro do raio configurado o(s) elemento(s) geométrico(s) mais próximo(s) (ignorando o próprio ponto RN).

Se o elemento mais próximo for um INSERT (bloco) pertencente às layers de poste → classificar como POSTE.

Se o elemento mais próximo for uma LWPOLYLINE ou LINE pertencente às layers de muro/divisa → classificar como MURO (ou DIVISA, se a layer indicar isso).

Se não houver nenhum elemento dentro do raio, ou se houver empate técnico (bloco e linha à distância muito parecida, diferença < 10%), marcar a RN como "revisão manual" — não classificar automaticamente, e listar essas RNs numa tela separada para o usuário decidir manualmente (dropdown POSTE/MURO/DIVISA).

Nunca modificar os elementos geométricos originais do DXF de trabalho — apenas adicionar novas entidades de texto/linha na layer de saída.

Formato da chamada a ser desenhada (replicar exatamente o padrão do DXF modelo)

O molde geométrico exato (proporções, distância do leader ao texto, espessura de linha, espaçamento entre as duas linhas de texto) deve ser extraído da chamada de exemplo já presente no DXF modelo — não deve ser reinventado com valores fixos no código. Baseado nos exemplos fornecidos (RN35/37-POSTE e RN43/45-MURO), cada chamada tem:

Uma linha guia (leader) saindo do ponto da RN até o texto, com seta na ponta do lado da RN.

Linha 1 de texto: {NOME(S) DA RN} - {POSTE|MURO|DIVISA} (ex: RN35/37-POSTE).

Uma linha horizontal (sublinhado) logo abaixo da linha 1, com a mesma largura do texto.

Linha 2 de texto: a cota/elevação Z da RN, com 3 casas decimais (ex: 768.762).

Fonte: Roman (romans.shx), altura de texto 14.

Todas essas entidades (textos, linha guia, sublinhado) devem ser criadas na layer ELEVACAO_19_TEXTO_RNS.

Quando há duas RNs na mesma chamada (ex: RN35 e RN37), a linha guia pode se ramificar em Y a partir das duas RNs até um ponto comum antes do texto (ver exemplo 1) — implementar essa bifurcação quando o CSV indicar GrupoChamada.

Fluxo de UI esperado

Upload do DXF modelo (referência de estrutura — pode ficar salvo como padrão do app após o primeiro upload, sem precisar reenviar toda vez).

Upload do DXF de trabalho (planta com os pontos RN e a geometria de postes/muros).

Upload do CSV/XLSX de RNs (nomes, coordenadas, cotas).

Configuração de parâmetros (raio, layers de poste, layers de muro).

Botão "Processar" → roda o casamento planilha↔ponto e a classificação POSTE/MURO.

Tela de resultados: lista de RNs classificadas automaticamente + lista separada de RNs em "revisão manual" (sem ponto correspondente encontrado, ou classificação ambígua) — com opção de escolher/corrigir manualmente.

Preview visual (canvas 2D simples) mostrando os pontos de RN sobre um esboço do DXF, com cores diferentes por classificação, para conferência rápida antes de exportar.

Botão "Exportar DXF" → gera o DXF final com o DXF de trabalho original + as novas chamadas na layer correta, disponível para download.

Observações técnicas de implementação

Para leitura de DXF em JS/TS, usar uma biblioteca de parsing de DXF (ex: dxf-parser) para extrair entidades (INSERT, LWPOLYLINE, LINE) e suas layers/coordenadas, tanto do DXF modelo quanto do DXF de trabalho.

Regra de ouro para evitar DXF inválido: nenhuma entrada de tabela (LAYER, STYLE, LTYPE) e nenhuma entidade de texto/leader deve ser construída com grupos de código "do zero". Tudo deve ser clonado byte a byte do DXF modelo:

A entrada da layer ELEVACAO_19_TEXTO_RNS (com todos os códigos, incluindo 370 e 390 — o Plot Style Name, obrigatório em DXF 2000+ com $PSTYLEMODE nomeado) deve ser extraída inteira do DXF modelo e colada na tabela LAYER do DXF de trabalho, só se ainda não existir lá.

A entrada de STYLE "Roman"/romans.shx também deve ser clonada do DXF modelo da mesma forma, se não existir no DXF de trabalho.

As entidades TEXT, LINE/LWPOLYLINE (leader e sublinhado) da chamada de exemplo do DXF modelo devem servir de template: o app troca só as coordenadas (posição/rotação) e o conteúdo do texto, mantendo todos os demais grupos de código (handle novo gerado, mas estilo, altura, layer, etc. idênticos ao exemplo).

Isso evita por completo o erro "Did not receive PlotStyleName" / "drawing discarded", porque nenhuma tabela é reconstruída manualmente — é sempre uma cópia de algo que o AutoCAD já sabe abrir.

Inserir as novas entidades (clonadas do modelo) na seção ENTITIES do DXF de trabalho, preservando todo o restante do arquivo intacto (cabeçalho, tabelas, blocos, demais entidades).

Cálculo de distância deve ser feito em coordenadas UTM (metros), já que o desenho está georreferenciado — sem necessidade de conversão de unidades.

Processamento pode ser feito no client (browser) ou em uma edge function, dependendo do tamanho esperado dos arquivos DXF (se a planta da cidade toda for muito grande, recomenda-se processar em edge function para não travar o navegador).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8b6fe4a0-00ff-4756-aaee-3c980fc964cd).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
