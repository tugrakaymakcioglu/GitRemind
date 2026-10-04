#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getRepoState, getRepoRoot } from '../core/git.js';
import { configManager } from '../core/config.js';
import { GitRemindDaemon } from '../core/daemon.js';
import { notifier } from '../core/notifier.js';
import { processTracker } from '../core/process-tracker.js';
import { formatRepoCard, formatBanner } from './formatters.js';
import { normalizeRepoPath, getLogPath, getConfigPath } from '../utils/paths.js';

const __filename = fileURLToPath(import.meta.url);
const program = new Command();

program
  .name('gitremind')
  .description('Otomatik Git Değişiklik ve Commit Hatırlatma Sistemi')
  .version('1.0.0');

// 1. START
program
  .command('start')
  .description('GitRemind arkaplan izleme servisini başlatır')
  .option('-f, --foreground', 'Servisi arkaplanda değil, bu terminalde önplanda çalıştır')
  .action(async (options) => {
    const isRunning = GitRemindDaemon.isRunning();
    if (isRunning.running) {
      console.log(pc.yellow(`⚠️  GitRemind servisi zaten çalışıyor (PID: ${isRunning.pid}).`));
      return;
    }

    if (options.foreground) {
      console.log(formatBanner());
      console.log(pc.cyan('🚀 GitRemind servisi önplanda çalıştırılıyor... (Çıkmak için Ctrl+C)'));
      const daemon = new GitRemindDaemon();
      await daemon.start();
    } else {
      const result = GitRemindDaemon.spawnBackground(__filename);
      if (result.success) {
        console.log(pc.green(`✔ ${result.message}`));
        console.log(pc.gray(`  Logları izlemek için: Get-Content -Wait "${getLogPath()}"`));
      } else {
        console.log(pc.red(`✖ ${result.message}`));
      }
    }
  });

// 2. STOP
program
  .command('stop')
  .description('Çalışan GitRemind arkaplan servisini durdurur')
  .action(async () => {
    const isRunning = GitRemindDaemon.isRunning();
    if (!isRunning.running || !isRunning.pid) {
      console.log(pc.yellow('ℹ️  Çalışan bir GitRemind servisi bulunamadı.'));
      return;
    }

    try {
      process.kill(isRunning.pid, 'SIGTERM');
      console.log(pc.green(`✔ GitRemind servisi (PID: ${isRunning.pid}) durduruldu.`));
    } catch (err: unknown) {
      const error = err as Error;
      console.log(pc.red(`✖ Servis durdurulurken hata oluştu: ${error.message}`));
    }
  });

// 3. RESTART
program
  .command('restart')
  .description('GitRemind arkaplan servisini yeniden başlatır')
  .action(async () => {
    const isRunning = GitRemindDaemon.isRunning();
    if (isRunning.running && isRunning.pid) {
      try {
        process.kill(isRunning.pid, 'SIGTERM');
        console.log(pc.yellow(`ℹ️  Eski servis (PID: ${isRunning.pid}) durduruldu.`));
        // Small delay to allow clean socket release
        await new Promise((r) => setTimeout(r, 1000));
      } catch {
        // ignore
      }
    }

    const result = GitRemindDaemon.spawnBackground(__filename);
    if (result.success) {
      console.log(pc.green(`✔ ${result.message}`));
    } else {
      console.log(pc.red(`✖ ${result.message}`));
    }
  });

// 4. STATUS
program
  .command('status')
  .description('Servis durumunu ve izlenen repoların durumunu gösterir')
  .action(async () => {
    console.log(formatBanner());

    const isRunning = GitRemindDaemon.isRunning();
    const config = configManager.load();

    console.log(pc.bold('\n⚙️  Servis Durumu:'));
    if (isRunning.running) {
      console.log(`   Durum           : ${pc.green('● ÇALIŞIYOR')} (PID: ${isRunning.pid})`);
    } else {
      console.log(`   Durum           : ${pc.red('○ DURDURULDU')}`);
    }
    console.log(`   Hatırlatma Sıklık: ${pc.cyan(config.intervalMinutes + ' dakika')}`);
    console.log(`   Kapanış Bildirimi: ${config.notifyOnClose ? pc.green('Açık') : pc.red('Kapalı')}`);
    console.log(`   Sesli Uyarı     : ${config.sound ? pc.green('Açık') : pc.red('Kapalı')}`);
    console.log(`   İzlenen Repo Sayısı: ${pc.yellow(String(config.watchedRepos.length))}`);

    // Current working directory check
    const currentRepo = await getRepoState(process.cwd());
    if (currentRepo.isGitRepo) {
      console.log(pc.bold('\n🔍 Bulunulan Klasörün Durumu:'));
      console.log(formatRepoCard(currentRepo));
    }
  });

