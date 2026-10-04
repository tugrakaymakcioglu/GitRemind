import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { NotificationPayload, GitRemindConfig } from './types.js';
import { configManager } from './config.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Notifier {
  /**
   * Resolves the win-toast.ps1 script path accurately
   */
  private getToastScriptPath(): string {
    // Check multiple candidate locations (source vs build distribution)
    const candidates = [
      path.resolve(__dirname, '../../scripts/win-toast.ps1'),
      path.resolve(__dirname, '../scripts/win-toast.ps1'),
      path.resolve(process.cwd(), 'scripts/win-toast.ps1'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    return candidates[0];
  }

  /**
   * Determines if current time falls within configured quiet hours
   */
  isQuietHour(config: GitRemindConfig): boolean {
    if (!config.quietHours.enabled) return false;

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = config.quietHours.start.split(':').map((s) => parseInt(s, 10));
    const [endH, endM] = config.quietHours.end.split(':').map((s) => parseInt(s, 10));

    const startMins = startH * 60 + (startM || 0);
    const endMins = endH * 60 + (endM || 0);

    if (startMins <= endMins) {
      return currentMins >= startMins && currentMins < endMins;
    } else {
      // Over midnight (e.g. 23:00 to 08:00)
      return currentMins >= startMins || currentMins < endMins;
    }
  }

  /**
   * Formats localized notification messages
   */
  formatMessage(payload: NotificationPayload, config: GitRemindConfig): { title: string; subtitle: string; message: string } {
    const isTr = config.language === 'tr';
    const repo = payload.repoName || (isTr ? 'Git Projesi' : 'Git Project');
    const branch = payload.branch ? ` (${payload.branch})` : '';
    const fileCount = payload.fileCount ?? 0;

    let title = payload.title;
    let subtitle = payload.subtitle || `${repo}${branch}`;
    let message = payload.message;

    if (!payload.title) {
      switch (payload.trigger) {
        case 'close':
          title = isTr ? 'GitRemind: Proje Kapatıldı!' : 'GitRemind: Project Closed!';
          message = isTr
            ? `⚠️ "${repo}" reposunda commit edilmemiş ${fileCount} dosya var!`
            : `⚠️ You have ${fileCount} uncommitted file(s) in "${repo}"!`;
          break;
        case 'idle':
          title = isTr ? 'GitRemind: İşlem Bekliyor' : 'GitRemind: Inactive Project!';
          message = isTr
            ? `⏳ "${repo}" reposunda bir süredir değişiklik commit edilmedi.`
            : `⏳ "${repo}" has pending uncommitted changes.`;
          break;
        case 'test':
          title = isTr ? 'GitRemind: Test Bildirimi' : 'GitRemind: Test Notification';
          message = isTr ? 'Bildirim sistemi başarıyla çalışıyor!' : 'Notification system is working properly!';
          break;
        case 'interval':
        default:
          title = isTr ? 'GitRemind: Değişiklikleri Commit Etmediniz!' : 'GitRemind: Uncommitted Changes!';
          message = isTr
            ? `💡 "${repo}" reposundaki son değişiklikleri commit etmediniz! (${fileCount} dosya)`
            : `💡 You haven't committed the latest changes in "${repo}"! (${fileCount} files)`;
          break;
      }
    }

    if (payload.filesPreview && payload.filesPreview.length > 0) {
      const preview = payload.filesPreview.slice(0, 3).join(', ');
      const more = payload.filesPreview.length > 3 ? ` +${payload.filesPreview.length - 3}` : '';
      message += isTr ? `\nDosyalar: ${preview}${more}` : `\nFiles: ${preview}${more}`;
    }

    return { title, subtitle, message };
  }

  /**
   * Dispatches desktop notification
   */
  async notify(payload: NotificationPayload): Promise<boolean> {
    const config = configManager.load();

    if (payload.trigger !== 'manual' && payload.trigger !== 'test') {
      if (this.isQuietHour(config)) {
        logger.info(`Quiet hours active, skipping notification for ${payload.repoName}`);
        return false;
      }
    }

    const { title, subtitle, message } = this.formatMessage(payload, config);
    const platform = os.platform();

    logger.info(`[NOTIFY] ${title} | ${subtitle} | ${message.replace(/\r?\n/g, ' ')}`);

    try {
      if (platform === 'win32') {
        const scriptPath = this.getToastScriptPath();
        const args = [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-Title',
          title,
          '-Subtitle',
          subtitle,
          '-Message',
          message,
        ];
        if (config.sound) {
          args.push('-Sound');
        }

        await execFileAsync('powershell.exe', args, {
          timeout: 10000,
          windowsHide: true,
        });
        return true;
      } else if (platform === 'darwin') {
        // macOS notification
        const appleScript = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" subtitle "${subtitle.replace(/"/g, '\\"')}"`;
        await execFileAsync('osascript', ['-e', appleScript], { timeout: 5000 });
        return true;
      } else {
        // Linux notification
        await execFileAsync('notify-send', [title, `${subtitle}\n${message}`], { timeout: 5000 });
        return true;
      }
    } catch (err) {
      logger.error('Failed to display native desktop notification', err);
      // Fallback: Terminal chime
      if (config.sound) {
        process.stdout.write('\x07');
      }
      return false;
    }
  }
}

export const notifier = new Notifier();
