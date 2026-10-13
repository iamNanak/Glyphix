// Font picker: searchable list of bundled + uploaded fonts, each shown in its own face, plus upload.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Upload } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/wensity/popover';
import { BUNDLED_FONTS, CATEGORY_LABELS, type FontCategory, type FontInfo } from '@/text/fonts';
import { fontLibrary } from '@/text/fontLibrary';
import { cssFamily, FONT_ACCEPT, importFont } from '@/assets/fontAssets';
import { inputClass } from './ui';

const cssLoaded = new Set<string>();

/** Make a bundled font available to CSS (for previews) the first time it is shown. */
function useCssFont(info: FontInfo | undefined) {
  useEffect(() => {
    if (!info?.url || cssLoaded.has(info.id) || typeof FontFace === 'undefined') return;
    cssLoaded.add(info.id);
    const w = info.weights;
    const face = new FontFace(cssFamily(info.id), `url(${info.url})`, w ? { weight: `${w.min} ${w.max}` } : {});
    document.fonts.add(face);
    face.load().catch(() => cssLoaded.delete(info.id));
  }, [info]);
}

export const fontCss = (id: string) => `"${cssFamily(id)}", system-ui, sans-serif`;

function useUserFonts() {
  const [list, setList] = useState(() => fontLibrary.userFontList());
  useEffect(() => fontLibrary.onChange(() => setList(fontLibrary.userFontList())), []);
  return list;
}

function FontRow({ info, selected, onPick }: { info: FontInfo; selected: boolean; onPick: () => void }) {
  useCssFont(info);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left outline-none hover:bg-white/6 focus-visible:ring-2 focus-visible:ring-accent ${selected ? 'bg-accent/20 text-white' : 'text-zinc-200'}`}
    >
      <span className="truncate text-[17px] leading-tight" style={{ fontFamily: fontCss(info.id), fontWeight: info.weights?.default ?? 400 }}>
        {info.family}
      </span>
      <span className={`shrink-0 text-[10px] uppercase ${selected ? 'text-violet-100' : 'text-zinc-400'}`}>{info.user ? 'yours' : info.weights ? 'variable' : ''}</span>
    </button>
  );
}

export function FontPicker({ value, onChange, onError }: { value: string; onChange: (fontId: string, family: string) => void; onError: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FontCategory | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const userFonts = useUserFonts();
  const current = fontLibrary.info(value);
  useCssFont(current);

  const fonts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...userFonts, ...BUNDLED_FONTS].filter((f) => (category === 'all' || (!f.user && f.category === category)) && f.family.toLowerCase().includes(q));
  }, [query, category, userFonts]);

  const pick = (f: FontInfo) => {
    onChange(f.id, f.family);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Font: ${current?.family ?? 'missing font'}`}
          className={`${inputClass} flex items-center justify-between gap-2 text-left`}
        >
          <span className="truncate text-[15px]" style={{ fontFamily: fontCss(value) }}>
            {current?.family ?? 'Missing font (shown in Inter)'}
          </span>
          <ChevronDown size={14} className="shrink-0 text-dim" />
        </button>
      </PopoverTrigger>
      <PopoverContent width="md" side="left" align="start" className="p-0">
        <div className="space-y-2 border-b border-line p-2.5">
          <input
            autoFocus
            aria-label="Search fonts"
            placeholder="Search fonts"
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div role="group" aria-label="Font category" className="flex flex-wrap gap-1">
            {(['all', ...Object.keys(CATEGORY_LABELS)] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(c as FontCategory | 'all')}
                className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-line outline-none focus-visible:ring-accent ${category === c ? 'bg-accent/25 text-white ring-accent/60' : 'text-zinc-300 hover:bg-white/6'}`}
              >
                {c === 'all' ? 'All' : CATEGORY_LABELS[c as FontCategory]}
              </button>
            ))}
          </div>
        </div>
        <div role="group" aria-label="Fonts" className="max-h-80 space-y-0.5 overflow-y-auto p-1.5">
          {fonts.map((f) => (
            <FontRow key={f.id} info={f} selected={f.id === value} onPick={() => pick(f)} />
          ))}
          {fonts.length === 0 && <p className="px-2.5 py-3 text-xs text-dim">No fonts match “{query}”.</p>}
        </div>
        <div className="border-t border-line p-2">
          <input
            ref={fileRef}
            type="file"
            accept={FONT_ACCEPT}
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setBusy(true);
              try {
                const f = await importFont(file);
                onChange(f.id, f.family);
                setOpen(false);
              } catch (err) {
                onError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-zinc-200 ring-1 ring-line outline-none hover:bg-white/6 focus-visible:ring-accent disabled:opacity-50"
          >
            <Upload size={13} /> {busy ? 'Reading font…' : 'Upload font (TTF, OTF, WOFF)'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
