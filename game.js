// === 레시피 (카페별로 다르면 여기 수정) ===
const DRINKS = [
  { name: 'Short Black', cup: 'S', defaultShots: 1, ingredients: [] },
  { name: 'Doppio',      cup: 'S', defaultShots: 2, ingredients: [] },
  { name: 'Macchiato',   cup: 'S', defaultShots: 1, ingredients: ['milk'] },
  { name: 'Piccolo',     cup: 'S', defaultShots: 1, ingredients: ['milk'] },
  { name: 'Magic',       cup: 'S', defaultShots: 2, ingredients: ['milk'] },
  { name: 'Flat White',  cup: 'M', defaultShots: 1, ingredients: ['milk'] },
  { name: 'Cappuccino',  cup: 'M', defaultShots: 1, ingredients: ['milk'] },
  { name: 'Mocha',       cup: 'M', defaultShots: 1, ingredients: ['milk', 'chocolate'] },
  { name: 'Latte',       cup: 'L', defaultShots: 1, ingredients: ['milk'] },
  { name: 'Long Black',  cup: 'L', defaultShots: 2, ingredients: ['hot_water'] },
];

const CUP_LABEL = { S: 'Small', M: 'Medium', L: 'Large' };
const ING_LABEL = { milk: 'Milk', hot_water: 'Hot Water', chocolate: 'Chocolate' };
const ING_EMOJI = { milk: '🥛', hot_water: '💧', chocolate: '🍫' };

// Visual / timing constants
const SHOT_FILL_PCT = 27;       // % cup fill per shot
const HOT_WATER_FILL_PCT = 25;  // additional % when hot water added
const MAX_CUP_FILL_PCT = 95;
const TOAST_DURATION_MS = 2600;

let state;
let gameStarted = false;
let toastTimer = null;
const orderCardCache = new Map();  // orderId -> { el, fill, info, ings }
const slotRefs = [[null, null], [null, null]];  // [station][cupIdx] -> { display, status, actions }

function emptyStation() {
  return {
    cups: [null, null],
    pulling: false,
    pullStart: 0,
    pullDuration: 0,
  };
}

function newCup(size) {
  return { cup: size, shots: 0, ingredients: [], targetShots: 0 };
}

function initState() {
  state = {
    score: 0,
    lives: 3,
    level: 1,
    streak: 0,
    bestStreak: 0,
    orders: [],
    nextOrderId: 1,
    stations: [emptyStation(), emptyStation()],
    held: null,
    lastOrderTime: 0,
    gameOver: false,
    nextLevelScore: 500,
  };
  orderCardCache.clear();
  document.getElementById('orders').innerHTML = '';
}

function levelConfig(level) {
  return {
    maxOrders: Math.min(1 + level, 5),
    orderInterval: Math.max(10000 - level * 700, 4500),
    orderTimeout: Math.max(60000 - level * 2700, 27000),
    pullDurationPerShot: Math.max(2200 - level * 100, 1400),
    tripleChance: Math.min(0.04 + level * 0.03, 0.18),
    doubleChance: Math.min(0.15 + level * 0.04, 0.35),
    showDetails: true,
  };
}

function generateOrder() {
  const cfg = levelConfig(state.level);
  const drink = DRINKS[Math.floor(Math.random() * DRINKS.length)];
  let shots = drink.defaultShots;
  let modLabel = '';
  const r = Math.random();
  if (drink.defaultShots === 1) {
    if (r < cfg.tripleChance) { shots = 3; modLabel = 'Triple'; }
    else if (r < cfg.tripleChance + cfg.doubleChance) { shots = 2; modLabel = 'Double'; }
  } else if (drink.defaultShots === 2) {
    if (r < cfg.tripleChance) { shots = 3; modLabel = 'Extra Shot'; }
  }
  return {
    id: state.nextOrderId++,
    name: drink.name,
    cup: drink.cup,
    shots,
    ingredients: [...drink.ingredients],
    modLabel,
    createdAt: Date.now(),
    timeout: cfg.orderTimeout,
  };
}

