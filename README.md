# EAS Soroban (MVP) 🛰️📝

Um mini **EAS-like** (Ethereum Attestation Service) rodando na **Soroban / Stellar Testnet**, com:

- 🦀 **Contrato** (Soroban Rust): schemas, atestacoes, revogacao e verificacao
- 🧠 **API + Indexer** (Node/TS): consome eventos do contrato e salva no Postgres
- 🖥️ **Frontend** (React + Vite): UI basica para criar schema, atestar, verificar e revogar
- 🌐 **Padrao do seu dominio**: tudo por **basePath** em `/_/` estilo `https://portifolio.cloud/EAS/`

## BasePath (importante!) 🧭

- Frontend: `/EAS/`
- API: `/EAS/api/` (o proxy tira o prefixo e manda pra API como `/...`)

## Link pro seu GitHub (na home) 🧷

A home do `/EAS/` mostra um link para o seu GitHub e lista automaticamente os **repos publicos** de sua autoria (sem forks e sem archived).

Configuracao:

- `VITE_GITHUB_USERNAME` (opcional): username do GitHub (default: `lello`)
  - Default atual: `LelloTereciani`

## Estrutura do repo 📦

- `contracts/eas`: contrato Soroban
- `apps/api`: API + indexer + chamadas Soroban RPC
- `apps/web`: frontend (build estatico)
- `infra/edge-proxy/nginx/conf.d/default.conf`: nginx local (simula o edge proxy do VPS)
- `docker-compose.local.yml`: sobe tudo local com proxy em `http://localhost:8080`
- `docker-compose.prod.yml`: compose pensado para VPS (rede docker `edge` externa)

## Requisitos ✅

- Docker + Docker Compose
- Node 22+
- pnpm (via corepack)
- Rust + Cargo
- `stellar` CLI (voce ja tem `stellar 23.3.0` instalado)

### Sobre seu erro no `cargo install` 🧯

Voce tentou:

```bash
cargo install stellar-cli 25.1.0
```

Isso falha por 2 motivos:

1. A sintaxe correta para versao e `--version`.
2. Voce ja tem um binario `stellar` (do `soroban-cli v23.3.0`), entao precisa `--force` se quiser sobrescrever.

Se voce realmente quiser instalar a `stellar-cli 25.1.0`, o comando correto e:

```bash
cargo install stellar-cli --version 25.1.0 --locked --force
```

Dito isso: **nao e obrigatorio** para rodar este MVP (estamos usando o `stellar 23.3.0`).

## Quickstart local (rodando de verdade) 🚀

### 1) Instalar deps JS

```bash
pnpm install
```

### 2) Preparar Rust target da Soroban

```bash
rustup target add wasm32v1-none
```

### 3) Build do contrato (gera `.wasm`) 🦀

```bash
stellar contract build \
  --manifest-path contracts/eas/Cargo.toml \
  --out-dir contracts/eas/wasm \
  --optimize
```

Saida esperada: `contracts/eas/wasm/eas_soroban.wasm`.

### 4) Criar `.env` com contas (TESTNET ONLY) 🧪

Gera 3 contas (admin, creator, attester) + 1 subject (public key):

```bash
pnpm accounts:gen
```

### 5) Faucet (Friendbot) para as contas 💧

```bash
pnpm accounts:fund
```

### 6) Deploy do contrato na Testnet 🛰️

```bash
set -a && source .env && set +a
stellar contract deploy \
  --wasm contracts/eas/wasm/eas_soroban.wasm \
  --source-account "$EAS_SCHEMA_CREATOR_SECRET" \
  --network testnet \
  --rpc-url "$SOROBAN_RPC_URL" \
  --network-passphrase "$SOROBAN_NETWORK_PASSPHRASE"
```

Copie o `CONTRACT_ID` retornado e coloque em `SOROBAN_CONTRACT_ID=` no seu `.env`.

### 7) Subir stack local (com proxy igual ao VPS) 🐳🌐

```bash
docker compose -f docker-compose.local.yml build
docker compose -f docker-compose.local.yml up -d
```

Abrir:

- Frontend: `http://localhost:8080/EAS/`
- API health: `http://localhost:8080/EAS/api/healthz`

### 8) Smoke tests (curl) 🔥

