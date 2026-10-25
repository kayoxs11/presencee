# Fase 1 — confiabilidade, navegação acessível e vendas pelo WhatsApp

## Regra comercial vigente

A Presença Papelaria funciona como catálogo e canal de vendas assistidas pelo WhatsApp. Abrir uma conversa apenas prepara uma mensagem. O cliente precisa enviá-la; a loja confirma disponibilidade, frete, valor final e instruções de pagamento durante o atendimento. Nenhuma mensagem é enviada automaticamente e nenhuma consulta vira pedido confirmado ou pago.

`checkout.html` mantém sua URL por compatibilidade, mas agora é **Revisar seleção**: usa o mesmo catálogo e motor de cupons do carrinho, mostra estimativas e prepara o mesmo resumo do WhatsApp. Aceita CEP e observações opcionais, sem formulário de compra, endereço completo, dados de cartão ou envio de pedido. CEP e observações dessa página não são persistidos. Há cópia/download do texto completo, inclusive quando a mensagem ultrapassa o tamanho seguro de um link. O clique nunca limpa o carrinho nem marca um pedido como recebido ou pago.

O frete desconhecido aparece como **a consultar**, e o total final como **a confirmar pelo WhatsApp**. A página não herda cotações temporárias da memória do drawer; sem uma cotação válida, FRETEGRATIS não é aplicado. As regras de BEMVINDO5, PRESENCA10, FRETEGRATIS e DEV não foram alteradas. Valores calculados no navegador não são preços de um pedido confirmado: a loja revisa os valores no atendimento.

## Finalidade dos componentes anteriores e implicações

- O checkout anterior chamava o servidor para aprovar uma revisão, registrar um pedido e abrir o pagamento no provedor. Essa exposição foi substituída pela revisão de mensagem, conforme a regra comercial aprovada.
- `server/commerce.cjs` bloqueia POST `/api/orders`, `/api/checkout/review` e `/api/orders/:reference/payment` com HTTP 410 no modo padrão `whatsapp`. Credenciais existentes não reativam essas rotas. O entry point `scripts/serve.cjs` usa esse padrão; não foi criada variável de ambiente para habilitar vendas online.
- Módulos de provedor, banco, migrações, registros, histórico e lógica anterior não foram apagados. A fábrica aceita o canal anterior apenas programaticamente; os testes de legado o selecionam de forma explícita com provedores isolados. Isso preserva verificações dos mecanismos antigos sem disponibilizar checkout no servidor da loja.
- `tracking.html` permanece uma consulta protegida a **registros realmente existentes**, sem botão de pagamento. Sua timeline e situação de pagamento refletem o registro retornado, sem transformar uma consulta do WhatsApp em pedido. Requer referência e chave fornecidas pela equipe.
- `admin.html` preserva autenticação e consulta/atualização de registros, cotações e operações de conciliação anteriores. A equipe recebe uma explicação de que mensagens do WhatsApp não geram registros e de que o painel não oferece cadastro manual de novos pedidos.

## O que seria necessário para rastrear novas vendas do WhatsApp

Primeiro, a equipe precisa concluir o atendimento: confirmar produtos disponíveis, personalização, frete, valor final e instruções de pagamento. Depois, precisaria de um **processo autorizado de cadastro de pedido** com snapshots corretos e registro real do pagamento/atendimento, seguido da entrega privada da referência e chave ao cliente. O painel atual não cria esse cadastro manual, e esta fase não introduz esse fluxo.

Portanto o acompanhamento atual serve a registros já existentes; não é prometido automaticamente a quem apenas envia uma seleção. Status de produção, postagem, entrega e eventuais pagamentos precisam ter evidência real antes de serem registrados. A equipe deve proteger o banco e manter estável o segredo de acesso para consultar registros anteriores. Não configure gateways para receber pagamentos no site nesta fase.

## Correções de confiabilidade e acessibilidade

