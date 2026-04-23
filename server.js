const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ───────────────────────────────────────────────────────────────
const STARTING_CHIPS = 1000;
const MAX_PLAYERS    = 5;
const BETTING_TIME   = 25;   // seconds
const TURN_TIME      = 30;   // seconds
const RESULTS_TIME   = 9000; // ms before next round
const SUITS  = ['♠','♥','♦','♣'];
const VALUES = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

// ─── Deck Helpers ─────────────────────────────────────────────────────────────
function createDeck(numDecks = 6) {
  const deck = [];
  for (let d = 0; d < numDecks; d++)
    for (const suit of SUITS)
      for (const value of VALUES)
        deck.push({ suit, value, id: `${d}${suit}${value}` });
  return deck;
}
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function cardScore(c) {
  if (c.value === 'A') return 11;
  if (['J','Q','K'].includes(c.value)) return 10;
  return parseInt(c.value);
}
function handScore(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += cardScore(c); if (c.value === 'A') aces++; }
  while (total > 21 && aces-- > 0) total -= 10;
  return total;
}
function isBlackjack(cards) { return cards.length === 2 && handScore(cards) === 21; }
function isRed(suit) { return suit === '♥' || suit === '♦'; }

// ─── Game State ───────────────────────────────────────────────────────────────
const state = {
  players: {},        // socketId → playerObj
  playerOrder: [],    // ordered array of socketIds
  dealer: { cards: [], hidden: true },
  deck: shuffle(createDeck()),
  phase: 'lobby',     // lobby | betting | dealing | playing | dealer | results
  currentIdx: -1,
  round: 0,
  epicHands: [],
  timers: {},
  countdowns: {},
};

function drawCard() {
  if (state.deck.length < 60) state.deck = shuffle(createDeck());
  return state.deck.pop();
}

// ─── Broadcast ────────────────────────────────────────────────────────────────
function publicPlayer(p) {
  return {
    id: p.id, nickname: p.nickname, chips: p.chips,
    bet: p.bet, cards: p.cards, score: handScore(p.cards),
    status: p.status, totalWon: p.totalWon, isAllIn: p.isAllIn,
  };
}
function publicDealer(hidden) {
  if (hidden) return { cards: [state.dealer.cards[0], { hidden: true }], score: null };
  return { cards: state.dealer.cards, score: handScore(state.dealer.cards) };
}
function broadcast() {
  const gs = {
    phase: state.phase,
    round: state.round,
    currentPlayerId: state.playerOrder[state.currentIdx] ?? null,
    dealer: publicDealer(state.dealer.hidden),
    players: Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, publicPlayer(p)])),
    playerOrder: state.playerOrder,
    epicHands: state.epicHands.slice(-15),
  };
  io.emit('gameState', gs);
}
function rankings() {
  return Object.values(state.players)
    .sort((a, b) => b.chips - a.chips)
    .map((p, i) => ({ rank: i + 1, nickname: p.nickname, chips: p.chips, totalWon: p.totalWon }));
}

// ─── Timers ───────────────────────────────────────────────────────────────────
function clearTimers() {
  Object.values(state.timers).forEach(t => clearTimeout(t));
  Object.values(state.countdowns).forEach(t => clearInterval(t));
  state.timers = {}; state.countdowns = {};
}
function startCountdown(key, seconds, onTick, onDone) {
  let left = seconds;
  onTick(left);
  state.countdowns[key] = setInterval(() => {
    left--;
    onTick(left);
    if (left <= 0) { clearInterval(state.countdowns[key]); onDone(); }
  }, 1000);
}

// ─── Epic Hands ───────────────────────────────────────────────────────────────
function addEpic(player, label, chips) {
  state.epicHands.push({
    round: state.round,
    nickname: player.nickname,
    hand: player.cards.map(c => c.value + c.suit).join(' '),
    score: handScore(player.cards),
    label,
    chips: Math.round(chips),
    ts: Date.now(),
  });
  if (state.epicHands.length > 30) state.epicHands.shift();
}

