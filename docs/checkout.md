# Checkout, frete, pagamentos e pedidos

> **Regra comercial vigente — vendas somente pelo WhatsApp.** A página `checkout.html` agora revisa a seleção e prepara uma mensagem que o cliente precisa enviar. Não há compra ou pagamento no site. As APIs públicas de criação de pedido e início de pagamento respondem 410, mesmo com credenciais configuradas. Catálogo, carrinho e cupons permanecem estimativas para confirmação da loja. Veja [phase1.md](phase1.md).
>
> As seções abaixo registram a implementação anterior preservada para registros existentes e testes isolados. Instruções antigas de ativação de checkout/pagamento **não se aplicam à fase atual**. Não ative provedores para vender no site.

## Arquitetura e estado encontrado

A inspeção encontrou uma vitrine estática em HTML/CSS/JavaScript, catálogo compartilhado em `js/catalog.js`, cálculo em centavos em `js/commerce.js`, cupons em `js/coupons.js`, empacotamento por receitas aprovadas em `js/shipping.js` e servidor Node de prévia. Não havia banco, autenticação, provedor de pagamento, credenciais ou arquivos de implantação. Não foi identificada uma hospedagem contratada. Os arquivos existentes já estavam modificados/não rastreados no Git; foram preservados.

A implementação estende `scripts/serve.cjs` com APIs de mesma origem. Usa Node 24+ e SQLite nativo, sem framework adicional ou dependência de runtime. Catálogo, preços, opções, elegibilidade dos combos e cupons são resolvidos no servidor a partir dos mesmos módulos da vitrine. O carrinho no localStorage contém apenas a seleção de produtos; nunca é autoridade de preços ou pagamentos. O checkout não aceita `DEV`, inclusive no ambiente de desenvolvimento; o fluxo local de testes do carrinho continua disponível apenas em loopback com `--dev`.

O servidor deve permanecer em execução, com **uma instância e volume persistente**. Não é compatível com hospedagem exclusivamente estática ou filesystem descartável. Para múltiplas instâncias, migrar para PostgreSQL e locks/rate limits distribuídos antes de escalar. Não há Supabase neste projeto, portanto nenhuma política RLS é utilizada.

## Fluxo operacional

1. No carrinho, **Ir para checkout** abre `/checkout.html`. A solicitação pelo WhatsApp existente continua disponível e continua sendo apenas uma solicitação, não um pedido pago.
2. O servidor confirma os itens e preços. O cliente informa o CEP e solicita uma cotação. A origem é sempre `53110000`, independente de dados enviados pelo navegador.
3. Com Melhor Envio autorizado, serviços habilitados, medidas reais, produção configurada e uma receita aprovada para a combinação inteira, o servidor consulta tarifas e prazos reais. O cliente escolhe entre os serviços retornados. Qualquer falta de configuração, medida, receita, prazo de produção, indisponibilidade ou erro mantém o frete pendente e abre uma solicitação manual.
4. Em `/admin.html`, a equipe autentica e verifica o envio por um canal autorizado. Registra serviço, preço em centavos, prazo de entrega, prazo de produção e comprovante/origem da consulta. A aprovação manual precisa contemplar embalagem, pesos, medidas, restrições e logística especial (incluindo reforma de Bíblias). Não há geração automática de etiquetas.
5. O cliente guarda a referência e chave da cotação e pode consultar a resposta. Pode retomar a cotação informando ambas e o mesmo CEP/carrinho. Solicitações pendentes duram 7 dias; aprovação manual dura 1 hora; cotação automática dura 15 minutos. A referência permite à equipe localizar a solicitação sem coletar contato antes da compra. O cliente deve voltar à página ou combinar o atendimento pelo contato da loja; não existe envio automático de notificações.
6. O cliente preenche nome, e-mail, telefone e endereço e revisa produtos, opções, personalização, descontos, frete, produção e total. O servidor vincula a cotação a CEP, quantidades, opções, personalização, preços e dados de envio atuais. Mudanças exigem nova cotação; mudança de serviço exige nova revisão. FRETEGRATIS só reduz frete confirmado; BEMVINDO5 dá 7% a partir de R$50 elegíveis; PRESENCA10 dá 10% exclusivamente sobre `is_combo: true`.
7. A confirmação transacional grava snapshots imutáveis, histórico e uma chave de idempotência. Repetições do mesmo envio retornam o mesmo pedido; outra chave não reutiliza a cotação. O carrinho não é apagado automaticamente.
8. O rastreio abre com referência aleatória e chave de acesso. O fragmento é removido do histórico da página. O cliente pode baixar referência/chave/link antes de pagar. O link vale por 30 dias. Dados de contato/endereço não são retornados na API do cliente. A equipe pode renovar o acesso após verificar identidade; não há recuperação automática por e-mail.
9. O botão de pagamento cria uma preferência do Mercado Pago no servidor e disponibiliza o link protegido do provedor. Cartão e Pix ficam no Checkout Pro, sujeitos à habilitação da conta. Nenhum dado de cartão passa pela loja. O cliente retorna à aba original ou usa seu link salvo e atualiza a situação.
10. Webhooks autenticados consultam o estado real em `/v1/payments/{id}` e validam valor, moeda, ambiente e pedido. Retornos do navegador não confirmam pagamentos. Pagamento e atendimento são campos separados. Pagamento aprovado não significa enviado. Pedido cancelado nunca é reativado automaticamente.

