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

## Limitações contornadas nesta revisão

- IBOV, IFNC, IMAT, ICON, IEEX, IDIV e SMLL agora usam a evolução diária oficial da B3; CDI usa SGS 12 do Banco Central. As séries mantêm fonte, referência, normalização e fallback explícitos.
- O gráfico principal passou de SVG para Canvas nativo, com candles, linha, volume, MM20/50/200, valor justo, eventos, tooltip e tabela textual acessível, sem adicionar dependência.
- Como bid, ask e open interest não existem no COTAHIST, o laboratório aceita fotografia CSV da corretora ou de outra fonte identificada. Validação rejeita book cruzado, OI inválido e dados sem fonte/data; fotografia defasada não libera o contrato.
- A alternância claro/escuro agora é global, fica salva em `b3-score-theme-v1` e mantém claro como padrão.
- O CI armazena o build como artefato por 14 dias para revisão, sem executar deploy. A branch continua sem publicação ou merge automáticos.

## Validação após os contornos

- 52 testes JavaScript aprovados.
- 18 testes Python aprovados.
- Build Vite de produção aprovado, incluindo `data/benchmarks.json` no artefato.
- O workflow de validação possui somente permissão de leitura e não pode publicar no GitHub Pages.

## Próximos upgrades recomendados

1. Monitorar a disponibilidade dos endpoints oficiais e a defasagem de cada série.
2. Extrair páginas legadas restantes de `App.jsx` sem reescrever motores.
3. Avaliar Lightweight Charts em branch isolada com medição de bundle e acessibilidade.
4. Adicionar testes de interface em viewport móvel e desktop no CI.
