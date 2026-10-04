import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export function getHomeDir(): string {
  return os.homedir();
}

export function getAppDir(): string {
  const appDir = path.join(os.homedir(), '.gitremind');
  if (!fs.existsSync(appDir)) {
    fs.mkdirSync(appDir, { recursive: true });
  }
  return appDir;
}

export function getConfigPath(): string {
  return path.join(getAppDir(), 'config.json');
}

export function getPidPath(): string {
  return path.join(getAppDir(), 'gitremind.pid');
}

export function getLogPath(): string {
  return path.join(getAppDir(), 'gitremind.log');
}

export function normalizeRepoPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return path.normalize(resolved);
}
