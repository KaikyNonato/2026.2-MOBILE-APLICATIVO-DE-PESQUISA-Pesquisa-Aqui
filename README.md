# Pesquisa Aqui

Plataforma para criar, aplicar e acompanhar pesquisas de campo. O projeto reúne três partes que conversam entre si:

- **API** (`api/`): back-end em NestJS com banco PostgreSQL.
- **Web** (`web/`): painel administrativo em Next.js, usado por administradores para montar pesquisas e acompanhar resultados.
- **Mobile** (`mobile/`): aplicativo Expo / React Native, usado pelos pesquisadores em campo para coletar respostas, inclusive sem internet.

> Esta é a documentação da branch **`main`**. Ela contém a evolução mais recente do painel web (dashboard com dados reais, paginação e busca no servidor), da API e do app mobile.

---

## Sumário

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Pré-requisitos](#pré-requisitos)
- [Como rodar o projeto](#como-rodar-o-projeto)
  - [1. API](#1-api)
  - [2. Web](#2-web)
  - [3. Mobile](#3-mobile)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Publicar na Vercel](#publicar-na-vercel)
- [Perfis de usuário](#perfis-de-usuário)
- [Modelo de dados](#modelo-de-dados)
- [Endpoints da API](#endpoints-da-api)
- [Paginação e limites de dados](#paginação-e-limites-de-dados)
- [Regras de negócio importantes](#regras-de-negócio-importantes)
- [Segurança](#segurança)
- [Testes e qualidade de código](#testes-e-qualidade-de-código)
- [Fluxo de trabalho com branches](#fluxo-de-trabalho-com-branches)
- [Problemas comuns](#problemas-comuns)

---

## Visão geral

O fluxo de uso do sistema é:

1. Um **superadministrador** cadastra empresas e seus administradores.
2. O **administrador** da empresa cadastra pesquisadores e monta a pesquisa (seções, questões, regras de exibição) pelo painel web.
3. Ao publicar a pesquisa e vincular pesquisadores, ela fica disponível no app mobile.
4. O **pesquisador** baixa a pesquisa no aparelho, aplica as entrevistas (com ou sem internet) e sincroniza as coletas quando houver conexão.
5. O painel web mostra gráficos, tabelas e as últimas atualizações com base nas coletas recebidas.

## Funcionalidades

### Painel web
- Login com sessão por cookie (`access_token`) e rotas protegidas.
- Dashboards diferentes para superadministrador e administrador (cards, gráficos, mapa de calor de coletas, equipe em campo e últimas atualizações), calculados no servidor.
- Cadastro e gestão de empresas e administradores.
- Cadastro, edição, ativação/desativação e listagem de pesquisadores (lista ou cartões).
- Criação, edição, publicação e encerramento de pesquisas, com lista em cartões ou linhas e calendário de campo.
- Montagem do questionário: seções, questões, opções, reordenação e regras de exibição condicional.
- Vinculação de pesquisadores a uma pesquisa, com meta de coletas por pesquisador.
- Consulta das coletas recebidas (com resposta a resposta, fotos e áudio), painel de resultados com filtros, relatório por questão e exportação em CSV.
- **Cópias em campo**: quem está com a pesquisa baixada, histórico de devoluções e revogações, revogação forçada e desbloqueio de aparelho.
- **Busca global** (atalho no topo) por pesquisas, pesquisadores, empresas, administradores e coletas.
- **Paginação em todas as listas e tabelas**, com busca, filtro e ordem feitos no servidor, e **seletores com pesquisa e rolagem infinita** (veja [Paginação e limites de dados](#paginação-e-limites-de-dados)).

### Aplicativo mobile
- Login com token guardado em armazenamento seguro (`expo-secure-store`).
- Lista de pesquisas disponíveis e download para uso offline (cache local).
- Coleta de respostas com 12 tipos de questão (texto, numérico, data, hora, sim/não, escolha única, múltipla escolha, escala 1–5, foto, múltiplas fotos, localização e áudio).
- Regras de exibição condicional aplicadas durante a entrevista.
- Termo de consentimento do entrevistado e gravação de áudio da entrevista, quando a pesquisa exige.
- Registro automático do local onde a entrevista começa.
- Sincronização das coletas com a API, com banner de modo offline e envio idempotente (reenviar a mesma coleta não duplica no servidor).

### API
- Autenticação JWT, via cookie (web) e via cabeçalho `Authorization: Bearer` (mobile).
- CRUD de empresas, usuários, pesquisas, seções, questões, opções e regras.
- Recebimento de coletas (em lote, com reenvio seguro) com validação de consentimento, e envio de fotos e áudios à parte, inclusive em pedaços para redes ruins.
- Armazenamento de mídias no Cloudinary (privado) ou, só em desenvolvimento, em disco.
- Controle de cópias da pesquisa por aparelho (download, devolução, revogação e desbloqueio).
- Painel de resultados, relatório por questão e exportação em CSV, Excel (XLSX), JSON e relatório em PDF.
- Mapa de coletas, auditoria de qualidade, modelos de pesquisa e duplicação de pesquisa.
- **Listagens paginadas com limite de 100 itens por página** e endpoints de totais prontos para os dashboards.
- Validação automática de entradas (`class-validator`, com `whitelist` e `transform`).

## Tecnologias

| Parte | Principais tecnologias |
| --- | --- |
| API | NestJS 11, TypeScript, Prisma Next (`@prisma/orm-postgres`), PostgreSQL ≥ 15, JWT (`@nestjs/jwt`), bcrypt, class-validator, Jest |
| Web | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui + Base UI, Recharts, jose, react-hot-toast |
| Mobile | Expo 57, React Native 0.86, React 19, Expo Router (rotas por arquivo), expo-audio, expo-location, expo-secure-store, AsyncStorage, NetInfo, Reanimated |

## Estrutura do repositório

```
.
├── api/                      # Back-end NestJS
│   ├── src/
│   │   ├── auth/             # Login, logout, /auth/me, guard JWT
│   │   ├── user/             # Usuários (admins e pesquisadores) e totais de pesquisadores
│   │   ├── company/          # Empresas e totais de empresas
│   │   ├── research/         # Pesquisas, publicação, encerramento, painel, relatório, CSV, equipe e cópias
│   │   ├── section/          # Seções do questionário
│   │   ├── question/         # Questões e opções
│   │   ├── question-rule/    # Regras de exibição condicional
│   │   ├── collection/       # Coletas (respostas, consentimento, mídias, sincronização)
│   │   ├── dashboard/        # Painel do administrador já calculado (GET /dashboard/admin)
│   │   ├── common/           # Paginação compartilhada (pagination.ts)
│   │   └── prisma/           # Contrato do banco (contract.prisma), cliente e seeds
│   ├── migrations/           # Snapshots de contrato do Prisma Next
│   ├── test/                 # Testes e2e
│   └── .env.example
├── web/                      # Painel administrativo Next.js
│   ├── app/
│   │   ├── (autenticacao)/login
│   │   └── (sidebar)/        # Home (dashboards), empresa, empresas, pesquisadores, pesquisas
│   ├── components/ui/        # Componentes de interface (shadcn/ui), DataTable, Pagination e RemoteComboBox
│   ├── hooks/                # useCurrentUser, useFieldSnapshot, usePagedResource
│   ├── lib/                  # Clientes da API (auth, research, company, user, collection...) e pagination.ts
│   └── proxy.ts              # Proteção de rotas por JWT
└── mobile/                   # App Expo / React Native
    ├── app/                  # Rotas (login, home, pesquisas, sincronização, usuário, coleta)
    ├── components/           # Componentes (QuestionInput, ConsentModal, OfflineBanner...)
    ├── context/              # AuthContext
    ├── hooks/                # useInterviewRecording, useNetworkStatus...
    └── lib/                  # API, cache de pesquisas, fila de coletas, envio de arquivos, regras de exibição
```

## Pré-requisitos

- [Node.js](https://nodejs.org/) 20 ou superior (recomendado: versão LTS atual) e npm
- [PostgreSQL](https://www.postgresql.org/) **15 ou superior**
- Para o mobile: app **Expo Go** no celular, ou um emulador Android / simulador iOS
- Git

## Como rodar o projeto

Clone o repositório e entre na branch:

```bash
git clone https://github.com/GirlaneSL/2026.2-MOBILE-APLICATIVO-DE-PESQUISA-Pesquisa-Aqui.git
cd 2026.2-MOBILE-APLICATIVO-DE-PESQUISA-Pesquisa-Aqui
git checkout dev-kaiky
```

Suba as partes nesta ordem: **API → Web → Mobile**.

### 1. API

```bash
cd api
npm install
cp .env.example .env     # depois edite o .env (veja "Variáveis de ambiente")
```

Crie um banco PostgreSQL vazio e aponte o `DATABASE_URL` para ele. Em seguida:

```bash
# gera/atualiza os arquivos do contrato (contract.json e contract.d.ts)
npm run contract:emit

# cria o superadministrador inicial
npm run seed

# inicia em modo desenvolvimento (com watch)
npm run start:dev
```

A API sobe em `http://localhost:3001` (ou na porta definida em `PORT`).

> Sobre o banco: o projeto usa o **Prisma Next**. O contrato dos dados fica em `api/src/prisma/contract.prisma`. Sempre que alterá-lo, rode `npm run contract:emit` e versione `contract.json` e `contract.d.ts`. Detalhes adicionais estão em [`api/prisma-next.md`](api/prisma-next.md).

**Usuário criado pelo seed (somente desenvolvimento):**

| Campo | Valor |
| --- | --- |
| Usuário | `admin` |
| Senha | a definida em `SEED_ADMIN_PASSWORD` ou, se vazia, uma senha aleatória mostrada no terminal ao rodar o seed |
| Perfil | `SUPERADMINISTRATOR` |

A conta nasce com **senha temporária**: no primeiro acesso o sistema obriga a escolher uma senha nova.

**Dados de demonstração (opcional):** para testar a paginação e os dashboards com volume, rode o seed de demonstração (é idempotente: pode rodar mais de uma vez sem duplicar).

```bash
npx tsx src/prisma/seed-demo.ts
# mais coletas na primeira pesquisa:
SEED_COLLECTIONS=250 npx tsx src/prisma/seed-demo.ts
```

Ele cria a empresa *Empresa Demo (seed)*, o administrador `demo.admin`, pesquisadores `demo.ana`, `demo.bruno` etc. (senha `demo123`) e cinco pesquisas em situações diferentes, com coletas.

### 2. Web

```bash
cd web
npm install
```

Crie o arquivo `web/.env.local` com o **mesmo** `JWT_SECRET` usado na API (o middleware valida o token localmente):

```env
JWT_SECRET=o-mesmo-valor-da-api
```

Depois:

```bash
npm run dev
```

O painel abre em `http://localhost:3000`. Faça login com o usuário do seed.

> O painel chama a API pelo caminho `/api/...` do próprio painel, e o `next.config.ts` repassa para o endereço definido em `API_URL` (padrão `http://localhost:3001`). Se a API rodar em outro endereço, defina `API_URL` em `web/.env.local` e reinicie o `npm run dev`. Veja [Publicar na Vercel](#publicar-na-vercel).

### 3. Mobile

```bash
cd mobile
npm install
```

Crie o arquivo `mobile/.env` informando o endereço da API **acessível pelo celular**:

```env
EXPO_PUBLIC_API_URL=http://SEU_IP_NA_REDE_LOCAL:3001
```

Dicas sobre esse endereço:

- Em **celular físico**, use o IP da sua máquina na rede Wi-Fi (por exemplo `http://192.168.0.10:3001`). `localhost` aponta para o próprio celular.
- No **emulador Android**, use `http://10.0.2.2:3001`.
- No **simulador iOS**, `http://localhost:3001` funciona.
- Se `EXPO_PUBLIC_API_URL` não for definida, o app usa `http://localhost:3001`.

Inicie o app:

```bash
npm start            # abre o Expo; escaneie o QR Code com o Expo Go
npm run android      # emulador Android
npm run ios          # simulador iOS
```

> O app usa microfone (gravação de entrevista) e localização. As permissões são solicitadas em tempo de uso.

## Variáveis de ambiente

### API (`api/.env`)

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | Sim | String de conexão PostgreSQL, ex.: `postgresql://user:password@localhost:5432/mydb` |
| `JWT_SECRET` | Sim | Segredo usado para assinar e validar os tokens JWT |
| `PORT` | Não | Porta da API (padrão `3001`) |
| `CLOUDINARY_URL` | Recomendada | Credenciais do Cloudinary (`cloudinary://API_KEY:API_SECRET@CLOUD_NAME`), onde ficam todas as fotos e áudios como arquivos privados. Alternativa: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET` |
| `CLOUDINARY_FOLDER` | Não | Pasta raiz no Cloudinary; cada pesquisa ganha uma subpasta própria |
| `AUDIO_STORAGE_DIR` | Não | Só para desenvolvimento **sem** Cloudinary: pasta em disco dos áudios (padrão `./storage/audio`) |
| `AUDIO_MAX_BYTES` | Não | Tamanho máximo do áudio de uma coleta, em bytes (padrão `157286400`, ou 150 MB) |
| `PHOTO_MAX_BYTES` | Não | Tamanho máximo de cada foto, em bytes (padrão `31457280`, ou 30 MB) |
| `CORS_ORIGINS` | Em produção, se um navegador chamar a API direto | Origens autorizadas, separadas por vírgula (ex.: `https://painel.exemplo.com`). Vazia em desenvolvimento libera tudo; vazia em produção nega todas as origens de navegador. O painel (usa `/api` do próprio domínio) e o app mobile (sem `Origin`) não dependem dela |
| `TRUST_PROXY` | Atrás de proxy | Quantos proxies existem na frente da API (Vercel/Render: `1`). Sem isso o limite de requisições enxerga o IP do proxy, e não o do usuário |
| `JWT_EXPIRES_IN` | Não | Validade do token de login (padrão `12h`) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | Não | Tentativas erradas seguidas até trancar a conta (padrão `5`) e por quanto tempo (padrão `15` minutos) |
| `SEED_ADMIN_PASSWORD` | Não | Senha inicial do superadministrador criado por `npm run seed` (vazia = aleatória, mostrada no terminal) |

### Web (`web/.env.local`)

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `JWT_SECRET` | Sim | Mesmo segredo da API, usado para validar o cookie `access_token` |
| `API_URL` | Não (em produção, sim) | Endereço da API, sem barra no final (padrão `http://localhost:3001`). É lido **no build**: ao mudar na Vercel, faça um novo deploy |

### Mobile (`mobile/.env`)

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | Recomendada | URL base da API (padrão `http://localhost:3001`) |

> Nunca faça commit de arquivos `.env` com valores reais.

## Publicar na Vercel

São **dois projetos** na Vercel, a partir do mesmo repositório: a **API** e o **painel web**. O app mobile não vai para a Vercel (ele só precisa do endereço da API).

### 0. Banco de dados e mídias (antes de tudo)

- Crie um PostgreSQL ≥ 15 na nuvem (Neon, Supabase, Vercel Postgres...). Em ambiente serverless use a string **com pooler** (Neon: host com `-pooler`; Supabase: porta `6543`), senão as funções esgotam as conexões.
- Crie as tabelas e o superadministrador **pelo seu computador**, apontando o `api/.env` para o banco de produção:

```bash
cd api
npx prisma db init
npm run seed        # cria o admin com senha temporária (anote a senha mostrada no terminal)
```

- Crie uma conta no [Cloudinary](https://cloudinary.com/). Na Vercel o disco é somente leitura, então fotos e áudios **precisam** ir para o Cloudinary (`CLOUDINARY_URL`).

### 1. API (projeto `pesquisa-aqui-api`)

1. Vercel > **Add New > Project** > importe o repositório.
2. **Root Directory:** `api`. A Vercel detecta o NestJS sozinha (entrada `src/main.ts`), sem build command.
3. **Environment Variables:** `DATABASE_URL`, `JWT_SECRET` (um valor longo e aleatório), `CLOUDINARY_URL` e, se quiser, `CLOUDINARY_FOLDER`.
4. Deploy. Teste abrindo `https://SUA-API.vercel.app/` no navegador.

### 2. Painel web (projeto `pesquisa-aqui-web`)

1. **Add New > Project** > o mesmo repositório.
2. **Root Directory:** `web` (framework: Next.js).
3. **Environment Variables:**
   - `JWT_SECRET`: **exatamente o mesmo** da API.
   - `API_URL`: `https://SUA-API.vercel.app` (sem barra no final).
4. Deploy. Faça login com o usuário do seed.

> Se você trocar o `API_URL`, é preciso **Redeploy** do painel, porque o valor é gravado no build.

### 3. Mobile

Em `mobile/.env`, aponte para a API publicada e reinicie o Expo:

```env
EXPO_PUBLIC_API_URL=https://SUA-API.vercel.app
```

### Limitações da API na Vercel

- **Corpo da requisição de até 4,5 MB.** O app envia arquivos em pedaços de 1 MB, então cabe.
- **Envio em pedaços de arquivos grandes (áudio longo):** os pedaços parciais ficam em `/tmp`, que é por instância. Se duas requisições caírem em instâncias diferentes, o app recomeça o arquivo do zero (nada se perde nem duplica, mas pode demorar). Para entrevistas longas com muito áudio, prefira hospedar a API num serviço com disco persistente (Render, Railway, Fly.io) e manter só o painel na Vercel: basta trocar o `API_URL` e fazer redeploy.
- **Cookies:** o painel fala com a API pelo caminho `/api` do próprio domínio, então o cookie `access_token` fica no domínio do painel e não há problema de CORS ou `SameSite`.

## Perfis de usuário

| Perfil | Onde usa | O que faz |
| --- | --- | --- |
| `SUPERADMINISTRATOR` | Web | Gerencia empresas e seus administradores |
| `ADMINISTRATOR` | Web | Gerencia pesquisadores e pesquisas da própria empresa |
| `RESEARCHER` | Mobile | Aplica entrevistas e sincroniza as coletas |

## Modelo de dados

Principais entidades (definidas em `api/src/prisma/contract.prisma`):

- **Company**: empresa (`ACTIVE` / `INACTIVE`).
- **User**: usuário com `profile`, vinculado a uma empresa.
- **Research**: pesquisa, com status `DRAFT`, `PUBLISHED`, `IN_FIELD` ou `CLOSED`, e a opção `recordInterview` (exige gravação e consentimento).
- **Section** → **Question** → **QuestionOption**: estrutura do questionário.
- **QuestionRule**: uma **condição** sobre a resposta de uma questão anterior (`operator` + `triggerValue`), que mostra (`SHOW`) ou esconde (`HIDE`) uma questão **ou uma seção inteira**. Condições do mesmo alvo com a mesma `groupKey` valem em conjunto (E); grupos diferentes valem em alternativa (OU).
- **Collection**: uma entrevista feita por um pesquisador (respostas, consentimento, áudio opcional).
- **Answer**: resposta a uma questão dentro de uma coleta.
- **ResearchResearcher**: vínculo entre pesquisa e pesquisadores.
- **ResearchDownload**: cópia da pesquisa baixada por um aparelho (data, devolução, revogação e desbloqueio).
- **SyncLog**: registro de cada sincronização em lote (aparelho, horário e resultado por coleta).

Tipos de questão (`QuestionType`): `FREE_TEXT`, `NUMERIC`, `DATE`, `TIME`, `YES_NO`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `SCALE_1_5`, `PHOTO`, `MULTIPLE_PHOTOS`, `LOCATION`, `AUDIO`.

## Endpoints da API

Todas as rotas, exceto `POST /auth/login` e `POST /auth/logout`, exigem autenticação (`AuthGuard`).

| Recurso | Rotas |
| --- | --- |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET/PATCH /auth/profile`, `POST /auth/change-password` |
| Usuários | `POST /user`, `GET /user` ⁽ᵖ⁾, `GET /user/admins` ⁽ᵖ⁾, `GET /user/researchers/stats`, `PATCH /user/:username`, `POST /user/:username/reset-password`, `PATCH /user/:username/situation`, `DELETE /user/:username` |
| Empresas | `GET /company` ⁽ᵖ⁾, `GET /company/stats`, `POST /company`, `PUT /company/:id`, `PATCH /company/:id`, `DELETE /company/:id` |
| Pesquisas | `POST /research`, `GET /research` ⁽ᵖ⁾, `GET /research/summary`, `GET /research/:id`, `PATCH /research/:id`, `DELETE /research/:id`, `POST /research/:id/publish`, `POST /research/:id/close` |
| Resultados | `GET /research/:id/panel`, `GET /research/:id/report`, `GET /research/:id/export.csv`, `export.xlsx`, `export.json`, `GET /research/:id/report.pdf` |
| Mapa e qualidade | `GET /research/:id/map`, `GET /research/:id/quality` (filtros `from`, `to`, `researcherId`, `flagged`; só administrador da empresa) |
| Modelos | `GET /research/templates`, `POST /research/from-template`, `POST /research/:id/duplicate` |
| Equipe da pesquisa | `GET /research/:id/researchers` ⁽ᵖ⁾, `GET /research/:id/team` ⁽ᵖ⁾, `POST /research/:id/researchers/:userId`, `PATCH /research/:id/researchers/:userId`, `DELETE /research/:id/researchers/:userId` |
| Cópias em campo | `GET /research/:id/copies` ⁽ᵖ⁾, `POST /research/:id/copies/:copyId/revoke`, `POST /research/:id/copies/:copyId/unblock`, `POST /research/:id/return`, `GET /research/:id/download` |
| Seções | `POST /section`, `POST /section/reorder`, `GET /section`, `GET /section/:id`, `PATCH /section/:id`, `DELETE /section/:id` |
| Questões | `POST /question`, `POST /question/reorder`, `GET /question`, `GET /question/:id`, `PATCH /question/:id`, `DELETE /question/:id`, `POST /question/:id/option`, `GET /question/:id/options`, `PATCH /question/option/:id`, `DELETE /question/option/:id` |
| Regras | `POST /question-rule` (uma ou várias condições; alvo questão ou seção), `GET /question-rule`, `DELETE /question-rule/:id` (apaga o grupo inteiro) |
| Coletas | `POST /collection`, `POST /collection/sync`, `POST /collection/:clientId/files`, `GET /collection/:clientId/files/progress`, `POST /collection/:clientId/files/chunk`, `GET /collection?researchId=` ⁽ᵖ⁾, `GET /collection/stats?researchId=`, `GET /collection/:id`, `GET /collection/:id/media/:name`, `GET /collection/:id/audio` |
| Dashboard | `GET /dashboard/admin` (administrador) |

⁽ᵖ⁾ = aceita paginação (veja a próxima seção).

## Paginação e limites de dados

O painel web **nunca baixa uma lista inteira**: cada tabela, cartão ou seletor pede à API uma página por vez, e a API recusa páginas maiores que **100 itens**.

### Contrato da API

As rotas marcadas com ⁽ᵖ⁾ aceitam estes parâmetros de consulta:

| Parâmetro | Descrição |
| --- | --- |
| `page` | Número da página, a partir de 1 |
| `pageSize` | Itens por página (1 a 100; padrão 20) |
| `q` | Busca por texto, sem diferenciar maiúsculas nem acentos |
| `sort` | `recent` (padrão), `name` ou `deadline` (só pesquisas) |
| filtros | Dependem da rota: `status` (pesquisas), `situation` e `profile` (usuários e empresas), `audio` (coletas), `filter=ALL\|LINKED\|AVAILABLE` (equipe da pesquisa), `status=ALL\|RETURNED\|REVOKED` (histórico de cópias) |

A resposta tem este formato:

```json
{ "items": [], "total": 87, "page": 1, "pageSize": 20, "totalPages": 5 }
```

**Compatibilidade com o app mobile:** sem `page` e sem `pageSize` as rotas continuam devolvendo a lista inteira, no formato antigo (um array). O painel web sempre envia os dois parâmetros.

Para os números dos dashboards existem rotas que devolvem só totais, sem listar nada: `GET /research/summary`, `GET /company/stats`, `GET /user/researchers/stats`, `GET /collection/stats` e `GET /dashboard/admin` (que recebe `tzOffset`, o fuso do navegador, para o mapa de calor e as coletas de hoje).

### Como funciona no painel web

| Peça | Onde | Para que serve |
| --- | --- | --- |
| `usePagedResource` | `web/hooks/` | Busca uma página por vez, com pausa na digitação, descarte de respostas atrasadas e página anterior na tela enquanto a nova carrega |
| `DataTable` | `web/components/ui/data-table.tsx` | Tabela/cartões. Pagina sozinha no navegador (10 por página) ou, com `server={list.server}`, usa a paginação da API |
| `Pagination`, `usePagination`, `PaginatedList` | `web/components/ui/pagination.tsx` | Rodapé de paginação (intervalo, itens por página, números) e paginação de listas curtas que já estão na tela |
| `RemoteComboBox` | `web/components/ui/remoteCombobox.tsx` | Seletor para opções vindas da API: pesquisa no servidor e rolagem infinita (carrega a próxima página perto do fim da lista) |
| `lib/pagination.ts` | `web/lib/` | Tipo `Page<T>` e montagem da query (`pageQuery`) |

### Como adicionar uma nova lista paginada

1. **API:** no controller, receba `@Query() query: PageQueryDto` (ou um DTO que o estenda, em `api/src/common/pagination.ts`) e, se `isPaged(query)`, chame um método `findPage` que use `runPaged(...)`. Se não for paginado, devolva a lista antiga.
2. **Web:** crie o fetcher em `web/lib/` usando `pageQuery` e `asPage`, e use `usePagedResource` na tela.
3. **Tabela:** passe `rows={list.items}` e `server={list.server}` ao `DataTable`.
4. **Seletor:** use `RemoteComboBox` com um `fetchOptions` que repasse `page`, `pageSize` e `q`.

### Limitações conhecidas

- Com texto na busca (`q`), o servidor ainda lê as linhas do escopo da empresa e filtra em memória (o ORM atual não expõe `or`); só a resposta é limitada. Pode pesar com dezenas de milhares de registros.
- A ordenação A-Z no banco depende do agrupamento (collation) do PostgreSQL.
- A busca global traz todos os resultados em páginas de 100 (com trava de 50 páginas por fonte); com 1 ou 2 letras pode disparar muitas requisições.
- O calendário de campo mostra as pesquisas da página atual.
- O editor de questionário e as respostas de uma única coleta não são paginados.

## Regras de negócio importantes

- **Regras de exibição**: a questão de origem precisa vir **antes** do alvo na ordem do questionário (seção, depois questão); para uma seção, a origem precisa estar em seção anterior. Operadores: `EQ`, `NEQ` (sim/não, escolhas, escala, número, texto), `GT`, `GTE`, `LT`, `LTE` (número e escala), `CONTAINS`, `NOT_CONTAINS` (texto), `ANSWERED`, `NOT_ANSWERED` (qualquer tipo de resposta direta). Uma regra pode ter até 10 condições em conjunto (E). Um alvo é visível quando (não tem regras `SHOW` ou alguma `SHOW` é verdadeira) **e** nenhuma `HIDE` é verdadeira. Uma condição só vale se a questão de origem está visível (esconder uma questão esconde em cascata o que depende dela). Questão ou seção escondida deixa de ser obrigatória e suas respostas não são enviadas. O app aplica as mesmas regras offline.
- **Área-alvo e qualidade**: a pesquisa pode ter uma área circular (`areaLatitude`, `areaLongitude`, `areaRadiusKm`). O app envia a localização do início da coleta (`startLocation`). Alertas da auditoria: `TOO_FAST` (abaixo de max(10 s, 2 s por resposta) ou abaixo de 35% da mediana, com ≥5 coletas), `OUT_OF_AREA`, `NO_LOCATION` (só informativo), `REPEATED_ANSWERS` (6+ respostas iguais seguidas de escolha/escala/sim-não, ou 3+ textos idênticos) e `MISSING_AUDIO` (pesquisa grava, há consentimento e não há áudio).
- **Exportações**: CSV, XLSX (abas Resumo, Coletas, Pesquisadores, Respostas por questão e Qualidade), JSON e PDF seguem os mesmos filtros do painel. Células que começam com `=`, `+`, `-`, `@` são neutralizadas contra injeção de fórmula. Só o administrador da empresa da pesquisa exporta.
- **Modelos e duplicação**: a biblioteca traz 5 questionários prontos; duplicar copia seções, questões, opções e regras (não copia coletas, equipe nem datas) e cria um rascunho.
- **Consentimento**: em pesquisas que gravam a entrevista, a coleta só é aceita se o consentimento tiver sido registrado de forma explícita, com data e hora, **antes** do início da coleta. Caso contrário a API responde `400` com o código `CONSENT_REQUIRED`.
- **Idempotência das coletas**: cada coleta carrega um `clientId` único gerado no aparelho, então reenvios após falha de rede não geram duplicidade.
- **Sincronização em lote** (`POST /collection/sync`): o aparelho envia `{ deviceId, collections: [...] }` (até 100 coletas, cada uma com `clientId` em UUID, `researchId`, `startedAt`, `finishedAt`, `consent` e `answers`). A resposta traz, **por coleta**, `ACCEPTED`, `ALREADY_EXISTS` (mesmo UUID já recebido: pode sair da fila) ou `REJECTED` com `code`, `reason` e `retryable` (`false` = recusa definitiva; `true` = falha temporária, continuar tentando). Uma recusa nunca derruba o lote: pesquisa encerrada (`RESEARCH_CLOSED`), questão que não existe na pesquisa (`QUESTION_NOT_FOUND`, com os `questionIds`), consentimento ausente (`CONSENT_REQUIRED`), datas inconsistentes (`INVALID_DATES`) e dados malformados (`INVALID_PAYLOAD`) afetam só a coleta em questão. Cada envio fica registrado em `SyncLog` (aparelho, horário e resultado por coleta). O áudio da entrevista não viaja no lote.
- **Mídias**: o áudio é limitado por `AUDIO_MAX_BYTES` (150 MB por padrão) e cada foto por `PHOTO_MAX_BYTES` (30 MB). Fotos e áudios sobem depois das respostas, ligados à coleta pelo UUID, e arquivos grandes podem subir em pedaços retomáveis. Reenviar o mesmo arquivo responde `ALREADY_EXISTS`.
- **Cópias da pesquisa**: cada pesquisador baixa a pesquisa por aparelho (`X-Device-ID`). Enquanto houver cópias ativas, o **questionário** (seções, questões, opções e regras) fica travado para edição e a API responde `403` com o código `RESEARCH_LOCKED`; uma pesquisa encerrada também fica travada. A cópia sai quando o aparelho a devolve, ou quando o administrador a **revoga** (aparelho perdido, pesquisador que saiu); um aparelho revogado pode ser **desbloqueado** depois.
- **Encerramento**: encerrar uma pesquisa bloqueia coletas novas e congela o resultado (`POST /research/:id/close`, só administrador).
- **Sessão expirada**: ao receber `401`, o web faz logout e o mobile limpa o token e volta para a tela de login.

## Segurança

- **CORS restrito**: só as origens de `CORS_ORIGINS` chamam a API a partir de um navegador (ver [Variáveis de ambiente](#variáveis-de-ambiente)).
- **Cabeçalhos de segurança** com `helmet`.
- **Limite de requisições** por IP (`@nestjs/throttler`): 300 por minuto no geral e **10 por minuto** em `POST /auth/login` e `POST /auth/change-password`. A sincronização de coletas e as imagens ficam fora do limite geral (vários aparelhos no mesmo Wi-Fi compartilham o IP). O contador fica na memória de cada instância: em ambiente serverless com várias instâncias ele é aproximado, e a proteção firme contra adivinhar senha é o bloqueio por conta, abaixo.
- **Bloqueio por conta**: depois de `LOGIN_MAX_ATTEMPTS` senhas erradas seguidas, o login daquela conta fica trancado por `LOGIN_LOCK_MINUTES` e a API responde `429` com o código `ACCOUNT_LOCKED`. O contador fica no banco (`failedLoginAttempts`, `lockedUntil`), então vale mesmo com várias instâncias.
- **Sessão sempre conferida no banco**: a cada requisição o `AuthGuard` confere se o usuário ainda existe, está ativo e continua com a mesma senha. Usuário excluído, desativado ou que trocou a senha perde a sessão na hora, mesmo com o token ainda dentro do prazo (o token carrega `pv`, uma impressão digital da senha).
- **Política de senha**: de 8 a 64 caracteres, com pelo menos uma letra e um número (cadastro, edição e troca).
- **Senha temporária**: usuários cadastrados por outra pessoa, contas redefinidas e o superadministrador do seed têm `mustChangePassword`. Enquanto a senha não for trocada, a API responde `403` com o código `PASSWORD_CHANGE_REQUIRED` em tudo, menos `GET /auth/me`, `GET /auth/profile` e `POST /auth/change-password`. O painel e o app abrem a tela de troca automaticamente.
- **Esqueci a senha (assistido)**: o cadastro não tem e-mail, então não há link de recuperação. Quem gerencia a conta usa **Redefinir senha** (`POST /user/:username/reset-password`): a API gera uma senha temporária aleatória, mostrada uma única vez, destrava a conta e encerra as sessões. Administrador redefine pesquisadores da própria empresa; superadministrador redefine administradores. Um superadministrador que perde a senha só é recuperado direto no banco.

### Atualizar um banco que já existe

Os campos novos de `User` precisam existir no banco. Em bancos já criados, rode:

```sql
ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" boolean NOT NULL DEFAULT false,
  ADD COLUMN "failedLoginAttempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" timestamptz NULL;
```

Os recursos de produto (regras avançadas, mapa e qualidade) também precisam de colunas novas:

```sql
ALTER TABLE "QuestionRule"
  ADD COLUMN "operator" text NOT NULL DEFAULT 'EQ',
  ADD COLUMN "action" text NOT NULL DEFAULT 'SHOW',
  ADD COLUMN "groupKey" text NULL,
  ADD COLUMN "targetSectionId" integer NULL REFERENCES "Section"("id") ON DELETE CASCADE,
  ALTER COLUMN "targetQuestionId" DROP NOT NULL;

ALTER TABLE "Collection"
  ADD COLUMN "startLatitude" double precision NULL,
  ADD COLUMN "startLongitude" double precision NULL,
  ADD COLUMN "locationAccuracy" double precision NULL;

ALTER TABLE "Research"
  ADD COLUMN "areaLatitude" double precision NULL,
  ADD COLUMN "areaLongitude" double precision NULL,
  ADD COLUMN "areaRadiusKm" double precision NULL;
```

Dependências novas: `exceljs` e `pdfkit` (API) e `leaflet` (web); rode `npm install` em `api/` e `web/`. A API e o app devem ser atualizados juntos: o app antigo não envia localização e não entende regras de seção.

(Confira o nome/tipo exatos das colunas em `api/src/prisma/contract.json` no seu ambiente.) Depois da atualização **todos precisam entrar de novo**: os tokens antigos não têm `pv` e deixam de valer.

## Testes e qualidade de código

```bash
# API
cd api
npm run test         # testes unitários (Jest)
npm run test:cov     # cobertura
npm run test:e2e     # testes ponta a ponta
npm run lint         # ESLint
npm run format       # Prettier

# Web
cd web
npm run lint
npm run build        # verifica se o build de produção compila

# Mobile
cd mobile
npm run lint
```

## Fluxo de trabalho com branches

| Branch | Uso |
| --- | --- |
| `main` | Versão estável |
| `dev-kaiky` | Desenvolvimento de Kaiky (esta branch) |
| `dev-girlane` | Desenvolvimento de Girlane |
| `mobile` | Desenvolvimento do aplicativo mobile |

Sugestão de fluxo:

1. Crie suas alterações na sua branch de desenvolvimento.
2. Use mensagens de commit no padrão *Conventional Commits* (ex.: `feat(web): ...`, `fix(api): ...`).
3. Abra um Pull Request para `main` e peça revisão antes do merge.

## Problemas comuns

- **O app mobile não conecta na API**: confira se o celular e o computador estão na mesma rede, se `EXPO_PUBLIC_API_URL` usa o IP da máquina (não `localhost`) e se o firewall libera a porta `3001`. Depois de alterar o `.env`, reinicie o Expo com `npx expo start -c`.
- **Painel web redireciona sempre para `/login`**: o `JWT_SECRET` do `web/.env.local` precisa ser idêntico ao da API.
- **Erro de conexão com o banco ao subir a API**: verifique o `DATABASE_URL` e se o PostgreSQL é versão 15 ou superior.
- **Tipos do banco desatualizados após mudar o contrato**: rode `npm run contract:emit` dentro de `api/`.
- **Falha de login no web por CORS/cookie**: a API aceita qualquer origem com credenciais; confirme que o painel está chamando o endereço correto da API.

---

Projeto acadêmico, semestre 2026.2.
