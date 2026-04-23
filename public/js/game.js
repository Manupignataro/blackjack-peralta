/* ═══════════════════════════════════════════════════════════
   BLACKJACK ROYALE — Client Game Logic
   ═══════════════════════════════════════════════════════════ */

const socket = io();
let myId    = null;
let myChips = 1000;
let myBet   = 0;
let phase   = 'lobby';
let gs      = null;
let soundOn = true;
let cdMax   = 25;

/* ─── Arc seat positions [left%, top%] within table-felt ──── */
const SEAT_POS = {
  1: [[50, 52]],
  2: [[24, 58], [76, 58]],
  3: [[11, 52], [50, 47], [89, 52]],
  4: [[7, 48], [28, 62], [72, 62], [93, 48]],
};

/* ─── Login Particles ────────────────────────────────────── */
(function initParticles() {
  const SUITS = ['♠','♥','♦','♣'];
  const container = document.getElementById('loginParticles');
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:absolute;left:${Math.random()*100}%;top:${Math.random()*100}%;
      font-size:${14+Math.random()*24}px;
      color:rgba(201,168,76,${0.05+Math.random()*0.12});
      animation:chipFloat ${3+Math.random()*4}s ${Math.random()*3}s ease-in-out infinite;
      pointer-events:none;`;
    el.textContent = SUITS[Math.floor(Math.random()*4)];
    container.appendChild(el);
  }
})();

/* ─── DOM Refs ────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const loginScreen    = $('loginScreen');
const gameScreen     = $('gameScreen');
const nicknameInput  = $('nicknameInput');
const joinBtn        = $('joinBtn');
const loginError     = $('loginError');
const startBtn       = $('startBtn');
const startPanel     = $('startPanel');
const bettingPanel   = $('bettingPanel');
const actionPanel    = $('actionPanel');
const betDisplay     = $('betDisplay');
const myBetCircle    = $('myBetCircle');
const myBetAmount    = $('myBetAmount');
const myCardsEl      = $('myCards');
const myScoreEl      = $('myScore');
const myNicknameEl   = $('myNickname');
const dealerCardsEl  = $('dealerCards');
const dealerScoreEl  = $('dealerScore');
const otherPlayersEl = $('otherPlayersRow');
const headerChips    = $('headerChips');
const roundBadge     = $('roundBadge');
const phaseDisplay   = $('phaseDisplay');
const chatMessages   = $('chatMessages');
const chatInput      = $('chatInput');
const sendBtn        = $('sendBtn');
const soundToggle    = $('soundToggle');
const allInOverlay   = $('allInOverlay');
const resultToast    = $('resultToast');
const countdownBar   = $('countdownBar');
const countdownFill  = $('countdownFill');
const countdownText  = $('countdownText');
const rankingList    = $('rankingList');
const epicList       = $('epicList');
const leaveBtn       = $('leaveBtn');
const sidePanel      = $('sidePanel');
const closePanelBtn  = $('closePanelBtn');
const reopenPanelBtn = $('reopenPanelBtn');
const reloadChipsBtn = $('reloadChipsBtn');

/* ─── Sound Init ─────────────────────────────────────────── */
document.addEventListener('click', () => sounds.init(), { once: true });
soundToggle.addEventListener('click', () => {
  soundOn = sounds.toggle();
  soundToggle.textContent = soundOn ? '🔊' : '🔇';
});

/* ─── Chat Panel Toggle ───────────────────────────────────── */
closePanelBtn.addEventListener('click', () => {
  sidePanel.classList.add('closed');
  reopenPanelBtn.classList.remove('hidden');
  sounds.buttonClick();
});
reopenPanelBtn.addEventListener('click', () => {
  sidePanel.classList.remove('closed');
  reopenPanelBtn.classList.add('hidden');
  sounds.buttonClick();
});

/* ─── Abandonar mesa ─────────────────────────────────────── */
leaveBtn.addEventListener('click', () => {
  if (!confirm('¿Seguro que querés abandonar la mesa?')) return;
  socket.disconnect();
  gameScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  nicknameInput.value = '';
  loginError.textContent = '';
  myId = null; myChips = 1000; myBet = 0; phase = 'lobby'; gs = null;
});

/* ─── Reload Chips ────────────────────────────────────────── */
reloadChipsBtn.addEventListener('click', () => {
  socket.emit('reloadChips');
  sounds.win();
  reloadChipsBtn.classList.add('hidden');
});
socket.on('chipsReloaded', ({ chips }) => {
  myChips = chips;
  headerChips.textContent = chips;
  reloadChipsBtn.classList.add('hidden');
  showResultToast('💰 +1000 fichas recargadas!', true);
});

/* ─── Tab Switching ──────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  if (!btn.dataset.tab) return;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.remove('hidden');
    sounds.buttonClick();
  });
});

/* ─── Login ──────────────────────────────────────────────── */
joinBtn.addEventListener('click', doJoin);
nicknameInput.addEventListener('keydown', e => e.key === 'Enter' && doJoin());
function doJoin() {
  const nick = nicknameInput.value.trim();
  if (!nick) { loginError.textContent = 'Escribe un apodo'; return; }
  sounds.buttonClick();
  socket.emit('join', { nickname: nick });
}
socket.on('joinError', ({ msg }) => { loginError.textContent = msg; });
socket.on('joined', ({ playerId, chips, phase: p }) => {
  myId = playerId; myChips = chips; phase = p;
  loginScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  sounds.init();
  updatePhaseUI(p);
  // Show share URL
  const hint = $('shareHint');
  if (hint) {
    const url = location.hostname === 'localhost'
      ? 'localhost:' + location.port : location.hostname;
    hint.innerHTML = `Comparte <strong>${url}</strong> con tus amigos`;
  }
});

/* ─── Start Game ─────────────────────────────────────────── */
startBtn.addEventListener('click', () => { sounds.buttonClick(); socket.emit('startGame'); });

/* ─── Betting ─────────────────────────────────────────────── */
document.querySelectorAll('.chip-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = parseInt(btn.dataset.val);
    if (myBet + val > myChips) return;
    myBet += val;
    betDisplay.textContent = myBet;
    sounds.chipPlace();
    myBetCircle.classList.add('has-bet');
    myBetAmount.textContent = myBet;
    flashEl(betDisplay);
  });
});
$('clearBetBtn').addEventListener('click', () => {
  myBet = 0; betDisplay.textContent = 0; myBetAmount.textContent = 0;
  myBetCircle.classList.remove('has-bet'); sounds.buttonClick();
});
$('confirmBetBtn').addEventListener('click', () => {
  if (myBet <= 0) return;
  socket.emit('placeBet', { amount: myBet });
  sounds.chipPlace(); bettingPanel.classList.add('hidden');
});
$('allInBtn').addEventListener('click', () => {
  socket.emit('allIn'); sounds.allIn(); bettingPanel.classList.add('hidden');
});

/* ─── Actions ─────────────────────────────────────────────── */
$('hitBtn').addEventListener('click', () => { socket.emit('hit'); sounds.buttonClick(); sounds.cardDeal(); });
$('standBtn').addEventListener('click', () => { socket.emit('stand'); sounds.buttonClick(); });
$('doubleBtn').addEventListener('click', () => { socket.emit('double'); sounds.buttonClick(); sounds.cardDeal(); });

/* ─── Chat ────────────────────────────────────────────────── */
sendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => e.key === 'Enter' && sendChat());
function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit('chat', { message: msg });
  chatInput.value = ''; sounds.buttonClick();
}
socket.on('chat', msg => {
  const div = document.createElement('div');
  div.className = 'chat-msg' + (msg.system ? ' system' : '') + (msg.special === 'allIn' ? ' allin-msg' : '');
  div.innerHTML = `<span class="msg-nick">${esc(msg.nickname)}:</span><span class="msg-text"> ${esc(msg.message)}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (sidePanel.classList.contains('closed') && !msg.system) {
    reopenPanelBtn.style.color = '#f0c040';
    setTimeout(() => reopenPanelBtn.style.color = '', 2000);
  }
});

