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

### Travas de consistência e sensibilidade

O motor preserva o valor justo bruto, mas impede que distâncias extremas virem sinal positivo automaticamente. A sensibilidade combina distância entre preço e justo, número e dispersão das âncoras, confiança e cobertura fundamental. Potencial acima de 200% recebe teto 49; acima de 100% recebe teto 59 ou 69 conforme os testes de sustentação. O usuário vê o teto, os motivos e os resultados intermediários.

Uma âncora por ação superior a dez vezes a cotação falha no teste dimensional e não entra no ranking. Essa regra captura principalmente quantidades de ações publicadas em milhares sem escala explícita. Na geração seguinte, a quantidade só é multiplicada por mil quando VPA/preço supera 50 ou |LPA|/preço supera 20; o multiplicador e os gatilhos ficam em `audit.capitalScale`. Sem cotação, nenhuma correção é estimada.

## Risco e momentum

- volatilidade: desvio-padrão amostral dos retornos diários × `√252`;
- VaR histórico 95% de um dia: oposto do percentil de 5%;
- drawdown: maior queda entre um pico observado e fundo posterior;
- retornos 20/60/126/252 pregões;
- MM20, MM50, MM200 e RSI14.

Beta e correlação exigem uma série sincronizada do benchmark. Sem ela, permanecem indisponíveis.

## Detector de movimentos

O detector usa a série oficial da B3 e mantém as janelas explicitamente separadas:

- retorno em 1, 5 e 20 pregões;
- volatilidade anualizada com até 60 retornos e base de 252 pregões;
- volume do último pregão contra a média dos 20 anteriores;
- z-score do retorno e do logaritmo do volume contra até 60 observações anteriores;
- aceleração como retorno dos últimos 5 pregões menos o retorno dos 5 anteriores;
- gap como abertura atual dividida pelo fechamento anterior menos 1;
- máxima e mínima dos últimos 20 pregões.

Um movimento é classificado como relevante quando ao menos um critério documentado ultrapassa seu limiar. A classificação é estatística e não comprova fraude, manipulação, intenção ou causa.

## Contexto e relevância

Eventos oficiais de proventos e manchetes já coletadas pelo radar são normalizados sem chaves no frontend. A relevância de 0 a 100 combina:

- 50% relação direta com empresa, setor ou macroeconomia;
- 18% proximidade temporal;
- 20% credibilidade da fonte;
- 12% magnitude lexical do acontecimento.

Notícias com relação indireta recebem pouca relevância. O sentimento é apenas contextual e nunca substitui valuation, score ou cálculo financeiro. Toda notícia exibe a ressalva de que associação temporal não significa causalidade comprovada.

## Justificativa do preço e cenários

A divergência é calculada por `preço atual ÷ valor justo consensual − 1`. O estado visual usa a distância absoluta: até 10% bem explicado, até 25% parcialmente explicado, até 45% divergência relevante e acima disso grande divergência. O texto combina apenas fatores fundamentais e contextuais disponíveis.

Os cenários usam o menor modelo válido, o consenso ponderado e o maior modelo válido como centros pessimista, base e otimista. A faixa ao redor de cada centro é ampliada pela volatilidade observada, limitada entre 8% e 45%. Não há probabilidades nem valor esperado sem modelo calibrado.

## Gráficos e eventos

O gráfico principal sincroniza preço e volume na mesma janela e permite 1, 3, 6 e 12 meses ou o máximo disponível. O valor justo atual aparece como referência, não como série histórica. Marcadores identificam proventos, notícias e anomalias; o tooltip mostra data, fonte, relevância e limitação causal.

O retorno posterior a eventos é calculado somente quando existem 1, 5 ou 20 pregões posteriores na própria série. Caso contrário, permanece `null`. Múltiplos históricos e benchmarks sincronizados são explicitamente indisponíveis até existirem dados reais comparáveis.

## Opções

O motor de opções usa a versão `2.0.0`. A cadeia diária é extraída do COTAHIST oficial da B3. O arquivo fornece série, tipo, vencimento, strike, último prêmio, negócios, quantidade e volume financeiro no fechamento D-1. O spot vem do mesmo pregão e a taxa de referência vem da série Selic 1178 do Banco Central.

Bid, ask e open interest não existem no COTAHIST e permanecem `null`. O laboratório permite anexar uma fotografia CSV identificada por fonte e data, oferece um modelo vazio para download e rejeita book cruzado, OI inválido ou fotografia defasada. Contratos cujo ativo-objeto não possa ser vinculado de maneira única por nome e raiz são excluídos. O modo manual permanece disponível e é identificado separadamente.

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