## Banco e migrações

`server/store.cjs` aplica automaticamente `server/migrations/001-commerce.sql`, `002-shipping-options.sql` e `003-payment-expiry.sql`. As migrações incrementais são transacionais e versionadas. Tabelas: `schema_migrations`, `shipping_quotes`, `orders`, `order_items`, `payments` (preferência e projeção atual), `payment_attempts` (tentativas reais distintas), `order_history`, `webhook_events`, `admin_sessions`.

Valores monetários persistidos usam inteiros em centavos. IDs internos são UUIDs e referências públicas têm 96 bits aleatórios; capacidades têm 256 bits. Tokens de cotação/sessão são guardados apenas como hash; a chave de pedido é derivada por HMAC com segredo exclusivamente no servidor. Reutilização após reinício depende de manter `ORDER_ACCESS_SECRET` e o banco. Rotacionar esse segredo invalida os links existentes. A renovação estende o acesso e não revoga uma chave anteriormente compartilhada; para um incidente de vazamento, revogue/expire o registro e emita atendimento verificado antes de renovar.

SQLite usa foreign keys, WAL, timeout de lock e transações para pedido, itens, pagamentos e histórico. Dados e migrações não são servidos pela rota estática. O arquivo precisa ser privado para o usuário do serviço e protegido por criptografia de disco/backups do host. Não há criptografia de aplicação para endereços. Use backup consistente de SQLite (online backup ou parada limpa), teste restauração e preserve o segredo fora do backup público.

## Configuração local

Requisitos: Node 24+, npm e Google Chrome para os testes de navegador.

```powershell
npm ci
Copy-Item .env.example .env
# Gere o hash localmente sem colocar a senha nos argumentos do processo:
$checkoutPassword = Read-Host 'Senha administrativa exclusiva (14+ caracteres)' -AsSecureString
[System.Net.NetworkCredential]::new('', $checkoutPassword).Password | node scripts/admin-password.cjs
# Copie o hash resultante para ADMIN_PASSWORD_HASH no .env.
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# Copie o segredo gerado para ORDER_ACCESS_SECRET no .env.
node --env-file=.env scripts/serve.cjs --dev
```

Abra `http://127.0.0.1:8010`. Use exatamente a origem de `PUBLIC_BASE_URL` (localhost e 127.0.0.1 são origens distintas). `npm start`/`npm run dev` preservam a prévia anterior e **não carregam `.env`**; para autenticação/configuração local, use o comando com `--env-file` acima. `npm run start:production` carrega `.env` e inicia sem `--dev`; o ambiente é definido por `NODE_ENV`, não pelo nome do script.

Sem credenciais externas é possível executar todo o fluxo de cotação manual, revisão, gravação do pedido e acompanhamento pendente. O botão de pagamento responde indisponível sem fabricar uma transação. A equipe deve configurar o hash para entrar no painel.

## Variáveis de ambiente