```bash
# criar schema
curl -sS -X POST http://127.0.0.1:8080/EAS/api/schemas \
  -H 'content-type: application/json' \
  -d '{"schemaUri":"ipfs://local/schema.json","revocable":true,"expiresAllowed":false,"attesterMode":0}'

# atestar (usa EAS_DEFAULT_SUBJECT do .env)
set -a && source .env && set +a
SCHEMA_ID=... # coloque o schemaId retornado acima
curl -sS -X POST http://127.0.0.1:8080/EAS/api/attestations \
  -H 'content-type: application/json' \
  -d "{\"schemaId\":\"$SCHEMA_ID\",\"subject\":\"$EAS_DEFAULT_SUBJECT\",\"payload\":{\"hello\":\"world\"},\"expirationLedger\":null}"
```

## Testes do contrato (seguranca + compliance) 🛡️🧪

Rodar antes de qualquer deploy:

```bash
cd contracts/eas
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

O pacote `contracts/eas/src/security_tests.rs` inclui testes **property-based** (proptest) e um teste **fuzz-like** cobrindo:

- 🔁 Nonce monotonic por attester (anti-replay) + nao avancar em falha
- 🧾 `issuer_only` (somente creator pode atestar)
- ⏳ Expiracao (inclusive o boundary `now >= exp`)
- 🧯 Revogacao (not_revocable, not_attester, idempotencia)

## Roadmap 🗺️

### Curto prazo (hardening) 🔒

- 🧨 Fuzzing "de verdade" com `cargo-fuzz` (libFuzzer) alem do proptest (minimizacao de crash e corpus).
- 🧾 Migrar eventos do contrato para `#[contractevent]` (mantendo compatibilidade do indexer com versao de evento).
- 🧯 Threat model + `SECURITY.md` (riscos, limites, controles operacionais).
- 🧹 Remover dependencia de secrets no servidor para flows sensiveis (ou isolar em um "signer" separado).
- 🧪 CI: rodar `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` e checks do Node no PR.

### Medio prazo (produto) 🧩

- 👛 Wallet no frontend (assinar tx no cliente): Freighter / Albedo / etc.
- 🔐 Autenticacao na API (JWT/OAuth) + rate limiting + allowlist por origem.
- 📚 OpenAPI/Swagger + SDK cliente para integrar outros projetos.
- 🔎 Indexer mais robusto: reprocessamento, backfill por range de ledger, retries, idempotencia e checkpoints persistidos.
- 🗄️ Melhorar modelagem: suporte a schemas com versionamento e metadata (ex: IPFS/Arweave) de forma padronizada.

### Longo prazo (producao de verdade) 🚢

- 🌐 Multi-network: testnet/mainnet + configuracao por ambiente (staging/prod).
- 🔁 Estrategia de upgrade/migracao do contrato (versionamento, compatibilidade de dados, eventos versionados).
- 🧰 Observabilidade: logs estruturados, metricas, alertas, tracing.
- 💾 Operacao VPS: backups automatizados do Postgres, rotacao de logs, healthchecks e playbook de incidentes.
- ✅ Compliance: trilha de auditoria (quem atestou/revogou), retencao, e controles de acesso.

## VPS / Producao (quando for subir) 🧰

Seu VPS ja usa o padrao:

- Nginx roda em container (`edge-proxy-nginx-1`)
- Proxy por `location` no arquivo `/root/RWAImob/infra/edge-proxy/nginx/conf.d/default.conf`
- Rede docker `edge` externa

O `docker-compose.prod.yml` deste repo ja esta preparado para entrar na rede `edge` e expor aliases:

- `eas-frontend` (porta 3000)
- `eas-api` (porta 4000)

### Snippet Nginx (edge proxy do VPS) 🧩

Ajuste/garanta no `edge-proxy` algo assim (a ordem importa: API primeiro):

```nginx
location = /EAS { return 301 /EAS/; }
location = /eas { return 301 /EAS/; }

location = /EAS/api { return 301 /EAS/api/; }
location /EAS/api/ {
  proxy_pass http://eas-api:4000/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /EAS {
  proxy_pass http://eas-frontend:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

## Segurança (lembrete) 🔒

- ⚠️ As secrets no `.env` sao **TESTNET ONLY**.
- 🚫 Nao comite `.env`.
- ✅ No VPS, mantenha somente `80/443/22` expostos e Postgres apenas na rede docker.

## Onde estamos agora? 📍

- ✅ Contrato buildando e com testes OK
- ✅ `.env` gerado, contas fundadas via faucet
- ✅ Contrato ja foi deployado na Testnet (preencha/valide `SOROBAN_CONTRACT_ID`)
- ✅ Stack local sobe em `http://localhost:8080/EAS/`
- ⏭️ Proximo: subir a mesma stack no VPS e trocar o placeholder do `/EAS` pelo app real
