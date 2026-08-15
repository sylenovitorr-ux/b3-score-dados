# B3 Score — fundamentos e análise quantitativa aberta

Aplicativo educacional para analisar ações, units, FIIs e estratégias com opções usando dados públicos, cálculos determinísticos e trilha de auditoria. A decisão final permanece com o usuário.

## Fontes e atualização

- **B3 COTAHIST:** fechamento, abertura, máxima, mínima, volume, quantidade e histórico de até 260 pregões.
- **B3 Proventos:** eventos em dinheiro por classe de ação.
- **CVM Dados Abertos:** DFP, ITR, FCA e informes mensais/trimestrais de FIIs.
- **GDELT e Google Notícias RSS:** manchetes secundárias identificadas como contexto no radar; ausência de notícia não é tratada como fato positivo ou negativo.

O workflow `update-data.yml` roda diariamente às 19h17 de Boa Vista e preserva o snapshot anterior quando uma fonte falha. Datas, fontes e estados de disponibilidade são exibidos na interface.

## Camadas

1. `data/` — snapshots recebidos ou derivados de fontes públicas.
2. `scripts/` — coleta, validação contábil, proventos, radar e anomalias.
3. `site/src/quant/` — perfis, validade, estatística, valuation, opções e carteira.
4. `site/src/` — interface React/PWA compatível com GitHub Pages.

Dados ausentes permanecem `null`. A interface apresenta “Dado indisponível” ou “Dados insuficientes para calcular”; ausência nunca é substituída silenciosamente por zero.

## Painel individual do ativo

Ao abrir uma ação ou FII, o painel gráfico preserva toda a análise anterior e acrescenta:

- retornos de 1, 5 e 20 pregões, volatilidade, volume contra a média, aceleração e gaps quando a abertura estiver disponível;
- gráfico responsivo de preço, volume, valor justo atual e eventos;
- scores separados de fundamentos, valuation, momentum, contexto, risco e confiança;
- justificativa auditável da divergência entre preço e valor fundamental;
- fundamentos históricos por métrica;
- cenários pessimista, base e otimista em faixas, sem probabilidades inventadas;
- evidências oficiais e notícias classificadas por relevância, fonte, data e relação com o ativo.

Os eventos são apresentados como associação temporal. O aplicativo não converte coincidência em causalidade comprovada.

## Desenvolvimento

```bash
python -m unittest discover -s scripts -p 'test_*.py' -v
cd site
npm ci
npm test
npm run build
```

Metodologia detalhada: [`docs/quant-methodology.md`](docs/quant-methodology.md).

## Limitações importantes

- A cadeia de opções usa o fechamento oficial D-1 da B3. Bid, ask e open interest continuam indisponíveis no COTAHIST; o modo manual permanece identificado.
- CDI, IPCA e IBOV sincronizados ainda não fazem parte do snapshot; comparações que dependeriam dessas séries ficam indisponíveis.
- O histórico de valor justo não é fabricado: enquanto só existir o valor atual, o gráfico mostra apenas essa referência e informa a limitação.
- Alertas estatísticos de preço/volume não comprovam fraude, manipulação ou intenção.
- Scores, preço justo, payoff e backtests são ferramentas educacionais, não ordens nem garantias.
