/**
 * MASTER CRITIC ENGINE TEST RUNNER
 * Runs:
 * 1. Financial Notification Classifier & Multi-factor Deduplication Suite
 * 2. Manual Entry UI/UX Redesign Suite
 * 3. Notification Inbox & Lock Screen / Background Sync Suite
 */

const { runCriticEngineTests } = require('./critic_classifier');
const { evaluateManualEntryUI } = require('./critic_manual_entry_ui');
const { evaluateInboxUI } = require('./critic_inbox_ui');
const { runNotificationReaderCritic } = require('./critic_notification_reader');
const { runAxioEngineCritic } = require('./critic_axio_features');
const { execSync } = require('child_process');

console.log('======================================================================');
console.log('🚀 MASTER CRITIC EVALUATION FOR FINANCE ME (AXIO-BEATING EDITION)');
console.log('======================================================================\n');

console.log('TEST 1: NOTIFICATION CLASSIFIER & MULTI-FACTOR DEDUPLICATION');
const classifierResult = runCriticEngineTests();

console.log('\nTEST 2: NOTIFICATION READER ENGINE (REAL-WORLD SMS & LOCK SCREEN)');
const readerResult = runNotificationReaderCritic();

console.log('\nTEST 3: AXIO-BEATING ENGINE (SMART TITLING, BANK PASSBOOK, BILL REMINDERS)');
const axioResult = runAxioEngineCritic();

console.log('\nTEST 4: MANUAL ENTRY UI/UX REDESIGN');
const manualUIResult = evaluateManualEntryUI();

console.log('\nTEST 5: NOTIFICATION INBOX & REVIEW AREA');
const inboxResult = evaluateInboxUI();

console.log('\nTEST 6: INTERCONNECTED END-TO-END WORKINGS');
let interconnectedPassed = false;
try {
  execSync('node scratch/critic_interconnected_workings.js', { stdio: 'inherit' });
  interconnectedPassed = true;
} catch (e) {
  interconnectedPassed = false;
}
const interconnectedScore = interconnectedPassed ? 10.0 : 0.0;

console.log('======================================================================');
console.log('📋 MASTER CRITIC SCORECARD');
console.log('======================================================================');
console.log(`1. Notification Classifier:  ${classifierResult.score.toFixed(1)} / 10.0  -> ${classifierResult.passed ? 'PASSED ✅' : 'FAILED ❌'}`);
console.log(`2. Notification Reader:      ${readerResult.score.toFixed(1)} / 10.0  -> ${readerResult.passed ? 'PASSED ✅' : 'FAILED ❌'}`);
console.log(`3. Axio-Beating Engine:      ${axioResult.score.toFixed(1)} / 10.0  -> ${axioResult.passed ? 'PASSED ✅' : 'FAILED ❌'}`);
console.log(`4. Manual Entry UI/UX:       ${manualUIResult.score.toFixed(1)} / 10.0  -> ${manualUIResult.passed ? 'PASSED ✅' : 'FAILED ❌'}`);
console.log(`5. Notification Inbox Suite: ${inboxResult.score.toFixed(1)} / 10.0  -> ${inboxResult.passed ? 'PASSED ✅' : 'FAILED ❌'}`);
console.log(`6. Interconnected Workings:  ${interconnectedScore.toFixed(1)} / 10.0  -> ${interconnectedPassed ? 'PASSED ✅' : 'FAILED ❌'}`);

const overall = ((classifierResult.score + readerResult.score + axioResult.score + manualUIResult.score + inboxResult.score + interconnectedScore) / 6).toFixed(1);
console.log('----------------------------------------------------------------------');
console.log(`🏆 OVERALL SYSTEM SCORE:      ${overall} / 10.0`);
console.log(`🎯 TARGET THRESHOLD:          >= 8.0 / 10.0`);
console.log(`🎉 OVERALL STATUS:            ${overall >= 8.0 ? 'EXCELLENT QUALITY (CERTIFIED)' : 'RETRY NEEDED'}`);
console.log('======================================================================\n');

