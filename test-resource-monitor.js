// Quick test script for resource monitoring
const { ResourceMonitor } = require('./src/resourceMonitor');

const monitor = new ResourceMonitor();

// Simulate some LLM calls for a project
const projectId = 'test-project-123';

// Simulate planner call
monitor.recordProjectPrompt(
  projectId,
  'gpt-4o',
  'Plan the following feature: Hero Section with...' + ' word '.repeat(1000),
  'Here is the plan...' + ' word '.repeat(2000)
);

// Simulate executor calls
for (let i = 0; i < 5; i++) {
  monitor.recordProjectPrompt(
    projectId,
    'gpt-4o-mini',
    'Generate code for...' + ' word '.repeat(500),
    'Here is the code...' + ' word '.repeat(1500)
  );
}

// Get and display metrics
const metrics = monitor.getProjectMetrics(projectId);
console.log('\n📊 Resource Monitor Test\n');
console.log('Project ID:', metrics.projectId);
console.log('\nPer-Model Breakdown:');
metrics.models.forEach(m => {
  console.log(`  ${m.name}:`);
  console.log(`    Tokens: ${m.tokensFormatted} (${m.inputTokens} in / ${m.outputTokens} out)`);
  console.log(`    Cost: ${m.costFormatted}`);
  console.log(`    Calls: ${m.calls}`);
});
console.log('\nTotals:');
console.log(`  Total Tokens: ${metrics.totalTokensFormatted}`);
console.log(`  Total Cost: ${metrics.totalCostFormatted}`);
console.log('\n✅ Test complete!\n');
