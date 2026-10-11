/// <reference lib="webworker" />
import JSZip from 'jszip';
import { parseSources, type SourceFile } from './takeout';

export type WorkerIn = { files: { file: File; path: string }[]; intradayOffsetHours: number };
export type WorkerOut =
  | { type: 'progress'; done: number; total: number; label: string }
  | { type: 'done'; dataset: unknown; report: unknown }
  | { type: 'error'; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  try {
    const sources: SourceFile[] = [];
    for (const { file, path } of ev.data.files) {
      if (/\.zip$/i.test(file.name)) {
        post({ type: 'progress', done: 0, total: 1, label: `Opening ${file.name}…` });
        const zip = await JSZip.loadAsync(file);
        zip.forEach((p, entry) => {
          if (entry.dir) return;
          sources.push({ path: p, size: 0, text: () => entry.async('string') });
        });
      } else {
        sources.push({ path, size: file.size, text: () => file.text() });
      }
    }
    const { dataset, report } = await parseSources(sources, { intradayOffsetHours: ev.data.intradayOffsetHours }, (done, total, label) => {
      if (done % 10 === 0 || done === total) post({ type: 'progress', done, total, label });
    });
    post({ type: 'done', dataset, report });
  } catch (e) {
    post({ type: 'error', message: (e as Error).message });
  }
};
