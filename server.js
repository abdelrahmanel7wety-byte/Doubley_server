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
  res.json({ status: '✅ Double Y Server شغال!', version: '3.0.0' });
});

// ===== جيب ترند من TikTok =====
const fetchTrendingVideo = async (region) => {
  const regionCode = region === 'egypt' ? 'EG' : 'US';
  const regions = [regionCode, 'US', 'GB', 'SA'];

  for (const rc of regions) {
    try {
      console.log(`🔍 جاري البحث في TikTok (${rc})...`);
      const res = await axios.get(`https://www.tikwm.com/api/feed/list?region=${rc}&count=30`, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        }
      });

      if (res.data?.data?.videos?.length) {
        const videos = res.data.data.videos.filter(v =>
          v.duration >= 10 && v.duration <= 60 && v.play
        );

        if (videos.length) {
          const pick = videos[Math.floor(Math.random() * videos.length)];
          console.log(`✅ لقينا ترند: ${pick.title || 'TikTok'} (${pick.duration}s)`);
          return {
            url: `https://www.tiktok.com/@${pick.author?.unique_id || 'user'}/video/${pick.video_id}`,
            title: pick.title || 'TikTok Trend',
            duration: pick.duration || 30,
            downloadUrl: pick.play,
          };
        }
      }
    } catch (e) {
      console.log(`⚠️ فشل البحث في ${rc}: ${e.message}`);
      continue;
    }
  }

  // Fallback: tikwm search
  try {
    console.log('🔍 Fallback: tikwm search...');
    const searchRes = await axios.get(`https://www.tikwm.com/api/feed/search?keywords=trending&count=20&region=${regionCode}`, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (searchRes.data?.data?.videos?.length) {
      const videos = searchRes.data.data.videos.filter(v => v.duration >= 10 && v.duration <= 60 && v.play);
      if (videos.length) {
        const pick = videos[Math.floor(Math.random() * videos.length)];
        return {
          url: `https://www.tiktok.com/@${pick.author?.unique_id || 'user'}/video/${pick.video_id}`,
          title: pick.title || 'TikTok Trend',
          duration: pick.duration || 30,
          downloadUrl: pick.play,
        };
      }
    }
  } catch (e) {
    console.log('⚠️ Fallback search failed:', e.message);
  }

  throw new Error('مش لاقي فيديوهات trending — جرب تاني');
};

// ===== تحميل فيديو =====
const downloadVideo = async (url, outputPath, directUrl = null) => {
  // لو فيه رابط مباشر من tikwm — حمّل مباشرة (أسرع وأضمن)
  if (directUrl) {
    try {
      console.log('⬇️ تحميل مباشر من tikwm...');
      const response = await axios({
        url: directUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.tiktok.com/',
        }
      });
      return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(outputPath);
        response.data.pipe(writer);
        writer.on('finish', () => {
          const stats = fs.statSync(outputPath);
          if (stats.size > 10000) {
            console.log(`✅ تم التحميل المباشر (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            resolve(outputPath);
          } else {
            console.log('⚠️ الملف صغير أوي — هنجرب yt-dlp');
            reject(new Error('ملف صغير'));
          }
        });
        writer.on('error', reject);
      });
    } catch (e) {
      console.log('⚠️ Direct download failed, trying yt-dlp...', e.message);
    }
  }

  // Fallback: yt-dlp
  return new Promise((resolve, reject) => {
    console.log('⬇️ تحميل بـ yt-dlp...');
    exec(`yt-dlp -o "${outputPath}" --no-playlist -f "best[ext=mp4]/best" --max-filesize 50M "${url}"`,
      { timeout: 60000 },
      (err) => {
        if (err) reject(new Error('فشل التحميل'));
        else if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) resolve(outputPath);
        else reject(new Error('الملف مش موجود أو صغير أوي'));
      });
  });
};

// ===== تحميل Gameplay من Google Drive =====
const downloadGameplay = async (type, outputPath) => {
  const url = GAMEPLAY_VIDEOS[type] || GAMEPLAY_VIDEOS.default;
  console.log(`⬇️ تحميل Gameplay (${type})...`);

  try {
    const response = await axios({ url, method: 'GET', responseType: 'stream', maxRedirects: 5, timeout: 30000 });
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);
      writer.on('finish', () => resolve(outputPath));
      writer.on('error', reject);
    });
  } catch (e) {
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
    console.log(`🎞️ دمج الفيديوهات (${duration}s)...`);
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
      .on('end', () => {
        console.log('✅ تم الدمج');
        resolve(outputPath);
      })
      .on('error', (err) => reject(new Error('فشل الدمج: ' + err.message)))
      .run();
  });
};

// ===== نضافة tmp =====
const cleanupOldFiles = () => {
  try {
    const files = fs.readdirSync(TMP);
    const now = Date.now();
    files.forEach(f => {
      const fp = path.join(TMP, f);
      const stats = fs.statSync(fp);
      if (now - stats.mtimeMs > 10 * 60 * 1000) {
        fs.unlinkSync(fp);
      }
    });
  } catch (e) {}
};

setInterval(cleanupOldFiles, 5 * 60 * 1000);

// ===== API: إنشاء فيديو كامل (ترند + دمج) =====
app.post('/create-video', async (req, res) => {
  const { tiktokUrl, gameplayType = 'minecraft', region = 'egypt' } = req.body;

  const id = uuidv4();
  const tiktokPath = path.join(TMP, `${id}_tiktok.mp4`);
  const gameplayPath = path.join(TMP, `${id}_gameplay.mp4`);
  const outputPath = path.join(TMP, `${id}_output.mp4`);
  const cleanup = () => [tiktokPath, gameplayPath, outputPath].forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e) {} });

  console.log(`\n🎬 ========== [${id}] بدأ إنشاء فيديو ==========`);
  console.log(`   Region: ${region} | Gameplay: ${gameplayType} | Custom URL: ${tiktokUrl ? 'yes' : 'no'}`);

  try {
    let videoUrl = tiktokUrl;
    let trendTitle = '';
    let directDownloadUrl = null;

    // 1. لو مفيش URL — جيب ترند أوتوماتيك من TikTok
    if (!videoUrl) {
      console.log(`🔍 [${id}] جاري البحث عن ترند TikTok...`);
      const trend = await fetchTrendingVideo(region);
      videoUrl = trend.url;
      trendTitle = trend.title;
      directDownloadUrl = trend.downloadUrl;
      console.log(`✅ [${id}] لقينا: ${trendTitle}`);
    }

    // 2. حمّل الفيديو (مباشر أو yt-dlp)
    console.log(`⬇️ [${id}] جاري تحميل الفيديو...`);
    await downloadVideo(videoUrl, tiktokPath, directDownloadUrl);

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
    console.log(`✅ [${id}] تم بنجاح! (${fileSizeMB} MB)`);
    console.log(`🎬 ========== [${id}] خلص ==========\n`);

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
  console.log(`🚀 Double Y Server v3.0 شغال على port ${PORT}`);
  checkDeps();
  cleanupOldFiles();
});
