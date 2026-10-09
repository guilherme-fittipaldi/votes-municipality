# Geografia eleitoral da Unidade Popular — Baixada Santista

Pipeline reprodutível para localizar a força eleitoral da Unidade Popular (UP) nos nove municípios da Baixada Santista, utilizando prioritariamente dados oficiais do Tribunal Superior Eleitoral (TSE).

> Situação em 9 de outubro de 2026: resultados oficiais por município/zona e por seção de SP foram importados e reconciliados. O dashboard permite explorar o território por zona, local de votação e seção.

## Escopo

Região padrão: Bertioga, Cubatão, Guarujá, Itanhaém, Mongaguá, Peruíbe, Praia Grande, Santos e São Vicente (SP).

O primeiro estágio produz:

- candidaturas UP relevantes, identificadas automaticamente no cadastro do TSE;
- seções e locais de votação da região, com endereço, bairro, coordenadas e eleitorado;
- tabelas CSV e Parquet;
- manifesto de fontes/URLs e hashes de downloads;
- relatório de qualidade pré-resultados.

O painel municipal usa JSON oficial do Portal Resultados do TSE. O explorador usa votação por seção de SP e votação nominal por município/zona do Portal de Dados Abertos, com junção ao cadastro oficial de locais.

O controle de qualidade também registra candidaturas do cadastro que não aparecem nos resultados oficiais divulgados, sem inferir o motivo.

## Instalação

Requer Python 3.11 ou posterior.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Uso

Consultar e registrar a disponibilidade das fontes oficiais, sem baixar arquivos:

```powershell
python main.py --year 2026 --party UP --region baixada_santista --stage discover
```

Baixar com cache e produzir o estágio pré-resultados:

```powershell
python main.py --year 2026 --party UP --region baixada_santista --stage pre-results
```

Importar a votação UP por município diretamente dos JSONs oficiais do Portal Resultados:

```powershell
python main.py --year 2026 --party UP --region baixada_santista --stage municipality-results
```

Importar e reconciliar os arquivos detalhados:

```powershell
python main.py --year 2026 --party UP --region baixada_santista --stage detailed-results
```

O comando padrão executa todas as etapas:

```powershell
python main.py --year 2026 --party UP --region baixada_santista
```

## Dados e rastreabilidade

As URLs não são hard-coded para download. A cada execução, a pipeline consulta a API CKAN do Portal de Dados Abertos, registra o recurso encontrado em `data/raw/sources_YYYY.json` e só então baixa o arquivo. Cada download recebe um manifesto com URL, tamanho, data e SHA-256.

Fontes verificadas na discovery:

- [Candidatos 2026 — TSE](https://dadosabertos.tse.jus.br/dataset/candidatos-2026)
- [Eleitorado 2026 — TSE](https://dadosabertos.tse.jus.br/dataset/eleitorado-2026)
- [Resultados 2026 — TSE](https://dadosabertos.tse.jus.br/dataset/resultados-2026)

Os CSVs TSE examinados usam delimitador `;` e CP1252/Latin-1. O leitor registra fallback de encoding, filtra SP/municípios precocemente e grava Parquet para os estágios analíticos seguintes.

## Estrutura

```text
data/raw/          ZIPs, manifestos e hashes (não versionados)
data/processed/    dados normalizados (não versionados)
data/geographic/   camadas geográficas rastreáveis
src/download/      discovery CKAN, cache e proveniência
src/processing/    ingestão e normalização
src/analysis/      qualidade, métricas e reconciliação
src/geography/     camadas e joins espaciais
src/visualization/ gráficos e mapas
outputs/           tabelas, gráficos, mapas e relatórios gerados
PLAN.md            discovery, esquema, chaves e limitações
```

## Garantias e limites

- Bairro vem do campo oficial `NM_BAIRRO` do local de votação; valores ausentes permanecem ausentes, com origem/confiança explícitas.
- Eleitorado não é usado como sinônimo de votos válidos.
- Nomes/endereço de locais são atributos; as chaves de join são ano, UF, município TSE, zona, seção e número oficial do local.
- Comparações entre 2022 e 2026 devem marcar alterações de seção/local como não comparáveis, nunca forçar equivalência.
- Correlações e índices futuros serão apresentados como associações/medidas descritivas, não como causalidade.

Veja [PLAN.md](PLAN.md) para as fontes completas, colunas confirmadas e plano de implementação.

## Dashboard

Site estático publicado em [votes-municipality.vercel.app](https://votes-municipality.vercel.app/), com arquivos em `dashboard/dist`.

Após executar a pipeline detalhada, gere o arquivo compacto do explorador:

```powershell
python dashboard/build_detailed_data.py
```

O gerador valida a reconciliação e as chaves de seção antes de exportar o JSON. A interface oferece filtros encadeados de município, zona e local, ranking por votos absolutos, navegação zona → local → seção, busca, paginação, inclusão opcional de unidades sem votos e CSV do resultado. Bairro identifica o endereço do local de votação segundo o TSE; não identifica a residência do eleitor. Os percentuais detalhados usam o total de votos da candidatura no recorte, não votos válidos.

O cadastro tem 4.361 seções e 480 locais. Os arquivos detalhados importados de SP cobrem dez candidaturas UP e reconciliam 10.345 votos; a candidatura à Presidência, presente no painel municipal, não aparece nesse recorte detalhado e recebe um aviso de indisponibilidade. Unidades sem votos referem-se ao cadastro, sem inferir comparecimento.

O mapa usa as coordenadas oficiais dos locais (478 válidas; dois locais com código ausente ficam somente nas tabelas). Os mesmos filtros territoriais e de candidatura alimentam os círculos proporcionais por local e uma mancha de calor com raio visual aproximado de 2 km. A mancha suaviza os votos registrados nos locais para evidenciar sua concentração espacial; a intensidade é relativa ao recorte atual. Áreas sem locais não são tratadas como zero. Os votos sem coordenadas são contabilizados no aviso de cobertura, sem deslocamento ou geocodificação presumida.

O mapa descreve a concentração dos votos registrados nos locais, sem inferir residência dos eleitores. Locais que compartilham uma coordenada são somados no símbolo e detalhados no popup. Leaflet 1.9.4 e Leaflet.heat 0.2.0 são distribuídos em `dashboard/dist/vendor`, com as licenças originais; mapa base do OpenStreetMap, carregado apenas para a área visível.

O ranking de bairros agrupa seções pelo bairro do endereço do local de votação informado pelo TSE e preserva a separação entre municípios. Para cada bairro, mostra votos, participação no recorte, seções com votos e número de locais. O ranking descreve o padrão observado; ele não mede, por si só, a efetividade de ações de rua. Para avaliar essa hipótese, o projeto precisa registrar data, bairro/local, quantidade de material, equipe e tipo de ação, e comparar tais registros ao resultado de forma transparente.

Verificação das agregações, cobertura geográfica, concentração e ranking de bairros: `node dashboard/verify_explorer.cjs`. Para testes de interface, sirva `dashboard/dist`, instale Playwright no ambiente e execute `node dashboard/verify_explorer.cjs --browser`; `EXPLORER_URL`, `PLAYWRIGHT_MODULE_PATH` e `CHROME_PATH` são opcionais.
