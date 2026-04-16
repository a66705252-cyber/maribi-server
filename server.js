const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const TG_TOKEN = process.env.TG_TOKEN || '8533430060:AAESdECgPoyCxSTmpgLUd0izhX7sP6iDTQs';
const TG_CHAT  = process.env.TG_CHAT  || '1447494393';
const TG_URL   = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;

// 메모리에 일정 저장 (Railway 무료플랜 기준)
let schedules = [];
let notiSettings = {
  briefOn: true,
  briefTime: '09:00',
  briefWeather: false,
  briefPlace: true,
  reminders: [
    { id: 1, h: 2, m: 0, park: false, wx: false, nav: false },
    { id: 2, h: 1, m: 0, park: true,  wx: false, nav: false }
  ]
};
let sentAlerts = new Set(); // 중복 알림 방지

// ── 텔레그램 전송 ──
async function tg(msg) {
  try {
    const r = await fetch(TG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' })
    });
    const d = await r.json();
    console.log('TG:', d.ok ? '✅' : '❌', msg.slice(0, 50));
  } catch (e) {
    console.error('TG 오류:', e.message);
  }
}

// ── 시간 포맷 ──
function fmtT(t) {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? '오후' : '오전';
  const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return `${ap} ${h12}시${m ? ` ${m}분` : ''}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function ds(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

// ── 리마인더 체크 (1분마다) ──
function checkReminders() {
  const now = new Date();
  const nowMs = now.getTime();

  schedules.filter(s => !s.done).forEach(s => {
    notiSettings.reminders.forEach(r => {
      const offsetMs = (r.h * 3600 + r.m * 60) * 1000;
      const schedTime = new Date(`${s.date}T${s.time}`).getTime();
      const remTime = schedTime - offsetMs;
      const alertKey = `${s.id}-${r.id}`;

      // 알림 시간 ±1분 이내이고 아직 안 보낸 경우
      if (Math.abs(nowMs - remTime) < 60000 && !sentAlerts.has(alertKey)) {
        sentAlerts.add(alertKey);
        const lbl = r.h > 0 ? (r.m > 0 ? `${r.h}시간 ${r.m}분` : `${r.h}시간`) : `${r.m}분`;
        let msg = `⏰ <b>${lbl} 전 알림</b>\n\n📌 ${s.title}\n🕐 ${fmtT(s.time)}`;
        if (s.place) msg += `\n📍 ${s.place}`;
        if (r.park && s.place) msg += `\n🅿 주차 정보를 미리 확인해 주십시오.`;
        if (r.nav && s.place) msg += `\n🗺 <a href="https://map.kakao.com/link/to/${encodeURIComponent(s.place)}">목적지 길안내 열기</a>`;
        tg(msg);
        console.log(`알림 전송: ${s.title} - ${lbl} 전`);
      }
    });
  });
}

// ── 아침 브리핑 체크 (1분마다) ──
function checkMorning() {
  if (!notiSettings.briefOn) return;
  const now = new Date();
  const [bh, bm] = notiSettings.briefTime.split(':').map(Number);
  const briefKey = `brief-${ds(now)}`;

  if (now.getHours() === bh && now.getMinutes() === bm && !sentAlerts.has(briefKey)) {
    sentAlerts.add(briefKey);
    const today = ds(now);
    const list = schedules.filter(s => s.date === today && !s.done)
      .sort((a, b) => a.time.localeCompare(b.time));

    if (list.length > 0) {
      const body = list.map(s =>
        `• ${fmtT(s.time)} ${s.title}${notiSettings.briefPlace && s.place ? ` (${s.place})` : ''}`
      ).join('\n');
      tg(`☀️ <b>좋은 아침입니다!</b>\n오늘 일정 ${list.length}건:\n\n${body}`);
      console.log(`아침 브리핑 전송: ${list.length}건`);
    }
  }
}

// 1분마다 체크
setInterval(() => {
  checkReminders();
  checkMorning();
}, 60000);

// ── API 엔드포인트 ──

// 일정 전체 조회
app.get('/schedules', (req, res) => {
  res.json({ schedules });
});

// 일정 저장 (앱에서 등록할 때)
app.post('/schedules', (req, res) => {
  const s = req.body;
  if (!s.id) s.id = Date.now();
  if (s.done === undefined) s.done = false;
  const idx = schedules.findIndex(x => x.id == s.id);
  if (idx >= 0) schedules[idx] = s;
  else schedules.push(s);
  // 이 일정의 알림 키 초기화 (재등록 시 다시 알림)
  notiSettings.reminders.forEach(r => sentAlerts.delete(`${s.id}-${r.id}`));
  console.log(`일정 저장: ${s.title} (${s.date} ${s.time})`);
  res.json({ ok: true, schedule: s });
});

// 일정 완료 처리
app.patch('/schedules/:id/done', (req, res) => {
  const s = schedules.find(x => x.id == req.params.id);
  if (s) { s.done = true; console.log(`완료: ${s.title}`); }
  res.json({ ok: true });
});

// 일정 삭제
app.delete('/schedules/:id', (req, res) => {
  schedules = schedules.filter(x => x.id != req.params.id);
  res.json({ ok: true });
});

// 알림 설정 저장
app.post('/settings', (req, res) => {
  notiSettings = { ...notiSettings, ...req.body };
  sentAlerts.clear(); // 설정 변경 시 알림 초기화
  console.log('설정 업데이트:', JSON.stringify(notiSettings).slice(0, 100));
  res.json({ ok: true });
});

// 알림 설정 조회
app.get('/settings', (req, res) => {
  res.json(notiSettings);
});

// 헬스체크
app.get('/', (req, res) => {
  res.json({
    status: '🐾 마리비 서버 작동 중',
    schedules: schedules.length,
    time: new Date().toLocaleString('ko-KR')
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🐾 마리비 서버 시작: 포트 ${PORT}`);
  tg('🐾 마리비 서버가 시작되었습니다!\n\n이제 폰이 꺼져있어도 알림이 옵니다 ✅');
});
