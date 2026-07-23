# B3 Score — dados oficiais

Este repositório mantém os dados públicos usados pelo B3 Score Gratuito.

## Fontes

- **B3 COTAHIST:** preço oficial de fechamento, abertura, máxima, mínima, volume e quantidade negociada.
- **CVM Dados Abertos:** cadastro, patrimônio, número de cotistas, P/VP calculado, dividend yield informado, imóveis, vacância, inadimplência e composição patrimonial dos FIIs.

Nenhum dado ausente é inventado. Indicadores sem base oficial suficiente permanecem vazios.

## Atualização automática

O GitHub Actions executa em dias úteis às **19h17 de Boa Vista (23h17 UTC)** e também pode ser iniciado manualmente:

1. Abra a aba **Actions**.
2. Selecione **Atualizar dados oficiais B3 e CVM**.
3. Clique em **Run workflow**.

Se o pregão mais recente ainda não estiver publicado, o script procura as datas anteriores. Se a coleta falhar, o arquivo anterior continua disponível.

## Arquivos consumidos pelo aplicativo

- `data/fii-catalog.json` — cotações e indicadores de FIIs.
- `data/status.json` — data/hora da coleta, data do pregão e quantidade de fundos.

URL pública do catálogo:

`https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/fii-catalog.json`

## Escopo atual

Esta primeira automação cobre **FIIs**. Ações e units continuarão usando o snapshot já existente até a próxima etapa, que adicionará DFP/ITR/FCA da CVM e o fechamento oficial da B3 para calcular P/L, P/VP, ROE, margens e endividamento com período e fórmula exibidos.
