import { lazy, Suspense, useEffect, useState } from 'react';
import { Editor } from './Editor';
import { TooltipProvider } from '@/components/wensity/tooltip';
import { assetStore } from '@/assets/assetStore';
import { createDemoScreenshot } from '@/assets/demoScreenshot';
import { DEMO_SCREENSHOT_ASSET } from '@/doc';

const Bench = lazy(() => import('@/bench/Bench'));

function useHashRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

if (!assetStore.get(DEMO_SCREENSHOT_ASSET)) assetStore.put(DEMO_SCREENSHOT_ASSET, createDemoScreenshot());

export function App() {
  const route = useHashRoute();
  if (route === '#/bench') {
    return (
      <Suspense fallback={<div className="p-6 text-dim">Loading bench…</div>}>
        <Bench />
      </Suspense>
    );
  }
  return (
    <TooltipProvider delay={500}>
      <Editor />
    </TooltipProvider>
  );
}
