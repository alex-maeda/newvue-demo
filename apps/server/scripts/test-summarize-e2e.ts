/**
 * Integration test for the summarization pipeline.
 * Runs the full pipeline for Patient_1, current study P1-CURRENT-001 (MR Brain).
 *
 * Run: npx tsx scripts/test-summarize-e2e.ts
 */
import { loadPatientFeed } from '../src/services/feed-loader';
import { runSummarizationPipeline } from '../src/services/summarization-service';
import { config } from '../src/config';

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr || 'Unknown';
  return `${dateStr.substring(4, 6)}/${dateStr.substring(6, 8)}/${dateStr.substring(0, 4)}`;
}

async function main() {
  console.log('── Summarization Pipeline E2E Test ──');
  console.log(`Model: ${config.bedrockModelId}`);
  console.log(`Region: ${config.awsRegion}`);
  console.log('');

  // Load patient data
  const patientRecord = loadPatientFeed('Patient_1');
  if (!patientRecord) {
    console.error('❌ Patient_1 not found');
    process.exit(1);
  }

  console.log(`Patient: ${patientRecord.demographics.name.first} ${patientRecord.demographics.name.last}`);
  console.log(`Total studies: ${patientRecord.totalStudies}`);
  console.log(`Current studies: ${patientRecord.currentStudies.map(cs => cs.currentStudyId).join(', ')}`);
  console.log('');

  const currentStudyId = 'P1-CURRENT-001';
  const currentStudy = patientRecord.currentStudies.find(cs => cs.currentStudyId === currentStudyId);
  if (!currentStudy) {
    console.error(`❌ Current study ${currentStudyId} not found`);
    process.exit(1);
  }

  console.log(`Current exam: ${currentStudy.studyDescription}`);
  console.log(`Indication: ${currentStudy.clinicalIndication}`);
  console.log(`Body regions: ${currentStudy.labels.bodyRegions.join(', ')}`);
  console.log('');

  // Run the pipeline
  console.log('Running summarization pipeline...');
  console.log('');

  try {
    const result = await runSummarizationPipeline(patientRecord, currentStudyId);

    console.log('');
    console.log('══════════════════════════════════════════');
    console.log('RESULTS');
    console.log('══════════════════════════════════════════');
    console.log(`Total latency: ${result.totalLatencyMs}ms`);
    console.log(`Total tokens: ${result.totalTokenUsage.input} in / ${result.totalTokenUsage.output} out`);
    console.log(`Individual analyses: ${result.individualAnalyses.length}`);
    console.log('');

    for (const analysis of result.individualAnalyses) {
      console.log(`── ${analysis.studyName} (${analysis.accessionNumber}) ──`);
      console.log(`   Date: ${analysis.studyDate}`);
      console.log(`   Clinical: ${analysis.clinicalPresentation || 'N/A'}`);
      console.log(`   Findings: ${analysis.findings.length}`);
      console.log('');

      for (const finding of analysis.findings) {
        const labels: string[] = [];
        if (finding.severity) labels.push(`[${finding.severity.toUpperCase()}]`);
        if (finding.technique) labels.push('[TECHNIQUE]');
        if (finding.trend) labels.push(`[${finding.trend.toUpperCase()}]`);
        if (finding.incidental) labels.push('[INCIDENTAL]');

        console.log(`   • ${finding.id}: ${finding.name} → ${finding.bodySubregion} (${finding.subregionSource}) ${labels.join(' ')}`);

        if (finding.measurements.length > 0) {
          for (const m of finding.measurements) {
            console.log(`     📏 ${m.dimension} — ${m.context}`);
          }
        }
        if (finding.changeStatement) {
          console.log(`     📈 ${finding.changeStatement}`);
        }
        if (finding.recommendation) {
          console.log(`     ⚡ Recommendation: ${finding.recommendation.action}${finding.recommendation.timeframe ? ` (${finding.recommendation.timeframe})` : ''}`);
        }
      }
      console.log('');
    }

    // Executive Summary
    if (result.executiveSummary) {
      const es = result.executiveSummary;
      console.log('══════════════════════════════════════════');
      console.log('EXECUTIVE SUMMARY');
      console.log('══════════════════════════════════════════');

      for (const group of es.regionGroups) {
        console.log(`\n── ${group.regionName} ──`);
        for (const finding of group.findings) {
          const chipStr = finding.chips.length > 0 ? ` ${finding.chips.map(c => `[${c}]`).join(' ')}` : '';
          console.log(`   • ${finding.name}${chipStr}`);
          for (const entry of finding.studyEntries) {
            const parts = [`     [${entry.findingId}] ${entry.studyName} (${entry.studyDate})`];
            if (entry.measurement) parts.push(`📏 ${entry.measurement}`);
            if (entry.changeStatement) parts.push(`📈 ${entry.changeStatement}`);
            console.log(parts.join(' — '));
          }
        }
      }

      if (es.similarPriorPresentations.length > 0) {
        console.log('\n── Similar Prior Presentations ──');
        for (const sp of es.similarPriorPresentations) {
          console.log(`   • ${sp.studyName} (${sp.studyDate}) — "${sp.priorPresentation}"`);
          console.log(`     Key findings: ${sp.keyFindings.join(', ')}`);
        }
      }

      if (es.openRecommendations.length > 0) {
        console.log('\n── Open Recommendations ──');
        for (const rec of es.openRecommendations) {
          const statusIcon = rec.status === 'fulfilled' ? '✅' : rec.status === 'overdue' ? '🔴' : '⏳';
          console.log(`   ${statusIcon} ${rec.action} — from ${rec.sourceStudyName} (${formatDate(rec.sourceStudyDate)})`);
          console.log(`     Context: ${rec.findingContext} | Timeframe: ${rec.timeframe || 'N/A'} | Status: ${rec.status}`);
          if (rec.fulfilledBy) console.log(`     Fulfilled by: ${rec.fulfilledBy}`);
        }
      }

      console.log(`\n   📝 ${es.normalStatement}`);
      console.log('');
    } else {
      console.log('\n⚠️ No executive summary generated.\n');
    }

    // QA Summary
    console.log('── QA LOG ──');
    for (const qa of result.qaLog) {
      const passCount = qa.validation.checks.filter(c => c.status === 'pass').length;
      const warnCount = qa.validation.checks.filter(c => c.status === 'warning').length;
      const failCount = qa.validation.checks.filter(c => c.status === 'fail').length;
      const icon = qa.validation.passed ? '✅' : '❌';
      console.log(`  ${icon} ${qa.label} — ${qa.latencyMs}ms — ✅${passCount} ⚠️${warnCount} ❌${failCount} — ${qa.tokenUsage.input}+${qa.tokenUsage.output} tokens`);
    }

    // Write full JSON output
    const fs = await import('fs');
    fs.writeFileSync('summarize-test-output.json', JSON.stringify(result, null, 2));
    console.log('');
    console.log('Full output written to summarize-test-output.json');

  } catch (error) {
    console.error('❌ Pipeline failed:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