| Variável | Finalidade |
| --- | --- |
| `NODE_ENV` | `development`, `test` ou `production`. Produção sempre desativa DEV. |
| `HOST` | Loopback local; `0.0.0.0` somente atrás da infraestrutura HTTPS de produção. |
| `PUBLIC_BASE_URL` | Origem exata da loja; HTTPS obrigatório em produção e para pagamentos. |
| `DATABASE_PATH` | Caminho privado em volume persistente. Sem configuração, a prévia usa `data/commerce-<porta>.sqlite`. |
| `ADMIN_PASSWORD_HASH` | Salt hexadecimal de 16 bytes + `:` + digest scrypt de 64 bytes; gere com o script. |
| `ORDER_ACCESS_SECRET` | Segredo estável de pelo menos 32 caracteres. Obrigatório em produção. |
| `MP_MODE` | `sandbox` ou `production`. O modo real exige `NODE_ENV=production`. |
| `MP_ACCESS_TOKEN` | Token privado do vendedor no ambiente escolhido. |
| `MP_WEBHOOK_SECRET` | Segredo de assinatura das notificações da aplicação. |
| `TRACKING_HOSTS` | Domínios oficiais adicionais, separados por vírgulas, sem protocolo. Correios já permitido. |
| `ME_MODE` | `sandbox` ou `production`; sandbox não é usado para frete automático em produção. |
| `ME_TOKEN` | Token privado de conta/aplicação Melhor Envio autorizada pela loja. |
| `ME_USER_AGENT` | Nome da aplicação e e-mail técnico, conforme exigência do provedor. |
| `ME_SERVICES` | IDs de serviços efetivamente autorizados/disponíveis para a loja, separados por vírgulas. |
| `SHIPPING_PACKAGING_JSON` | Objeto JSON com `strategy: "approved-recipes"` e `recipes`, conforme `docs/shipping.md`. |

Nunca preencha segredos em `js/`, HTML, variáveis públicas ou no Git. `.env`, SQLite, WAL e dados são ignorados pelo Git.

## Melhor Envio e Correios

Nenhuma conta, autorização ou tarifa comercial foi fornecida. Para ativar o Melhor Envio, a loja deve criar/autorizar a aplicação, gerar token com permissão de cotação, confirmar os serviços e registrar as medidas reais de cada produto no catálogo. Também deve configurar `productionDays` inteiro de 0 a 365 em cada produto (0 apenas se não exige produção), aprovar fisicamente receitas de embalagem e preencher as variáveis ME. Não existem valores fictícios no catálogo.

O módulo `server/shipping.cjs` reutiliza `PresenceShipping.shipment`: soma pesos reais com tara e usa dimensões externas de uma receita exata, nunca a soma das três dimensões dos produtos. Um único volume é suportado. Envia `volumes` com kg/cm e valor segurado do subtotal ao endpoint oficial; usa apenas `custom_price` e `custom_delivery_time` validados, filtra serviços autorizados, ignora respostas com erro e impõe timeout. A API do provedor aplica cobertura e limites do serviço. Restrições comerciais e elegibilidade dos produtos precisam ser aprovadas pela loja.

Sandbox exige cadastro/token próprios; não representa cotação comercial e é identificado na tela. Cotação de sandbox não pode ser combinada com pagamento real. Contratação/postagem, etiquetas, documentos fiscais e importação automática de rastreio permanecem operações da equipe no provedor; este escopo integra cotação, não compra de etiquetas.

Também foram revisados os manuais atuais dos Correios. Acesso direto exige contrato e habilitações de APIs de preço/prazo; os manuais contêm exemplos v1 e referências de ambiente v3. Não foram fornecidos contrato, serviços habilitados nem credenciais para confirmar esse acesso. Por isso a integração automática escolhida foi Melhor Envio, opcional e autorizada por token, e não uma chamada presumida aos Correios. O adaptador antigo da vitrine fica inativo; as cotações pagáveis pertencem ao backend de checkout.

## Teste sandbox do Mercado Pago

