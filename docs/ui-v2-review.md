# Relatório de revisão — navegação v2

## Arquitetura proposta

A aplicação continua sem dependência de roteador externo. O módulo `navigation.js` centraliza rotas hash compatíveis com GitHub Pages e mantém os hashes antigos.

Rotas preparadas:

- `#/`
- `#/radar`
- `#/oportunidades`
- `#/analisar`
- `#/ativo/:ticker`
- `#/comparador`
- `#/quant/:ticker`
- `#/simulador`
- `#/opcoes`
- `#/carteira`
- `#/metodologia`
- `#/alertas`

## Componentes novos

- `HomeHub`: home enxuta, pesquisa rápida e cards por finalidade.
- `ComparisonPage`: até quatro ativos, base 100, tabela e comparação setorial.
- `SimulatorPage`: hub para ação, FII, carteira e opções.
- `MethodologyPage`: fluxo educacional, fontes e limitações.
- `comparison-engine`: normalização e posição relativa testáveis fora da interface.

## Funcionalidades preservadas

- Radar, oportunidades, alertas, análise individual, Quant, opções e carteira.
- Valuation, scores, confiança, backtest, gráficos, auditoria e fontes.
- Estratégias e cálculos do laboratório de opções.
- Todos os identificadores de `localStorage` anteriores.
- Atualização automática, cache e instalação PWA.

## Melhorias adicionais implementadas

- URL direta por ticker para análise e Quant.
- Página individual deixa de depender visualmente de modal na rota do ativo.
- Comparação normalizada não confunde preço nominal com retorno.
- Comparação setorial respeita métricas em que menor ou maior é preferível.
- Leitura Quant transforma cálculos existentes em frases determinísticas.
- Opções perguntam primeiro o objetivo e filtram estratégias compatíveis.
- Foco visível, alvos maiores e layout adaptativo nas páginas novas.

## Regressões verificadas

- Links antigos testados pelo novo parser.
- Ausência convertida incorretamente em zero foi encontrada no primeiro teste do comparador e corrigida.
- Motores financeiros não foram alterados.
- Testes JavaScript: 47 aprovados.
- Testes Python: 14 aprovados.
- Build Vite de produção: aprovado.

## Limitações ainda existentes

- IBOV, CDI e índices setoriais não têm séries sincronizadas; nenhum benchmark foi fabricado.
- Candles usam OHLC disponível no snapshot, mas a versão v2 ainda mantém o gráfico SVG atual.
- Bid, ask e open interest de opções não existem no COTAHIST.
- O tema claro permanece como padrão; uma alternância global completa exigirá revisar componentes legados antes de ser ativada.
- Esta branch é de revisão e não deve ser publicada automaticamente.

## Próximos upgrades recomendados

1. Sincronizar séries oficiais de benchmarks e alinhar calendários.
2. Extrair páginas legadas restantes de `App.jsx` sem reescrever motores.
3. Avaliar Lightweight Charts em branch isolada com medição de bundle e acessibilidade.
4. Adicionar testes de interface em viewport móvel e desktop no CI.