function maybeSpawnOrder() {
  if (state.gameOver) return;
  const cfg = levelConfig(state.level);
  const now = Date.now();
  if (state.orders.length < cfg.maxOrders && now - state.lastOrderTime > cfg.orderInterval) {
    state.orders.push(generateOrder());
    state.lastOrderTime = now;
  }
}

function updateOrders() {
  if (state.gameOver) return;
  const now = Date.now();
  for (let i = state.orders.length - 1; i >= 0; i--) {
    const o = state.orders[i];
    if (now - o.createdAt >= o.timeout) {
      state.orders.splice(i, 1);
      loseLife(`⏰ ${o.name} 주문 시간 초과`);
    }
  }
}

function loseLife(msg) {
  state.lives--;
  state.streak = 0;
  toast(msg, 'error');
  if (state.lives <= 0) endGame();
}

function endGame() {
  state.gameOver = true;
  document.getElementById('final-score').textContent = state.score;
  document.getElementById('final-level').textContent = state.level;
  document.getElementById('final-streak').textContent = state.bestStreak;
  document.getElementById('game-over').classList.add('active');
}

// === Station actions ===
function placeCupAt(stationIdx, cupSize) {
  if (state.gameOver || !gameStarted) return;
  const s = state.stations[stationIdx];
  if (s.pulling) { toast('머신 추출 중이에요', 'error'); return; }
  const empty = s.cups.findIndex(c => c === null);
  if (empty === -1) { toast('이 머신은 슬롯이 꽉 찼어요', 'error'); return; }
  s.cups[empty] = newCup(cupSize);
}

function pullAt(stationIdx) {
  if (state.gameOver) return;
  const s = state.stations[stationIdx];
  if (s.pulling) return;
  const present = s.cups.filter(c => c !== null);
  if (present.length === 0) { toast('컵이 없어요', 'error'); return; }
  const perCup = present.length === 1 ? 2 : 1;
  for (const c of present) {
    if (c.shots + perCup > 3) {
      toast('샷이 3개를 넘어가요! 컵을 정리하거나 추가하세요', 'error');
      return;
    }
  }
  for (const c of present) {
    c.targetShots = c.shots + perCup;
  }
  s.pulling = true;
  s.pullStart = Date.now();
  const cfg = levelConfig(state.level);
  s.pullDuration = cfg.pullDurationPerShot * 2;
}

function updatePulls() {
  const now = Date.now();
  for (const s of state.stations) {
    if (s.pulling && now - s.pullStart >= s.pullDuration) {
      s.pulling = false;
      for (const c of s.cups) {
        if (c) c.shots = c.targetShots;
      }
    }
  }
}

function addIngredientAt(stationIdx, cupIdx, ing) {
  if (state.gameOver) return;
  const s = state.stations[stationIdx];
  if (s.pulling) return;
  const c = s.cups[cupIdx];
  if (!c || c.shots === 0) return;
  if (c.ingredients.includes(ing)) {
    toast(`${ING_EMOJI[ing]} 이미 들어갔어요`, 'error');
    return;
  }
  c.ingredients.push(ing);
}

function takeCupAt(stationIdx, cupIdx) {
  if (state.gameOver) return;
  const s = state.stations[stationIdx];
  if (s.pulling) return;
  const c = s.cups[cupIdx];
  if (!c || c.shots === 0) return;
  if (state.held) { toast('이미 컵을 들고 있어요!', 'error'); return; }
  state.held = {
    cup: c.cup,
    shots: c.shots,
    ingredients: [...c.ingredients],
  };
  s.cups[cupIdx] = null;
}

function discardCupAt(stationIdx, cupIdx) {
  const s = state.stations[stationIdx];
  if (s.pulling) return;
  s.cups[cupIdx] = null;
}

