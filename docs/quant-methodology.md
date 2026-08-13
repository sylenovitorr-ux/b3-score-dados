# Metodologia quantitativa do B3 Score

Versão do motor: `1.0.0`.

## Princípios

- Fatos observados não são alterados pelo perfil.
- Premissas e estimativas são identificadas e separadas dos dados brutos.
- Um componente ausente não recebe zero; ele sai do denominador e reduz cobertura/confiança.
- Todo cálculo importante expõe fonte, referência, fórmula, entradas, resultado e limitações.

## Perfis

O padrão é **Agressivo**. Os pesos desse perfil são: valuation 15%, qualidade 12%, crescimento 15%, rentabilidade 12%, endividamento 8%, momentum 10%, risco 8%, liquidez 5%, consistência 5% e assimetria 10%.

Os limites de concentração, volatilidade, drawdown, derivativos, liquidez, margem de segurança e relação risco/retorno podem ser ajustados na interface. Isso muda adequação e premissas; não muda os fatos.

## Score e confiança

O Score é a média ponderada dos componentes calculáveis. A cobertura é a soma dos pesos originalmente disponíveis. A confiança combina:

- 45% qualidade/atualidade das fontes;
- 40% cobertura dos componentes;
- 15% ausência de anomalia estatística.

Essa confiança não representa probabilidade de ganho.

## Valuation

Modelos implementados quando adequados:

- Graham: `√(22,5 × LPA × VPA)`;
- múltiplo de lucro: `LPA × P/L-alvo`;
- múltiplo patrimonial: `VPA × P/VP-alvo`;
- DCF de cinco anos, apenas com três FCF positivos e ações válidas;
- valor patrimonial por cota para FIIs.

Fluxo de dividendos e múltiplos históricos aparecem como indisponíveis até existir histórico suficiente. O consenso mostra média simples, ponderada e pesos efetivos apenas dos modelos válidos.

## Risco e momentum

- volatilidade: desvio-padrão amostral dos retornos diários × `√252`;
- VaR histórico 95% de um dia: oposto do percentil de 5%;
- drawdown: maior queda entre um pico observado e fundo posterior;
- retornos 20/60/126/252 pregões;
- MM20, MM50, MM200 e RSI14.

Beta e correlação exigem uma série sincronizada do benchmark. Sem ela, permanecem indisponíveis.

## Opções

O laboratório implementa Black-Scholes europeu, Delta, Gamma, Theta, Vega, Rho e volatilidade implícita por bisseção. Também calcula valor intrínseco/extrínseco, moneyness, break-even, liquidez e payoff de call comprada, put comprada, call coberta, put protetiva, bull call spread, bear put spread e collar.

Não existe recomendação automática de lançamento descoberto. Entradas do contrato são manuais até uma cadeia auditável ser integrada.

## Carteira e persistência

As posições reais usam `b3-score-positions-v2`. Armazenamentos anteriores não são apagados. A migração aceita posições legadas reconhecíveis, preserva `null` quando a cotação não existe e calcula custo, valor atual, P&L, peso, classe, setor, Top 3 e Top 5.

Volatilidade agregada não é exibida sem correlações sincronizadas; somar volatilidades seria incorreto.
