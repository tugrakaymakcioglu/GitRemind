import fs from 'node:fs';
import { getLogPath } from './paths.js';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

class Logger {
  private silentConsole: boolean = false;
  private maxLogSizeBytes = 5 * 1024 * 1024; // 5 MB

  setSilentConsole(silent: boolean) {
    this.silentConsole = silent;
  }

  private write(level: LogLevel, message: string, meta?: unknown) {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${typeof meta === 'object' ? JSON.stringify(meta) : String(meta)}` : '';
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;

    if (!this.silentConsole) {
      if (level === 'error') {
        console.error(line.trimEnd());
      } else if (level === 'warn') {
        console.warn(line.trimEnd());
      } else {
        console.log(line.trimEnd());
      }
    }

    try {
      const logFile = getLogPath();
      // Check file size and rotate if needed
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size > this.maxLogSizeBytes) {
          const oldLog = logFile + '.old';
          if (fs.existsSync(oldLog)) {
            fs.unlinkSync(oldLog);
          }
          fs.renameSync(logFile, oldLog);
        }
      }
      fs.appendFileSync(logFile, line, 'utf8');
    } catch {
      // Avoid crashing daemon due to logging failures
    }
  }

  info(message: string, meta?: unknown) {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: unknown) {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: unknown) {
    this.write('error', message, meta);
  }

  debug(message: string, meta?: unknown) {
    this.write('debug', message, meta);
  }
}

export const logger = new Logger();