function putHeldCupAt(stationIdx, cupIdx) {
  if (!state.held) return;
  const s = state.stations[stationIdx];
  if (s.pulling) { toast('머신 추출 중이에요', 'error'); return; }
  if (s.cups[cupIdx] !== null) return;
  s.cups[cupIdx] = {
    cup: state.held.cup,
    shots: state.held.shots,
    ingredients: [...state.held.ingredients],
    targetShots: state.held.shots,
  };
  state.held = null;
}

function discardHeld() { state.held = null; }

function ingredientsMatch(a, b) {
  if (a.length !== b.length) return false;
  return [...a].sort().join(',') === [...b].sort().join(',');
}

function describeIngredients(ings) {
  return ings.length === 0 ? '추가 없음' : ings.map(i => ING_EMOJI[i]).join(' ');
}

function serveTo(orderId) {
  if (!state.held) {
    toast('컵을 먼저 들어주세요 (✋ Take)', 'error');
    return;
  }
  const idx = state.orders.findIndex(o => o.id === orderId);
  if (idx === -1) return;
  const o = state.orders[idx];
  const cupOk = o.cup === state.held.cup;
  const shotsOk = o.shots === state.held.shots;
  const ingOk = ingredientsMatch(o.ingredients, state.held.ingredients);
  if (cupOk && shotsOk && ingOk) {
    const elapsed = Date.now() - o.createdAt;
    const remaining = Math.max(0, 1 - elapsed / o.timeout);
    const base = 100;
    const speedBonus = Math.floor(remaining * 100);
    const streakBonus = Math.floor(state.streak * 10);
    const total = base + speedBonus + streakBonus;
    state.score += total;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.orders.splice(idx, 1);
    state.held = null;
    toast(`+${total} · ${o.name} ✓`, 'success');
    while (state.score >= state.nextLevelScore) {
      state.level++;
      state.nextLevelScore += 500 + state.level * 100;
      toast(`🎉 Level ${state.level}!`, 'success');
    }
  } else {
    const wanted = `${o.name} = ${CUP_LABEL[o.cup]}, ${o.shots} shot${o.shots>1?'s':''}, ${describeIngredients(o.ingredients)}`;
    const got = `${CUP_LABEL[state.held.cup]} / ${state.held.shots} shot${state.held.shots>1?'s':''} / ${describeIngredients(state.held.ingredients)}`;
    state.held = null;
    loseLife(`❌ 틀림! 원했던건 ${wanted} · 줬던건 ${got}`);
  }
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + (type || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), TOAST_DURATION_MS);
}

// === Render: stations use static DOM, only update inner content/visibility ===

function initSlotRefs() {
  for (let s = 0; s < 2; s++) {
    const stEl = document.querySelector(`.station[data-station="${s}"]`);
    for (let i = 0; i < 2; i++) {
      const slot = stEl.querySelector(`.cup-slot[data-cup-index="${i}"]`);
      slotRefs[s][i] = {
        slot,
        display: slot.querySelector('.cup-display'),
        status: slot.querySelector('.cup-status'),
        actions: slot.querySelector('.cup-actions'),
      };
    }
  }
}

function buildCupActionButtons(actionsEl, cupIdx) {
  actionsEl.innerHTML = `
    <button class="action-btn ing-milk"  data-action="add"     data-cup-index="${cupIdx}" data-ing="milk">🥛</button>
    <button class="action-btn ing-water" data-action="add"     data-cup-index="${cupIdx}" data-ing="hot_water">💧</button>
    <button class="action-btn ing-choc"  data-action="add"     data-cup-index="${cupIdx}" data-ing="chocolate">🍫</button>
    <button class="action-btn take"      data-action="take"    data-cup-index="${cupIdx}">✋</button>
    <button class="action-btn discard"   data-action="discard" data-cup-index="${cupIdx}">×</button>
  `;
}