// ─── Phase Controllers ────────────────────────────────────────────────────────
function startBetting() {
  clearTimers();
  state.phase = 'betting';
  state.round++;
  state.dealer = { cards: [], hidden: true };
  state.currentIdx = -1;

  Object.values(state.players).forEach(p => {
    p.cards = []; p.bet = 0; p.isAllIn = false;
    p.status = p.chips > 0 ? 'betting' : 'broke';
  });

  broadcast();
  io.emit('phase', { phase: 'betting' });

  startCountdown('betting', BETTING_TIME,
    left => io.emit('countdown', { key: 'betting', left }),
    () => {
      // Auto-min bet for idle players
      Object.values(state.players).forEach(p => {
        if (p.status === 'betting' && p.chips >= 10) {
          p.chips -= 10; p.bet = 10; p.status = 'ready';
        } else if (p.status === 'betting') {
          p.status = 'broke';
        }
      });
      startDealing();
    }
  );
}

function startDealing() {
  clearTimers();
  state.phase = 'dealing';
  const active = state.playerOrder.filter(id => state.players[id]?.status === 'ready');

  if (active.length === 0) { startBetting(); return; }

  // Deal 2 cards each
  active.forEach(id => {
    state.players[id].cards = [drawCard(), drawCard()];
    state.players[id].status = 'waiting';
    if (isBlackjack(state.players[id].cards)) {
      state.players[id].status = 'blackjack';
      addEpic(state.players[id], '🎰 BLACKJACK!', state.players[id].bet * 1.5);
    }
  });
  state.dealer.cards = [drawCard(), drawCard()];
  state.dealer.hidden = true;

  broadcast();
  io.emit('phase', { phase: 'dealing' });

  state.timers.deal = setTimeout(() => {
    const turnOrder = active.filter(id => state.players[id]?.status === 'waiting');
    state.playerOrder = state.playerOrder; // keep original join order
    startPlaying(turnOrder);
  }, 2500);
}

function startPlaying(turnOrder) {
  state.phase = 'playing';
  state._turnOrder = turnOrder;
  state.currentIdx = 0;

  if (turnOrder.length === 0) { startDealerTurn(); return; }

  const firstId = turnOrder[0];
  if (state.players[firstId]) state.players[firstId].status = 'playing';

  broadcast();
  io.emit('phase', { phase: 'playing', currentPlayerId: firstId });
  io.to(firstId).emit('yourTurn', { timeLeft: TURN_TIME });

  startTurnTimer(firstId);
}

function startTurnTimer(playerId) {
  clearTimers();
  startCountdown('turn', TURN_TIME,
    left => io.emit('countdown', { key: 'turn', left, playerId }),
    () => {
      if (state.players[playerId]) {
        state.players[playerId].status = 'stood';
        io.emit('chat', { nickname: '🎰 Casino', message: `${state.players[playerId].nickname} pasó su turno`, system: true });
      }
      advanceTurn();
    }
  );
}

function advanceTurn() {
  clearTimers();
  state.currentIdx++;
  const order = state._turnOrder || [];
  if (state.currentIdx >= order.length) { startDealerTurn(); return; }

  const nextId = order[state.currentIdx];
  if (!state.players[nextId]) { advanceTurn(); return; }

  state.players[nextId].status = 'playing';
  broadcast();
  io.emit('phase', { phase: 'playing', currentPlayerId: nextId });
  io.to(nextId).emit('yourTurn', { timeLeft: TURN_TIME });
  startTurnTimer(nextId);
}

function startDealerTurn() {
  clearTimers();
  state.phase = 'dealer';
  state.dealer.hidden = false;
  broadcast();
  io.emit('phase', { phase: 'dealer' });

  function dealerHit() {
    const score = handScore(state.dealer.cards);
    if (score < 17) {
      state.dealer.cards.push(drawCard());
      broadcast();
      state.timers.dealerHit = setTimeout(dealerHit, 1100);
    } else {
      state.timers.resolve = setTimeout(resolveRound, 1200);
    }
  }
  state.timers.dealerStart = setTimeout(dealerHit, 1500);
}

