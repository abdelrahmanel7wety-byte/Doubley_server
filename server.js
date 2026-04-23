// doubley-server/server.js
const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const TMP = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);

// ===== Dependencies Check =====
const checkDeps = () => {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    execSync('yt-dlp --version', { stdio: 'ignore' });
    console.log('✅ ffmpeg و yt-dlp جاهزين');
    return true;
  } catch (e) {
    console.error('❌ ffmpeg أو yt-dlp مش موجودين');
    return false;
  }
};

// ===== Gameplay Videos =====
const GAMEPLAY_VIDEOS = {
  minecraft: 'https://drive.google.com/uc?export=download&id=1ZHyU8W_Nfbynxfp73r8g3R-PDlbTWEvF',
  subway: 'https://drive.google.com/uc?export=download&id=1vp9uMQgfvjq6FKI0p2Uo8-9toGul8pYO',
  asmr: 'https://drive.google.com/uc?export=download&id=1LhNvJMwFtgXJSxj7NUIWdKKhkc2dsWXk',
  default: 'https://drive.google.com/uc?export=download&id=1ZHyU8W_Nfbynxfp73r8g3R-PDlbTWEvF',
};

// ===== Health Check =====
app.get('/', (req, res) => {
  res.json({ status: '✅ Double Y Server شغال!', version: '2.0.0' });
});

// ===== جيب ترند من TikTok/YouTube Shorts =====
const fetchTrendingVideo = (region) => {
  return new Promise((resolve, reject) => {
    const query = region === 'egypt' ? 'tiktok trending مصر' : 'tiktok trending USA';
    const regionCode = region === 'egypt' ? 'EG' : 'US';
    // yt-dlp يبحث ويجيب أول فيديو trending short
    const cmd = `yt-dlp --no-download --print "%(webpage_url)s|||%(title)s|||%(duration)s" "ytsearch10:${query} shorts" --match-filter "duration<61" --max-downloads 5 2>/dev/null | head -5`;
    
    exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err || !stdout.trim()) {
        // Fallback: ابحث بطريقة تانية
        const fallbackCmd = `yt-dlp --no-download --print "%(webpage_url)s|||%(title)s|||%(duration)s" "ytsearch5:trending shorts ${regionCode} 2024" --match-filter "duration<61" --max-downloads 3 2>/dev/null | head -3`;
        exec(fallbackCmd, { timeout: 30000 }, (err2, stdout2) => {
          if (err2 || !stdout2.trim()) {
            reject(new Error('مش لاقي فيديوهات trending'));
            return;
          }
          const lines = stdout2.trim().split('\n').filter(l => l.includes('|||'));
          if (!lines.length) { reject(new Error('مش لاقي فيديوهات')); return; }
          const random = lines[Math.floor(Math.random() * lines.length)];
          const [url, title, duration] = random.split('|||');
          resolve({ url: url.trim(), title: title.trim(), duration: parseInt(duration) || 30 });
        });
        return;
      }
      const lines = stdout.trim().split('\n').filter(l => l.includes('|||'));
      if (!lines.length) { reject(new Error('مش لاقي فيديوهات')); return; }
      const random = lines[Math.floor(Math.random() * lines.length)];
      const [url, title, duration] = random.split('|||');
      resolve({ url: url.trim(), title: title.trim(), duration: parseInt(duration) || 30 });
    });
  });
};

// ===== تحميل فيديو =====
const downloadVideo = (url, outputPath) => {
  return new Promise((resolve, reject) => {
    exec(`yt-dlp -o "${outputPath}" --no-playlist -f "best[ext=mp4]/best" --max-filesize 50M "${url}"`, 
      { timeout: 60000 }, 
      (err, stdout, stderr) => {
        if (err) reject(new Error('فشل التحميل'));
        else if (fs.existsSync(outputPath)) resolve(outputPath);
        else reject(new Error('الملف مش موجود بعد التحميل'));
    });
  });
};

// ===== تحميل Gameplay من Google Drive =====
const downloadGameplay = async (type, outputPath) => {
  const url = GAMEPLAY_VIDEOS[type] || GAMEPLAY_VIDEOS.default;
  try {
    const response = await axios({ url, method: 'GET', responseType: 'stream', maxRedirects: 5, timeout: 30000 });
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);
      writer.on('finish', () => resolve(outputPath));
      writer.on('error', reject);
    });
  } catch (e) {
    // Google Drive ممكن يعمل redirect — جرب بـ confirm
    const confirmUrl = url + '&confirm=t';
    const response = await axios({ url: confirmUrl, method: 'GET', responseType: 'stream', maxRedirects: 5, timeout: 30000 });
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);
      writer.on('finish', () => resolve(outputPath));
      writer.on('error', reject);
    });
  }
};