// Reuse cup-visual DOM across frames — only recreate when cup size changes
function renderCupVisual(display, c, fillPct) {
  let cv = display.firstElementChild;
  const isVisual = cv && cv.classList && cv.classList.contains('cup-visual');
  if (!isVisual || cv.dataset.size !== c.cup) {
    display.innerHTML = '';
    cv = document.createElement('div');
    cv.dataset.size = c.cup;
    const liquidEl = document.createElement('div');
    liquidEl.className = 'liquid';
    cv.appendChild(liquidEl);
    display.appendChild(cv);
  }
  cv.className = 'cup-visual ' + c.cup
    + (c.ingredients.includes('milk') ? ' has-milk' : '')
    + (c.ingredients.includes('chocolate') ? ' has-choc' : '');
  cv.firstElementChild.style.height = fillPct + '%';
}

function renderStation(stationIdx, now) {
  const s = state.stations[stationIdx];
  const stEl = document.querySelector(`.station[data-station="${stationIdx}"]`);
  stEl.classList.toggle('pulling', s.pulling);

  const present = s.cups.filter(c => c !== null);
  const presentCount = present.length;
  const perCupOnPull = presentCount === 1 ? 2 : 1;
  const wouldExceed = present.some(c => c.shots + perCupOnPull > 3);
  const canPull = !s.pulling && presentCount > 0 && !wouldExceed;
  const pullBtn = stEl.querySelector('.pull-btn');
  pullBtn.disabled = !canPull;
  if (s.pulling) {
    const prog = Math.min(100, Math.floor(100 * (now - s.pullStart) / s.pullDuration));
    pullBtn.textContent = `Pulling… ${prog}%`;
  } else {
    pullBtn.textContent = presentCount === 0
      ? 'PULL (컵 필요)'
      : presentCount === 1
        ? 'PULL (2 shots → 1 cup)'
        : 'PULL (split 1+1)';
  }

  // Disable place buttons based on availability
  const hasEmpty = s.cups.some(c => c === null);
  stEl.querySelectorAll('.place-row .action-btn').forEach(b => {
    b.disabled = s.pulling || !hasEmpty;
  });

  for (let i = 0; i < 2; i++) {
    const { slot, display, status, actions } = slotRefs[stationIdx][i];
    const c = s.cups[i];

    if (!c) {
      slot.classList.add('empty');
      const canPlace = !!state.held && !s.pulling;
      slot.classList.toggle('can-place', canPlace);
      const txt = canPlace ? '👆 여기 놓기' : '컵 없음';
      // Only rewrite if changed
      if (display.firstElementChild && display.firstElementChild.className === 'empty-slot-text') {
        if (display.firstElementChild.textContent !== txt) display.firstElementChild.textContent = txt;
      } else {
        display.innerHTML = `<div class="empty-slot-text"></div>`;
        display.firstElementChild.textContent = txt;
      }
      if (status.textContent !== '') status.textContent = '';
      if (actions.firstChild) actions.innerHTML = '';
      continue;
    }

    slot.classList.remove('empty', 'can-place');
    if (!actions.firstChild) buildCupActionButtons(actions, i);

    // Cup fill calculation
    let fillPct = c.shots * SHOT_FILL_PCT;
    if (s.pulling) {
      const progress = Math.min(1, (now - s.pullStart) / s.pullDuration);
      fillPct += (c.targetShots - c.shots) * SHOT_FILL_PCT * progress;
    }
    if (c.ingredients.includes('hot_water')) fillPct += HOT_WATER_FILL_PCT;
    fillPct = Math.min(MAX_CUP_FILL_PCT, fillPct);

    renderCupVisual(display, c, fillPct);

    // Status text
    let statusText;
    if (s.pulling && c.targetShots > c.shots) {
      statusText = `Pulling → ${c.targetShots} shot${c.targetShots>1?'s':''}`;
    } else if (c.shots > 0) {
      const ingTxt = c.ingredients.length > 0 ? ' + ' + c.ingredients.map(i => ING_EMOJI[i]).join(' ') : '';
      statusText = `${CUP_LABEL[c.cup]} · ${c.shots}shot${ingTxt}`;
    } else {
      statusText = `${CUP_LABEL[c.cup]} cup`;
    }
    if (status.textContent !== statusText) status.textContent = statusText;

    // Button enable/disable
    const noShots = c.shots === 0;
    actions.querySelectorAll('button').forEach(b => {
      const a = b.dataset.action;
      if (a === 'add' || a === 'take') b.disabled = noShots || s.pulling;
      else if (a === 'discard') b.disabled = s.pulling;
    });
  }
}

