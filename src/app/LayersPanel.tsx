import { Eye, EyeOff, Image, Square, Type } from 'lucide-react';
import { useEditor } from './store';

const icons = { background: Square, image: Image, text: Type } as const;

export function LayersPanel() {
  const layers = useEditor((s) => s.doc.comp.layers);
  const selectedId = useEditor((s) => s.selectedId);
  const { select, set } = useEditor.getState();

  return (
    <aside className="min-h-0 overflow-y-auto border-r border-line bg-panel" aria-label="Layers">
      <h2 className="px-4 pt-4 pb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Layers</h2>
      <ul className="space-y-0.5 px-2" role="listbox" aria-label="Layer list">
        {layers
          .map((layer, index) => ({ layer, index }))
          .reverse()
          .map(({ layer, index }) => {
            const Icon = icons[layer.type];
            const selected = layer.id === selectedId;
            return (
              <li key={layer.id} role="option" aria-selected={selected}>
                <div className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${selected ? 'bg-accent/20 text-white' : 'text-zinc-300 hover:bg-white/5'}`}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => select(layer.id)}>
                    <Icon size={14} className="shrink-0 text-muted" />
                    <span className={`truncate ${layer.visible ? '' : 'opacity-40'}`}>{layer.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                    className="rounded p-1 text-muted opacity-60 hover:text-white group-hover:opacity-100"
                    onClick={() => set(layer.visible ? 'Hide layer' : 'Show layer', [{ path: ['comp', 'layers', index, 'visible'], value: !layer.visible }])}
                  >
                    {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
              </li>
            );
          })}
      </ul>
    </aside>
  );
}