function resolveRound() {
  clearTimers();
  state.phase = 'results';
  const dScore  = handScore(state.dealer.cards);
  const dBust   = dScore > 21;
  const dBJ     = isBlackjack(state.dealer.cards);

  Object.values(state.players).forEach(p => {
    if (!p.bet || p.status === 'broke') return;

    const pScore = handScore(p.cards);
    const pBust  = p.status === 'bust';
    const pBJ    = p.status === 'blackjack';
    let won = 0;

    if (pBust) {
      p.result = '💥 Bust'; won = 0;
    } else if (pBJ && dBJ) {
      p.result = '🤝 Push (ambos BJ)'; won = p.bet; p.chips += p.bet;
    } else if (pBJ) {
      p.result = '🎰 BLACKJACK!'; won = Math.floor(p.bet * 2.5); p.chips += won;
      addEpic(p, '🎰 BLACKJACK!', won - p.bet);
    } else if (dBJ) {
      p.result = '😱 Dealer BJ'; won = 0;
      addEpic(p, '😱 Dealer Blackjack', -p.bet);
    } else if (dBust) {
      p.result = '🎉 Dealer bust!'; won = p.bet * 2; p.chips += won;
      if (p.bet >= 100) addEpic(p, `🎉 Dealer bust! (+${won})`, won - p.bet);
    } else if (pScore > dScore) {
      p.result = '🏆 Ganaste!'; won = p.bet * 2; p.chips += won;
      if (p.isAllIn) addEpic(p, `🏆 ALL-IN ganado! (+${p.bet})`, p.bet);
    } else if (pScore === dScore) {
      p.result = '🤝 Push'; won = p.bet; p.chips += p.bet;
    } else {
      p.result = '😢 Perdiste'; won = 0;
      if (p.isAllIn) addEpic(p, `💀 ALL-IN perdido (-${p.bet})`, -p.bet);
    }

    p.totalWon += won;
    p.status = p.result;
  });

  broadcast();
  io.emit('phase', { phase: 'results', rankings: rankings() });
  io.emit('rankings', rankings());

  state.timers.nextRound = setTimeout(startBetting, RESULTS_TIME);
}