function renderOrders(now) {
  const ordersEl = document.getElementById('orders');
  const currentIds = new Set(state.orders.map(o => o.id));

  // Remove gone cards
  for (const [id, entry] of orderCardCache.entries()) {
    if (!currentIds.has(id)) {
      entry.el.remove();
      orderCardCache.delete(id);
    }
  }

  // Add new + update existing
  for (const o of state.orders) {
    let entry = orderCardCache.get(o.id);
    if (!entry) {
      const card = document.createElement('div');
      card.className = 'order';
      card.dataset.orderId = o.id;
      // Build via DOM API (defensive, even though o.name comes from hardcoded DRINKS)
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = o.name;
      card.appendChild(nameEl);
      if (o.modLabel) {
        const modEl = document.createElement('div');
        modEl.className = 'mod';
        modEl.textContent = o.modLabel;
        card.appendChild(modEl);
      }
      const infoEl = document.createElement('div');
      infoEl.className = 'info';
      infoEl.textContent = `${CUP_LABEL[o.cup]}, ${o.shots} shot${o.shots>1?'s':''}`;
      card.appendChild(infoEl);
      const ingsEl = document.createElement('div');
      ingsEl.className = 'ings';
      ingsEl.textContent = o.ingredients.length ? o.ingredients.map(i => ING_EMOJI[i]).join(' ') : '–';
      card.appendChild(ingsEl);
      const timerEl = document.createElement('div');
      timerEl.className = 'timer';
      const fillEl = document.createElement('div');
      fillEl.className = 'timer-fill';
      timerEl.appendChild(fillEl);
      card.appendChild(timerEl);

      ordersEl.appendChild(card);
      entry = { el: card, fill: fillEl };
      orderCardCache.set(o.id, entry);
    }
    entry.el.classList.toggle('servable', !!state.held);
    const pct = Math.max(0, 100 * (1 - (now - o.createdAt) / o.timeout));
    entry.fill.style.width = pct + '%';
    const newCls = 'timer-fill' + (pct < 25 ? ' danger' : pct < 50 ? ' warn' : '');
    if (entry.fill.className !== newCls) entry.fill.className = newCls;
  }

  // Empty placeholder
  let emptyEl = ordersEl.querySelector('.order-empty');
  if (state.orders.length === 0) {
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'order-empty';
      emptyEl.textContent = '주문 대기 중...';
      ordersEl.appendChild(emptyEl);
    }
  } else if (emptyEl) {
    emptyEl.remove();
  }
}

// Cache HUD refs (set after DOM available, see initSlotRefs caller)
let hudRefs = null;
function initHudRefs() {
  hudRefs = {
    score: document.getElementById('score'),
    lives: document.getElementById('lives'),
    level: document.getElementById('level'),
    streak: document.getElementById('streak'),
    held: document.getElementById('held-cup'),
    heldLabel: document.getElementById('held-cup-label'),
  };
}

