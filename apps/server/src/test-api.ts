/**
 * Test all API endpoints including error cases.
 * Run with: npx ts-node src/test-api.ts
 *
 * Requires the server to be running on port 3001.
 */

const BASE = 'http://localhost:3001/api/v1';

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, pass: true, detail: 'OK' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, pass: false, detail: msg });
  }
}

async function fetchJSON(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  const body = await res.json();
  return { status: res.status, body };
}

async function run(): Promise<void> {
  // ── GET /health ──
  await test('Health check returns ok', async () => {
    const { status, body } = await fetchJSON(`${BASE}/health`);
    if (status !== 200) throw new Error(`Expected 200, got ${status}`);
    if ((body as { status: string }).status !== 'ok') throw new Error('status not ok');
  });

  // ── GET /patients ──
  await test('Patient list returns 7 patients', async () => {
    const { status, body } = await fetchJSON(`${BASE}/patients`);
    if (status !== 200) throw new Error(`Expected 200, got ${status}`);
    if (!Array.isArray(body) || body.length !== 7) {
      throw new Error(`Expected 7 patients, got ${Array.isArray(body) ? body.length : 'non-array'}`);
    }
  });

  // ── GET /patients/:id ──
  const expectedStudyCounts: Record<string, number> = {
    Patient_1: 26, Patient_2: 49, Patient_3: 23,
    Patient_4: 14, Patient_5: 15, Patient_6: 2, Patient_7: 1,
  };

  for (const [id, expected] of Object.entries(expectedStudyCounts)) {
    await test(`${id} has ${expected} studies`, async () => {
      const { status, body } = await fetchJSON(`${BASE}/patients/${id}`);
      if (status !== 200) throw new Error(`Expected 200, got ${status}`);
      const record = body as { totalStudies: number };
      if (record.totalStudies !== expected) {
        throw new Error(`Expected ${expected}, got ${record.totalStudies}`);
      }
    });
  }

  // ── GET /patients/:id/studies ──
  await test('Studies endpoint returns array', async () => {
    const { status, body } = await fetchJSON(`${BASE}/patients/Patient_6/studies`);
    if (status !== 200) throw new Error(`Expected 200, got ${status}`);
    if (!Array.isArray(body) || body.length !== 2) {
      throw new Error(`Expected 2 studies array`);
    }
  });

  // ── GET /patients/:id/studies/:seq ──
  await test('Single study returns correct data', async () => {
    const { status, body } = await fetchJSON(`${BASE}/patients/Patient_6/studies/1`);
    if (status !== 200) throw new Error(`Expected 200, got ${status}`);
    const study = body as { accessionNumber: string; studyDescription: string };
    if (study.accessionNumber !== 'ACC-P6-0001') throw new Error('Wrong accession');
    if (study.studyDescription !== 'XR Chest 2 Views') throw new Error('Wrong description');
  });

  // ── Report sections present ──
  await test('Report sections are parsed correctly', async () => {
    const { body } = await fetchJSON(`${BASE}/patients/Patient_6/studies/1`);
    const sections = (body as { reportSections: Record<string, unknown> }).reportSections;
    if (!sections.clinicalIndication) throw new Error('Missing clinicalIndication');
    if (!sections.technique) throw new Error('Missing technique');
    if (!sections.comparison) throw new Error('Missing comparison');
    if (!sections.findings) throw new Error('Missing findings');
    if (!sections.impression) throw new Error('Missing impression');
  });

  // ── 404: Invalid patient ──
  await test('Invalid patient returns 404', async () => {
    const { status, body } = await fetchJSON(`${BASE}/patients/Patient_99`);
    if (status !== 404) throw new Error(`Expected 404, got ${status}`);
    const problem = body as { type: string; title: string };
    if (problem.title !== 'Patient Not Found') throw new Error('Wrong error title');
  });

  // ── 404: Invalid study ──
  await test('Invalid study sequence returns 404', async () => {
    const { status, body } = await fetchJSON(`${BASE}/patients/Patient_6/studies/99`);
    if (status !== 404) throw new Error(`Expected 404, got ${status}`);
    const problem = body as { type: string; title: string };
    if (problem.title !== 'Study Not Found') throw new Error('Wrong error title');
  });

  // ── 400: Bad sequence param ──
  await test('Non-numeric sequence returns 400', async () => {
    const { status, body } = await fetchJSON(`${BASE}/patients/Patient_6/studies/abc`);
    if (status !== 400) throw new Error(`Expected 400, got ${status}`);
    const problem = body as { title: string };
    if (problem.title !== 'Invalid Parameter') throw new Error('Wrong error title');
  });

  // ── Report ──
  console.log('\n=== API Test Results ===\n');
  let allPass = true;
  for (const r of results) {
    const icon = r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${icon}: ${r.name}${r.pass ? '' : ' — ' + r.detail}`);
    if (!r.pass) allPass = false;
  }
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} tests passed`);
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
}

run().catch(console.error);
