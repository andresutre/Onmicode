/**
 * Quote an absolute executable path for the shell an agent runs in, and only
 * when needed. A leading slash means a POSIX shell — where a backslash escapes
 * rather than separates, and so is never safe bare.
 */
export function shellPath(path: string): string {
  if (path.startsWith("/"))
    return /^[A-Za-z0-9._/:-]+$/.test(path)
      ? path
      : `'${path.replace(/'/g, `'\''`)}'`;
  return /[\s"]/.test(path) ? `"${path.replace(/"/g, "")}"` : path;
}