- `PresenceCommerce.restoreCart()` valida envelope/versionamento, lista de itens, tipos dos campos, quantidades e formato do cupom antes de acessar propriedades. Reutiliza `clean()` para catálogo, opções, personalização e preços atuais. Retém linhas válidas de carrinhos parcialmente danificados e comunica as exclusões. Totais, preços, cotações e estados de pagamento fornecidos no armazenamento nunca são restaurados como autoridade.
- Carrinho e revisão reutilizam essa recuperação. JSON inválido, `null`, estruturas não suportadas ou armazenamento bloqueado produzem estado vazio/aviso útil, sem exceções não tratadas ou total final inventado.
- Favoritos aceitam apenas IDs atuais do catálogo e sincronizam eventos entre abas. Eventos leem o estado atual do armazenamento, evitando sobrescrita por notificações antigas. Antes de uma alternância local, a seleção compartilhada é relida quando disponível.
- Ao renderizar favoritos, o controle equivalente conserva o foco. Se o cartão desaparece, o foco volta ao botão de favoritos. Atualizações em outra aba preservam foco em busca e outros controles externos ao grid.
- Catálogo e detalhe alternam dois elementos `main`, mantendo exatamente um visível. O skip link aponta para destino visível e focável e não muda indevidamente a rota do detalhe.
- Entrada no detalhe foca o título. Retorno restaura o controle de origem do produto quando ainda disponível; caso contrário, foca o catálogo. O histórico de vários produtos conserva seus destinos de foco, com navegação hash/back/forward preservada.
- Escape fecha o menu móvel e devolve o foco ao acionador. `hidden`, classe e `aria-expanded` são mantidos juntos; a mudança para desktop fecha o menu móvel e mantém um foco visível. O diálogo do carrinho continua responsável pelo próprio Escape.

## Arquivos alterados

| Arquivo | Motivo |
| --- | --- |
| `js/commerce.js` | Recuperação compartilhada do carrinho; redação da mensagem como consulta que exige envio explícito. Sem mudanças nas regras de cálculo/cupom. |
| `js/cart.js` | Reutilizar recuperação validada. |
| `js/app.js` | Favoritos entre abas/foco, menu móvel, skip link, foco por rota e mensagem dos detalhes. |
| `index.html` | Landmarks/foco, estado inicial do menu e ações/textos compatíveis com WhatsApp. |
| `checkout.html`, `js/checkout.js` | Revisão da seleção e preparação de mensagem, sem submissão de pedido ou pagamento. |
| `tracking.html`, `js/tracking.js` | Explicar exigência de registro existente, preservar consulta/histórico e retirar início de pagamento. |
| `admin.html` | Explicar finalidade e limites operacionais do painel preservado. |
| `js/checkout-shared.js` | Nomear o total de registros existentes como “Total registrado”, sem chamada implícita à cobrança. |
| `server/commerce.cjs` | Aplicar a restrição comercial no servidor, sem integrar novos serviços. |
| `tests/navigation.spec.js` | Regressões de favoritos, foco, landmarks, histórico, Escape e mensagens. |
| `tests/checkout.spec.js` | Regressões de armazenamento, revisão WhatsApp, cópia/download, ausência de chamadas de compra e rastreio somente de registros. Substitui expectativas de compra online que deixaram de fazer parte do negócio. |
| `tests/commerce.spec.js` | Validação do envelope e recuperação parcial sem confiar em dados de preço/pagamento. |
| `tests/server.test.cjs` | Manter testes legados isolados e comprovar HTTP 410/nenhuma criação ou chamada de provedor no canal WhatsApp. |
| `README.md`, `docs/checkout.md`, `docs/delivery.md` | Destacar a regra atual e identificar instruções de integração anteriores como históricas. |
| `docs/phase1.md` | Este relatório e os critérios atuais. |

Nenhum preço, cadastro de produto, elegibilidade de cupom, credencial, migração, dependência, framework ou CSS foi alterado. Nenhuma integração externa nova foi introduzida. A composição das telas reutiliza as classes e os tokens existentes.

