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
app.use(express.json());

const TMP = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);

// ===== تأكد إن ffmpeg و yt-dlp موجودين =====
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

// ===== Gameplay Videos (موجودة على السيرفر) =====
const GAMEPLAY_VIDEOS = {
  minecraft: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  subway: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  gta: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
  racing: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
  default: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
};

// ===== Health Check =====
app.get('/', (req, res) => {
  res.json({ status: '✅ Double Y Server شغال!', version: '1.0.0' });
});

// ===== تحميل TikTok فيديو =====
const downloadTikTok = (url, outputPath) => {
  return new Promise((resolve, reject) => {
    exec(`yt-dlp -o "${outputPath}" --no-playlist -f "best[ext=mp4]/best" "${url}"`, (err, stdout, stderr) => {
      if (err) reject(new Error('فشل تحميل TikTok: ' + stderr));
      else resolve(outputPath);
    });
  });
};

// ===== تحميل Gameplay فيديو =====
const downloadGameplay = async (type, outputPath) => {
  const url = GAMEPLAY_VIDEOS[type] || GAMEPLAY_VIDEOS.default;
  const response = await axios({ url, method: 'GET', responseType: 'stream' });
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    writer.on('finish', () => resolve(outputPath));
    writer.on('error', reject);
  });
};

// ===== دمج الفيديوهات =====
// TikTok فوق (70% من الشاشة) + Gameplay تحت (30%)
const mergeVideos = (tiktokPath, gameplayPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(tiktokPath)
      .input(gameplayPath)
      .complexFilter([
        // scale TikTok to 1080x1344 (70% of 1920)
        '[0:v]scale=1080:1344,setsar=1[top]',
        // scale gameplay to 1080x576 (30% of 1920)
        '[1:v]scale=1080:576,setsar=1[bottom]',
        // stack vertically
        '[top][bottom]vstack=inputs=2[out]',
        // audio from TikTok only
        '[0:a]aformat=sample_rates=44100[audio]'
      ])
      .outputOptions([
        '-map [out]',
        '-map [audio]',
        '-t 30',           // 30 ثانية بس
        '-c:v libx264',
        '-c:a aac',
        '-b:v 2000k',
        '-b:a 128k',
        '-r 30',
        '-shortest',
        '-y'
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error('فشل الدمج: ' + err.message)))
      .run();
  });
};

// ===== الـ API الرئيسي: إنشاء فيديو =====
app.post('/create-video', async (req, res) => {
  const { tiktokUrl, gameplayType = 'minecraft' } = req.body;

  if (!tiktokUrl) {
    return res.status(400).json({ error: 'محتاج tiktokUrl' });
  }

  const id = uuidv4();
  const tiktokPath = path.join(TMP, `${id}_tiktok.mp4`);
  const gameplayPath = path.join(TMP, `${id}_gameplay.mp4`);
  const outputPath = path.join(TMP, `${id}_output.mp4`);

  console.log(`🎬 بدأ إنشاء فيديو: ${id}`);

  try {
    // 1. حمّل TikTok
    console.log('⬇️ جاري تحميل TikTok...');
    await downloadTikTok(tiktokUrl, tiktokPath);

    // 2. حمّل Gameplay
    console.log('⬇️ جاري تحميل Gameplay...');
    await downloadGameplay(gameplayType, gameplayPath);

    // 3. ادمج الفيديوهات
    console.log('🎞️ جاري الدمج...');
    await mergeVideos(tiktokPath, gameplayPath, outputPath);

    // 4. ابعت الفيديو
    console.log('✅ تم! جاري الإرسال...');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="doubley_${id}.mp4"`);

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);

    stream.on('end', () => {
      // امسح الملفات المؤقتة
      [tiktokPath, gameplayPath, outputPath].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
      console.log(`🗑️ تم مسح الملفات المؤقتة: ${id}`);
    });

  } catch (err) {
    console.error('❌ خطأ:', err.message);
    // امسح الملفات لو فيه خطأ
    [tiktokPath, gameplayPath, outputPath].forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    res.status(500).json({ error: err.message });
  }
});

// ===== Gameplay Types المتاحة =====
app.get('/gameplay-types', (req, res) => {
  res.json({
    types: Object.keys(GAMEPLAY_VIDEOS).filter(k => k !== 'default'),
  });
});

// ===== تشغيل السيرفر =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Double Y Server شغال على port ${PORT}`);
  checkDeps();
});
