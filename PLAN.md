# Plano de discovery — Geografia eleitoral da Unidade Popular na Baixada Santista

Data da verificação: 5 de outubro de 2026 (America/Sao_Paulo).

Atualização: em 7 de outubro de 2026, o Portal Resultados do TSE passou a disponibilizar JSONs oficiais por município. A pipeline passou a importar a etapa municipal diretamente desses JSONs; o Portal de Dados Abertos ainda não publicou votação por seção nem votação nominal por município/zona como arquivos tabulares.

## Conclusão da discovery

É possível construir uma pipeline reproduzível, com recorte territorial até a seção e o local de votação, usando fontes oficiais do TSE. A base oficial de **locais de votação de 2026** já contém bairro, endereço, latitude/longitude e eleitorado por seção: não será necessário inferir bairro a partir do nome da escola na maior parte dos casos.

Contudo, nesta data os arquivos de resultados de 2026 necessários para calcular votos ainda não constam no Portal de Dados Abertos. As URLs convencionais dos três arquivos abaixo foram verificadas e retornaram HTTP 404:

- votação por seção SP;
- votação nominal por município/zona;
- boletim de urna SP.

O projeto deverá detectar essa condição no download, encerrar com mensagem clara e preservar as fontes já baixadas. Não deve produzir tabelas ou conclusões de voto enquanto não houver arquivo oficial publicado.

## Fontes oficiais identificadas

| Finalidade | Conjunto / arquivo | URL | Estado na discovery |
|---|---|---|---|
| Cadastro de candidaturas | `Candidatos` (CSV por UF e Brasil) | https://dadosabertos.tse.jus.br/dataset/candidatos-2026 e https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip | Publicado |
| Locais, seções, endereço, bairro, coordenadas e eleitorado | `Eleitorado por local de votação - 2026` | https://dadosabertos.tse.jus.br/dataset/eleitorado-2026 e https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip | Publicado |
| Perfil/eleitorado de seção (complementar) | `Perfil do eleitorado por seção eleitoral — SP` | https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_eleitor_secao/perfil_eleitor_secao_2026_SP.zip | Publicado |
| Correspondência de urnas esperadas | `Resultados 2026 — Correspondências esperadas e efetivadas — 1º turno` | https://dadosabertos.tse.jus.br/dataset/resultados-2026-correspondencias-esperadas-e-efetivadas-1-turno | Publicado; auditoria operacional, não fonte de votos |
| Votos detalhados | Futuro conjunto `Resultados — 2026` | Portal de Dados Abertos do TSE / CDN | Ainda não publicado em 05/10/2026 |
| Boletins de urna | Futuro conjunto `Resultados — 2026 — Boletim de Urna` | Portal de Dados Abertos do TSE / CDN | Ainda não publicado em 05/10/2026 |
| Referência histórica 2022 | `Resultados — 2022` | https://dadosabertos.tse.jus.br/dataset/resultados-2022 | Publicado |

Fonte complementar já utilizada para município: `https://resultados.tse.jus.br/oficial/ele2026/` (JSON público do Portal Resultados). Para cada cargo e município, a URL incorpora o código do pleito, do cargo, da UF e do município; a pipeline registra URL, conteúdo e SHA-256 em `data/raw/results_portal/`.

O downloader **não** deve codificar URLs previstas de 2026 como fato. Ele consultará a API CKAN do TSE (`/api/3/action/package_show`) e selecionará recursos pelo nome/descrição. A URL de 2022 confirma que o TSE publicou, naquele pleito, votação nominal por município/zona e votação por seção por UF; ela é referência para o adaptador histórico, não garantia de schema ou URL de 2026.

## Esquemas efetivamente examinados

Os CSVs inspecionados são separados por `;` e codificados em Windows-1252/Latin-1. A pipeline deve tentar `utf-8-sig`, depois `cp1252`, registrar o encoding efetivo e nunca abrir os arquivos grandes inteiros sem filtro.

### Candidatos: `consulta_cand_2026_SP.csv` e `consulta_cand_2026_BR.csv`

