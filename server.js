const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
 
const TG_TOKEN = '8533430060:AAESdECgPoyCxSTmpgLUd0izhX7sP6iDTQs';
const KST = 9 * 3600000;
 
let schedules = [];
let settings = {
  briefOn: true, briefTime: '09:00', briefPlace: true, briefWeather: true,
  reminders: [
    {id:1, h:2, m:0, park:false, wx:false, nav:false},
    {id:2, h:1, m:0, park:true, wx:true, nav:false}
  ]
};
let sent = new Set();
let tgChats = {};
 
async function tg(chatId, msg) {
  if (!chatId || chatId === 'skip') return;
  try {
    await fetch('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: chatId, text: msg, parse_mode: 'HTML'})
    });
    console.log('[TG→' + chatId + '] ' + msg.slice(0, 50));
  } catch(e) {
    console.log('[TG 오류] ' + e.message);
  }
}
 
function fmtT(t) {
  const p = t.split(':').map(Number);
  const h = p[0], m = p[1];
  const ap = h >= 12 ? '오후' : '오전';
  const h12 = h > 12 ? h-12 : (h === 0 ? 12 : h);
  return ap + ' ' + h12 + '시' + (m ? ' ' + m + '분' : '');
}
 
function wIco(c) {
  if (c === 0) return '☀️';
  if (c <= 2) return '⛅';
  if (c <= 3) return '☁️';
  if (c <= 48) return '🌫️';
  if (c <= 65) return '🌧️';
  if (c <= 77) return '🌨️';
  return '⛈️';
}
 
function kstNow() { return new Date(Date.now() + KST); }
function pad(n) { return String(n).padStart(2, '0'); }
function kstDate(d) {
  const k = new Date(d.getTime() + KST);
  return k.getUTCFullYear() + '-' + pad(k.getUTCMonth()+1) + '-' + pad(k.getUTCDate());
}
 
async function fetchWx(date) {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&hourly=temperature_2m,weathercode&timezone=Asia/Seoul&start_date=' + date + '&end_date=' + date;
    const r = await fetch(url);
    const d = await r.json();
    const wxMap = {};
    d.hourly.time.forEach((t, i) => {
      const h = parseInt(t.split('T')[1].split(':')[0]);
      wxMap[h] = {temp: Math.round(d.hourly.temperature_2m[i]), code: d.hourly.weathercode[i]};
    });
    return wxMap;
  } catch(e) {
    console.log('[날씨 오류] ' + e.message);
    return null;
  }
}
 
