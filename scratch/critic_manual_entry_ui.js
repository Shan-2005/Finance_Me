/**
 * CRITIC ENGINE - MANUAL ENTRY UI/UX EVALUATION SUITE
 * 
 * Target: Score >= 8.0 / 10.0 (Pass threshold)
 * Evaluates:
 * 1. Visual Hierarchy & Typography (Space Grotesk, Plus Jakarta Sans, JetBrains Mono for amounts)
 * 2. Segmented Transaction Type Selector (Debit vs Credit with animated pill, distinctive colors & icons)
 * 3. Hero Amount Display with Monospace font, auto-formatted currency symbol, and Quick Preset Amount Chips (+₹100, +₹500, +₹1,000, +₹2,000)
 * 4. Custom Visual Category Dropdown/Selector with Rich Icons & Subtitles (🏠 Unavoidable, 🛍️ Unwanted/Leak, 📈 Investments, 💰 Income)
 * 5. Custom Payment Mode Selector with Brand Icons (⚡ GPay/UPI, 💳 Card, 🏦 Net Banking, 💵 Cash)
 * 6. Responsive Ergonomics & Micro-Interactions (Backdrop blur, tactile active states, haptic-ready, mobile keyboard decimal mode)
 * 7. Validation, Smart Defaults & Error Prevention (Autofill date, merchant suggestions, clean resets)
 */

const fs = require('fs');
const path = require('path');