/* ─── Game State ──────────────────────────────────────────── */
socket.on('gameState', state => {
  gs = state;
  renderDealer(state.dealer);
  renderOtherPlayers(state);
  renderMyArea(state);
  updateHeader(state);
  if (state.epicHands?.length) updateEpicHands(state.epicHands);
});

socket.on('phase', data => {
  phase = data.phase;
  updatePhaseUI(data.phase, data);
  if (data.phase === 'results' && data.rankings) updateRankings(data.rankings);
});

socket.on('countdown', ({ key, left, playerId }) => {
  if (key === 'betting') {
    showCountdown(left, cdMax, 'Tiempo para apostar');
  } else if (key === 'turn') {
    const p = gs?.players?.[playerId];
    const label = playerId === myId ? 'TU TURNO ⚡' : `Turno de ${p?.nickname || '...'}`;
    showCountdown(left, 30, label);
    if (left <= 5) sounds.tick();
  }
});

socket.on('yourTurn', ({ timeLeft }) => {
  cdMax = timeLeft;
  showCountdown(timeLeft, timeLeft, 'TU TURNO ⚡');
  flashPhase('TU TURNO ⚡');
  actionPanel.classList.remove('hidden');
  const me = gs?.players?.[myId];
  $('doubleBtn').disabled = !me || me.cards?.length !== 2 || me.chips < me.bet;
  sounds.cardDeal();
});