// ─── Socket Handlers ──────────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('join', ({ nickname }) => {
    nickname = (nickname || '').trim().slice(0, 18);
    if (!nickname) return socket.emit('joinError', { msg: 'Nickname inválido' });
    if (Object.keys(state.players).length >= MAX_PLAYERS)
      return socket.emit('joinError', { msg: 'Mesa llena (máximo 5 jugadores)' });
    if (Object.values(state.players).some(p => p.nickname === nickname))
      return socket.emit('joinError', { msg: 'Ese nickname ya está en uso' });

    state.players[socket.id] = {
      id: socket.id, nickname,
      chips: STARTING_CHIPS, bet: 0, isAllIn: false,
      cards: [], status: 'waiting', totalWon: 0, result: '',
    };
    if (!state.playerOrder.includes(socket.id)) state.playerOrder.push(socket.id);

    socket.emit('joined', { playerId: socket.id, chips: STARTING_CHIPS, phase: state.phase });
    io.emit('chat', { nickname: '🎰 Casino', message: `${nickname} entró al casino. ¡Bienvenido!`, system: true });
    broadcast();
    io.emit('rankings', rankings());
  });

  socket.on('startGame', () => {
    if (state.phase !== 'lobby') return;
    if (Object.keys(state.players).length < 1) return;
    startBetting();
  });

  socket.on('placeBet', ({ amount }) => {
    const p = state.players[socket.id];
    if (!p || state.phase !== 'betting' || p.status !== 'betting') return;
    amount = parseInt(amount);
    if (isNaN(amount) || amount <= 0 || amount > p.chips) return;
    p.chips -= amount; p.bet = amount; p.status = 'ready';
    io.emit('chat', { nickname: '🎰 Casino', message: `${p.nickname} apostó ${amount} fichas`, system: true });
    broadcast();
  });

  socket.on('allIn', () => {
    const p = state.players[socket.id];
    if (!p || state.phase !== 'betting') return;
    if (p.chips <= 0) return;
    const total = p.chips + p.bet;
    p.chips = 0; p.bet = total; p.isAllIn = true; p.status = 'ready';
    io.emit('chat', { nickname: '🎰 Casino', message: `🚨 ${p.nickname} va ALL-IN con ${total} fichas!!`, system: true, special: 'allIn' });
    broadcast();
    io.emit('allInAlert', { nickname: p.nickname, bet: total });
  });

  socket.on('hit', () => {
    const p = state.players[socket.id];
    if (!p || state.phase !== 'playing') return;
    if ((state._turnOrder || [])[state.currentIdx] !== socket.id) return;
    if (p.status !== 'playing') return;

    p.cards.push(drawCard());
    const score = handScore(p.cards);
    if (score > 21) {
      p.status = 'bust';
      if (p.bet >= 100) addEpic(p, `💥 Bust con ${p.bet} fichas`, -p.bet);
      io.emit('chat', { nickname: '🎰 Casino', message: `💥 ${p.nickname} se pasó (${score})`, system: true });
      broadcast();
      setTimeout(advanceTurn, 700);
    } else if (score === 21) {
      p.status = 'stood';
      broadcast();
      setTimeout(advanceTurn, 700);
    } else {
      broadcast();
    }
  });

  socket.on('stand', () => {
    const p = state.players[socket.id];
    if (!p || state.phase !== 'playing') return;
    if ((state._turnOrder || [])[state.currentIdx] !== socket.id) return;
    p.status = 'stood';
    broadcast();
    advanceTurn();
  });

  socket.on('double', () => {
    const p = state.players[socket.id];
    if (!p || state.phase !== 'playing') return;
    if ((state._turnOrder || [])[state.currentIdx] !== socket.id) return;
    if (p.cards.length !== 2) return;

    const extra = Math.min(p.bet, p.chips);
    p.chips -= extra; p.bet += extra;
    p.cards.push(drawCard());
    const score = handScore(p.cards);
    p.status = score > 21 ? 'bust' : 'stood';
    if (score > 21) addEpic(p, `💥 Doble bust (${score})`, -p.bet);
    broadcast();
    setTimeout(advanceTurn, 900);
  });

  socket.on('reloadChips', () => {
    const p = state.players[socket.id];
    if (!p || p.chips > 0 || p.bet > 0) return;
    p.chips = STARTING_CHIPS;
    socket.emit('chipsReloaded', { chips: STARTING_CHIPS });
    io.emit('chat', { nickname: '🎰 Casino', message: `${p.nickname} recargó fichas 💰`, system: true });
    broadcast();
  });

  socket.on('chat', ({ message }) => {
    const p = state.players[socket.id];
    if (!p || !message?.trim()) return;
    io.emit('chat', { nickname: p.nickname, message: message.trim().slice(0, 200), system: false, ts: Date.now() });
  });

  socket.on('disconnect', () => {
    const p = state.players[socket.id];
    if (!p) return;
    io.emit('chat', { nickname: '🎰 Casino', message: `${p.nickname} abandonó la mesa`, system: true });
    const wasPlaying = state.phase === 'playing' &&
      (state._turnOrder || [])[state.currentIdx] === socket.id;
    delete state.players[socket.id];
    state.playerOrder = state.playerOrder.filter(id => id !== socket.id);
    if (state._turnOrder) state._turnOrder = state._turnOrder.filter(id => id !== socket.id);
    if (wasPlaying) advanceTurn();
    broadcast();
    io.emit('rankings', rankings());
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🎰 Blackjack Royale → http://localhost:${PORT}`));