async function tick() {
  const now = Date.now();
  const kst = kstNow();
  console.log('[체크] KST ' + kst.toUTCString() + ' | 일정: ' + schedules.length + '개 | 유저: ' + Object.keys(tgChats).length + '명');
 
  // 각 유저별로 처리
  for (const [userId, userData] of Object.entries(tgChats)) {
    const userScheds = schedules.filter(s => s.userId === userId && !s.done);
    const userSettings = userData.settings || settings;
    const chatId = userData.chatId;
 
    for (const s of userScheds) {
      const schedMs = new Date(s.date + 'T' + s.time + ':00+09:00').getTime();
      const reminders = userSettings.reminders || settings.reminders;
 
      for (const r of reminders) {
        const offset = (r.h * 3600 + r.m * 60) * 1000;
        const remMs = schedMs - offset;
        const key = userId + '-' + s.id + '-' + r.id;
        const diff = Math.abs(now - remMs);
 
        if (diff < 90000 && !sent.has(key)) {
          sent.add(key);
          const lbl = r.h > 0 ? (r.m > 0 ? r.h+'시간 '+r.m+'분' : r.h+'시간') : r.m+'분';
          let msg = '⏰ <b>' + lbl + ' 전 알림 멍!</b>\n\n📌 ' + s.title + '\n🕐 ' + fmtT(s.time);
          if (s.place) msg += '\n📍 ' + s.place;
 
          // 날씨 추가
          if (r.wx) {
            const wxMap = await fetchWx(s.date);
            const sHour = parseInt(s.time.split(':')[0]);
            if (wxMap && wxMap[sHour]) {
              msg += '\n🌤 날씨: ' + wIco(wxMap[sHour].code) + ' ' + wxMap[sHour].temp + '°C';
            }
          }
 
          // 주차 카카오맵 링크
          if (r.park && s.place) {
            msg += '\n🅿 주차 찾기 → https://map.kakao.com/link/search/' + encodeURIComponent(s.place + ' 주차장');
          }
 
          // 길안내
          if (r.nav && s.place) {
            msg += '\n🗺 길안내 → https://map.kakao.com/link/to/' + encodeURIComponent(s.place);
          }
 
          await tg(chatId, msg);
          console.log('[알림] ' + s.title + ' ' + lbl + ' 전 → ' + chatId);
        }
      }
    }
 
    // 아침 브리핑
    const h = kst.getUTCHours();
    const m = kst.getUTCMinutes();
    const bt = (userSettings.briefTime || settings.briefTime).split(':').map(Number);
    const today = kstDate(new Date());
    const bkey = userId + '-brief-' + today;
 
    if ((userSettings.briefOn !== false) && h === bt[0] && m === bt[1] && !sent.has(bkey)) {
      sent.add(bkey);
      const list = schedules.filter(s => s.userId === userId && s.date === today && !s.done)
        .sort((a, b) => a.time.localeCompare(b.time));
 
      if (list.length > 0) {
        const showWx = userSettings.briefWeather !== false;
        let wxMap = null;
        if (showWx) wxMap = await fetchWx(today);
 
        const body = list.map(s => {
          const sHour = parseInt(s.time.split(':')[0]);
          let line = '• ' + fmtT(s.time) + ' ' + s.title;
          if (userSettings.briefPlace !== false && s.place) line += ' (' + s.place + ')';
          if (wxMap && wxMap[sHour]) line += ' ' + wIco(wxMap[sHour].code) + ' ' + wxMap[sHour].temp + '°';
          return line;
        }).join('\n');
 
        await tg(chatId, '☀️ <b>좋은 아침이에요 멍!</b>\n오늘 일정 ' + list.length + '건:\n\n' + body);
        console.log('[브리핑] ' + userId + ' ' + list.length + '건');
      }
    }
  }
 
  // 단일 유저 모드 (이전 버전 호환)
  const legacyScheds = schedules.filter(s => !s.userId && !s.done);
  if (legacyScheds.length > 0) {
    for (const s of legacyScheds) {
      const schedMs = new Date(s.date + 'T' + s.time + ':00+09:00').getTime();
      for (const r of settings.reminders) {
        const offset = (r.h * 3600 + r.m * 60) * 1000;
        const remMs = schedMs - offset;
        const key = s.id + '-' + r.id;
        const diff = Math.abs(now - remMs);
        if (diff < 90000 && !sent.has(key)) {
          sent.add(key);
          const lbl = r.h > 0 ? (r.m > 0 ? r.h+'시간 '+r.m+'분' : r.h+'시간') : r.m+'분';
          let msg = '⏰ <b>' + lbl + ' 전 알림 멍!</b>\n\n📌 ' + s.title + '\n🕐 ' + fmtT(s.time);
          if (s.place) msg += '\n📍 ' + s.place;
          if (r.wx) {
            const wxMap = await fetchWx(s.date);
            const sHour = parseInt(s.time.split(':')[0]);
            if (wxMap && wxMap[sHour]) msg += '\n🌤 날씨: ' + wIco(wxMap[sHour].code) + ' ' + wxMap[sHour].temp + '°C';
          }
          if (r.park && s.place) msg += '\n🅿 주차 찾기 → https://map.kakao.com/link/search/' + encodeURIComponent(s.place + ' 주차장');
          if (r.nav && s.place) msg += '\n🗺 길안내 → https://map.kakao.com/link/to/' + encodeURIComponent(s.place);
          // 기본 채팅 ID로 전송
          const defaultChat = Object.values(tgChats)[0]?.chatId || '';
          await tg(defaultChat, msg);
        }
      }
    }
  }
}
 
console.log('[시작] setInterval 등록...');
setInterval(tick, 30000);
console.log('[시작] setInterval 완료!');
 
// API
app.get('/', (req, res) => res.json({status:'🐾 마리비 작동중 멍!', schedules:schedules.length, kst:kstNow().toUTCString()}));
 
app.get('/schedules', (req, res) => res.json({schedules}));
 
app.post('/schedules', (req, res) => {
  const s = req.body;
  if (!s.id) s.id = Date.now();
  if (s.done === undefined) s.done = false;
  const i = schedules.findIndex(x => x.id == s.id);
  if (i >= 0) schedules[i] = s; else schedules.push(s);
  settings.reminders.forEach(r => {
    sent.delete(s.id + '-' + r.id);
    if (s.userId) sent.delete(s.userId + '-' + s.id + '-' + r.id);
  });
  console.log('[저장] ' + s.title + ' (' + s.date + ' ' + s.time + ')' + (s.userId ? ' 유저:' + s.userId : ''));
  res.json({ok: true});
});
 
app.patch('/schedules/:id/done', (req, res) => {
  const s = schedules.find(x => x.id == req.params.id);
  if (s) s.done = true;
  res.json({ok: true});
});
 
app.delete('/schedules/:id', (req, res) => {
  schedules = schedules.filter(x => x.id != req.params.id);
  res.json({ok: true});
});
 
app.post('/settings', (req, res) => {
  const body = req.body;
  if (body.userId && body.chatId) {
    tgChats[body.userId] = {chatId: body.chatId, settings: body};
    console.log('[유저 등록] ' + body.userId + ' → ' + body.chatId);
  } else {
    settings = {...settings, ...body};
  }
  sent.clear();
  res.json({ok: true});
});
 
app.get('/settings', (req, res) => res.json(settings));
 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('[시작] 포트 ' + PORT + ' 멍!');
  // 등록된 모든 유저에게 알림
  setTimeout(async () => {
    for (const userData of Object.values(tgChats)) {
      await tg(userData.chatId, '🐾 <b>마리비 서버 재시작!</b>\n✅ 날씨 알림 정상 작동\n✅ 주차 카카오맵 링크 추가 왈왈!');
    }
  }, 2000);
});
