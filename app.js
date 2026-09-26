// ============================================================
// Автосервис Админ — Mini App для Telegram
// Данные хранятся локально (в браузере), синхронизация через файл в чате с ботом.
// ============================================================

// ---------- Инициализация Telegram WebApp ----------
const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();
}

// ---------- Данные ----------
let clients = [];
let orders = [];
let dataVersion = 0;

// ---------- Загрузка из локального хранилища ----------
function loadFromLocal() {
    try {
        const saved = localStorage.getItem('autoservice_data');
        if (saved) {
            const parsed = JSON.parse(saved);
            clients = parsed.clients || [];
            orders = parsed.orders || [];
            dataVersion = parsed.version || 0;
            console.log('✅ Данные загружены из локального хранилища');
        }
    } catch (e) {
        console.error('Ошибка загрузки:', e);
    }
}

// ---------- Сохранение в локальное хранилище ----------
function saveToLocal() {
    const data = {
        clients,
        orders,
        version: dataVersion,
        updatedAt: new Date().toISOString()
    };
    localStorage.setItem('autoservice_data', JSON.stringify(data));
    updateVersionDisplay();
}

// ---------- Обновление отображения версии ----------
function updateVersionDisplay() {
    const el = document.getElementById('versionText');
    if (el) el.textContent = `v${dataVersion}`;
}

// ---------- Обновление статуса ----------
function setStatus(text) {
    const el = document.getElementById('statusText');
    if (el) el.textContent = text;
}

// ---------- Рендер клиентов ----------
function renderClients() {
    const container = document.getElementById('clientsList');
    if (!container) return;

    if (clients.length === 0) {
        container.innerHTML = '<div class="empty">Нет клиентов</div>';
        return;
    }

    container.innerHTML = clients.map((c, i) => `
        <div class="item">
            <div class="item-info">
                <strong>${escapeHtml(c.name)}</strong>
                <small>${escapeHtml(c.phone)} · ${escapeHtml(c.car)}</small>
            </div>
            <button class="delete-btn" onclick="deleteClient(${i})">✕</button>
        </div>
    `).join('');
}

// ---------- Рендер заказов ----------
function renderOrders() {
    const container = document.getElementById('ordersList');
    if (!container) return;

    if (orders.length === 0) {
        container.innerHTML = '<div class="empty">Нет заказов</div>';
        return;
    }

    container.innerHTML = orders.map((o, i) => `
        <div class="item">
            <div class="item-info">
                <strong>${escapeHtml(o.work)}</strong>
                <small>${escapeHtml(o.clientName)} · ${o.cost} руб.</small>
            </div>
            <button class="delete-btn" onclick="deleteOrder(${i})">✕</button>
        </div>
    `).join('');
}

// ---------- Обновление выпадающего списка клиентов ----------
function updateClientSelect() {
    const select = document.getElementById('orderClient');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Выберите клиента --</option>' +
        clients.map((c, i) => `<option value="${i}">${escapeHtml(c.name)}</option>`).join('');
    select.value = currentVal;
}

// ---------- Добавление клиента ----------
function addClient() {
    const name = document.getElementById('clientName').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();
    const car = document.getElementById('clientCar').value.trim();

    if (!name) {
        alert('Введите ФИО клиента');
        return;
    }

    clients.push({ name, phone, car });
    document.getElementById('clientName').value = '';
    document.getElementById('clientPhone').value = '';
    document.getElementById('clientCar').value = '';

    saveToLocal();
    renderAll();
    setStatus('Клиент добавлен');
}

// ---------- Удаление клиента ----------
function deleteClient(index) {
    if (!confirm('Удалить клиента?')) return;
    clients.splice(index, 1);
    saveToLocal();
    renderAll();
}

// ---------- Добавление заказа ----------
function addOrder() {
    const clientIdx = document.getElementById('orderClient').value;
    const work = document.getElementById('orderWork').value.trim();
    const cost = document.getElementById('orderCost').value.trim();

    if (clientIdx === '') {
        alert('Выберите клиента');
        return;
    }
    if (!work) {
        alert('Введите описание работ');
        return;
    }

    const client = clients[parseInt(clientIdx)];
    orders.push({
        clientName: client.name,
        work,
        cost: cost || '0',
        date: new Date().toLocaleDateString('ru-RU')
    });

    document.getElementById('orderWork').value = '';
    document.getElementById('orderCost').value = '';

    saveToLocal();
    renderAll();
    setStatus('Заказ добавлен');
}

// ---------- Удаление заказа ----------
function deleteOrder(index) {
    if (!confirm('Удалить заказ?')) return;
    orders.splice(index, 1);
    saveToLocal();
    renderAll();
}

// ---------- Очистка всего ----------
function clearAll() {
    if (!confirm('Удалить ВСЕ данные? Это действие необратимо!')) return;
    clients = [];
    orders = [];
    dataVersion = 0;
    saveToLocal();
    renderAll();
    setStatus('Все данные удалены');
}

// ============================================================
//  СИНХРОНИЗАЦИЯ ЧЕРЕЗ TELEGRAM
// ============================================================

// ---------- Сохранение в Telegram (отправка файла боту) ----------
function saveToTelegram() {
    if (!tg) {
        alert('Откройте приложение через Telegram');
        return;
    }

    dataVersion += 1;

    const data = {
        clients,
        orders,
        version: dataVersion,
        updatedAt: new Date().toISOString(),
        device: tg.platform || 'unknown'
    };

    const jsonStr = JSON.stringify(data, null, 2);

    try {
        tg.sendData(JSON.stringify({
            action: 'save',
            version: dataVersion,
            content: jsonStr
        }));
        setStatus(`Сохранено (v${dataVersion})`);
        saveToLocal();
    } catch (e) {
        console.error('Ошибка отправки:', e);
        alert('Не удалось сохранить. Попробуйте ещё раз.');
    }
}

// ---------- Загрузка из Telegram ----------
function loadFromTelegram() {
    if (!tg) {
        alert('Откройте приложение через Telegram');
        return;
    }

    try {
        tg.sendData(JSON.stringify({
            action: 'load'
        }));
        setStatus('Запрос отправлен...');
    } catch (e) {
        console.error('Ошибка запроса:', e);
        alert('Не удалось запросить данные.');
    }
}

// ---------- Приём данных от бота ----------
if (tg) {
    tg.onEvent('webAppData', (data) => {
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;

            if (parsed.clients) {
                clients = parsed.clients || [];
                orders = parsed.orders || [];
                dataVersion = parsed.version || 0;
                saveToLocal();
                renderAll();
                setStatus(`Загружено (v${dataVersion})`);
            }
        } catch (e) {
            console.error('Ошибка обработки данных от бота:', e);
            setStatus('Ошибка загрузки');
        }
    });
}

// ============================================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderAll() {
    renderClients();
    renderOrders();
    updateClientSelect();
    updateVersionDisplay();
}

// ---------- Старт приложения ----------
loadFromLocal();
renderAll();
setStatus('Готово');
console.log('🔧 Автосервис Админ запущен');