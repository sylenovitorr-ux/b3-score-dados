# Inventário funcional anterior à navegação v2

Data da auditoria: 2026-08-15. Base: `main` no commit `041b7ec3`.

## Dados e atualização

- Catálogo de ações, units e FIIs com fechamento B3 D-1.
- Fundamentos de companhias por DFP/ITR e dados de FIIs por informes CVM.
- Proventos oficiais, radar diário, histórico de até 260 pregões e detector de anomalias.
- Cadeia de opções COTAHIST, Selic do Banco Central e atualização automática diária.
- Cache remoto, fallback de snapshot e PWA com service worker.

## Navegação e telas existentes

- Home com perfil, guia, simulador, pesquisa, filtros e listagem de ativos.
- Radar diário, valuation/oportunidades, integridade de movimentos, Central Quant e opções.
- Análise detalhada de ações e FIIs em sheet/modal.
- Carteira simulada na home e carteira real local dentro do Quant.

## Análise individual

- Leitura do sistema separada para quem possui e para quem não possui.
- Preço atual, valor justo, entrada, saída, saída defensiva e horizonte.
- Score geral, pilares, confiança e composição auditável.
- Fundamentos, demonstrativos, proventos, fontes e estados de disponibilidade.
- Gráfico de preço/volume, valor justo atual, eventos, contexto, cenários e evidências.

## Motores preservados

- `opportunity-engine`: valuation, oportunidade, plano de posição e leitura quantitativa.
- `quant/quant-engine`: score por dez componentes, valuation multimodelo, risco e backtest.
- `quant/options-engine`: Black-Scholes, IV, gregas, liquidez, Option Score e payoff.
- `quant/portfolio-engine`: posições, migração, P&L, concentração e alertas.
- `quant/context-engine`: movimentos, relevância, eventos e cenários.
- `formatters`: formatação segura sem converter ausências em zero.

## Persistência local preservada

- `b3-score-cache-v11`
- `b3-score-favorites-v2`
- `b3-score-investor-profile-v1`
- `b3-score-platform-v1`
- `b3-score-portfolio-v1`
- `b3-score-portfolio-positions-v2`
- `b3-score-quant-profile-v1`
- `b3-score-option-contracts-v1`

## Problemas constatados

- `App.jsx` concentrava 1.384 linhas e muitas responsabilidades.
- Home acumulava hub, tutorial, perfil, simulador, filtros, ranking e metodologia.
- Rotas eram estados manuais com hashes diferentes e sem ticker endereçável.
- Análise completa abria como modal mesmo quando deveria funcionar como página.
- Não havia comparador dedicado nem comparação setorial/base 100.
- Simuladores e carteira não tinham isolamento de navegação.
- Header ficava saturado em larguras intermediárias.

## Critério de regressão

Nenhum motor foi reescrito. A navegação v2 deve manter acessíveis todos os itens acima; dado ausente continua `null`/indisponível e links legados continuam reconhecidos.
