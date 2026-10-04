import fs from 'node:fs';
import path from 'node:path';
import { getConfigPath, normalizeRepoPath } from '../utils/paths.js';
import { GitRemindConfig, WatchedRepoConfig } from './types.js';
import { getRepoRoot } from './git.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CONFIG: GitRemindConfig = {
  version: 1,
  intervalMinutes: 20,
  notifyOnClose: true,
  sound: true,
  language: 'en',
  watchedRepos: [],
  ignorePatterns: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/.cache/**',
    '**/target/**',
  ],
  ideProcesses: [
    'code.exe',
    'code',
    'cursor.exe',
    'cursor',
    'idea64.exe',
    'webstorm64.exe',
    'pycharm64.exe',
    'rider64.exe',
  ],
  quietHours: {
    enabled: false,
    start: '23:00',
    end: '08:00',
  },
};

export class ConfigManager {
  private configCache: GitRemindConfig | null = null;

  /**
   * Loads config from disk or returns default configuration
   */
  load(): GitRemindConfig {
    if (this.configCache) {
      return this.configCache;
    }

    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
      this.configCache = { ...DEFAULT_CONFIG, watchedRepos: [] };
      this.save(this.configCache);
      return this.configCache;
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      // Merge with defaults to guarantee all keys exist
      const loaded: GitRemindConfig = {
        ...DEFAULT_CONFIG,
        ...parsed,
        quietHours: {
          ...DEFAULT_CONFIG.quietHours,
          ...(parsed.quietHours || {}),
        },
      };
      this.configCache = loaded;
      return loaded;
    } catch (err) {
      logger.error('Failed to parse config file, recreating defaults', err);
      const fallback: GitRemindConfig = { ...DEFAULT_CONFIG, watchedRepos: [] };
      this.save(fallback);
      return fallback;
    }
  }

  /**
   * Saves config atomically to disk
   */
  save(config: GitRemindConfig): void {
    const configPath = getConfigPath();
    this.configCache = config;
    const tempPath = `${configPath}.${Date.now()}.tmp`;

    try {
      fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');
      fs.renameSync(tempPath, configPath);
    } catch (err) {
      logger.error('Failed to save config', err);
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }

  /**
   * Adds a git repository to watched list
   */
  async addRepo(targetPath: string): Promise<{ success: boolean; repo?: WatchedRepoConfig; message: string }> {
    const root = await getRepoRoot(targetPath);
    if (!root) {
      return { success: false, message: `"${targetPath}" is not a valid Git repository.` };
    }

    const normalized = normalizeRepoPath(root);
    const config = this.load();

    const existing = config.watchedRepos.find((r) => normalizeRepoPath(r.path) === normalized);
    if (existing) {
      return { success: false, repo: existing, message: `"${existing.name}" is already in the watch list.` };
    }

    const repoName = path.basename(normalized);
    const newRepo: WatchedRepoConfig = {
      path: normalized,
      name: repoName,
      addedAt: new Date().toISOString(),
    };

    config.watchedRepos.push(newRepo);
    this.save(config);
    return { success: true, repo: newRepo, message: `"${repoName}" (${normalized}) added to watch list.` };
  }

  /**
   * Removes a repository from watched list
   */
  removeRepo(targetPath: string): { success: boolean; message: string } {
    const normalized = normalizeRepoPath(targetPath);
    const config = this.load();

    const initialCount = config.watchedRepos.length;
    config.watchedRepos = config.watchedRepos.filter(
      (r) => normalizeRepoPath(r.path) !== normalized && r.name.toLowerCase() !== targetPath.toLowerCase()
    );

    if (config.watchedRepos.length === initialCount) {
      return { success: false, message: `"${targetPath}" not found in watch list.` };
    }

    this.save(config);
    return { success: true, message: `"${targetPath}" removed from watch list.` };
  }

  /**
   * Updates state metadata for a watched repository
   */
  updateRepoState(repoPath: string, updates: Partial<WatchedRepoConfig>): void {
    const normalized = normalizeRepoPath(repoPath);
    const config = this.load();
    const repo = config.watchedRepos.find((r) => normalizeRepoPath(r.path) === normalized);
    if (repo) {
      Object.assign(repo, updates);
      this.save(config);
    }
  }

  /**
   * Partially updates configuration properties
   */
  updateSettings(updates: Partial<GitRemindConfig>): GitRemindConfig {
    const config = this.load();
    const updated = {
      ...config,
      ...updates,
      quietHours: {
        ...config.quietHours,
        ...(updates.quietHours || {}),
      },
    };
    this.save(updated);
    return updated;
  }
}

export const configManager = new ConfigManager();
