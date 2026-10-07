# Geografia eleitoral da Unidade Popular — Baixada Santista

Pipeline reprodutível para localizar a força eleitoral da Unidade Popular (UP) nos nove municípios da Baixada Santista, utilizando prioritariamente dados oficiais do Tribunal Superior Eleitoral (TSE).

> Situação em 5 de outubro de 2026: candidaturas e locais de votação estão disponíveis; os resultados detalhados de 2026 ainda não foram publicados pelo TSE. A pipeline processa as fontes disponíveis e falha de forma explícita antes de calcular votos sem fonte oficial.

## Escopo

Região padrão: Bertioga, Cubatão, Guarujá, Itanhaém, Mongaguá, Peruíbe, Praia Grande, Santos e São Vicente (SP).

O primeiro estágio produz:

- candidaturas UP relevantes, identificadas automaticamente no cadastro do TSE;
- seções e locais de votação da região, com endereço, bairro, coordenadas e eleitorado;
- tabelas CSV e Parquet;
- manifesto de fontes/URLs e hashes de downloads;
- relatório de qualidade pré-resultados.

O Portal Resultados do TSE já permite uma etapa municipal via JSON oficial. Seção, zona, local e bairro continuam dependentes da publicação dos respectivos arquivos detalhados no Dados Abertos.

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

O comando padrão executa o estágio pré-resultados e verifica a disponibilidade de votação por seção e município/zona. Enquanto esses recursos não existirem no Portal do TSE, termina com código 2 após gerar as saídas pré-resultados.

```powershell
python main.py --year 2026 --party UP --region baixada_santista
```

## Dados e rastreabilidade

As URLs não são hard-coded para download. A cada execução, a pipeline consulta a API CKAN do Portal de Dados Abertos, registra o recurso encontrado em `data/raw/sources_YYYY.json` e só então baixa o arquivo. Cada download recebe um manifesto com URL, tamanho, data e SHA-256.

Fontes verificadas na discovery:

- [Candidatos 2026 — TSE](https://dadosabertos.tse.jus.br/dataset/candidatos-2026)
- [Eleitorado 2026 — TSE](https://dadosabertos.tse.jus.br/dataset/eleitorado-2026)
- [Resultados 2022 — TSE](https://dadosabertos.tse.jus.br/dataset/resultados-2022)

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
