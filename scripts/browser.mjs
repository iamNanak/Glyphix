// Shared Chrome launcher for the test scripts.
// Headless by default; HEADED=1 opens a visible window. The Vulkan flags matter: with Chrome's
// default headless GPU path, WebGPU canvases read back as transparent (blank screenshots, empty
// PNG exports) and the device is occasionally lost. With Vulkan, headless WebGPU behaves like headed.
import { chromium } from 'playwright-core';

export const CHROME_ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--use-angle=vulkan'];

export function launch() {
  return chromium.launch({
    headless: !process.env.HEADED,
    executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
    args: CHROME_ARGS,
  });
}