function render(now) {
  // Only write to DOM if value changed (avoid unnecessary reflows)
  const scoreStr = String(state.score);
  if (hudRefs.score.textContent !== scoreStr) hudRefs.score.textContent = scoreStr;
  const livesStr = '❤'.repeat(state.lives) + '🖤'.repeat(Math.max(0, 3 - state.lives));
  if (hudRefs.lives.textContent !== livesStr) hudRefs.lives.textContent = livesStr;
  const levelStr = String(state.level);
  if (hudRefs.level.textContent !== levelStr) hudRefs.level.textContent = levelStr;
  const streakStr = String(state.streak);
  if (hudRefs.streak.textContent !== streakStr) hudRefs.streak.textContent = streakStr;

  renderOrders(now);
  renderStation(0, now);
  renderStation(1, now);

  if (state.held) {
    hudRefs.held.classList.add('active');
    const ingTxt = state.held.ingredients.length > 0
      ? ' + ' + state.held.ingredients.map(i => ING_EMOJI[i]).join(' ')
      : '';
    const heldText = `🥤 ${CUP_LABEL[state.held.cup]} · ${state.held.shots} shot${state.held.shots>1?'s':''}${ingTxt}`;
    if (hudRefs.heldLabel.textContent !== heldText) hudRefs.heldLabel.textContent = heldText;
  } else {
    hudRefs.held.classList.remove('active');
  }
}

// === Event handlers (attach once) ===
document.querySelectorAll('.station').forEach(stEl => {
  const idx = parseInt(stEl.dataset.station);
  stEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) {
      if (btn.disabled) return;
      const action = btn.dataset.action;
      if (action === 'place') placeCupAt(idx, btn.dataset.cup);
      else if (action === 'pull') pullAt(idx);
      else if (action === 'add') addIngredientAt(idx, parseInt(btn.dataset.cupIndex), btn.dataset.ing);
      else if (action === 'take') takeCupAt(idx, parseInt(btn.dataset.cupIndex));
      else if (action === 'discard') discardCupAt(idx, parseInt(btn.dataset.cupIndex));
      return;
    }
    // 빈 슬롯 클릭 → 들고 있는 컵 놓기
    if (state.held) {
      const slot = e.target.closest('.cup-slot');
      if (slot && slot.classList.contains('empty')) {
        putHeldCupAt(idx, parseInt(slot.dataset.cupIndex));
      }
    }
  });
});

document.getElementById('orders').addEventListener('click', (e) => {
  const card = e.target.closest('.order');
  if (!card) return;
  const id = parseInt(card.dataset.orderId);
  serveTo(id);
});

const supportsHover = window.matchMedia('(hover: hover)').matches;
if (supportsHover) {
  document.addEventListener('mousemove', (e) => {
    const held = document.getElementById('held-cup');
    if (!held.classList.contains('active')) return;
    held.style.left = (e.clientX + 14) + 'px';
    held.style.top = (e.clientY + 14) + 'px';
  });
}

document.getElementById('held-cup-drop').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state && state.held) discardHeld();
});

document.addEventListener('contextmenu', (e) => {
  if (state && state.held) {
    e.preventDefault();
    discardHeld();
  }
});

function startGame() {
  document.getElementById('start-screen').classList.remove('active');
  initState();
  gameStarted = true;
}

function restart() {
  document.getElementById('game-over').classList.remove('active');
  initState();
  gameStarted = true;
}

function toggleMenu() {
  const m = document.getElementById('menu-modal');
  m.classList.toggle('active');
  if (m.classList.contains('active')) {
    const tbody = document.getElementById('menu-tbody');
    tbody.innerHTML = DRINKS.map(d => {
      const ings = d.ingredients.length === 0 ? '–' : d.ingredients.map(i => ING_EMOJI[i] + ' ' + ING_LABEL[i]).join(', ');
      return `<tr><td><b>${d.name}</b></td><td>${CUP_LABEL[d.cup]}</td><td>${d.defaultShots} shot${d.defaultShots>1?'s':''}</td><td>${ings}</td></tr>`;
    }).join('');
  }
}

function gameLoop() {
  if (gameStarted && state && !state.gameOver) {
    const now = Date.now();
    maybeSpawnOrder();
    updateOrders();
    updatePulls();
    render(now);
  }
  // Game over: overlay covers the UI, no need to keep rendering.
  // Not started: start-screen overlay covers the UI.
  requestAnimationFrame(gameLoop);
}

initSlotRefs();
initHudRefs();
initState();
gameLoop();