1. Crie uma aplicação Checkout Pro na conta do vendedor. Configure conta de teste vendedora/compradora e credenciais de teste conforme a documentação atual do provedor. Não presuma que Pix/cartão estão habilitados.
2. Configure `MP_MODE=sandbox`, token privado de teste e segredo de webhook. Publique o ambiente de teste por HTTPS ou um túnel HTTPS para o servidor local e use essa origem em `PUBLIC_BASE_URL`. Não execute um pagamento com token de produção no ambiente de desenvolvimento.
3. No painel do provedor, configure notificações **payment** para `https://<sua-origem>/api/webhooks/mercadopago`. Cadastre o mesmo segredo no servidor. O endpoint exige `data.id` na query e correspondente no corpo, `x-request-id`, `x-signature`, HMAC válido e timestamp recente (janela de 5 minutos).
4. Inicie `node --env-file=.env scripts/serve.cjs`, navegue pela origem HTTPS e faça uma cotação manual legítima (ou de sandbox Melhor Envio). Confirme o pedido e guarde seu link/chave. Abra o Checkout Pro fornecido pelo provedor.
5. Use exclusivamente os dados de comprador/cartões de teste oficiais. Execute cenários de aprovação, pendência e recusa. Valide no painel e no banco o ID real, `live_mode=false` e o histórico. Teste reembolso integral pelo painel administrativo apenas para a transação de teste.
6. Retorne à aba do pedido e atualize. Não use `status=approved` da URL como evidência. Se o webhook não chegar, a equipe pode **Consultar pagamento no provedor**, que pesquisa por referência interna e consulta cada pagamento individualmente.

A preferência é persistida e reutilizada em cliques/retries; operações enviam chave de idempotência. O contrato de idempotência do provedor para cada endpoint deve ser confirmado na homologação. Há locks em uma instância e o pedido impede criação concorrente de preferências em operação normal. Um crash entre resposta externa e gravação local pode deixar uma preferência órfã, sem confirmar pagamento. Antes de retomar um pagamento o servidor também concilia o estado real. Tentativas com IDs diferentes ficam registradas e não fazem um pedido aprovado regredir para pendente/recusado. O provedor pode aceitar mais de uma tentativa em um link já aberto; o painel mostra os IDs e sinaliza mais de uma aprovação. A equipe deve conciliar/reembolsar excedentes no provedor. Não se afirma garantia de cobrança exatamente uma vez em sistemas externos.

Reembolsos parciais feitos no provedor aparecem explicitamente como parciais e bloqueiam novo pagamento/avanço automático. O painel solicita reembolso integral, não inventa sucesso nem altera estado de pagamento sem consulta. Cancelamento de pedido sem checkout aberto é local; checkout/pagamento existente exige conciliação. Cancelar atendimento nunca reativa um pedido em resposta a aprovação atrasada. Webhooks repetidos são deduplicados no banco; estados fora de ordem são descartados por timestamp. Falhas são retornadas para retry do provedor. Notificações antigas fora da janela exigem reenvio recente ou conciliação pela equipe.

## Segurança, privacidade e operação

Autenticação da equipe usa scrypt, cookie HttpOnly/SameSite=Strict, Secure em produção, sessão de 8 horas e logout que revoga o hash. Existe uma credencial de equipe, sem RBAC individual; todos os registros administrativos têm ator `admin`. Para atribuição individual, adicionar usuários/MFA antes de ampliar a equipe. Ações de escrita exigem origem exata e header dedicado; webhooks exigem assinatura. Consultas e login têm limitação de tentativas por endereço remoto, payload máximo de 64 KiB, timeouts e erros em português sem payloads/segredos externos. `X-Forwarded-For` não é confiado; um proxy pode agrupar usuários no mesmo limite, portanto configurar limitação adicional na borda para o tráfego real. Limites de memória reiniciam junto do processo.

Busca administrativa filtra cliente/referência, pagamento, atendimento e datas, e exibe 100 registros entre os 1.000 mais recentes. Históricos são cronológicos. Avanços exigem pagamento confirmado e transições válidas; produção é oferecida para itens personalizáveis. Rastreio precisa de código real e URL HTTPS com domínio oficial permitido. A entrega é registrada pela equipe; não há rastreio automático que presuma a entrega. Prazos são dias úteis estimados separados de produção. Não se calcula data de chegada sem calendário confiável/data de postagem operacional.

O cliente deve guardar seu link de acesso, pois não há envio de e-mail/SMS. Nenhum contato/endereço é guardado em localStorage/sessionStorage. O acesso por capacidade autoriza visualizar itens, personalização, valores e histórico, portanto o link deve permanecer privado. Não adicione analytics de terceiros nas páginas de pedido. Configure logs do proxy sem query/fragmentos/corpos de cliente e use `Cache-Control: no-store` para APIs. A política da loja deve informar controlador, contato, finalidades, direitos e retenção antes da abertura pública; os prazos legais de conservação e eventuais exigências fiscais precisam ser definidos pela empresa, não inferidos pelo código.