function evaluateManualEntryUI() {
  console.log('=================================================================');
  console.log('🔍 EXECUTING CRITIC ENGINE: MANUAL ENTRY UI/UX REDESIGN');
  console.log('=================================================================\n');

  const indexPath = 'd:/Finace_Me/index.html';
  const stylesPath = 'd:/Finace_Me/styles.css';
  const appPath = 'd:/Finace_Me/app.js';

  const indexContent = fs.readFileSync(indexPath, 'utf-8');
  const stylesContent = fs.readFileSync(stylesPath, 'utf-8');
  const appContent = fs.readFileSync(appPath, 'utf-8');

  const criteria = [
    {
      id: 'CRIT-1',
      name: 'Modern Typography & Font Stacking',
      weight: 1.5,
      check: () => {
        const hasJakarta = stylesContent.includes('Plus Jakarta Sans');
        const hasMono = stylesContent.includes('JetBrains Mono');
        const hasGrotesk = stylesContent.includes('Space Grotesk');
        const hasAmountFont = stylesContent.includes('--font-amount');
        return hasJakarta && hasMono && hasGrotesk && hasAmountFont;
      },
      critique: 'Requires Space Grotesk for headings, Plus Jakarta Sans for UI labels, and JetBrains Mono for monetary numerals.'
    },
    {
      id: 'CRIT-2',
      name: 'Tactile Segmented Type Selector (Debit/Credit)',
      weight: 1.5,
      check: () => {
        const hasSegmentedHTML = indexContent.includes('type-segment') || indexContent.includes('txn-type-toggle') || indexContent.includes('segmented-type-btn');
        const hasSegmentedCSS = stylesContent.includes('.segmented-control') || stylesContent.includes('.type-segmented');
        return hasSegmentedHTML && hasSegmentedCSS;
      },
      critique: 'Must replace plain select with a tactile 2-way segmented control featuring distinct active colors, icons (arrow-up-right / arrow-down-left), and smooth sliding transitions.'
    },
    {
      id: 'CRIT-3',
      name: 'Hero Currency Input with Quick Amount Preset Chips',
      weight: 1.5,
      check: () => {
        const hasHeroAmount = indexContent.includes('hero-amount-wrapper') || indexContent.includes('amount-input-hero');
        const hasPresetChips = indexContent.includes('amount-preset-chip') || indexContent.includes('quick-amount-chip');
        const hasDecimalMode = indexContent.includes('inputmode="decimal"');
        return hasHeroAmount && hasPresetChips && hasDecimalMode;
      },
      critique: 'Must feature a prominent hero currency input with currency symbol prefix, inputmode="decimal" for mobile keypad, and 1-tap quick amount preset chips (+100, +500, +1000, +2000).'
    },
    {
      id: 'CRIT-4',
      name: 'Custom Visual Category Dropdown with Rich Icons & Subtitles',
      weight: 1.5,
      check: () => {
        const hasCustomCategoryPicker = indexContent.includes('custom-category-dropdown') || indexContent.includes('category-picker-grid');
        const hasCategoryIcons = indexContent.includes('fa-house') && indexContent.includes('fa-bag-shopping') && indexContent.includes('fa-chart-line') && indexContent.includes('fa-sack-dollar');
        const hasCategoryCSS = stylesContent.includes('.category-item') || stylesContent.includes('.custom-dropdown-menu');
        return hasCustomCategoryPicker && hasCategoryIcons && hasCategoryCSS;
      },
      critique: 'Categories must not be a bare dropdown. Must feature custom dropdown items or grid cards with badges, icons (House, Shopping Bag, Chart Line, Sack Dollar), and sub-labels.'
    },
    {
      id: 'CRIT-5',
      name: 'Custom Payment Method Selector with Brand/Mode Icons',
      weight: 1.5,
      check: () => {
        const hasCustomModePicker = indexContent.includes('custom-mode-dropdown') || indexContent.includes('payment-mode-grid');
        const hasModeIcons = indexContent.includes('fa-bolt') && indexContent.includes('fa-credit-card') && indexContent.includes('fa-building-columns') && indexContent.includes('fa-money-bill-wave');
        return hasCustomModePicker && hasModeIcons;
      },
      critique: 'Payment mode selector must have proper icons for GPay/UPI (lightning/bolt), Credit/Debit Card, Net Banking (building-columns), and Cash (money-bill-wave).'
    },
    {
      id: 'CRIT-6',
      name: 'Responsive Ergonomics, Glassmorphism & Animations',
      weight: 1.5,
      check: () => {
        const hasGlassModal = stylesContent.includes('backdrop-filter') && stylesContent.includes('--glass-surface');
        const hasTransitions = stylesContent.includes('transition:') || stylesContent.includes('transition :');
        const hasActiveStates = stylesContent.includes(':active') || stylesContent.includes('.active');
        return hasGlassModal && hasTransitions && hasActiveStates;
      },
      critique: 'Modal must feel native: glassmorphic backdrop blur, smooth slide-up animation, tactile feedback on button press, clean spacing.'
    },
    {
      id: 'CRIT-7',
      name: 'Smart Form Reset, Pre-fill & Autofocus Logic in JS',
      weight: 1.0,
      check: () => {
        const hasSetAmountPreset = appContent.includes('addAmountPreset') || appContent.includes('setAmountPreset');
        const hasSetCategory = appContent.includes('selectCategory') || appContent.includes('chooseCategory');
        const hasSetType = appContent.includes('selectTransactionType') || appContent.includes('setTransactionType');
        return hasSetAmountPreset && hasSetCategory && hasSetType;
      },
      critique: 'JavaScript must support interactive amount chip incrementing, category selection updates, and animated type toggling.'
    }
  ];

  let totalScore = 0;
  let maxScore = 0;
  let results = [];

  for (const crit of criteria) {
    maxScore += crit.weight;
    let passed = false;
    try {
      passed = crit.check();
    } catch (e) {
      passed = false;
    }

    if (passed) {
      totalScore += crit.weight;
      results.push({ id: crit.id, name: crit.name, status: 'PASS', score: crit.weight, max: crit.weight, critique: 'Excellent implementation.' });
    } else {
      results.push({ id: crit.id, name: crit.name, status: 'NEEDS_WORK', score: 0, max: crit.weight, critique: crit.critique });
    }
  }

  const normalizedScore = Number(((totalScore / maxScore) * 10).toFixed(1));

  console.log('CRITIC ENGINE EVALUATION REPORT:');
  console.log('-----------------------------------------------------------------');
  results.forEach(r => {
    const symbol = r.status === 'PASS' ? '✅' : '❌';
    console.log(`${symbol} [${r.id}] ${r.name.padEnd(50)} : ${r.score}/${r.max}`);
    if (r.status !== 'PASS') {
      console.log(`   Issue: ${r.critique}`);
    }
  });
  console.log('-----------------------------------------------------------------');
  console.log(`📊 FINAL CRITIC SCORE: ${normalizedScore} / 10.0`);
  console.log(`🎯 PASS THRESHOLD:     8.0 / 10.0`);
  console.log(`🏁 VERDICT:            ${normalizedScore >= 8.0 ? 'EXCELLENT (PASSED)' : 'RETRY NEEDED (BELOW 8.0)'}`);
  console.log('=================================================================\n');

  return { score: normalizedScore, passed: normalizedScore >= 8.0, results };
}

if (require.main === module) {
  evaluateManualEntryUI();
}

module.exports = { evaluateManualEntryUI };