Colunas confirmadas relevantes: `ANO_ELEICAO`, `NR_TURNO`, `SG_UF`, `SG_UE`, `NM_UE`, `CD_CARGO`, `DS_CARGO`, `SQ_CANDIDATO`, `NR_CANDIDATO`, `NM_CANDIDATO`, `NM_URNA_CANDIDATO`, `CD_SITUACAO_CANDIDATURA`, `DS_SITUACAO_CANDIDATURA`, `NR_PARTIDO`, `SG_PARTIDO`, `NM_PARTIDO`, `CD_SIT_TOT_TURNO`, `DS_SIT_TOT_TURNO`.

Regra de seleção: `SG_PARTIDO == partido` (padrão `UP`), com cargos-alvo configuráveis. Para Presidente, ler a parte Brasil; para cargos de SP, ler a parte SP. A discovery encontrou registros UP para Presidente, Governador, Senador, Deputado Federal e Deputado Estadual. Isso será calculado automaticamente em cada execução; nomes não serão cadastrados no código.

### Locais: `eleitorado_local_votacao_2026_SP.csv`

Colunas confirmadas relevantes: `SG_UF`, `CD_MUNICIPIO`, `NM_MUNICIPIO`, `NR_ZONA`, `NR_SECAO`, `NR_LOCAL_VOTACAO`, `NM_LOCAL_VOTACAO`, `DS_ENDERECO`, `NM_BAIRRO`, `NR_CEP`, `NR_LATITUDE`, `NR_LONGITUDE`, `QT_ELEITOR_SECAO`, `QT_ELEITOR_ELEICAO_FEDERAL`, `QT_ELEITOR_ELEICAO_ESTADUAL`, além dos indicadores de seção/local ativo e de seção agregada.

`NM_BAIRRO` será a classificação primária, com `bairro_origem = "TSE_eleitorado_local_votacao"` e nível de confiança alto. Nulo/vazio será preservado como não classificado; enriquecimento externo só ocorrerá em etapa opcional e auditável.

### Perfil de seção: `perfil_eleitor_secao_2026_SP.csv`

Chave confirmada: `SG_UF`, `CD_MUNICIPIO`, `NR_ZONA`, `NR_SECAO`, `NR_LOCAL_VOTACAO`. A medida `QT_ELEITORES` é segmentada por perfil, portanto só poderá ser somada após eliminar as dimensões demográficas ou usada como validação, não somada cegamente sobre linhas.

### Correspondências esperadas: `csec_1t_SP_031020261534.csv`

Chave confirmada: `SG_UF`, `CD_MUNICIPIO`, `NR_ZONA`, `NR_SECAO`, `NR_LOCAL_VOTACAO`, com identificador de urna esperada. Será opcional para checar cobertura operacional; não substitui resultado nem boletim de urna.

## Chaves e modelo de dados

Chave territorial canônica de seção: `ano, turno, sg_uf, cd_municipio, nr_zona, nr_secao`.

Chave canônica de local: `ano, sg_uf, cd_municipio, nr_zona, nr_local_votacao`. O nome e endereço serão atributos, nunca chave. Para candidatos, usar `sq_candidato` como chave técnica, mantendo `nr_candidato` e cargo para exibição.

| Entrada | Relação | Saída |
|---|---|---|
| candidaturas UP | `sq_candidato` e cargo/número no resultado | dimensão de candidaturas UP |
| votação por seção (futura) | chave da seção + identificador do candidato | fatos de votos por candidato/seção |
| locais TSE | chave da seção | seção enriquecida com local, endereço, bairro, coordenadas e eleitorado |
| votação nominal município/zona (futura) | município/zona/candidato | controle de totalização |
| BU (futuro) | seção/urna/cargo/candidato | auditoria e reconciliação, quando necessário |

## Recorte e cálculos propostos

O recorte será uma configuração regional contendo os nove municípios: Santos, São Vicente, Guarujá, Cubatão, Praia Grande, Bertioga, Mongaguá, Itanhaém e Peruíbe, todos em SP. A seleção preferirá códigos de município TSE derivados dos próprios arquivos, com validação de exatamente nove nomes; outras regiões serão adicionadas em YAML, sem alterar código.

Para cada candidato e cargo, os percentuais usarão o denominador correspondente ao cargo, preferencialmente votos válidos do mesmo nível territorial e turno. O pipeline conservará separadamente votos nominais, branco, nulo, total apurado e votos válidos quando essas medidas existirem no arquivo oficial. Não tratará eleitorado como votos válidos.

