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

O motor de opções usa a versão `2.0.0`. O contrato é cadastrado manualmente até existir uma cadeia pública e auditável; o spot continua vindo do fechamento B3 identificado na tela. A origem, a data de referência e a distinção entre dado informado e cálculo local acompanham a análise.

### Cálculos do contrato

- ATM quando `|K/S − 1| ≤ 1%`; fora dessa faixa, o valor intrínseco determina ITM ou OTM;
- DTE é o teto da diferença entre o fim do vencimento em UTC e a data de referência;
- spread absoluto é `ask − bid` e spread relativo é `spread / midpoint`;
- CALL: intrínseco `max(S − K, 0)` e break-even `K + prêmio`;
- PUT: intrínseco `max(K − S, 0)` e break-even `K − prêmio`;
- valor extrínseco é `prêmio − valor intrínseco`.

Black-Scholes europeu calcula preço teórico, Delta, Gamma, Theta, Vega e Rho somente com spot, strike, prazo, taxa e volatilidade válidos. A volatilidade implícita é encontrada por bisseção entre 0,01% e 500% a.a., respeitando limites de não arbitragem. Falha de entrada ou convergência permanece como dado indisponível.

### Option Score

O **Option Score** mede o contrato, não a empresa. Ele é independente do B3 Score do ativo e possui cinco componentes configuráveis:

- liquidez: 25 pontos (spread 12, volume 7, open interest 6);
- preço e volatilidade: 25 pontos;
- strike: 20 pontos;
- tempo: 15 pontos;
- risco/retorno: 15 pontos.

A nota só existe com pelo menos 70% de cobertura. Dados ausentes saem do denominador; não recebem zero. Volume alto não compensa automaticamente spread superior a 8%, que produz alerta de execução.

### Estratégias e payoff

O simulador calcula no vencimento call comprada, put comprada, call coberta, put protetiva, bull call spread, bear put spread e collar. Exibe capital requerido, lucro máximo, prejuízo máximo, break-even e relação risco/retorno quando matematicamente finitos. Não inclui corretagem, emolumentos, impostos, exercício antecipado ou slippage.

Não existe recomendação automática de lançamento descoberto. Contratos cadastrados são guardados em `b3-score-option-contracts-v1`, sem alterar posições ou preferências anteriores.

## Carteira e persistência

As posições reais usam `b3-score-positions-v2`. Armazenamentos anteriores não são apagados. A migração aceita posições legadas reconhecíveis, preserva `null` quando a cotação não existe e calcula custo, valor atual, P&L, peso, classe, setor, Top 3 e Top 5.

Volatilidade agregada não é exibida sem correlações sincronizadas; somar volatilidades seria incorreto.
