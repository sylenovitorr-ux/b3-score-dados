# Swing 3–6M

O módulo **Swing 3–6M** é um filtro de estudo para operações com horizonte esperado de 60 a 126 pregões. Ele não produz ordem automática, previsão de preço ou garantia de retorno.

## Separação de leituras

- **B3 Score / qualidade:** valuation, fundamentos, risco, liquidez e demais componentes quantitativos. Responde *o que vale estudar*.
- **Timing Score:** preço em relação às médias, inclinação, retornos de 60 e 126 pregões, RSI14 e volume. Responde *se a estrutura de entrada merece investigação agora*.
- **Classificação final:** combina qualidade, timing, confiança, liquidez e risco. É uma hipótese inicial, ainda pendente de validação histórica.

## Dados mínimos

O Timing Score exige 127 observações de preço para calcular 126 retornos de pregão. Com histórico menor, o resultado é **Dados insuficientes**: a ausência não se transforma em zero.

## Pesos iniciais do perfil

| Componente | Peso |
| --- | ---: |
| Momentum | 25% |
| Valuation | 15% |
| Risco | 15% |
| Qualidade | 10% |
| Crescimento | 10% |
| Rentabilidade | 8% |
| Liquidez | 7% |
| Endividamento | 5% |
| Consistência | 3% |
| Assimetria | 2% |

Os pesos são configuráveis e representam uma hipótese de trabalho. Não são declarados superiores antes de backtest fora da amostra.

## Estados de timing

- **Timing favorável:** conjunto majoritariamente construtivo, sem esticamento detectado.
- **Timing aceitável:** parte relevante dos critérios está presente.
- **Aguardar confirmação:** estrutura incompleta.
- **Movimento esticado:** RSI, retorno curto, distância da MM20 ou volume indicam cautela; o sinal não recebe bônus por isso.
- **Tendência deteriorando:** preço, médias e retornos apontam deterioração.
- **Dados insuficientes:** não há série mínima para a leitura de médio prazo.

## Limitações e rastreabilidade

Cada leitura guarda valores intermediários, fórmula, cobertura, data de referência e a fonte da série. Médias e RSI não antecipam retornos; eventos corporativos, liquidez, dados históricos e contexto podem limitar a interpretação. A validação histórica e o backtest sem look-ahead serão a próxima fase do módulo.
