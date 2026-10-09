/**
 * Duty Pass — Telegram Mini App Frontend
 * Высокопроизводительное SPA без сторонних фреймворков
 */

// Глобальное состояние приложения
const state = {
  chatId: null,
  allUsers: [],
  allLogs: [],
  currentTab: 'roster',
  searchQuery: '',
};

// Инициализация Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) {
    tg.setHeaderColor('#0d1117');
  }
  if (tg.enableClosingConfirmation) {
    tg.enableClosingConfirmation();
  }
}

// Тактильный отклик (Haptic Feedback)
function haptic(type = 'light') {
  if (!tg?.HapticFeedback) return;
  try {
    if (type === 'light') tg.HapticFeedback.impactOccurred('light');
    else if (type === 'medium') tg.HapticFeedback.impactOccurred('medium');
    else if (type === 'heavy') tg.HapticFeedback.impactOccurred('heavy');
    else if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
    else if (type === 'warning') tg.HapticFeedback.notificationOccurred('warning');
    else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
  } catch (e) {
    console.debug('Haptic feedback error:', e);
  }
}

// Всплывающие уведомления (Toast)
let toastTimeout = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.display = 'none';
  }, 2500);
}

// Извлечение chat_id из URL или Telegram initDataUnsafe
function resolveChatId() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromQuery = urlParams.get('chat_id');
  if (fromQuery) return parseInt(fromQuery, 10);

  // Fallback: из start_param (например, t.me/bot?startapp=-10012345678)
  if (tg?.initDataUnsafe?.start_param) {
    const parsed = parseInt(tg.initDataUnsafe.start_param, 10);
    if (!isNaN(parsed)) return parsed;
  }

  // Fallback: из контекста чата Telegram
  if (tg?.initDataUnsafe?.chat?.id) {
    return tg.initDataUnsafe.chat.id;
  }

  return null;
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
  state.chatId = resolveChatId();

  if (!state.chatId) {
    showNoChatWarning();
  } else {
    updateChatBadge();
    loadRoster();
  }

  setupEventListeners();
});

function showNoChatWarning() {
  document.getElementById('view-no-chat').style.display = 'block';
  document.getElementById('view-roster').style.display = 'none';
  document.getElementById('view-stats').style.display = 'none';
  document.getElementById('view-logs').style.display = 'none';
  document.getElementById('search-bar').style.display = 'none';
}

function updateChatBadge() {
  const badge = document.getElementById('chat-badge');
  if (badge && state.chatId) {
    badge.textContent = `Рота #${state.chatId}`;
  }
}

// Настройка событий интерфейса
function setupEventListeners() {
  // Навигация по табам в Dock Bar
  document.querySelectorAll('.dock-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      switchTab(tabName);
    });
  });

  // Кнопка быстрого добавления «+»
  document.getElementById('quick-add-btn')?.addEventListener('click', () => {
    haptic('medium');
    openAddModal();
  });

  document.querySelectorAll('.add-user-trigger').forEach((btn) => {
    btn.addEventListener('click', openAddModal);
  });

  // Модальное окно добавления бойца
  document.getElementById('close-modal-btn')?.addEventListener('click', closeAddModal);
  document.getElementById('cancel-add-btn')?.addEventListener('click', closeAddModal);

  document.getElementById('add-user-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleAddUserSubmit();
  });

  // Живой поиск
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search-btn');

  searchInput?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    clearSearchBtn.style.display = state.searchQuery ? 'block' : 'none';
    renderRosterCards();
  });

  clearSearchBtn?.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearSearchBtn.style.display = 'none';
    renderRosterCards();
  });

  // Кнопка обновления
  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    haptic('light');
    if (state.currentTab === 'roster') loadRoster();
    else if (state.currentTab === 'stats') loadRoster(true);
    else if (state.currentTab === 'logs') loadLogs();
  });

  // Очистка логов
  document.getElementById('clear-logs-btn')?.addEventListener('click', handleClearLogs);

  // Ручной ввод chat_id на экране ошибки
  document.getElementById('manual-chat-btn')?.addEventListener('click', () => {
    const inputVal = document.getElementById('manual-chat-input')?.value.trim();
    const parsed = parseInt(inputVal, 10);
    if (!isNaN(parsed) && parsed !== 0) {
      state.chatId = parsed;
      document.getElementById('view-no-chat').style.display = 'none';
      document.getElementById('search-bar').style.display = 'flex';
      updateChatBadge();
      switchTab('roster');
      loadRoster();
    } else {
      alert('Пожалуйста, введите корректный числовой ID чата (например, -100123456789)');
    }
  });

  // Закрытие выпадающих меню при клике вне
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.card-actions-dropdown')) {
      document.querySelectorAll('.actions-menu').forEach((menu) => {
        menu.style.display = 'none';
      });
    }
  });
}