// ===== دمج الفيديوهات =====
const mergeVideos = (tiktokPath, gameplayPath, outputPath, duration = 30) => {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(tiktokPath)
      .input(gameplayPath)
      .complexFilter([
        '[0:v]scale=1080:1344:force_original_aspect_ratio=decrease,pad=1080:1344:(ow-iw)/2:(oh-ih)/2,setsar=1[top]',
        '[1:v]scale=1080:576:force_original_aspect_ratio=decrease,pad=1080:576:(ow-iw)/2:(oh-ih)/2,setsar=1[bottom]',
        '[top][bottom]vstack=inputs=2[out]'
      ])
      .outputOptions([
        '-map [out]',
        '-map 0:a?',
        `-t ${Math.min(duration, 59)}`,
        '-c:v libx264',
        '-preset fast',
        '-c:a aac',
        '-b:v 2500k',
        '-b:a 128k',
        '-r 30',
        '-movflags +faststart',
        '-shortest',
        '-y'
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error('فشل الدمج: ' + err.message)))
      .run();
  });
};

// ===== API: إنشاء فيديو كامل (ترند + دمج) =====
app.post('/create-video', async (req, res) => {
  const { tiktokUrl, gameplayType = 'minecraft', region = 'egypt' } = req.body;

  const id = uuidv4();
  const tiktokPath = path.join(TMP, `${id}_tiktok.mp4`);
  const gameplayPath = path.join(TMP, `${id}_gameplay.mp4`);
  const outputPath = path.join(TMP, `${id}_output.mp4`);
  const cleanup = () => [tiktokPath, gameplayPath, outputPath].forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e) {} });

  console.log(`🎬 [${id}] بدأ إنشاء فيديو...`);

  try {
    let videoUrl = tiktokUrl;
    let trendTitle = '';

    // 1. لو مفيش URL — جيب ترند أوتوماتيك
    if (!videoUrl) {
      console.log(`🔍 [${id}] جاري البحث عن ترند...`);
      const trend = await fetchTrendingVideo(region);
      videoUrl = trend.url;
      trendTitle = trend.title;
      console.log(`✅ [${id}] لقينا: ${trendTitle}`);
    }

    // 2. حمّل الفيديو
    console.log(`⬇️ [${id}] جاري تحميل الفيديو...`);
    await downloadVideo(videoUrl, tiktokPath);

    // 3. حمّل Gameplay
    console.log(`⬇️ [${id}] جاري تحميل Gameplay (${gameplayType})...`);
    await downloadGameplay(gameplayType, gameplayPath);

    // 4. ادمج
    console.log(`🎞️ [${id}] جاري الدمج...`);
    await mergeVideos(tiktokPath, gameplayPath, outputPath);

    // 5. حول لـ base64 وابعته
    console.log(`📤 [${id}] جاري الإرسال...`);
    const videoBuffer = fs.readFileSync(outputPath);
    const base64Video = videoBuffer.toString('base64');
    const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);

    cleanup();
    console.log(`✅ [${id}] تم! (${fileSizeMB} MB)`);

    res.json({
      success: true,
      video: base64Video,
      trendTitle: trendTitle,
      fileSize: fileSizeMB,
      mimeType: 'video/mp4',
    });

  } catch (err) {
    console.error(`❌ [${id}] خطأ:`, err.message);
    cleanup();
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== API: جيب ترند بس بدون دمج =====
app.post('/fetch-trend', async (req, res) => {
  const { region = 'egypt' } = req.body;
  try {
    const trend = await fetchTrendingVideo(region);
    res.json({ success: true, ...trend });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== Gameplay Types =====
app.get('/gameplay-types', (req, res) => {
  res.json({
    types: Object.keys(GAMEPLAY_VIDEOS).filter(k => k !== 'default'),
    details: [
      { id: 'minecraft', name: 'Minecraft', icon: '⛏️' },
      { id: 'subway', name: 'Subway Surfers', icon: '🏃' },
      { id: 'asmr', name: 'ASMR', icon: '🎧' },
    ]
  });
});

// ===== Start =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Double Y Server v2.0 شغال على port ${PORT}`);
  checkDeps();
});

