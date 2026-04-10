import { join } from 'node:path';
import { access, constants } from 'node:fs/promises';
import { listSources } from './sources.js';
import { ingestSource, type IngestResult } from './ingest.js';
import { slugify } from './utils.js';
import { directoryExists } from './wiki.js';

export interface BulkIngestOptions {
  dryRun?: boolean;
  force?: boolean;
  onProgress?: (current: number, total: number, file: string) => void;
}

export interface BulkIngestFileResult {
  file: string;
  status: 'ingested' | 'skipped' | 'failed';
  error?: string;
}

export interface BulkIngestResult {
  command: string;
  total: number;
  ingested: number;
  skipped: number;
  failed: number;
  dry_run: boolean;
  files: BulkIngestFileResult[];
}

export async function bulkIngest(
  rawDir: string,
  wikiDir: string,
  options: BulkIngestOptions = {},
): Promise<BulkIngestResult> {
  const { dryRun = false, force = false, onProgress } = options;

  const wikiPath = join(wikiDir, 'wiki');
  if (!(await directoryExists(wikiPath))) {
    return {
      command: 'bulk-ingest',
      total: 0,
      ingested: 0,
      skipped: 0,
      failed: 0,
      dry_run: dryRun,
      files: [],
    };
  }

  const sources = await listSources(rawDir);
  const result: BulkIngestResult = {
    command: 'bulk-ingest',
    total: sources.length,
    ingested: 0,
    skipped: 0,
    failed: 0,
    dry_run: dryRun,
    files: [],
  };

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const sourcePath = join(rawDir, source.path);

    onProgress?.(i + 1, sources.length, source.name);

    // Check if already ingested (slug-summary.md exists) unless force
    if (!force) {
      const slug = slugify(source.name);
      const summaryPath = join(wikiPath, 'sources', `${slug}-summary.md`);
      let exists = false;
      try {
        await access(summaryPath, constants.F_OK);
        exists = true;
      } catch {
        // Does not exist — will ingest
      }
      if (exists) {
        result.skipped++;
        result.files.push({ file: source.path, status: 'skipped' });
        continue;
      }
    }

    // Ingest the source
    const ingestResult: IngestResult = await ingestSource(sourcePath, wikiDir, dryRun, force);

    if (ingestResult.status === 'success') {
      result.ingested++;
      result.files.push({ file: source.path, status: 'ingested' });
    } else if (ingestResult.status === 'skipped') {
      result.skipped++;
      result.files.push({ file: source.path, status: 'skipped' });
    } else {
      result.failed++;
      result.files.push({ file: source.path, status: 'failed', error: ingestResult.error });
    }
  }

  return result;
}