socket.on('allInAlert', ({ nickname, bet }) => {
  $('allInPlayer').textContent = nickname;
  $('allInAmount').textContent = `${bet} FICHAS`;
  allInOverlay.classList.remove('hidden');
  setTimeout(() => allInOverlay.classList.add('hidden'), 3000);
});

socket.on('rankings', updateRankings);

socket.on('playerJoined', ({ nickname }) => addSystemMsg(`${nickname} entró a la mesa`));
socket.on('playerLeft',   ({ nickname }) => addSystemMsg(`${nickname} salió de la mesa`));

/* ─── Render: Cards ───────────────────────────────────────── */
function renderCard(card, small = false) {
  if (!card) return '';
  if (card.hidden) return `<div class="card face-down${small ? ' sm' : ''}"></div>`;
  const red = card.suit === '♥' || card.suit === '♦';
  return `
    <div class="card face-up ${red ? 'red' : 'black'}${small ? ' sm' : ''}">
      <div class="card-tl"><span class="card-val">${card.value}</span><span class="card-s">${card.suit}</span></div>
      <div class="card-mid">${card.suit}</div>
      <div class="card-br"><span class="card-val">${card.value}</span><span class="card-s">${card.suit}</span></div>
    </div>`;
}

/* ─── Render: Dealer ──────────────────────────────────────── */
function renderDealer(dealer) {
  if (!dealer?.cards?.length) {
    dealerCardsEl.innerHTML = ''; dealerScoreEl.classList.add('hidden'); return;
  }
  dealerCardsEl.innerHTML = dealer.cards.map(c => renderCard(c)).join('');
  if (dealer.score !== null && dealer.score !== undefined) {
    dealerScoreEl.textContent = dealer.score;
    dealerScoreEl.className = 'score-badge' +
      (dealer.score > 21 ? ' bust' : dealer.score === 21 ? ' blackjack' : '');
    dealerScoreEl.classList.remove('hidden');
  } else {
    dealerScoreEl.classList.add('hidden');
  }
}

