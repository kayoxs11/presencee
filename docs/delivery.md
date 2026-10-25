# Relatório de entrega — 24/10/2026

> **Regra comercial vigente — vendas somente pelo WhatsApp.** A página `checkout.html` agora revisa a seleção e prepara uma mensagem que o cliente precisa enviar. Não há compra ou pagamento no site. As APIs públicas de criação de pedido e início de pagamento respondem 410, mesmo com credenciais configuradas. Catálogo, carrinho e cupons permanecem estimativas para confirmação da loja. Veja [phase1.md](phase1.md).
>
> As seções abaixo registram a implementação anterior preservada para registros existentes e testes isolados. Instruções antigas de ativação de checkout/pagamento **não se aplicam à fase atual**. Não ative provedores para vender no site.

## Entregue e verificado localmente

O projeto continua com HTML/CSS/JavaScript. O servidor Node existente agora hospeda APIs de mesma origem com SQLite real, autenticação administrativa, cotação manual, revisão autoritativa, pedidos idempotentes e acompanhamento protegido por referência/chave com validade. Catálogo, regras de cupons, tema e carrinho existentes foram reutilizados. O WhatsApp permanece um canal de solicitação separado da criação/pagamento de pedidos no checkout.

| Recurso | Estado |
| --- | --- |
| Checkout, endereço, revisão, centavos e validação de preços/cupons no servidor | Implementado e testado |
| Cotação manual aprovada pela equipe e vinculada ao carrinho/CEP | Implementado; fluxo completo testado com HTTP, UI e SQLite reais |
| Cupons BEMVINDO5/PRESENCA10/FRETEGRATIS e rejeição de DEV no checkout | Implementado e testado |
| Banco, migrações, snapshots, idempotência e histórico | Implementado e testado, inclusive reabertura do banco |
| Administração, filtros, transições e cadastro de rastreio | Implementado e testado com autenticação |
| Rastreio do cliente e estados pendente/aprovado/enviado/entregue/cancelado/reembolsado | Implementado; API real e telas com fixtures verificadas |
| Melhor Envio: cotação automática, serviços e empacotamento | Adaptador implementado e testado com respostas isoladas; aguarda autorização, token, serviços, medidas, produção e receitas reais |
| Mercado Pago Checkout Pro, webhook, conciliação, retomada, cancelamento/reembolso | Adaptador implementado e testado com provedor simulado; aguarda conta/credenciais e homologação real |
| Pix e cartões | Oferecidos pelo checkout do provedor quando habilitados pela conta; disponibilidade real ainda não verificada |
| Integração direta com contrato Correios | Não ativada; acesso não fornecido. Melhor Envio é a integração automática opcional escolhida |
| Publicação em produção | Não executada; não há hospedagem/contas fornecidas |

Não foram inventadas tarifas, medidas, prazos comerciais, códigos de rastreio ou transações. Os exemplos comerciais de teste ficam exclusivamente em fixtures. Sem configuração, pagamentos falham explicitamente e o frete fica pendente de aprovação.

## Arquivos

Novos:

- `checkout.html`, `tracking.html`, `admin.html`.
- `css/checkout.css`.
- `js/checkout-shared.js`, `js/checkout.js`, `js/tracking.js`, `js/admin.js`.
- `server/commerce.cjs`, `server/providers.cjs`, `server/shipping.cjs`, `server/store.cjs`.
- `server/migrations/001-commerce.sql`, `002-shipping-options.sql`, `003-payment-expiry.sql`.
- `scripts/admin-password.cjs`, `scripts/maintenance.cjs`.
- `.env.example`, `docs/checkout.md`, este relatório.
- `tests/server.test.cjs`, `tests/checkout.spec.js`.

Estendidos: `scripts/serve.cjs`, `index.html`, `.gitignore`, `package.json`, `package-lock.json`, `playwright.config.js`, `tests/coupons.spec.js`, `README.md`, `docs/coupons.md`, `docs/shipping.md`. O repositório já tinha muitos desses arquivos sem rastreamento/modificados antes desta tarefa; nenhum reset ou commit foi feito.

## Testes executados

- `npm run test:server`: **24 passaram, 0 falharam**. SQLite e HTTP reais; serviços externos substituídos por fixtures.
- `npm test -- --workers=4`: **82 passaram, 0 falharam** na última execução completa.
- `npx playwright test tests/checkout.spec.js --workers=2`: **11 passaram, 0 falharam**, após os ajustes finais de navegação/estado do checkout. Playwright usou 1 worker para esse arquivo.
- Verificação de sintaxe dos scripts novos e do servidor com `node --check`: sem erros nos arquivos verificados.
- `npm install --package-lock-only`: auditoria informou 0 vulnerabilidades.
- Revisão visual da página de acompanhamento em 390px, com correção dos acentos e apresentação responsiva. Testes existentes também cobrem vitrine/carrinho em 320, 390 e 1440px e ambos os temas.

A primeira execução de navegador teve duas falhas: uma expectativa de HTTP 405 que passou a ser 403 por proteção de origem, e navegação para um novo link na mesma página. A expectativa foi atualizada e o rastreio passou a tratar `hashchange`; as execuções seguintes passaram. Nenhuma transação sandbox/real foi executada contra conta externa.

## Instalação, ambiente e pendências

O [guia operacional](checkout.md) contém os comandos exatos para desenvolvimento e sandbox, geração do hash administrativo/segredo, as três migrações automáticas, todas as variáveis e a sequência de implantação. Use Node 24+, `npm ci` e `node --env-file=.env scripts/serve.cjs --dev` para desenvolvimento configurado. As páginas principais são `/checkout.html`, `/tracking.html` e `/admin.html`.

Configuração necessária: `NODE_ENV`, `HOST`, `PUBLIC_BASE_URL`, `DATABASE_PATH`, `ADMIN_PASSWORD_HASH`, `ORDER_ACCESS_SECRET`; para pagamento, `MP_MODE`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`; para cotação automática, `ME_MODE`, `ME_TOKEN`, `ME_USER_AGENT`, `ME_SERVICES`, `SHIPPING_PACKAGING_JSON`; transportadoras adicionais usam `TRACKING_HOSTS`. Nenhum valor privado foi incluído no código ou neste relatório.

Ainda cabe à loja fornecer/autorizar as contas de vendedor e os tokens dos ambientes corretos, cadastrar o webhook HTTPS, confirmar métodos de pagamento disponíveis, medir e aprovar produtos/embalagens, configurar produção e serviços, e homologar os resultados nos provedores. Para produção, precisa de uma instância Node com disco persistente, TLS, backups testados, supervisor e limitação de tráfego na borda. Não serve como publicação estática nem como aplicação de múltiplas instâncias com banco/locks locais.

A equipe deve operar a fila manual, contratar/postar o frete e registrar rastreio/entrega reais. Não há compra automática de etiquetas, integração fiscal, notificações de e-mail/SMS, reserva de estoque, RBAC individual ou limites globais de resgate de cupom. O guia também registra limites da busca administrativa, tratamento de preferências órfãs, conciliação de tentativas extras no provedor, proteção/expiração dos links, retenção e manutenção do banco. Esses limites são explícitos e não são apresentados como integrações homologadas.
