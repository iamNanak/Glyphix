// Shared browser launcher for the test scripts.
// Headless by default; HEADED=1 opens a visible window. BROWSER=firefox uses Playwright's Firefox
// (install once: npx playwright-core install firefox).
// Chrome's Vulkan flags matter: with Chrome's default headless GPU path, WebGPU canvases read back
// as transparent (blank screenshots, empty PNG exports) and the device is occasionally lost.
import { chromium, firefox } from 'playwright-core';

export const CHROME_ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--use-angle=vulkan'];
export const browserName = process.env.BROWSER === 'firefox' ? 'firefox' : 'chrome';

export function launch() {
  const headless = !process.env.HEADED;
  if (browserName === 'firefox') {
    return firefox.launch({ headless, firefoxUserPrefs: { 'dom.webgpu.enabled': true, 'gfx.webgpu.ignore-blocklist': true } });
  }
  return chromium.launch({ headless, executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: CHROME_ARGS });
}