## Critérios de aceite desta fase

1. Dados persistidos inválidos não interrompem carrinho/revisão; linhas válidas são recuperadas com aviso e preço recalculado do catálogo.
2. Favoritos e contadores convergem entre abas; eventos antigos não sobrepõem o estado atual; foco do teclado continua previsível.
3. Todas as rotas têm um `main` visível e skip link válido onde oferecido; back/forward e foco nos detalhes são preservados.
4. Escape/resize mantêm o estado do menu coerente, sem interferir no diálogo ou menu desktop.
5. A ação comercial prepara uma mensagem explícita com seleção/quantidades/detalhes; só o cliente pode enviá-la no WhatsApp. Nenhum clique cria, confirma ou paga pedido.
6. A revisão não chama APIs de pedido, frete ou pagamento. As rotas públicas de criação/início de pagamento permanecem bloqueadas, inclusive com provedor configurado.
7. Frete desconhecido nunca vira zero. Não há formulário ou botão de pagamento. Rastreio exige um registro real e dados de acesso emitidos pela equipe.
8. Testes existentes de catálogo, carrinho, temas e cupons permanecem aprovados, junto às novas regressões. Resultados efetivos estão registrados abaixo.

## Verificação executada

| Comando | Resultado observado na execução final correspondente |
| --- | --- |
| `npm test -- --workers=4` | **111 passaram, 0 falharam**; Chrome, quatro workers. |
| `npm run test:server` | **25 passaram, 0 falharam**; HTTP/SQLite reais, provedores isolados. |
| `npx playwright test tests/navigation.spec.js --repeat-each=3 --workers=4` | **21 passaram, 0 falharam**; sete cenários repetidos três vezes, três workers utilizados. |
| `npx playwright test tests/checkout.spec.js tests/navigation.spec.js --workers=4` | **37 passaram, 0 falharam** na execução inicial direcionada, anterior à inclusão do cenário de histórico com vários produtos. A suíte completa final cobre as regressões atuais. |
| `node --check` em `js/app.js`, `js/cart.js`, `js/commerce.js`, `js/checkout.js`, `js/tracking.js`, `js/checkout-shared.js`, `server/commerce.cjs` | Sem erros de sintaxe. |
| `git diff --check` | Sem erros. |

Revisão visual da seleção em 320 e 1440 px, com capturas em `test-results/whatsapp-review-320.png` e `whatsapp-review-1440.png`. Não houve rolagem horizontal nessas verificações. Os testes existentes preservam cobertura de vitrine, carrinho, detalhes e temas em 320, 390 e 1440 px.

As execuções intermediárias revelaram falhas intermitentes nos novos testes com abas em segundo plano, incluindo espera por estabilidade de cartões animados e leitura do estado de outra aba sem ativá-la. Os testes passaram a ativar a aba de interação explicitamente, usar redução de movimento nos cenários de foco e não depender de fontes remotas nesses cenários. As suítes visuais/temas continuam verificando o comportamento existente. Também foi acrescentada uma regressão determinística contra eventos de armazenamento antigos. Nenhuma asserção funcional foi removida para declarar sucesso; a execução completa foi repetida até passar.

Para aplicar o bloqueio de API a um processo Node que já estava em execução antes da atualização, reinicie esse processo. Não é necessário configurar contas ou credenciais de pagamento para o fluxo de WhatsApp.

## Limitações preservadas

Não houve envio real de WhatsApp nem contato com provedores nos testes. A confirmação de estoque, frete, total e pagamento é responsabilidade do atendimento. Cliques no site não comprovam o envio da mensagem. Não há cadastro manual de novos pedidos no painel, notificação automática ou sincronização do histórico de conversas. A validação local protege a experiência, mas não transforma estimativas manipuláveis do navegador em compromissos comerciais. A Fase 2 não foi iniciada.
