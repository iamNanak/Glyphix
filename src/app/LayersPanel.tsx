import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Image, Lock, Square, Trash2, Type, Unlock } from 'lucide-react';
import { useEditor } from './store';
import { IconButton } from './ui';

const icons = { background: Square, image: Image, text: Type } as const;

export function LayersPanel() {
  const layers = useEditor((s) => s.doc.comp.layers);
  const selectedId = useEditor((s) => s.selectedId);
  const s = useEditor.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const selected = layers.find((l) => l.id === selectedId);
  const selIndex = selected ? layers.indexOf(selected) : -1;

  return (
    <aside className="flex min-h-0 flex-col border-r border-line bg-panel" aria-label="Layers">
      <h2 className="px-4 pt-4 pb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Layers</h2>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2" role="listbox" aria-label="Layer list">
        {layers
          .map((layer, index) => ({ layer, index }))
          .reverse()
          .map(({ layer, index }) => {
            const Icon = icons[layer.type];
            const isSel = layer.id === selectedId;
            const fixed = layer.type === 'background';
            return (
              <li
                key={layer.id}
                role="option"
                aria-selected={isSel}
                draggable={!fixed && renaming !== layer.id}
                onDragStart={(e) => {
                  setDragId(layer.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  // List is shown top-first, so the upper half means "above" = higher index.
                  setDropIndex(e.clientY < r.top + r.height / 2 ? index + 1 : index);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dropIndex !== null) {
                    const from = layers.findIndex((l) => l.id === dragId);
                    s.moveLayerTo(dragId, dropIndex > from ? dropIndex - 1 : dropIndex);
                  }
                  setDragId(null);
                  setDropIndex(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDropIndex(null);
                }}
                className={`relative ${dragId === layer.id ? 'opacity-40' : ''}`}
              >
                {dragId && dropIndex === index + 1 && <DropLine top />}
                {dragId && dropIndex === index && <DropLine />}
                <div className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 ${isSel ? 'bg-accent/20 text-white' : 'text-zinc-300 hover:bg-white/5'}`}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => s.select(layer.id)}
                    onDoubleClick={() => !fixed && setRenaming(layer.id)}
                  >
                    <Icon size={14} className="shrink-0 text-muted" />
                    {renaming === layer.id ? (
                      <input
                        autoFocus
                        defaultValue={layer.name}
                        aria-label="Layer name"
                        className="w-full rounded bg-panel-2 px-1 text-sm ring-1 ring-accent outline-none"
                        onBlur={(e) => {
                          s.renameLayer(layer.id, e.target.value);
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                      />
                    ) : (
                      <span className={`truncate ${layer.visible ? '' : 'opacity-40'}`}>{layer.name}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                    className={`rounded p-1 text-muted hover:text-white ${layer.locked ? 'opacity-100' : 'opacity-0 group-hover:opacity-70 focus-visible:opacity-100'}`}
                    onClick={() => s.toggleLayer(layer.id, 'locked')}
                  >
                    {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                  <button
                    type="button"
                    aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                    className="rounded p-1 text-muted opacity-60 hover:text-white group-hover:opacity-100"
                    onClick={() => s.toggleLayer(layer.id, 'visible')}
                  >
                    {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
              </li>
            );
          })}
      </ul>
      <div className="flex items-center justify-between border-t border-line px-2 py-1.5">
        <IconButton label="Bring forward (Ctrl+])" disabled={!selected || selected.type === 'background' || selIndex >= layers.length - 1} onClick={() => selected && s.moveLayer(selected.id, 1)}>
          <ArrowUp size={14} />
        </IconButton>
        <IconButton label="Send backward (Ctrl+[)" disabled={!selected || selected.type === 'background' || selIndex <= 1} onClick={() => selected && s.moveLayer(selected.id, -1)}>
          <ArrowDown size={14} />
        </IconButton>
        <IconButton label="Duplicate (Ctrl+D)" disabled={!selected || selected.type === 'background'} onClick={() => selected && s.duplicateLayer(selected.id)}>
          <Copy size={14} />
        </IconButton>
        <IconButton label="Delete (Del)" disabled={!selected || selected.type === 'background' || selected.locked} onClick={() => selected && s.removeLayer(selected.id)}>
          <Trash2 size={14} />
        </IconButton>
      </div>
    </aside>
  );
}

function DropLine({ top }: { top?: boolean }) {
  return <div className={`pointer-events-none absolute right-1 left-1 h-0.5 rounded bg-accent ${top ? '-top-px' : '-bottom-px'}`} />;
}