O índice territorial UP será uma média simples dos percentuais por candidatura/cargo disponíveis no território, depois de normalizar cada percentual pela taxa estadual daquele cargo (`percentual_territorio / percentual_SP_do_candidato`). A saída trará cobertura, candidatos incluídos e versão metodológica. Ele compara presença relativa, mas não é intenção de voto, soma de votos, nem medida causal; territórios com cobertura insuficiente serão marcados.

Correlação entre candidaturas: matriz de Spearman (e `n` de locais) sobre percentuais por local ou seção, somente onde ambos os denominadores forem positivos. Também serão produzidos resíduos padronizados por candidato para identificar locais fortes de modo consistente ou específico. Resultados com poucos locais serão suprimidos/assinalados; correlação não será interpretada como causalidade.

## Arquitetura proposta

```text
data/raw/                 # ZIPs e manifestos de download, nunca alterados
data/processed/           # Parquet normalizado e dimensões territoriais
data/geographic/          # limites e metadados geográficos/versionados
src/config/               # regiões, cargos e configuração de fontes
src/download/             # cliente CKAN, cache, checksum e manifesto
src/processing/           # leitores em chunks, normalização e joins
src/analysis/             # métricas, índice, correlações e qualidade
src/geography/            # preparação de camadas e joins espaciais opcionais
src/visualization/        # gráficos e mapas
outputs/tables/           # CSV/Parquet finais
outputs/charts/           # PNG/SVG
outputs/maps/             # GeoJSON/HTML estático quando aplicável
outputs/reports/          # relatório Markdown e qualidade
main.py
```

O comando-alvo será `python main.py --year 2026 --party UP --region baixada_santista`. Ele executará: discovery de fontes → download com cache → validação → normalização → agregações → análise → artefatos. Haverá uma opção de fase (`--stage`) para executar ou depurar cada etapa e um modo `--require-results` que falha se o TSE ainda não publicou resultados.

## Validações obrigatórias

- os nove municípios devem aparecer no cadastro de locais;
- deve haver ao menos uma candidatura do partido nos cargos configurados, ou a execução falha explicando a condição;
- a chave de seção não pode gerar multiplicação de linhas no join;
- votos agregados seção → zona → município devem reconciliar com o arquivo oficial município/zona, por candidato/cargo/turno;
- seções sem local, locais sem bairro e coordenadas ausentes entram em relatório de qualidade;
- duplicidades, valores negativos, denominadores nulos e percentuais fora de `[0, 100]` interrompem a etapa afetada;
- downloads registram URL, data, tamanho, hash SHA-512 quando o TSE o fornecer e encoding;
- comparação 2022–2026 será por chaves e atributos explícitos; se seção/local mudou, será classificada como não comparável em vez de forçar correspondência.

## Etapas de implementação propostas

1. Criar esqueleto Python, configuração regional, logger, manifestos e cliente de discovery/download do CKAN.
2. Implementar e testar a ingestão de candidatos e locais já disponíveis; gerar relatório de disponibilidade e qualidade pré-resultados.
3. Implementar adaptadores de resultados/BU a partir dos recursos **efetivamente publicados** para 2026, inspecionando schema no primeiro download e versionando o mapeamento de colunas.
4. Implementar fatos por seção, agregações município/zona/local/bairro, reconciliação e outputs CSV/Parquet.
5. Implementar índice UP, comparação entre candidaturas, relatório Markdown e visualizações.
6. Incluir adaptador 2022 e comparador que trate mudanças territoriais de forma conservadora.
7. Adicionar camadas geográficas de fonte pública confiável após escolha e licença verificadas; os pontos de locais poderão ser mapeados diretamente pelas coordenadas oficiais do TSE.

## Limitações conhecidas

- Resultados 2026 não estavam publicados na fonte primária em 05/10/2026; portanto ainda não há análise eleitoral válida a executar.
- Bairro TSE descreve o endereço cadastrado do local de votação, não uma área de captação eleitoral. Agregações por bairro devem ser apresentadas com essa ressalva.
- Uma seção pode estar agregada, transferida ou inativa; os campos de situação e seção principal precisam ser preservados.
- Resultados por local serão obtidos agregando seções ao local. Não se deve pressupor que todos os eleitores residentes no bairro votem naquele local.
- Polígonos oficiais de bairros podem não ter cobertura/metodologia homogênea nos nove municípios; a primeira versão deve entregar ranking por bairro textual e pontos, e só fazer coropletas de bairro onde os limites forem auditáveis.