Execute periodicamente `node --env-file=.env scripts/maintenance.cjs` para remover sessões vencidas, cotações expiradas sem pedido (após 1 dia de margem) e registros de deduplicação com mais de 30 dias. Pedidos, snapshots, pagamentos e auditoria não são apagados automaticamente. Defina política e processo de anonimização após os prazos necessários, com acesso restrito e backups igualmente sujeitos à política. O módulo não é certificação de conformidade legal.

## Produção

1. Provisione host/container com Node 24, uma instância, volume SQLite privado e backup consistente. Use `npm ci --omit=dev`; não copie `.env` para assets/imagem pública. Configure as variáveis pelo secret manager do host.
2. Faça backup antes de atualizar. Aplique o código e inicie `node scripts/serve.cjs 8010` com `NODE_ENV=production`, `HOST=0.0.0.0`, origem pública HTTPS, segredo estável e hash administrativo forte. As migrações executam no startup; falta de segurança básica impede o startup. Use supervisor com reinício e shutdown limpo.
3. Termine TLS em proxy confiável, redirecione HTTP para HTTPS e configure HSTS, limites na borda e corpo máximo. Não exponha o volume de dados, `.env`, `server/` ou `scripts/` como diretório web. A whitelist do servidor serve somente as páginas e assets públicos.
4. Configure conta/credenciais **de produção** do Mercado Pago, `MP_MODE=production`, webhook e meios de pagamento realmente aprovados. Ative Melhor Envio em produção somente depois de homologar token, serviços, pesos, receitas e restrições. Nunca implante fixtures de teste como catálogo/preços reais.
5. Verifique `/api/health`, login, cotação real, revisão, compra controlada, webhook, reconciliação, reembolso, rastreio, restrição de acesso e restauração de backup. Monitore erros de provedor e solicitações pendentes; supervisione a fila manual. Sem esses passos a integração não está homologada para receber dinheiro.

## Arquivos e verificação

Backend: `server/commerce.cjs`, `server/providers.cjs`, `server/shipping.cjs`, `server/store.cjs` e duas migrações. Telas: `checkout.html`, `tracking.html`, `admin.html`, scripts correspondentes, `js/checkout-shared.js`, `css/checkout.css`. Integração: links em `index.html` e extensão do servidor existente. Operação: `.env.example`, `.gitignore`, `package.json`/lock, scripts de senha/manutenção, configuração Playwright, documentação e testes.

```powershell
npm run test:server
npm test -- --workers=4
```

`tests/server.test.cjs` usa SQLite real e HTTP real com fixtures de catálogo e provedores isoladas. Abrange CEP, campos, autoridade de preço, cupons/mistos/arredondamento/DEV, cotação manual, expiração/vínculo, idempotência, acesso, assinatura/replay, estados de pagamento e reembolso, tentativas distintas, transições/rastreio, falta de configuração, falhas externas e throttling. O adaptador Melhor Envio é testado com resposta simulada, incluindo peso/tara/dimensões externas e valores customizados reais do payload de teste.

Playwright mantém os testes da vitrine e acrescenta revisão móvel, estados reais de tela, invalidação, falta de pagamento, privacidade e um fluxo completo com aprovação administrativa e persistência em SQLite. O servidor de teste 8030 tem credenciais **somente de fixture** e banco isolado, sem conta externa. Não há teste ao vivo de Correios, Melhor Envio ou Mercado Pago porque nenhuma credencial foi fornecida. Veja o relatório de entrega para resultados efetivamente executados.

## Fontes oficiais consultadas

- [Mercado Pago: preferências Checkout Pro](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/create-payment-preference).
- [Mercado Pago: notificações de pagamento e validação](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications).
- [Mercado Pago: schema oficial de webhooks](https://github.com/mercadopago/openapi/blob/main/schemas/webhooks.yaml).
- [Melhor Envio: cálculo por produtos e pacotes](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos), [cotação](https://docs.melhorenvio.com.br/docs/cotacao-de-fretes) e [sandbox](https://docs.melhorenvio.com.br/docs/sandbox).
- [Correios: API Preço](https://www.correios.com.br/atendimento/developers/manuais/manual-api-preco-1), [API Prazo](https://www.correios.com.br/atendimento/developers/manuais/manual-api-prazo) e [Token](https://www.correios.com.br/atendimento/developers/manuais/manual-uso-da-api-token).
