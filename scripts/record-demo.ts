import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:5173';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(baseUrl)) throw new Error('The demo recorder only runs against a local preview URL.');
if (process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_ANON_KEY || ['.env', '.env.local', '.env.development', '.env.production'].some((name) => existsSync(path.resolve(name)))) {
  throw new Error('The demo recorder refuses to write example walkthrough data when shared database configuration is present.');
}
const outDir = path.resolve('recordings');
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, slowMo: 700 });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const video = page.video();
const pageErrors: string[] = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const pause = (ms = 1800) => page.waitForTimeout(ms);

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await pause(2200);
  await page.getByLabel('Username').fill('dheeraj');
  await pause(1200);
  await page.getByLabel('Password').fill('1234');
  await pause(1200);
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await page.getByRole('heading', { name: 'Benchmarking suite' }).waitFor();
  await page.getByText('example-insurer', { exact: true }).first().waitFor();
  await pause(2400);
  await page.screenshot({ path: path.join(outDir, '01-benchmarking-suite.png'), fullPage: true });

  const firstRow = page.locator('.subprocess-row').first();
  await firstRow.locator('select').nth(0).selectOption('Partially Exists');
  await pause();
  await firstRow.locator('select').nth(1).selectOption('Partially Automated');
  await pause();
  await firstRow.locator('.sub-name-button').click();
  await page.getByRole('dialog', { name: /benchmark details/ }).waitFor();
  await page.getByLabel('Benchmark notes').fill('Example only: show how a hand-entered benchmark note appears for one process step.');
  await page.getByRole('tab', { name: 'Pain notes' }).click();
  await pause();
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.getByRole('textbox', { name: 'Pain point note' }).fill('Example only: teams may re-enter employee details when onboarding data arrives in different formats.');
  await pause(1000);
  await page.getByRole('button', { name: 'Add note', exact: true }).last().click();
  await page.getByText('teams may re-enter employee details', { exact: false }).waitFor();
  await pause();
  await page.screenshot({ path: path.join(outDir, '02-assessment-and-pain-notes.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close detail drawer' }).click();
  await pause();

  await page.locator('.process-card').first().locator('.process-more').click();
  await page.getByLabel('Process name').fill('Employer Discovery & Quotation');
  await page.getByLabel('Description').fill('Example edit: collect employer requirements through quotation approval.');
  await pause();
  await page.getByRole('button', { name: 'Save process' }).click();
  await pause();
  await page.screenshot({ path: path.join(outDir, '03-editable-processes.png'), fullPage: true });

  await page.locator('.page-heading .button-primary').click();
  await page.getByLabel('Process name').fill('Demo sandbox');
  await page.getByLabel('Description').fill('Temporary process used only in this isolated walkthrough.');
  await page.getByRole('button', { name: 'Add process', exact: true }).last().click();
  const sandbox = page.locator('.process-card').filter({ hasText: 'Demo sandbox' });
  await sandbox.waitFor();
  await pause();
  await sandbox.locator('.process-heading').click();
  await sandbox.locator('.add-subprocess').click();
  await page.getByLabel('Subprocess name').fill('Illustrative review step');
  await page.getByLabel('Description').fill('Temporary example step to demonstrate editing and removal.');
  await page.getByRole('button', { name: 'Add subprocess', exact: true }).click();
  await sandbox.getByText('Illustrative review step', { exact: true }).waitFor();
  await pause();
  await page.screenshot({ path: path.join(outDir, '04-added-process-and-subprocess.png'), fullPage: true });
  await sandbox.locator('.archive-process').click();
  await pause();
  await page.screenshot({ path: path.join(outDir, '05-process-removed.png'), fullPage: true });

  await page.getByRole('button', { name: 'Workflow graph' }).click();
  await page.locator('.graph-canvas').waitFor();
  await pause(2400);
  await page.screenshot({ path: path.join(outDir, '06-workflow-graph-all.png'), fullPage: true });
  await page.locator('.page-heading .button-primary').click();
  await page.getByLabel('From step').selectOption({ index: 0 });
  await page.getByLabel('To step').selectOption({ index: 1 });
  await page.getByLabel('Link note').fill('Example link for the walkthrough; edit or remove it from the graph.');
  await pause(1200);
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await page.locator('.graph-canvas').waitFor();
  await page.locator('.graph-toolbar select').selectOption({ label: 'Employer Discovery & Quotation' });
  await pause(2600);
  await page.screenshot({ path: path.join(outDir, '07-workflow-graph-with-link.png'), fullPage: true });
  await page.getByRole('button', { name: 'Benchmarking suite' }).click();
  await pause(2200);
  await page.screenshot({ path: path.join(outDir, '08-benchmarking-suite-final.png'), fullPage: true });

  assert.equal(pageErrors.length, 0, `Browser errors: ${pageErrors.join('; ')}`);
} finally {
  await context.close();
  if (video) await video.saveAs(path.join(outDir, 'bench-suite-demo.webm'));
  await browser.close();
}

console.log(`Recorded ${path.join(outDir, 'bench-suite-demo.webm')}`);
console.log('The walkthrough uses a half-speed action cadence and isolated, clearly labelled example-insurer edits.');
