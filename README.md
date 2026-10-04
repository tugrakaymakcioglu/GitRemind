# 🔔 GitRemind

**GitRemind**, yerel Git depolarındaki dosya değişikliklerini arka planda gerçek zamanlı izleyen, commit edilmemiş değişiklikleri otomatik tespit eden ve hem **belirli zaman aralıklarıyla** hem de **projeyi/editörü kapattığınızda** yerel Windows Toast bildirimleri ile sizi uyaran profesyonel bir geliştirici aracıdır.

---

## 🚀 Öne Çıkan Özellikler

1. **⚡ Gerçek Zamanlı Değişiklik Tespiti**:
   - `chokidar` ve `git status --porcelain` entegrasyonu ile dosya kaydetme anında otomatik tetiklenir.
   - Değiştirilen (`M`), yeni eklenen (`?`), sahnelenen (`A`) ve silinen (`D`) dosyaları anında ayrıştırır.
   - Akıllı debounce (gecikme dengeleme) mekanizması ile derleme veya paket yükleme anında bildirim kirliliği yapmaz.

2. **⏰ Periyodik Commit Hatırlatıcısı (Aralıklı Bildirim)**:
   - Depoda commit bekleyen dosyalar varken belirlenen süre boyunca (örn. varsayılan 20 dk) yeni commit atılmazsa Windows Toast bildirimi gönderir.
   - Hatırlatma aralığı tamamen özelleştirilebilir (`gitremind config interval 15`).

3. **🚪 Proje / Editör Kapanış Hatırlatıcısı (Kapanış Bildirimi)**:
   - **`gitremind open code .`**: Projenizi VS Code veya istediğiniz editör ile başlatır; editör penceresi kapandığı an uncommitted dosya varsa hemen sesli ve görsel bildirimle uyarır.
   - **Shell Hook (`gitremind hook powershell`)**: Terminal veya PowerShell oturumundan çıkarken (`exit`) commit edilmemiş dosyalarınız varsa çıkışı uyararak hatırlatır.

4. **🪟 Yerel Windows Toast Entegrasyonu**:
   - Harici C++ bağımlılığına gerek duymadan Windows WinRT Toast Bildirim API'sini doğrudan kullanır.
   - Dosya sayısı, branch adı ve değiştirilen dosyaların önizlemesini bildirim kartında gösterir.

5. **🌙 Sessiz Saatler ve Yapılandırma**:
   - Gece çalışma veya odaklanma saatlerinde bildirimleri susturma desteği.
   - Türkçe (`tr`) ve İngilizce (`en`) dil desteği.

---

## 📦 Kurulum ve Başlangıç

Proje küresel olarak sisteme bağlanmıştır (`npm link` yapılmıştır). Herhangi bir PowerShell veya CMD penceresinden doğrudan `gitremind` komutunu çalıştırabilirsiniz:

```powershell
gitremind --help
```

---

## 🛠️ Temel Komutlar

| Komut | Açıklama |
| :--- | :--- |
| `gitremind status` | Servis durumunu ve bulunulan reponun commit durumunu gösterir |
| `gitremind watch [yol]` | Bulunduğunuz veya belirttiğiniz git reposunu izleme listesine ekler |
| `gitremind unwatch [yol]` | Bir repoyu izleme listesinden çıkarır |
| `gitremind list` | İzlenen tüm depoları ve anlık commit durumlarını listeler |
| `gitremind check` | Bulunulan depoyu anında kontrol eder ve değişiklik varsa bildirim tetikler |
| `gitremind open code .` | Projeyi VS Code ile açar; editör kapandığında commit edilmemiş dosyaları uyarır |
| `gitremind start` | Arka plan izleme servisini başlatır |
| `gitremind start -f` | Servisi ön planda (terminalde logları görerek) çalıştırır |
| `gitremind stop` | Arka plan servisini durdurur |
| `gitremind config` | Mevcut ayarları görüntüler |
| `gitremind config interval 15` | Hatırlatma aralığını 15 dakikaya ayarlar |
| `gitremind config sound true` | Sesli uyarıyı açar |
| `gitremind notify` | Test amaçlı Windows Toast bildirimi gönderir |
| `gitremind hook powershell` | Terminalden çıkarken hatırlatma yapan PowerShell hook kodunu verir |

---

## 💻 Kullanım Senaryoları

### Senaryo 1: Projeyi İzlemeye Alma
```powershell
# Proje klasörünüze gidin
cd C:\Projelerim\MyApp

# Repoyu GitRemind izleme listesine ekleyin
gitremind watch

# Arka plan servisini başlatın
gitremind start
```

### Senaryo 2: Projeyi Editörle Açıp Kapanışta Uyarılma
```powershell
# VS Code veya Cursor ile projeyi başlatın:
gitremind open code .

# Siz kod yazıp editörü kapattığınızda, eğer commit etmediyseniz:
# 🔔 "GitRemind: Proje Kapatıldı! 3 dosya commit edilmedi!" uyarısı ekranınıza gelir.
```

### Senaryo 3: PowerShell Profiline Çıkış Hook'u Ekleme
PowerShell terminalinden her çıktığınızda projenizde unutulmuş değişiklik varsa uyarılmak için `$PROFILE` dosyanıza şu kodu ekleyin:

```powershell
Register-EngineEvent PowerShell.Exiting -Action {
    try {
        if (git rev-parse --is-inside-work-tree 2>$null) {
            $dirty = git status --porcelain=v1 2>$null
            if ($dirty) {
                Write-Host "`n[GitRemind] ⚠️ UYARI: Commit edilmemiş değişiklikler var!" -ForegroundColor Yellow
                git status -s
                gitremind check 2>$null
            }
        }
    } catch {}
} | Out-Null
```

---

## 🧪 Testlerin Çalıştırılması

Tüm çekirdek modüller için hazırlanmış birim ve entegrasyon testlerini çalıştırmak için:

```powershell
npm test
```
*(14 testin tamamı doğrulanmıştır).*
