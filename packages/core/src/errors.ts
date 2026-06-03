export function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export function isPermissionError(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EACCES';
}