/* ─── Render: Other Players (arc) ─────────────────────────── */
function renderOtherPlayers(state) {
  const others = (state.playerOrder || []).filter(id => id !== myId && state.players[id]);
  const n = Math.min(others.length, 4);
  const positions = SEAT_POS[n] || SEAT_POS[4];
  const sizeClass = n >= 4 ? 'sz-sm' : n >= 3 ? 'sz-md' : '';

  otherPlayersEl.innerHTML = others.slice(0, 4).map((id, i) => {
    const p = state.players[id];
    const [lp, tp] = positions[i] || positions[positions.length - 1];
    const isPlaying = state.currentPlayerId === id;
    const statusCls = p.status === 'bust' ? 'bust' : p.status === 'blackjack' ? 'blackjack' : '';
    const cards = (p.cards || []).map(c => renderCard(c, true)).join('');
    return `
      <div class="player-seat ${isPlaying ? 'is-playing' : ''} ${statusCls} ${sizeClass}"
           style="left:${lp}%;top:${tp}%">
        ${isPlaying ? '<div class="turn-indicator">EN JUEGO</div>' : ''}
        <div class="seat-nickname">${esc(p.nickname)}</div>
        <div class="seat-chips">⬡ ${p.chips}</div>
        ${p.bet > 0 ? `<div class="seat-bet">Apuesta: ${p.bet}</div>` : ''}
        <div class="seat-cards">${cards}</div>
        ${p.score > 0 && p.cards?.length ? `<div class="seat-status">${p.score}</div>` : ''}
        ${p.result ? `<div class="seat-status">${p.result}</div>` : ''}
      </div>`;
  }).join('');
}

/* ─── Render: My Area ─────────────────────────────────────── */
let lastCardCount = 0;
let lastMyStatus  = '';

function renderMyArea(state) {
  const me = state.players?.[myId];
  if (!me) return;

  myChips = me.chips;
  headerChips.textContent = me.chips;
  myNicknameEl.textContent = me.nickname;

  // Cards
  const cardHTML = (me.cards || []).map(c => renderCard(c)).join('');
  if (myCardsEl.innerHTML !== cardHTML) {
    myCardsEl.innerHTML = cardHTML;
    if ((me.cards?.length || 0) > lastCardCount) sounds.cardDeal();
  }
  lastCardCount = me.cards?.length || 0;

  // Score
  if (me.score > 0 && me.cards?.length > 0) {
    myScoreEl.textContent = me.score;
    myScoreEl.className = 'score-badge' +
      (me.score > 21 ? ' bust' : me.score === 21 ? ' blackjack' : '');
    myScoreEl.classList.remove('hidden');
  } else {
    myScoreEl.classList.add('hidden');
  }

  // Bet circle
  myBetAmount.textContent = me.bet;
  myBetCircle.classList.toggle('has-bet', me.bet > 0);

  // Reload chips button — show only when broke and no active bet
  const showReload = me.chips === 0 && me.bet === 0;
  reloadChipsBtn.classList.toggle('hidden', !showReload);

  // Result sound (once per result phase)
  if (state.phase === 'results' && me.status && me.status !== lastMyStatus) {
    lastMyStatus = me.status;
    setTimeout(() => showResultToast(me.status), 500);
  }
  if (state.phase !== 'results') lastMyStatus = '';
}

function updateHeader(state) {
  roundBadge.textContent = state.round > 0 ? `Ronda ${state.round}` : 'Lobby';
  const me = state.players?.[myId];
  if (me) headerChips.textContent = me.chips;
}

/* ─── Phase UI ────────────────────────────────────────────── */
function updatePhaseUI(p, data = {}) {
  phase = p;
  startPanel.classList.add('hidden');
  bettingPanel.classList.add('hidden');
  actionPanel.classList.add('hidden');

  const labels = {
    lobby: '◆ Sala de espera ◆', betting: '◆ Fase de apuestas ◆',
    dealing: '◆ Repartiendo cartas ◆', playing: '◆ En juego ◆',
    dealer: '◆ Turno del dealer ◆', results: '◆ Resultados ◆',
  };
  phaseDisplay.textContent = labels[p] || p;

  if (p === 'lobby') {
    startPanel.classList.remove('hidden'); hideCountdown();
  } else if (p === 'betting') {
    myBet = 0; betDisplay.textContent = 0; myBetAmount.textContent = 0;
    myBetCircle.classList.remove('has-bet');
    bettingPanel.classList.remove('hidden'); cdMax = 25;
  } else if (p === 'playing') {
    if (gs?.currentPlayerId === myId) actionPanel.classList.remove('hidden');
  } else if (p === 'results') {
    hideCountdown();
    setTimeout(() => document.querySelector('[data-tab="ranking"]')?.click(), 1500);
  }
}