// 5. WATCH (Add repo)
program
  .command('watch [path]')
  .description('Bir git reposunu izleme listesine ekler (varsayılan: bulunulan dizin)')
  .action(async (targetPath?: string) => {
    const dir = targetPath ? path.resolve(targetPath) : process.cwd();
    const result = await configManager.addRepo(dir);

    if (result.success) {
      console.log(pc.green(`✔ ${result.message}`));
      // If daemon is not running, prompt user
      const isRunning = GitRemindDaemon.isRunning();
      if (!isRunning.running) {
        console.log(pc.cyan('💡 Arkaplan servisini başlatmak için: gitremind start'));
      }
    } else {
      console.log(pc.yellow(`ℹ️  ${result.message}`));
    }
  });

// 6. UNWATCH (Remove repo)
program
  .command('unwatch [path]')
  .description('Bir repoyu izleme listesinden çıkarır')
  .action((targetPath?: string) => {
    const dir = targetPath ? path.resolve(targetPath) : process.cwd();
    const result = configManager.removeRepo(dir);
    if (result.success) {
      console.log(pc.green(`✔ ${result.message}`));
    } else {
      console.log(pc.red(`✖ ${result.message}`));
    }
  });

// 7. LIST
program
  .command('list')
  .description('İzlenen tüm repoları ve anlık commit durumlarını listeler')
  .action(async () => {
    const config = configManager.load();
    if (config.watchedRepos.length === 0) {
      console.log(pc.yellow('ℹ️  Henüz izleme listesine eklenmiş bir repo yok.'));
      console.log(pc.cyan('   Eklemek için: gitremind watch'));
      return;
    }

    console.log(pc.bold(`\n📋 İzlenen Depolar (${config.watchedRepos.length}):`));
    for (const r of config.watchedRepos) {
      if (fs.existsSync(r.path)) {
        const state = await getRepoState(r.path);
        console.log(formatRepoCard(state));
      } else {
        console.log(pc.red(`\n✖ ${r.name} (${r.path}) - Klasör bulunamadı!`));
      }
    }
  });

// 8. CHECK (One-off check & notify)
program
  .command('check [path]')
  .description('Repo durumunu anında kontrol eder ve uncommitted değişiklik varsa bildirim gönderir')
  .action(async (targetPath?: string) => {
    const dir = targetPath ? path.resolve(targetPath) : process.cwd();
    const state = await getRepoState(dir);

    if (!state.isGitRepo) {
      console.log(pc.red(`✖ "${dir}" bir Git reposu değil.`));
      return;
    }

    console.log(formatRepoCard(state));

    if (state.isDirty) {
      await notifier.notify({
        trigger: 'interval',
        title: 'GitRemind: Değişiklikleri Commit Etmediniz!',
        subtitle: `Repo: ${state.name} (${state.branch})`,
        message: `💡 "${state.name}" reposundaki ${state.summary.total} dosya commit bekliyor!`,
        repoName: state.name,
        repoPath: state.rootPath,
        branch: state.branch,
        fileCount: state.summary.total,
        filesPreview: state.files.map((f) => f.path),
      });
      console.log(pc.green('\n✔ Windows Toast bildirimi gönderildi.'));
    } else {
      console.log(pc.green('\n✔ Repo temiz! Commit edilmemiş dosya yok.'));
    }
  });

// 9. OPEN / SESSION (Run editor & notify on exit)
program
  .command('open <editorCommand> [args...]')
  .description('Projeyi seçilen editörle açar ve editör kapandığında commit uyarısı verir (Örn: gitremind open code .)')
  .action(async (editorCommand: string, args: string[]) => {
    const currentDir = process.cwd();
    const root = await getRepoRoot(currentDir);
    const repoPath = root || currentDir;

    console.log(pc.cyan(`🚀 ${editorCommand} başlatılıyor (${repoPath})...`));
    console.log(pc.gray('   Editör kapandığında commit durumu otomatik denetlenecektir.\n'));

    const exitCode = await processTracker.runSession(editorCommand, args, repoPath);
    process.exit(exitCode);
  });

