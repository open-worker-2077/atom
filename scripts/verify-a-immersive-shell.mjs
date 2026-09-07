import { chromium } from '@playwright/test';

const endpoint = process.argv[2] || 'http://127.0.0.1:4784';
const commandArguments = process.argv.slice(3);
const pageDownArgument = commandArguments.find((argument) => argument.startsWith('--page-down='));
const pageDownSteps = Math.max(0, Number.parseInt(pageDownArgument?.split('=')[1] || '0', 10) || 0);
const labels = commandArguments.filter((argument) => !argument.startsWith('--page-down='));
if (!labels.length) labels.push('atom.json');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 2514, height: 1316 } });
await page.route('**/*', (route) => (
  ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()
));

try {
  await page.goto(endpoint, { waitUntil: 'domcontentloaded' });
  for (const label of labels) {
    await page.waitForFunction((expectedLabel) => (
      window.spatialLab?.state().interactionTargets.some((candidate) => candidate.label === expectedLabel)
    ), label, { timeout: 30_000 });
    const target = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
      .find((candidate) => candidate.label === label);
    if (!target) throw new Error(`A target not found: ${label}`);
    await page.mouse.move(target.clientX, target.clientY);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(440);
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(1_500);
  }

  const drilldown = [];
  for (let step = 0; step <= pageDownSteps; step += 1) {
    drilldown.push(await page.evaluate((currentStep) => {
      const state = window.spatialLab.state();
      const shell = state.clusterRegions.find(({ path }) => path === state.path) || null;
      return { step: currentStep, path: state.path, clusterPaths: state.clusterPaths, shell };
    }, step));
    if (step === pageDownSteps) break;
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(1_000);
  }

  const result = await page.evaluate(() => {
    const state = window.spatialLab.state();
    const shell = state.clusterRegions.find(({ path }) => path === state.path) || null;
    return {
      path: state.path,
      viewMode: state.viewMode,
      clusterFieldOpen: state.clusterFieldOpen,
      shell,
      labels: state.visibleNodeDescriptors.map(({ label: nodeLabel }) => nodeLabel),
      targets: state.clusterTargets.filter(({ path }) => path === state.path),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      camera: state.camera,
      settings: window.spatialLab.presentationSettings().settings
    };
  });
  result.drilldown = drilldown;
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
