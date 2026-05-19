# NewVue Demo

Consolidated demo system for the NewVue Radiology Platform. Integrates the worklist frontend, Cockpit UI, and unified backend into a single dockerized monorepo.

## Architecture

```
newvue-demo/
├── apps/
│   ├── frontend/       # Worklist UI (React 18, CRA, Redux, Ant Design)
│   └── server/         # Unified backend (Express, TypeScript, AWS Bedrock)
├── reporting-ui/       # Full Cockpit UI (React 19, Vite, Zustand)
├── docker-compose.yml
├── .env.example
└── .gitignore
```

| Service | Port | Description |
|---------|------|-------------|
| frontend | 3000 | Worklist, login, clinical info page with Cockpit iframe |
| server | 8000 | REST API, ERIK chat (SSE), reporting pipeline, HL7 data, ASR relay |
| reporting-ui | 5174 | Full Cockpit UI — left rail, executive summary, reporting panel |

## Demo Patients

| # | Patient | Exam | Features |
|---|---------|------|----------|
| 1 | Franklin Tanner | XR Chest — PA and Lateral | Field-by-field reporting, no EHR |
| 2 | Elisa Paniagua | CT Chest with Contrast | Field-by-field + impression, no EHR |
| 3 | Paula Everyly | MR Brain without Contrast | Full EHR + ERIK + generative reporting |

## Features & Dependencies

| Feature | Dependency | Env Var |
|---------|-----------|---------|
| ERIK AI chat | AWS Bedrock | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| AI summarization | AWS Bedrock | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| Impression generation | AWS Bedrock | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| Voice dictation (default) | Speechmatics | `SPEECHMATICS_API_KEY` |
| Voice dictation (fallback) | Deepgram | `DEEPGRAM_API_KEY` |
| EHR data (Notes, Problems, Meds, Labs) | FHIR files | None (bundled, Patient_1 only) |
| Patient data | HL7 simulation | None (bundled, 7 patients) |
| Worklist / login | Frontend fakeApi | None (bundled) |

## Prerequisites

- Docker + Docker Compose
- AWS credentials with Bedrock access
- Speechmatics or Deepgram API key (for voice dictation)

## Setup

```bash
git clone https://gitlab.com/newvue1/newvuevr/newvue-demo.git
cd newvue-demo
cp .env.example .env
# Fill in AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SPEECHMATICS_API_KEY, DEEPGRAM_API_KEY
```

## Run — Docker (recommended)

```bash
docker-compose up --build
```

Open http://localhost:3000 (also accessible via IP address from any machine on the network)

## Run — Local Development

```bash
# Terminal 1: Server
cd apps/server && npm install && npm run dev

# Terminal 2: Cockpit UI
cd reporting-ui && npm install && npx vite

# Terminal 3: Frontend
cd apps/frontend && npm install --legacy-peer-deps --ignore-scripts && npm start
```

| Service | Local URL |
|---------|-----------|
| Frontend | http://localhost:3000 |
| Cockpit UI | http://localhost:5174 |
| Server API | http://localhost:8000 |

## Demo Flow

