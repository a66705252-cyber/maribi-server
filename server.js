const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
 
const TG_TOKEN = '8533430060:AAESdECgPoyCxSTmpgLUd0izhX7sP6iDTQs';
const TG_CHAT = '1447494393';
const KST = 9 * 3600000;
 
let schedules = [];
let settings = {
  briefOn: true, briefTime: '09:00', briefPlace: true,
  reminders: [
    {id:1, h:2, m:0, park:false},
    {id:2, h:1, m:0, park:true}
  ]
};
let sent = new Set();
 
async function tg(msg) {
  try {
    await fetch('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: TG_CHAT, text: msg, parse_mode: 'HTML'})
    });
    console.log('[TG 전송] ' + msg.slice(0,50));
  } catch(e) {
    console.log('[TG 오류] ' + e.message);
  }
}
 
function fmtT(t) {
  const p = t.split(':').map(Number);
  const h = p[0], m = p[1];
  const ap = h >= 12 ? '오후' : '오전';
  const h12 = h > 12 ? h-12 : (h===0 ? 12 : h);
  return ap + ' ' + h12 + '시' + (m ? ' ' + m + '분' : '');
}
 
function kstNow() {
  return new Date(Date.now() + KST);
}
 
function kstDate(d) {
  const k = new Date(d.getTime() + KST);
  const y = k.getUTCFullYear();
  const mo = String(k.getUTCMonth()+1).padStart(2,'0');
  const da = String(k.getUTCDate()).padStart(2,'0');
  return y + '-' + mo + '-' + da;
}
 
function wIco(c) {
  if(c===0) return '☀️';
  if(c<=2) return '⛅';
  if(c<=3) return '☁️';
  if(c<=48) return '🌫️';
  if(c<=65) return '🌧️';
  if(c<=77) return '🌨️';
  return '⛈️';
}
 
// 날씨 데이터 가져오기
async function fetchWeather(date) {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&hourly=temperature_2m,weathercode&timezone=Asia/Seoul&start_date=' + date + '&end_date=' + date;
    const r = await fetch(url);
    const d = await r.json();
    // 시간별 날씨 맵 만들기
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
 
async async function tick() {
  const now = Date.now();
  const kst = kstNow();
  console.log('[체크] ' + kst.toUTCString() + ' | 일정: ' + schedules.length + '개');
 
  // 리마인더 체크
  schedules.filter(s => !s.done).forEach(s => {
    const schedMs = new Date(s.date + 'T' + s.time + ':00+09:00').getTime();
    settings.reminders.forEach(r => {
      const offset = (r.h * 3600 + r.m * 60) * 1000;
      const remMs = schedMs - offset;
      const key = s.id + '-' + r.id;
      const diff = Math.abs(now - remMs);
      if (diff < 90000 && !sent.has(key)) {
        sent.add(key);
        const lbl = r.h > 0 ? (r.m > 0 ? r.h+'시간 '+r.m+'분' : r.h+'시간') : r.m+'분';
        let msg = '⏰ <b>' + lbl + ' 전 알림</b>\n\n📌 ' + s.title + '\n🕐 ' + fmtT(s.time);
        if (s.place) msg += '\n📍 ' + s.place;
        if (r.park && s.place) msg += '\n🅿 주차 정보를 미리 확인해 주십시오.';
        tg(msg);
        console.log('[알림 전송] ' + s.title + ' - ' + lbl + ' 전');
      }
    });
  });
 
  // 아침 브리핑 체크
  if (settings.briefOn) {
    const h = kst.getUTCHours();
    const m = kst.getUTCMinutes();
    const bp = settings.briefTime.split(':').map(Number);
    const today = kstDate(new Date());
    const bkey = 'brief-' + today;
    if (h === bp[0] && m === bp[1] && !sent.has(bkey)) {
      sent.add(bkey);
      const list = schedules.filter(s => s.date === today && !s.done)
        .sort((a,b) => a.time.localeCompare(b.time));
      if (list.length > 0) {
        // 날씨 데이터 가져오기
        const wxMap = await fetchWeather(today);
        const body = list.map(s => {
          const sHour = parseInt(s.time.split(':')[0]);
          let line = '• ' + fmtT(s.time) + ' ' + s.title;
          if (settings.briefPlace && s.place) line += ' (' + s.place + ')';
          // 해당 시간대 날씨 추가
          if (wxMap && wxMap[sHour]) {
            line += ' ' + wIco(wxMap[sHour].code) + ' ' + wxMap[sHour].temp + '°';
          }
          return line;
        }).join('\n');
        tg('☀️ <b>좋은 아침입니다!</b>\n오늘 일정 ' + list.length + '건:\n\n' + body);
        console.log('[브리핑] ' + list.length + '건 전송');
      }
    }
  }
}
 
console.log('[시작] setInterval 등록...');
setInterval(tick, 30000);
console.log('[시작] setInterval 완료!');
 
app.get('/', (req, res) => res.json({status:'🐾 작동중', schedules:schedules.length, kst:kstNow().toUTCString()}));
app.get('/schedules', (req, res) => res.json({schedules}));
app.post('/schedules', (req, res) => {
  const s = req.body;
  if (!s.id) s.id = Date.now();
  if (s.done === undefined) s.done = false;
  const i = schedules.findIndex(x => x.id == s.id);
  if (i >= 0) schedules[i] = s; else schedules.push(s);
  settings.reminders.forEach(r => sent.delete(s.id + '-' + r.id));
  console.log('[저장] ' + s.title + ' (' + s.date + ' ' + s.time + ')');
  res.json({ok:true});
});
app.patch('/schedules/:id/done', (req, res) => {
  const s = schedules.find(x => x.id == req.params.id);
  if (s) s.done = true;
  res.json({ok:true});
});
app.delete('/schedules/:id', (req, res) => {
  schedules = schedules.filter(x => x.id != req.params.id);
  res.json({ok:true});
});
app.post('/settings', (req, res) => {
  settings = {...settings, ...req.body};
  sent.clear();
  res.json({ok:true});
});
app.get('/settings', (req, res) => res.json(settings));
 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('[시작] 포트 ' + PORT);
  tg('🐾 <b>마리비 서버 업데이트!</b>\n✅ 아침 브리핑에 날씨 추가\n✅ 각 일정 시간대별 날씨 표시');
});