// Переключение табов
function switchTab(tab) {
  state.currentTab = tab;
  haptic('light');

  document.querySelectorAll('.dock-item').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-tab') === tab);
  });

  const views = {
    roster: document.getElementById('view-roster'),
    stats: document.getElementById('view-stats'),
    logs: document.getElementById('view-logs'),
  };

  Object.keys(views).forEach((key) => {
    if (views[key]) {
      views[key].style.display = key === tab ? 'block' : 'none';
    }
  });

  // Поиск виден только во вкладке состава
  const searchBar = document.getElementById('search-bar');
  if (searchBar) {
    searchBar.style.display = tab === 'roster' ? 'flex' : 'none';
  }

  if (tab === 'roster') {
    renderRosterCards();
  } else if (tab === 'stats') {
    renderStatsView();
  } else if (tab === 'logs') {
    loadLogs();
  }
}

// Загрузка личного состава с сервера
async function loadRoster(silent = false) {
  if (!state.chatId) return;

  const usersListEl = document.getElementById('users-list');
  if (!silent && usersListEl) {
    usersListEl.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <span>Загрузка личного состава...</span>
      </div>
    `;
  }

  try {
    const res = await fetch(`/api/users?chat_id=${state.chatId}`);
    const data = await res.json();
    if (data.status === 'ok') {
      state.allUsers = data.users || [];
      updateTopMetrics();
      renderRosterCards();
      if (state.currentTab === 'stats') {
        renderStatsView();
      }
    } else {
      showToast('Ошибка загрузки данных');
    }
  } catch (err) {
    console.error('Ошибка загрузки пользователей:', err);
    showToast('Не удалось загрузить бойцов');
  }
}

// Обновление числовых метрик в шапке
function updateTopMetrics() {
  const totalUsers = state.allUsers.length;
  const totalUvals = state.allUsers.reduce((sum, u) => sum + (u.uval_count || 0), 0);
  const avgUvals = totalUsers > 0 ? (totalUvals / totalUsers).toFixed(1) : '0.0';

  const uEl = document.getElementById('chip-total-users');
  const uvEl = document.getElementById('chip-total-uvals');
  const avgEl = document.getElementById('chip-avg-uvals');

  if (uEl) uEl.textContent = totalUsers;
  if (uvEl) uvEl.textContent = totalUvals;
  if (avgEl) avgEl.textContent = avgUvals;
}

// Генерация монограммы и градиента аватарки
function getInitials(name) {
  if (!name) return '🎖';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Отрисовка списка карточек бойцов
function renderRosterCards() {
  const container = document.getElementById('users-list');
  const emptyState = document.getElementById('empty-users');
  if (!container) return;

  // Фильтрация поиском
  const filtered = state.allUsers.filter((u) => {
    if (!state.searchQuery) return true;
    const nameMatch = u.full_name?.toLowerCase().includes(state.searchQuery);
    const userMatch = u.username?.toLowerCase().includes(state.searchQuery);
    return nameMatch || userMatch;
  });

  if (filtered.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = state.allUsers.length === 0 ? 'flex' : 'none';
    if (state.allUsers.length > 0 && state.searchQuery) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>Ничего не найдено</h3>
          <p>По запросу «${state.searchQuery}» совпадений нет.</p>
        </div>
      `;
    }
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  container.innerHTML = filtered
    .map((u) => {
      const initials = getInitials(u.full_name);
      const isManual = u.user_id < 0;
      const subtitle = u.username
        ? `@${u.username}`
        : isManual
        ? 'Ручная запись'
        : `ID: ${u.user_id}`;

      return `
        <div class="user-card glass-card" id="user-card-${u.user_id}">
          <div class="user-info">
            <div class="user-avatar">${initials}</div>
            <div class="user-details">
              <span class="user-name">${escapeHtml(u.full_name)}</span>
              <span class="user-username">${escapeHtml(subtitle)}</span>
            </div>
          </div>

          <div class="user-controls">
            <div class="counter-pill">
              <button class="counter-btn minus-btn" onclick="handleUvalChange(${u.user_id}, -1)">−</button>
              <span class="counter-value" id="counter-val-${u.user_id}">${u.uval_count || 0}</span>
              <button class="counter-btn plus-btn" onclick="handleUvalChange(${u.user_id}, 1)">+</button>
            </div>

            <div class="card-actions-dropdown">
              <button class="action-icon-btn" onclick="toggleCardMenu(event, ${u.user_id})">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="1"></circle>
                  <circle cx="12" cy="5" r="1"></circle>
                  <circle cx="12" cy="19" r="1"></circle>
                </svg>
              </button>
              <div class="actions-menu" id="menu-${u.user_id}" style="display: none;">
                <button class="menu-item" onclick="handleDeleteUser(${u.user_id}, '${escapeQuote(u.full_name)}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                  Удалить
                </button>
                <button class="menu-item danger-item" onclick="handleBanUser(${u.user_id}, '${escapeQuote(u.full_name)}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                  </svg>
                  В чёрный список
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

// Переключение выпадающего меню карточки
window.toggleCardMenu = function (event, userId) {
  event.stopPropagation();
  const menu = document.getElementById(`menu-${userId}`);
  const isShown = menu.style.display === 'flex';

  document.querySelectorAll('.actions-menu').forEach((m) => {
    m.style.display = 'none';
  });

  if (!isShown) {
    menu.style.display = 'flex';
  }
};

// Мгновенное реактивное изменение счётчика увалов (+ / -)
window.handleUvalChange = async function (userId, delta) {
  haptic('light');

  const counterEl = document.getElementById(`counter-val-${userId}`);
  const targetUser = state.allUsers.find((u) => u.user_id === userId);

  // Оптимистичное локальное вычисление
  if (targetUser && counterEl) {
    const optimisticCount = Math.max(0, (targetUser.uval_count || 0) + delta);
    counterEl.textContent = optimisticCount;
    counterEl.classList.remove('pulse-up', 'pulse-down');
    void counterEl.offsetWidth; // Trigger reflow
    counterEl.classList.add(delta > 0 ? 'pulse-up' : 'pulse-down');
  }

  try {
    const res = await fetch('/api/uval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        chat_id: state.chatId,
        delta: delta,
      }),
    });

    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      // Обновляем точное значение из БД в массиве и DOM
      if (targetUser) {
        targetUser.uval_count = data.new_count;
      }
      if (counterEl) {
        counterEl.textContent = data.new_count;
      }
      updateTopMetrics();
      showToast(`${delta > 0 ? '+1' : '-1'} увал (${targetUser?.full_name || 'Боец'})`);
    } else {
      // Откат при ошибке
      if (targetUser && counterEl) {
        counterEl.textContent = targetUser.uval_count;
      }
      showToast(data.detail || 'Не удалось обновить');
    }
  } catch (err) {
    console.error('Ошибка изменения увала:', err);
    if (targetUser && counterEl) {
      counterEl.textContent = targetUser.uval_count;
    }
    showToast('Сетевая ошибка');
  }
};

// Удаление бойца из роты с плавной анимацией
window.handleDeleteUser = async function (userId, fullName) {
  haptic('warning');
  const confirmed = confirm(`Удалить бойца «${fullName}» из списка роты?`);
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/users/${userId}?chat_id=${state.chatId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      const cardEl = document.getElementById(`user-card-${userId}`);
      if (cardEl) {
        cardEl.classList.add('removing');
        setTimeout(() => {
          cardEl.remove();
          state.allUsers = state.allUsers.filter((u) => u.user_id !== userId);
          updateTopMetrics();
          if (state.allUsers.length === 0) renderRosterCards();
        }, 250);
      } else {
        state.allUsers = state.allUsers.filter((u) => u.user_id !== userId);
        updateTopMetrics();
        renderRosterCards();
      }
      showToast(`Боец ${fullName} удалён`);
      haptic('success');
    } else {
      showToast('Ошибка удаления');
    }
  } catch (err) {
    console.error('Ошибка удаления бойца:', err);
    showToast('Сетевая ошибка при удалении');
  }
};

// Внесение бойца в чёрный список (бан)
window.handleBanUser = async function (userId, fullName) {
  haptic('heavy');
  const confirmed = confirm(
    `Занести бойца «${fullName}» в чёрный список?\n\nОн будет удалён из списка и никогда не попадёт обратно даже при написании сообщений в чат.`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/users/ban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        chat_id: state.chatId,
      }),
    });
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      const cardEl = document.getElementById(`user-card-${userId}`);
      if (cardEl) {
        cardEl.classList.add('removing');
        setTimeout(() => {
          cardEl.remove();
          state.allUsers = state.allUsers.filter((u) => u.user_id !== userId);
          updateTopMetrics();
          if (state.allUsers.length === 0) renderRosterCards();
        }, 250);
      } else {
        state.allUsers = state.allUsers.filter((u) => u.user_id !== userId);
        updateTopMetrics();
        renderRosterCards();
      }
      showToast(`Боец ${fullName} внесён в чёрный список`);
      haptic('success');
    } else {
      showToast('Ошибка добавления в чёрный список');
    }
  } catch (err) {
    console.error('Ошибка бана бойца:', err);
    showToast('Сетевая ошибка');
  }
};

// Открытие и закрытие модального окна добавления
function openAddModal() {
  const modal = document.getElementById('add-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('new-fullname')?.focus();
  }
}

function closeAddModal() {
  const modal = document.getElementById('add-modal');
  if (modal) {
    modal.style.display = 'none';
    document.getElementById('add-user-form')?.reset();
  }
}

// Отправка формы ручного добавления бойца
async function handleAddUserSubmit() {
  const nameInput = document.getElementById('new-fullname');
  const usernameInput = document.getElementById('new-username');

  const fullName = nameInput?.value.trim();
  const username = usernameInput?.value.trim().replace(/^@/, '') || null;

  if (!fullName) {
    alert('Укажите ФИО или позывной бойца');
    return;
  }

  haptic('medium');

  try {
    const res = await fetch('/api/users/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: state.chatId,
        full_name: fullName,
        username: username,
      }),
    });

    const data = await res.json();
    if (res.ok && data.status === 'ok' && data.user) {
      state.allUsers.unshift(data.user);
      updateTopMetrics();
      closeAddModal();
      renderRosterCards();
      showToast(`Боец «${fullName}» добавлен`);
      haptic('success');
    } else {
      showToast('Не удалось добавить бойца');
    }
  } catch (err) {
    console.error('Ошибка добавления бойца:', err);
    showToast('Сетевая ошибка при добавлении');
  }
}

// Отрисовка вкладки «Мониторинг / Статистика»
function renderStatsView() {
  const activeCountEl = document.getElementById('stat-active-count');
  const zeroCountEl = document.getElementById('stat-zero-count');
  const leaderboardEl = document.getElementById('leaderboard-list');

  const activeCount = state.allUsers.reduce((sum, u) => sum + (u.uval_count || 0), 0);
  const zeroCount = state.allUsers.filter((u) => (u.uval_count || 0) === 0).length;

  if (activeCountEl) activeCountEl.textContent = activeCount;
  if (zeroCountEl) zeroCountEl.textContent = zeroCount;

  if (!leaderboardEl) return;

  if (state.allUsers.length === 0) {
    leaderboardEl.innerHTML = `<p class="empty-state" style="padding: 16px;">Личный состав пуст</p>`;
    return;
  }

  // Сортировка по количеству увалов (Топ-5)
  const topUsers = [...state.allUsers]
    .sort((a, b) => (b.uval_count || 0) - (a.uval_count || 0))
    .slice(0, 5);

  const maxVal = Math.max(1, topUsers[0]?.uval_count || 5);

  leaderboardEl.innerHTML = topUsers
    .map((u, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
      const pct = Math.min(100, Math.round(((u.uval_count || 0) / maxVal) * 100));

      return `
        <div class="leader-item">
          <div class="leader-info">
            <span class="leader-name">
              <span>${medal}</span>
              <span>${escapeHtml(u.full_name)}</span>
            </span>
            <span class="leader-val">${u.uval_count || 0} ув.</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

// Загрузка журнала действий (Logs)
async function loadLogs() {
  if (!state.chatId) return;

  const logsListEl = document.getElementById('logs-list');
  const emptyLogsEl = document.getElementById('empty-logs');

  if (logsListEl) {
    logsListEl.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <span>Загрузка журнала событий...</span>
      </div>
    `;
  }

  try {
    const res = await fetch(`/api/logs?chat_id=${state.chatId}`);
    const data = await res.json();

    if (data.status === 'ok') {
      state.allLogs = data.logs || [];
      renderLogs();
    } else {
      showToast('Ошибка загрузки журнала');
    }
  } catch (err) {
    console.error('Ошибка загрузки логов:', err);
    showToast('Сетевая ошибка при загрузке журнала');
  }
}

// Отрисовка журнала событий
function renderLogs() {
  const container = document.getElementById('logs-list');
  const emptyLogs = document.getElementById('empty-logs');
  if (!container) return;

  if (state.allLogs.length === 0) {
    container.innerHTML = '';
    if (emptyLogs) emptyLogs.style.display = 'flex';
    return;
  }

  if (emptyLogs) emptyLogs.style.display = 'none';

  container.innerHTML = state.allLogs
    .map((log) => {
      const isPos = log.delta > 0;
      const deltaClass = isPos ? 'positive' : 'negative';
      const deltaText = isPos ? `+${log.delta}` : `${log.delta}`;
      const timeFormatted = formatLogTime(log.created_at);

      return `
        <div class="log-entry">
          <div class="log-left">
            <span class="log-name">${escapeHtml(log.full_name)}</span>
            <span class="log-time">${escapeHtml(timeFormatted)}</span>
          </div>
          <div class="log-right">
            <span class="log-delta ${deltaClass}">${deltaText} ув.</span>
            <span class="log-balance">Остаток: ${log.new_count}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

// Форматирование времени для лога
function formatLogTime(timeStr) {
  if (!timeStr) return '';
  try {
    const parts = timeStr.split(' ');
    if (parts.length === 2) {
      const dateParts = parts[0].split('-');
      const timePart = parts[1].slice(0, 5); // HH:MM
      return `${dateParts[2]}.${dateParts[1]} в ${timePart}`;
    }
    return timeStr;
  } catch (e) {
    return timeStr;
  }
}

// Очистка журнала событий
async function handleClearLogs() {
  haptic('heavy');
  const confirmed = confirm('Вы уверены, что хотите полностью очистить журнал событий текущей роты?');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/logs/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: state.chatId }),
    });

    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      state.allLogs = [];
      renderLogs();
      showToast('Журнал роты очищен');
      haptic('success');
    } else {
      showToast('Ошибка при очистке журнала');
    }
  } catch (err) {
    console.error('Ошибка очистки логов:', err);
    showToast('Сетевая ошибка при очистке');
  }
}

// Вспомогательные функции экранирования XSS
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeQuote(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
