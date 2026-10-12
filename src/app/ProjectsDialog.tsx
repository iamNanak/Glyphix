import { useEffect, useRef, useState } from 'react';
import { FilePlus2, FolderOpen, Save, Trash2 } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/wensity/dialog';
import { listProjects, type ProjectSummary } from '@/persistence/projects';
import { newProject, openProject, openProjectFile, removeProject, saveProjectFile } from '@/persistence/actions';
import { PROJECT_EXTENSION } from '@/persistence/projectFile';
import { useEditor } from './store';
import { Button, IconButton } from './ui';

/** Hidden file input shared by the dialog and the Ctrl+O shortcut. */
export function useOpenFilePicker(onError: (msg: string | null) => void) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_EXTENSION},application/zip`;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        await openProjectFile(file);
        onError(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    });
    document.body.appendChild(input);
    inputRef.current = input;
    return () => input.remove();
  }, [onError]);
  return () => inputRef.current?.click();
}

export function ProjectsDialog({ open, onOpenChange, onError, pickFile }: { open: boolean; onOpenChange: (o: boolean) => void; onError: (msg: string | null) => void; pickFile: () => void }) {
  const currentId = useEditor((s) => s.doc.id);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // Thumbnail object URLs live until they're replaced or the dialog unmounts. Revoking them on
  // close would break the images while the closing animation is still showing them.
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  useEffect(() => {
    if (!open) return;
    void listProjects().then((list) => {
      const t: Record<string, string> = {};
      list.forEach((p) => p.thumbnail && (t[p.id] = URL.createObjectURL(p.thumbnail)));
      const stale = urls.current;
      urls.current = Object.values(t);
      setProjects(list);
      setThumbs(t);
      requestAnimationFrame(() => stale.forEach((u) => URL.revokeObjectURL(u)));
    });
  }, [open]);

  const run = (fn: () => Promise<unknown>) => async () => {
    try {
      const warning = await fn();
      onError(typeof warning === 'string' ? warning : null);
      onOpenChange(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="scrollable" className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Projects</DialogTitle>
          <DialogDescription>Everything is saved in this browser automatically. Save a file to back up or share a project.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {projects === null ? (
            <p className="py-6 text-center text-sm text-dim">Loading…</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3" aria-label="Recent projects">
              {projects.map((p) => (
                <li key={p.id} className={`group relative overflow-hidden rounded-lg ring-1 ${p.id === currentId ? 'ring-accent' : 'ring-line'}`}>
                  <button type="button" className="block w-full text-left" onClick={run(() => openProject(p.id))} aria-label={`Open ${p.name}`}>
                    <div className="aspect-video bg-panel-2">{thumbs[p.id] && <img src={thumbs[p.id]} alt="" className="h-full w-full object-cover" />}</div>
                    <div className="px-3 py-2">
                      <div className="truncate text-sm text-zinc-100">{p.name}</div>
                      <div className="text-xs text-dim">
                        {p.id === currentId ? 'Open now · ' : ''}
                        {new Date(p.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  </button>
                  <IconButton
                    label={`Delete ${p.name}`}
                    className="absolute top-2 right-2 bg-black/50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={run(async () => {
                      if (window.confirm(`Delete “${p.name}”? This can't be undone.`)) await removeProject(p.id);
                    })}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter className="justify-between">
          <div className="flex gap-2">
            <Button onClick={run(newProject)}>
              <FilePlus2 size={14} /> New project
            </Button>
            <Button
              onClick={() => {
                onOpenChange(false);
                pickFile();
              }}
            >
              <FolderOpen size={14} /> Open file…
            </Button>
          </div>
          <Button variant="primary" onClick={run(saveProjectFile)}>
            <Save size={14} /> Save {PROJECT_EXTENSION} file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
