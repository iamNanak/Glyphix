import { lazy, Suspense, useEffect, useState } from 'react';
import { Editor } from './Editor';
import { useEditor } from './store';
import { bootProject, flushSave, startAutosave } from '@/persistence/autosave';
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
      <EditorBoot />
    </TooltipProvider>
  );
}

/** Restore the last project (or start a new one) before showing the editor, then autosave. */
function EditorBoot() {
  const [boot, setBoot] = useState<{ ready: boolean; warning: string | null }>({ ready: false, warning: null });
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    void bootProject().then(({ doc, warning }) => {
      if (cancelled) return;
      useEditor.getState().loadDoc(doc);
      stop = startAutosave();
      void flushSave(); // first save of a brand-new project; no-op for a restored one
      setBoot({ ready: true, warning });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  if (!boot.ready) {
    return (
      <div className="grid h-full place-items-center bg-app text-sm text-dim" role="status">
        Opening your project…
      </div>
    );
  }
  return <Editor initialWarning={boot.warning} />;
}