/* ─── Countdown ───────────────────────────────────────────── */
function showCountdown(left, max, label) {
  countdownBar.classList.remove('hidden');
  const pct = max > 0 ? (left / max) * 100 : 0;
  countdownFill.style.width = pct + '%';
  countdownFill.style.background = left <= 5
    ? 'linear-gradient(90deg, #e74c3c, #c0392b)'
    : 'linear-gradient(90deg, var(--gold), var(--gold-bright))';
  countdownText.textContent = `${label} — ${left}s`;
}
function hideCountdown() { countdownBar.classList.add('hidden'); }

/* ─── Rankings ────────────────────────────────────────────── */
function updateRankings(list) {
  rankingList.innerHTML = list.map(item => `
    <div class="ranking-item rank-${item.rank}">
      <span class="rank-num">${['🥇','🥈','🥉'][item.rank-1] || item.rank}</span>
      <span class="rank-nick">${esc(item.nickname)}</span>
      <span class="rank-chips">⬡ ${item.chips}</span>
    </div>`).join('');
}

/* ─── Epic Hands ──────────────────────────────────────────── */
function updateEpicHands(hands) {
  epicList.innerHTML = [...hands].reverse().map(h => {
    const sign = h.chips > 0 ? 'positive' : h.chips < 0 ? 'negative' : 'neutral';
    const prefix = h.chips > 0 ? '+' : '';
    return `
      <div class="epic-item">
        <div class="epic-round">RONDA ${h.round}</div>
        <div class="epic-player">${esc(h.nickname)}</div>
        <div class="epic-hand">${esc(h.hand)} (${h.score})</div>
        <div class="epic-label ${sign}">${esc(h.label)} ${h.chips !== 0 ? `(${prefix}${h.chips})` : ''}</div>
      </div>`;
  }).join('');
}

/* ─── Result Toast ────────────────────────────────────────── */
function showResultToast(status) {
  resultToast.textContent = status;
  resultToast.className = 'result-toast';
  if (status.includes('Ganaste') || status.includes('BLACKJACK') || status.includes('bust!') || status.includes('fichas')) {
    resultToast.classList.add('win');
    spawnParticles();
    if (status.includes('BLACKJACK')) sounds.blackjack();
    else if (status.includes('bust!')) sounds.dealerBust();
    else sounds.win();
  } else if (status.includes('Perdiste') || (status.includes('bust') && !status.includes('bust!')) || status.includes('BJ')) {
    resultToast.classList.add('lose');
    status.includes('bust') ? sounds.bust() : sounds.lose();
  } else if (status.includes('Push')) {
    resultToast.classList.add('push'); sounds.push();
  }
  resultToast.classList.remove('hidden');
  setTimeout(() => resultToast.classList.add('hidden'), 4000);
}

/* ─── Win Particles ───────────────────────────────────────── */
function spawnParticles() {
  const container = $('particles');
  const colors = ['#f0c040','#c9a84c','#2ecc71','#e74c3c','#9b59b6','#3498db','#f39c12'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 6 + Math.random() * 12;
    p.style.cssText = `
      left:${10+Math.random()*80}%;width:${size}px;height:${size}px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      border-radius:${Math.random()>0.5?'50%':'2px'};
      animation:fall ${1.5+Math.random()*2}s ${Math.random()*0.8}s ease-in forwards;`;
    container.appendChild(p);
    setTimeout(() => p.remove(), 4000);
  }
}

/* ─── Utilities ───────────────────────────────────────────── */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function flashEl(el) {
  el.style.transform = 'scale(1.3)';
  setTimeout(() => el.style.transform = '', 200);
}
function flashPhase(text) {
  phaseDisplay.textContent = text;
  phaseDisplay.style.color = '#f0c040';
  setTimeout(() => phaseDisplay.style.color = '', 2000);
}
function addSystemMsg(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.innerHTML = `<span class="msg-nick">🎰 Casino:</span><span class="msg-text"> ${esc(msg)}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
