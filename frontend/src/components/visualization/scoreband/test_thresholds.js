
const RISK_BAND_COLORS = {
    LOW: "#4CAF50",
    MEDIUM: "#FFC107",
    HIGH: "#FF9800",
    EXTREME: "#F44336",
};

const getBandColor = (score, type) => {
    // BB, BP, SB use stricter thresholds
    if (['BB', 'BP', 'SB'].includes(type)) {
        if (score <= 5) return RISK_BAND_COLORS.LOW;
        if (score <= 10) return RISK_BAND_COLORS.MEDIUM;
        if (score <= 20) return RISK_BAND_COLORS.HIGH;
        return RISK_BAND_COLORS.EXTREME;
    }

    // VB and others (default)
    if (score <= 10) return RISK_BAND_COLORS.LOW;
    if (score <= 25) return RISK_BAND_COLORS.MEDIUM;
    if (score <= 60) return RISK_BAND_COLORS.HIGH;
    return RISK_BAND_COLORS.EXTREME;
};

const testCases = [
    // BB tests
    { score: 4, type: 'BB', expected: RISK_BAND_COLORS.LOW },
    { score: 5, type: 'BB', expected: RISK_BAND_COLORS.LOW },
    { score: 5.1, type: 'BB', expected: RISK_BAND_COLORS.MEDIUM },
    { score: 10, type: 'BB', expected: RISK_BAND_COLORS.MEDIUM },
    { score: 11, type: 'BB', expected: RISK_BAND_COLORS.HIGH },
    { score: 20, type: 'BB', expected: RISK_BAND_COLORS.HIGH },
    { score: 21, type: 'BB', expected: RISK_BAND_COLORS.EXTREME },

    // VB tests
    { score: 9, type: 'VB', expected: RISK_BAND_COLORS.LOW },
    { score: 10, type: 'VB', expected: RISK_BAND_COLORS.LOW },
    { score: 10.1, type: 'VB', expected: RISK_BAND_COLORS.MEDIUM },
    { score: 25, type: 'VB', expected: RISK_BAND_COLORS.MEDIUM },
    { score: 26, type: 'VB', expected: RISK_BAND_COLORS.HIGH },
    { score: 60, type: 'VB', expected: RISK_BAND_COLORS.HIGH },
    { score: 61, type: 'VB', expected: RISK_BAND_COLORS.EXTREME },
];

let passed = 0;
let failed = 0;

console.log("Running threshold verification...");

testCases.forEach((test, index) => {
    const result = getBandColor(test.score, test.type);
    if (result === test.expected) {
        passed++;
    } else {
        failed++;
        console.error(`Test ${index + 1} failed: Type ${test.type}, Score ${test.score}. Expected ${test.expected}, got ${result}`);
    }
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);

if (failed > 0) process.exit(1);
