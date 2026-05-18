import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import patientRoutes from './routes/patients';
import summarizationRoutes from './routes/summarization';
import ehrRoutes from './routes/ehr';
import erikRoutes from './routes/erik';
import { getDevSettings, updateDevSettings } from './services/dev-settings-loader';

// ── Global Error Handlers ──────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[GLOBAL] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error('[FATAL] Port already in use:', err.message);
    process.exit(1);
  }
  console.error('[GLOBAL] Uncaught Exception (non-fatal):', err.message || err);
});

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../../public')));

// Serve config directory as static for client-side template loading
app.use('/config', express.static(config.reportingConfigDir));

// ── Health Check ───────────────────────────────────────────────────────────
app.get(`${config.apiPrefix}/health`, (_req, res) => {
  res.json({
    status: 'ok',
    service: 'newvue-cockpit',
    timestamp: new Date().toISOString(),
    hl7SimulationPath: config.hl7SimulationPath,
  });
});

// Reporting health check (legacy /api/health path)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', phase: 6, uptime: process.uptime() });
});

// ── Summarization Routes ──────────────────────────────────────────────────
app.use(`${config.apiPrefix}/patients`, patientRoutes);
app.use(`${config.apiPrefix}/patients`, summarizationRoutes);
app.use(`${config.apiPrefix}/ehr`, ehrRoutes);
app.use(`${config.apiPrefix}/erik`, erikRoutes);

// ── Dev Settings API (development-only model comparison) ──────────────────
app.get(`${config.apiPrefix}/dev-settings`, (_req, res) => {
  res.json(getDevSettings());
});

app.put(`${config.apiPrefix}/dev-settings`, (req, res) => {
  const updated = updateDevSettings(req.body);
  res.json(updated);
});

// ── Load Reporting Config Data ────────────────────────────────────────────

let autoCorrectRules: Record<string, string> | null = null;
try {
  const acPath = path.join(config.reportingConfigDir, 'autocorrect.json');
  const acData = fs.readFileSync(acPath, 'utf8');
  autoCorrectRules = JSON.parse(acData);
  console.log(`[Startup] Loaded ${Object.keys(autoCorrectRules!).length} autocorrect rules`);
} catch (e: any) {
  console.warn('[Startup] Could not load autocorrect.json:', e.message);
}

const ASR_LISTS: Record<string, string[]> = {};
try {
  const configFiles = fs.readdirSync(config.reportingConfigDir).filter(
    (f: string) => f.startsWith('ASR_') && f.endsWith('.json'),
  );
  for (const f of configFiles) {
    const regionKey = f.replace(/^ASR_/, '').replace(/\.json$/, '').toLowerCase();
    const list = JSON.parse(fs.readFileSync(path.join(config.reportingConfigDir, f), 'utf8'));
    if (Array.isArray(list)) {
      ASR_LISTS[regionKey] = list;
    }
  }
  console.log(`[Startup] Loaded ASR lists for: ${Object.keys(ASR_LISTS).join(', ') || '(none)'}`);
} catch (e: any) {
  console.warn('[Startup] Could not load ASR lists:', e.message);
}

// ── Config API Endpoints (Reporting) ──────────────────────────────────────

app.get('/api/config/autocorrect', (_req, res) => {
  if (autoCorrectRules) {
    return res.json(autoCorrectRules);
  }
  res.status(404).json({ error: 'autocorrect rules not loaded' });
});

app.get('/api/config/asr-keywords/:region', (req, res) => {
  const region = (req.params.region || '').toLowerCase();
  const list = ASR_LISTS[region] || [];
  res.json({ region, keywords: list });
});

// ── Mount Reporting Routers (ESM modules loaded dynamically) ──────────────

async function mountReportingRouters() {
  try {
    const pass1Router = (await import('./reporting/pass1Router.js')).default;
    const pass2Router = (await import('./reporting/pass2Router.js')).default;
    const pass2bRouter = (await import('./reporting/pass2bRouter.js')).default;
    const impressionRouter = (await import('./reporting/impressionRouter.js')).default;
    const profileRouter = (await import('./reporting/profileRouter.js')).default;
    const sessionRouter = (await import('./reporting/sessionRouter.js')).default;
    const voiceSanitizeRouter = (await import('./reporting/voiceSanitizeRouter.js')).default;

    app.use(pass1Router);        // POST /api/dictation/pass1
    app.use(pass2Router);        // POST /api/dictation/pass2  (Pass 2A: placement)
    app.use(pass2bRouter);       // POST /api/dictation/pass2b (Pass 2B: normal processing)
    app.use(impressionRouter);   // POST /api/report/impression
    app.use(profileRouter);      // GET/PUT /api/user/profile, /api/user/preferences, /api/user/avatar
    app.use(sessionRouter);      // POST/GET/DELETE /api/session/*
    app.use(voiceSanitizeRouter); // POST /api/dictation/voice-sanitize

    console.log('[Startup] Reporting routers mounted successfully');
  } catch (e: any) {
    console.error('[Startup] Failed to mount Reporting routers:', e.message);
    console.error(e.stack);
  }
}

// ── Start Server ──────────────────────────────────────────────────────────

async function startServer() {
  // Mount Reporting routers before starting the server
  await mountReportingRouters();

  const server = app.listen(config.port, () => {
    console.log(`\n╔════════════════════════════════════════════════╗`);
    console.log(`║  NewVue Cockpit Server (Unified)               ║`);
    console.log(`║  http://localhost:${config.port}                         ║`);
    console.log(`╚════════════════════════════════════════════════╝\n`);
    console.log(`[Startup] Summarization API: http://localhost:${config.port}${config.apiPrefix}/health`);
    console.log(`[Startup] Reporting API:     http://localhost:${config.port}/api/health`);
    console.log(`[Startup] HL7 data path:     ${config.hl7SimulationPath}`);

    console.log(`[Startup] Bedrock model:     ${config.bedrockModelId} (${config.awsRegion})`);
    if (!process.env.DEEPGRAM_API_KEY) {
      console.warn('[WARN] DEEPGRAM_API_KEY not set — Deepgram dictation will not work');
    }
  });

  // Attach ASR WebSocket relay
  try {
    const asrModule = await import('./reporting/asrRelay.js');
    const attachAsrRelay = asrModule.attachAsrRelay;
    attachAsrRelay(server, ASR_LISTS);
    console.log('[Startup] ASR WebSocket relay attached');
  } catch (e: any) {
    console.error('[Startup] Failed to attach ASR relay:', e.message);
  }
}

startServer();

export default app;