// 10. CONFIG
program
  .command('config [key] [value]')
  .description('Ayarları görüntüler veya günceller (interval, sound, close, lang)')
  .action((key?: string, value?: string) => {
    const config = configManager.load();

    if (!key) {
      console.log(pc.bold('\n⚙️  GitRemind Yapılandırması:'));
      console.log(`   intervalMinutes : ${pc.cyan(String(config.intervalMinutes))}`);
      console.log(`   notifyOnClose   : ${pc.cyan(String(config.notifyOnClose))}`);
      console.log(`   sound           : ${pc.cyan(String(config.sound))}`);
      console.log(`   language        : ${pc.cyan(config.language)}`);
      console.log(`   Yapılandırma Dosyası: ${pc.gray(getConfigPath())}`);
      return;
    }

    if (key === 'interval' && value) {
      const minutes = parseInt(value, 10);
      if (isNaN(minutes) || minutes < 1) {
        console.log(pc.red('✖ interval değeri pozitif bir sayı olmalıdır (dakika cinsinden).'));
        return;
      }
      configManager.updateSettings({ intervalMinutes: minutes });
      console.log(pc.green(`✔ Hatırlatma aralığı ${minutes} dakika olarak güncellendi.`));
    } else if (key === 'sound' && value) {
      const soundVal = value.toLowerCase() === 'true' || value === '1' || value === 'yes';
      configManager.updateSettings({ sound: soundVal });
      console.log(pc.green(`✔ Sesli bildirim ${soundVal ? 'açıldı' : 'kapatıldı'}.`));
    } else if (key === 'close' && value) {
      const closeVal = value.toLowerCase() === 'true' || value === '1' || value === 'yes';
      configManager.updateSettings({ notifyOnClose: closeVal });
      console.log(pc.green(`✔ Kapanış bildirimi ${closeVal ? 'açıldı' : 'kapatıldı'}.`));
    } else if (key === 'lang' && value) {
      if (value !== 'tr' && value !== 'en') {
        console.log(pc.red('✖ Dil seçeneği sadece "tr" veya "en" olabilir.'));
        return;
      }
      configManager.updateSettings({ language: value });
      console.log(pc.green(`✔ Dil "${value}" olarak güncellendi.`));
    } else {
      console.log(pc.yellow(`Bilinmeyen ayar: "${key}". Kullanılabilir ayarlar: interval, sound, close, lang`));
    }
  });

// 11. NOTIFY (Test notification)
program
  .command('notify [message]')
  .description('Test amaçlı masaüstü bildirimi gönderir')
  .action(async (customMsg?: string) => {
    console.log(pc.cyan('🔔 Test bildirimi gönderiliyor...'));
    const success = await notifier.notify({
      trigger: 'test',
      title: 'GitRemind: Test Bildirimi',
      subtitle: 'Git Hatırlatıcı Servisi',
      message: customMsg || 'Bu bir test bildirimidir. Bildirim mekanizması sorunsuz çalışıyor!',
    });

    if (success) {
      console.log(pc.green('✔ Bildirim başarıyla iletildi.'));
    } else {
      console.log(pc.red('✖ Bildirim iletilemedi.'));
    }
  });

// 12. HOOK (Shell integration)
program
  .command('hook [shell]')
  .description('Terminal çıkışında commit hatırlatması yapan kabuk (shell) kodunu üretir (powershell, bash, zsh)')
  .action((shell = 'powershell') => {
    const s = shell.toLowerCase();
    if (s === 'powershell' || s === 'pwsh') {
      console.log(pc.cyan('# GitRemind PowerShell Entegrasyonu'));
      console.log(pc.gray('# Bu kodu $PROFILE dosyanıza ekleyebilirsiniz:'));
      console.log(`
Register-EngineEvent PowerShell.Exiting -Action {
    try {
        if (git rev-parse --is-inside-work-tree 2>$null) {
            $dirty = git status --porcelain=v1 2>$null
            if ($dirty) {
                Write-Host "\`n[GitRemind] ⚠️  UYARI: Projeden çıkılıyor fakat commit edilmemiş değişiklikler var!" -ForegroundColor Yellow
                git status -s
                gitremind check 2>$null
            }
        }
    } catch {}
} | Out-Null
`);
    } else if (s === 'bash' || s === 'zsh') {
      console.log(pc.cyan(`# GitRemind ${s.toUpperCase()} Entegrasyonu`));
      console.log(pc.gray(`# Bu kodu ~/.${s}rc dosyanıza ekleyebilirsiniz:`));
      console.log(`
gitremind_exit_hook() {
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        if [ -n "$(git status --porcelain=v1 2>/dev/null)" ]; then
            printf "\\n\\033[1;33m[GitRemind] ⚠️  UYARI: Commit edilmemiş değişiklikler var!\\033[0m\\n"
            git status -s
            gitremind check >/dev/null 2>&1 &
        fi
    fi
}
trap gitremind_exit_hook EXIT
`);
    } else {
      console.log(pc.red(`Desteklenmeyen kabuk türü: ${shell}. Desteklenenler: powershell, bash, zsh`));
    }
  });

// 13. DAEMON RUN (Internal)
program
  .command('daemon')
  .argument('<action>', 'run')
  .description('Arkaplan servis döngüsü (iç kullanım)')
  .action(async (action) => {
    if (action === 'run') {
      const daemon = new GitRemindDaemon();
      await daemon.start();
    }
  });

await program.parseAsync(process.argv);