1. Open http://localhost:3000
2. Login
3. Worklist loads — 3 demo patients shown in red at the top
4. Double-click a patient row (Franklin, Elisa, or Paula)
5. Cockpit UI loads with that patient's data:
   - **Left rail** — prior reports (relevance-scored), clinical notes, problems, procedures, pathology, medications, labs
   - **ERIK** — AI chat assistant (type a question in the search bar)
   - **Executive Summary** — toggle with sparkle icon to run AI summarization
   - **Reporting panel** — report template with study selector dropdown, dictation controls, EHR toggle
   - **EHR toggle** — pill switch in the reporting toolbar to enable/disable EHR integration

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | Yes | AWS region for Bedrock (default: `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | Yes | AWS access key for Bedrock |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS secret key for Bedrock |
| `BEDROCK_MODEL_ID` | No | Bedrock model ID (default: `us.anthropic.claude-haiku-4-5-20251001-v1:0`) |
| `SPEECHMATICS_API_KEY` | Yes | Speechmatics API key for real-time ASR (default vendor) |
| `SPEECHMATICS_WS_URL` | No | Speechmatics WebSocket URL (default: `wss://eu2.rt.speechmatics.com/v2`) |
| `DEEPGRAM_API_KEY` | No | Deepgram API key for ASR (fallback vendor) |
| `PORT` | No | Server port (default: `8000`) |
| `CORS_ORIGIN` | No | Allowed CORS origin (default: `*` in Docker) |

## ASR (Speech-to-Text)

WebSocket relay at `/ws/dictation` proxies audio to upstream ASR vendor.

**Vendors:** Speechmatics (default) | Deepgram (fallback)

```
ws://localhost:8000/ws/dictation?vendor=speechmatics&region=head
ws://localhost:8000/ws/dictation?vendor=deepgram&region=head
```

The `region` param loads body-region-specific medical vocabulary for improved recognition accuracy.

## Key APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/patients` | GET | List all patients |
| `/api/v1/patients/:id` | GET | Patient record with studies |
| `/api/v1/patients/:id/summarize` | POST | Run AI summarization pipeline |
| `/api/v1/erik/chat` | POST | ERIK AI chat (SSE streaming) |
| `/api/v1/ehr/:id` | GET | EHR/FHIR data |
| `/api/dictation/pass1` | POST | Dictation Pass 1 (sanitization) |
| `/api/dictation/pass2` | POST | Dictation Pass 2 (field placement) |
| `/api/report/impression` | POST | Impression generation |
| `/api/health` | GET | Reporting API health check |
| `/config/templates/:id.json` | GET | Report templates |
| `/ws/dictation` | WebSocket | ASR relay (Speechmatics/Deepgram) |

## Deployment (GitLab CI/CD → demo EC2)

CI on `main` builds 3 images, pushes to GitLab Container Registry, and (on manual trigger) instructs the demo EC2 via SSM to pull + restart. Auth is OIDC — no AWS keys stored in GitLab. See `.gitlab-ci.yml` and `infra/deploy.sh`.

### Required GitLab CI/CD variables

Settings → CI/CD → Variables. Mask everything except `AWS_REGION`.

| Variable | Example | Notes |
|----------|---------|-------|
| `AWS_REGION` | `us-east-1` | EC2 region |
| `AWS_OIDC_ROLE_ARN` | `arn:aws:iam::<account>:role/GitLabCIDeployRole` | IAM role with SSM permissions; OIDC trust |
| `EC2_INSTANCE_ID` | `i-0xxxxxxxxxxxxxxxx` | Demo EC2 |
| `APP_DIR` | `/newvue-demo` | Path on EC2 where `docker-compose.demo.yml` + `.env` live |

### EC2 `.env` file

Created manually on the EC2 at `${APP_DIR}/.env` (never touched by CI):

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
SPEECHMATICS_API_KEY=...
SPEECHMATICS_WS_URL=wss://eu2.rt.speechmatics.com/v2
DEEPGRAM_API_KEY=...
```

### EC2 prerequisites

1. **SSM Agent + IAM role** with `AmazonSSMManagedInstanceCore` — verify "Online" in Systems Manager → Fleet Manager.
2. **`${APP_DIR}/docker-compose.demo.yml`** — `scp` once from this repo; CI never overwrites it.
3. **Docker Compose v2** (`docker compose version`, not `docker-compose`).

### Rollback

```bash
aws ssm send-command --region <region> --instance-ids <id> \
  --document-name AWS-RunShellScript \
  --parameters 'commands=[
    "cd /newvue-demo",
    "export IMAGE_TAG=<previous-sha>",
    "docker compose -f docker-compose.demo.yml pull",
    "docker compose -f docker-compose.demo.yml up -d"
  ]'
```

Find previous SHAs in GitLab Container Registry UI or `git log --oneline main`.

## Smoke Test

Run after every deploy at `https://demo.dev.newvueai.app/`. ~3 minutes.

| # | Step | Pass criteria |
|---|------|---------------|
| 1 | Login | Worklist loads with 3 demo patients (Paula, Franklin, Elisa) at top |
| 2 | Double-click Paula Everyly | Cockpit iframe loads with EHR data + MRI brain template |
| 3 | Type into ERIK: "What are her recent labs?" | Streamed lab values appear within ~5s |
| 4 | Click sparkle icon → Executive Summary | AI summary renders within ~30-60s |
| 5 | Click Findings field, mic on, say "The brain parenchyma appears normal." | Text appears formatted in field within ~2s |

On failure: SSM into EC2 → `cd /newvue-demo && docker compose -f docker-compose.demo.yml logs --tail=200 <service>`. If unrecoverable in <10 min, [roll back](#rollback).
