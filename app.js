// ESTADOS Y VARIABLES GLOBALES
const apiKey = ""; 
const DB_URL_KEY = 'leo_agenda_db_url';
const API_KEY_STORAGE_KEY = 'leo_gemini_api_key';

let dbUrl = localStorage.getItem(DB_URL_KEY) || "";
let customApiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || "";

// --- BARRERA DE SEGURIDAD ---
const SECURITY_TOKEN = "e7b8c9d0-f1a2-4b3c-9d8e-7f6a5b4c3d2e";

function getSecureUrl(baseUrl) {
    if (!baseUrl || typeof baseUrl !== 'string' || baseUrl.trim() === '') return "";
    const separator = baseUrl.includes('?') ? '&' : '?';
    return baseUrl + separator + "token=" + SECURITY_TOKEN;
}
// ----------------------------

function safeParse(key, fallback) {
    try { const data = localStorage.getItem(key); return data ? JSON.parse(data) : fallback; } 
    catch (e) { return fallback; }
}

// INSERCIÓN RÁPIDA DE SUBTAREAS (BLINDAJE GLOBAL)
async function quickAddSubtask(parentId, event) {
    if (event) event.stopPropagation(); 
    
    const title = prompt("Ingresá el título de la nueva subtarea:");
    if (!title || title.trim() === "") return;
    
    findAndMutateTask(parentId, (nodes, i) => {
        if (!nodes[i].subtasks) nodes[i].subtasks = [];
        
        const newTask = { 
            id: Date.now(), 
            name: title.trim(), 
            area: nodes[i].area || 'Inbox', 
            context: '', 
            priority: 'baja', 
            date: '', // Corrección: la fecha no se hereda
            startDate: '', // Corrección: la fecha de inicio tampoco se hereda
            time: '', 
            notes: '', 
            reminder: false, 
            status: 'pending', 
            attachments: [], 
            subtasks: [], 
            isDeleted: false,
            parentId: parentId // Trazabilidad opcional
        };
        
        nodes[i].subtasks.push(newTask);
    });
    
    await saveData();
    updateUI();
    showNotice("Subtarea añadida con éxito.");
}
window.quickAddSubtask = quickAddSubtask;

let tasks = [];
let currentState = { view: 'today', selectedArea: null, filterStatus: 'all', filterPriority: 'all', filterContext: 'all', sortOrder: 'dateAsc', searchQuery: '' };
let isBulkMode = false;
let bulkSelected = new Set();
let editingTaskId = null;
let navHistory = [];
let draggingTaskId = null;
let currentAttachments = [];

// FUNCIONES DE UTILIDAD (FECHAS)
function isToday(dateStr) { if (!dateStr) return false; const d = new Date(dateStr + 'T12:00:00'); const today = new Date(); return d.toDateString() === today.toDateString(); }
function isTomorrow(dateStr) { if (!dateStr) return false; const d = new Date(dateStr + 'T12:00:00'); const tmr = new Date(); tmr.setDate(tmr.getDate() + 1); return d.toDateString() === tmr.toDateString(); }
function isThisWeek(dateStr) { 
    if (!dateStr) return false; 
    const d = new Date(dateStr + 'T12:00:00'); 
    const today = new Date(); 
    today.setHours(0,0,0,0);
    const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek + 1);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    return d >= startOfWeek && d <= endOfWeek;
}
function isNext15Days(dateStr) { if (!dateStr) return false; const d = new Date(dateStr + 'T12:00:00'); const today = new Date(); today.setHours(0,0,0,0); const end = new Date(today); end.setDate(today.getDate() + 15); return d >= today && d <= end; }
function isPast(dateStr) { if (!dateStr) return false; const d = new Date(dateStr + 'T12:00:00'); const today = new Date(); today.setHours(0,0,0,0); return d < today; }
function formatDisplayDate(dateStr) { if (!dateStr) return ''; const [y, m, d] = dateStr.split('-'); return `${d}/${m}/${y}`; }

// NAVEGACIÓN Y ESTADO
function navigate(view, area = null) {
    if (currentState.view !== view || currentState.selectedArea !== area) {
        navHistory.push(JSON.parse(JSON.stringify(currentState)));
    }
    currentState.view = view;
    currentState.selectedArea = area;
    if (view === 'trash') {
        currentState.filterStatus = 'all'; currentState.filterPriority = 'all'; currentState.filterContext = 'all'; currentState.searchQuery = '';
        if (isBulkMode) toggleBulkMode();
    }
    updateUI();
}
window.navigate = navigate;

function goBack() {
    if (navHistory.length > 0) {
        currentState = navHistory.pop();
        updateUI();
    }
}
window.goBack = goBack;

// INICIALIZACIÓN
window.addEventListener('DOMContentLoaded', async () => {
    initSpeechRecognition();
    populateSelects();
    document.getElementById('dbUrlInput').value = dbUrl;
    document.getElementById('apiKeyInput').value = customApiKey;
    
    document.getElementById('searchQuery').addEventListener('input', (e) => { currentState.searchQuery = e.target.value; renderTasks(); });
    ['filterStatus', 'filterPriority', 'filterContext', 'sortSelect'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => { 
            currentState[id.replace('Select', 'Order')] = e.target.value; 
            renderTasks(); 
        });
    });

    if (dbUrl) {
        document.getElementById('settingsModal').classList.add('hidden');
        await loadData();
        updateUI();
        if (typeof renderCalendar === 'function') setTimeout(renderCalendar, 500);
    } else {
        document.getElementById('settingsModal').classList.remove('hidden');
    }
});

function toggleSettings() { document.getElementById('settingsModal').classList.toggle('hidden'); }
window.toggleSettings = toggleSettings;

async function saveSettings() {
    dbUrl = document.getElementById('dbUrlInput').value.trim();
    customApiKey = document.getElementById('apiKeyInput').value.trim();
    localStorage.setItem(DB_URL_KEY, dbUrl);
    localStorage.setItem(API_KEY_STORAGE_KEY, customApiKey);
    toggleSettings();
    if (dbUrl) { await loadData(); updateUI(); }
}
window.saveSettings = saveSettings;

function showNotice(msg, isError = false) {
    const notice = document.getElementById('notice');
    notice.innerText = msg;
    notice.classList.remove('hidden', 'bg-navy-800', 'bg-danger-900', 'text-brand-400', 'text-danger-400');
    if (isError) { notice.classList.add('bg-danger-900', 'text-danger-400'); } 
    else { notice.classList.add('bg-navy-800', 'text-brand-400'); }
    setTimeout(() => notice.classList.add('hidden'), 3000);
}

// SINCRONIZACIÓN DE DATOS CON BLINDAJE DE SEGURIDAD
async function loadData() {
    if (!dbUrl) return;
    try {
        const response = await fetch(getSecureUrl(dbUrl));
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        tasks = Array.isArray(data) ? data : [];
        refreshAllDropdowns();
        showNotice("Datos cargados correctamente");
    } catch (e) {
        console.error(e);
        showNotice("Error al cargar datos", true);
        tasks = [];
    }
}
window.loadData = loadData;

async function saveData() {
    if (!dbUrl) { showNotice("Falta URL de DB", true); return; }
    showNotice("Guardando sincronización...");
    try {
        const response = await fetch(getSecureUrl(dbUrl), {
            method: 'POST',
            body: JSON.stringify(tasks)
        });
        const res = await response.json();
        if (res.status === 'success') {
            showNotice("Sincronización completa");
        } else {
            showNotice("Error al sincronizar", true);
        }
    } catch (e) {
        console.error(e);
        showNotice("Error de red al guardar", true);
    }
}

// GESTIÓN DE TAREAS Y ÁRBOLES
function findAndMutateTask(id, callback, nodes = tasks) {
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id == id) { callback(nodes, i); return true; }
        if (nodes[i].subtasks && findAndMutateTask(id, callback, nodes[i].subtasks)) return true;
    }
    return false;
}

function findTask(id, nodes = tasks) {
    for (const t of nodes) {
        if (t.id == id) return t;
        if (t.subtasks) { const found = findTask(id, t.subtasks); if (found) return found; }
    }
    return null;
}

async function deleteTask(id, permanent = false) {
    if (permanent) {
        findAndMutateTask(id, (nodes, i) => { nodes.splice(i, 1); });
    } else {
        findAndMutateTask(id, (nodes, i) => { nodes[i].isDeleted = true; nodes[i].deletedAt = new Date().toISOString(); });
    }
    await saveData();
    updateUI();
}
window.deleteTask = deleteTask;

async function toggleTaskStatus(id, event) {
    if (event) event.stopPropagation();
    findAndMutateTask(id, (nodes, i) => { nodes[i].status = nodes[i].status === 'completed' ? 'pending' : 'completed'; });
    await saveData();
    updateUI();
}
window.toggleTaskStatus = toggleTaskStatus;

async function toggleTaskPin(id, event) {
    if (event) event.stopPropagation();
    findAndMutateTask(id, (nodes, i) => { nodes[i].isPinned = !nodes[i].isPinned; });
    await saveData();
    updateUI();
}
window.toggleTaskPin = toggleTaskPin;

async function restoreTask(id, event) {
    if (event) event.stopPropagation();
    findAndMutateTask(id, (nodes, i) => { nodes[i].isDeleted = false; delete nodes[i].deletedAt; });
    await saveData();
    updateUI();
}
window.restoreTask = restoreTask;

async function emptyTrash() {
    if (confirm("¿Vaciar papelera permanentemente?")) {
        const cleanNodes = (nodes) => nodes.filter(t => { if (t.subtasks) t.subtasks = cleanNodes(t.subtasks); return !t.isDeleted; });
        tasks = cleanNodes(tasks);
        await saveData();
        updateUI();
    }
}
window.emptyTrash = emptyTrash;

function autoCleanTrash() {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    let changed = false;
    const cleanNodes = (nodes) => nodes.filter(t => {
        if (t.subtasks) t.subtasks = cleanNodes(t.subtasks);
        if (t.isDeleted && t.deletedAt) {
            if (new Date(t.deletedAt) < tenDaysAgo) { changed = true; return false; }
        }
        return true;
    });
    tasks = cleanNodes(tasks);
    if (changed) saveData();
}
setInterval(autoCleanTrash, 1000 * 60 * 60);

// UI ORQUESTADOR Y CONTADORES
window.updateSidebarCounters = function() {
    if (typeof tasks === 'undefined' || !Array.isArray(tasks)) return;

    let counts = { today: 0, tomorrow: 0, week: 0, fortnight: 0, all: 0, trash: 0 };
    const today = new Date(); 
    today.setHours(0, 0, 0, 0);

    function countNodes(nodes) {
        if (!nodes || !Array.isArray(nodes)) return;
        nodes.forEach(t => {
            if (t.isDeleted) {
                counts.trash++;
            } else if (t.status !== 'completed') {
                counts.all++;
                if (t.date) {
                    try {
                        const [year, month, day] = t.date.split('-').map(Number);
                        const tDate = new Date(year, month - 1, day);
                        const diffDays = Math.round((tDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                        if (diffDays <= 0) counts.today++; 
                        if (diffDays === 1) counts.tomorrow++;
                        if (diffDays <= 7) counts.week++;
                        if (diffDays <= 15) counts.fortnight++;
                    } catch (e) {
                        console.warn("Fallo de formato en fecha:", e);
                    }
                }
            }
            if (t.subtasks) countNodes(t.subtasks);
        });
    }
    
    countNodes(tasks);

    const updateBadge = (id, count) => {
        const btn = document.getElementById(id);
        if (!btn) return; 
        
        btn.classList.remove('justify-between');

        let badge = btn.querySelector('.nav-badge-counter');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'nav-badge-counter text-[10px] font-bold text-navy-400 bg-navy-800 px-1.5 py-0.5 rounded-md ml-auto';
            btn.appendChild(badge);
        }
        badge.innerText = count;
    };

    updateBadge('nav-today', counts.today);
    updateBadge('nav-tomorrow', counts.tomorrow);
    updateBadge('nav-week', counts.week);
    updateBadge('nav-fortnight', counts.fortnight);
    updateBadge('nav-all', counts.all);
    updateBadge('nav-trash', counts.trash);
};

function updateUI() {
    const btnBack = document.getElementById('btnBack'); if (btnBack && typeof navHistory !== 'undefined' && navHistory.length > 0) btnBack.classList.remove('hidden'); else if (btnBack) btnBack.classList.add('hidden');
    const titleEl = document.getElementById('view-title');
    const titles = { 'today':'Hoy y atrasadas', 'tomorrow':'Mañana', 'week':'Esta semana', 'fortnight':'Próximos 15 días', 'all':'Todas las tareas', 'calendar':'Calendario', 'focus':'Dependencia específica', 'trash':'Papelera (10 días)' };
    if (titleEl) titleEl.innerText = currentState.view === 'area' ? `Área: ${currentState.selectedArea}` : titles[currentState.view];
    const isTrash = currentState.view === 'trash';
    
    ['nav-today', 'nav-tomorrow', 'nav-week', 'nav-fortnight', 'nav-all', 'nav-calendar', 'nav-trash'].forEach(id => { 
        const el = document.getElementById(id); 
        if (!el) return;
        if (id === `nav-${currentState.view}`) { 
            el.classList.add('bg-navy-900', 'text-brand-500', 'border-r-2', 'border-brand-500'); 
            el.classList.remove('text-navy-300', 'border-transparent'); 
            if(id === 'nav-trash') {
                const svg = el.querySelector('svg');
                if (svg) svg.classList.remove('text-danger-500'); 
            }
        } else { 
            el.classList.remove('bg-navy-900', 'text-brand-500', 'border-r-2', 'border-brand-500'); 
            el.classList.add('text-navy-300', 'border-transparent'); 
            if(id === 'nav-trash') {
                const svg = el.querySelector('svg');
                if (svg) svg.classList.add('text-danger-500'); 
            }
        } 
    });
    
    document.querySelectorAll('.sidebar-area-item').forEach(el => { 
        if (currentState.view === 'area' && el.dataset.area === currentState.selectedArea) { 
            el.classList.add('border-brand-500', 'bg-navy-900', 'text-brand-500'); 
            el.classList.remove('border-transparent', 'text-navy-300'); 
        } else { 
            el.classList.remove('border-brand-500', 'bg-navy-900', 'text-brand-500'); 
            el.classList.add('border-transparent', 'text-navy-300'); 
        } 
    });
    
    const toggleHidden = (id, condition) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', condition); };
    toggleHidden('view-list', currentState.view === 'calendar'); 
    
    if (currentState.view === 'calendar') { 
        const omni = document.getElementById('omnibar-container'); if (omni) omni.classList.add('hidden'); 
        const aiBtn = document.getElementById('btnAIToggle'); 
        if (aiBtn) { aiBtn.classList.remove('text-brand-500', 'bg-navy-700'); aiBtn.classList.add('text-navy-400'); }
    }
    
    toggleHidden('view-calendar', currentState.view !== 'calendar'); 
    toggleHidden('filters-container', currentState.view === 'calendar');
    toggleHidden('btnEmptyTrash', !isTrash);
    toggleHidden('searchWrap', isTrash);
    toggleHidden('filterStatus', isTrash);
    toggleHidden('filterPriority', isTrash);
    toggleHidden('filterContext', isTrash);
    toggleHidden('sortSelect', isTrash);
    toggleHidden('btnBulkMode', isTrash);
    toggleHidden('btnResetFilters', isTrash);
    toggleHidden('btnAIToggle', isTrash);
    toggleHidden('filtersDivider', isTrash);
    
    const fab = document.getElementById('mainFab');
    if (fab) {
        if (isTrash) fab.classList.add('hidden'); 
        else { 
            fab.classList.remove('hidden'); 
            if (typeof isBulkMode !== 'undefined' && isBulkMode) fab.classList.add('translate-y-24', 'opacity-0'); 
            else fab.classList.remove('translate-y-24', 'opacity-0'); 
        }
    }
    
    if (currentState.view === 'calendar' && typeof isBulkMode !== 'undefined' && isBulkMode && typeof toggleBulkMode === 'function') toggleBulkMode();
    
    if (typeof window.updateSidebarCounters === 'function') window.updateSidebarCounters();

    if (currentState.view === 'calendar' && typeof renderCalendar === 'function') renderCalendar(); 
    else if (typeof renderTasks === 'function') renderTasks();
}

// RENDERIZADO DE TAREAS
function renderSidebarAreas() { 
    const allAreas = typeof getAllAreasOrdered === 'function' ? getAllAreasOrdered() : []; 
    const container = document.getElementById('sidebar-areas-list');
    if (!container) return; 

    container.innerHTML = allAreas.map(area => {
        let count = 0;
        function countAreaTasks(nodes) {
            if (!nodes || !Array.isArray(nodes)) return;
            nodes.forEach(t => {
                if (!t.isDeleted && t.status !== 'completed' && t.area === area) count++;
                if (t.subtasks && Array.isArray(t.subtasks)) countAreaTasks(t.subtasks);
            });
        }
        if (typeof tasks !== 'undefined') countAreaTasks(tasks);

        return `<button onclick="navigate('area', '${area}')" data-area="${area}" class="sidebar-area-item w-full flex items-center px-3 py-2 rounded-md text-sm font-medium text-navy-300 transition-all border-r-2 border-transparent hover:bg-navy-700 hover:text-navy-50 focus:outline-none">
            <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${area === 'Inbox' ? 'bg-brand-500' : 'bg-navy-500'}"></span>
            <span class="truncate ml-3">${area}</span>
            <span class="text-[10px] font-bold text-navy-400 bg-navy-800 px-1.5 py-0.5 rounded-md ml-auto">${count}</span>
        </button>`;
    }).join(''); 
}

function getAllAreasOrdered() {
    const areas = new Set();
    const extract = (nodes) => nodes.forEach(t => { if (t.area) areas.add(t.area); if (t.subtasks) extract(t.subtasks); });
    extract(tasks);
    const arr = Array.from(areas);
    if (arr.includes('Inbox')) { arr.splice(arr.indexOf('Inbox'), 1); arr.unshift('Inbox'); } 
    else { arr.unshift('Inbox'); }
    return arr;
}
window.getAllAreasOrdered = getAllAreasOrdered;

function getAllContexts() { const ctx = new Set(); const ext = (nodes) => nodes.forEach(t => { if (t.context) ctx.add(t.context); if (t.subtasks) ext(t.subtasks); }); ext(tasks); return Array.from(ctx); }
function populateSelects() {
    populateSelect('filterContext', getAllContexts(), 'Todos los contextos');
    populateSelect('taskContext', getAllContexts(), 'Seleccionar...', '');
}
window.populateSelects = populateSelects;

function renderTasks() {
    renderSidebarAreas();
    const container = document.getElementById('tasks-container');
    if (!container) return;
    
    let displayTasks = [];
    const isTrash = currentState.view === 'trash';
    
    const filterFn = (t) => {
        if (isTrash) return t.isDeleted;
        if (t.isDeleted) return false;
        
        let matchView = false;
        if (currentState.view === 'all') matchView = true;
        else if (currentState.view === 'today') matchView = isToday(t.date) || isPast(t.date) || (!t.date && t.status !== 'completed');
        else if (currentState.view === 'tomorrow') matchView = isTomorrow(t.date);
        else if (currentState.view === 'week') matchView = isThisWeek(t.date);
        else if (currentState.view === 'fortnight') matchView = isNext15Days(t.date);
        else if (currentState.view === 'area') matchView = t.area === currentState.selectedArea;
        else if (currentState.view === 'focus') matchView = t.focus === true;
        
        let matchStatus = true;
        if (currentState.filterStatus === 'pending') matchStatus = t.status === 'pending';
        else if (currentState.filterStatus === 'completed') matchStatus = t.status === 'completed';
        
        let matchPriority = currentState.filterPriority === 'all' || t.priority === currentState.filterPriority;
        let matchContext = currentState.filterContext === 'all' || t.context === currentState.filterContext;
        let matchSearch = !currentState.searchQuery || t.name.toLowerCase().includes(currentState.searchQuery.toLowerCase()) || (t.notes && t.notes.toLowerCase().includes(currentState.searchQuery.toLowerCase()));
        
        return matchView && matchStatus && matchPriority && matchContext && matchSearch;
    };

    const extractTasks = (nodes) => {
        let res = [];
        nodes.forEach(t => { if (filterFn(t)) res.push(t); if (t.subtasks) res = res.concat(extractTasks(t.subtasks)); });
        return res;
    };
    displayTasks = extractTasks(tasks);

    if (!isTrash) {
        displayTasks.sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            if (currentState.sortOrder === 'dateAsc') return (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99');
            if (currentState.sortOrder === 'dateDesc') return (b.date || '0000-00-00').localeCompare(a.date || '0000-00-00');
            if (currentState.sortOrder === 'priorityDesc') { const p = { 'alta': 3, 'media': 2, 'baja': 1 }; return (p[b.priority] || 0) - (p[a.priority] || 0); }
            return 0;
        });
    }

    if (displayTasks.length === 0) {
        container.innerHTML = `<div class="text-center py-12 text-navy-400"><p class="text-lg mb-2">No hay tareas en esta vista.</p><p class="text-sm">Disfrutá la tranquilidad o añadí nuevas.</p></div>`;
        return;
    }

    container.innerHTML = displayTasks.map(task => renderTaskHTML(task, 0, isTrash)).join('');
}
window.renderTasks = renderTasks;

function renderTaskHTML(task, level, isTrash = false) {
    const isCompleted = task.status === 'completed';
    const isPinned = task.isPinned;
    const hasAttachments = task.attachments && task.attachments.length > 0;
    const paddingLeft = level > 0 ? `ml-${level * 6}` : '';
    const borderL = level > 0 ? 'border-l-2 border-navy-700 pl-4 mt-2' : 'mb-3 bg-navy-800 rounded-xl shadow-sm border border-navy-700/50 hover:border-navy-600 transition-all';
    
    let bulkCheckbox = '';
    if (isBulkMode && !isTrash) {
        const checked = bulkSelected.has(task.id) ? 'checked' : '';
        bulkCheckbox = `<input type="checkbox" class="bulk-cb w-5 h-5 rounded border-navy-600 text-brand-500 focus:ring-brand-500 mr-3 cursor-pointer" onchange="toggleBulkSelect(${task.id})" ${checked}>`;
    }

    let actionsHTML = '';
    if (isTrash) {
        actionsHTML = `<button onclick="restoreTask(${task.id}, event)" class="text-brand-400 hover:text-brand-300 p-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg></button>
                       <button onclick="deleteTask(${task.id}, true)" class="text-danger-500 hover:text-danger-400 p-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>`;
    } else {
        actionsHTML = `<button onclick="toggleTaskPin(${task.id}, event)" class="${isPinned ? 'text-warning-500' : 'text-navy-400 hover:text-warning-500'} p-2 transition-colors"><svg class="w-5 h-5" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg></button>
                       <button onclick="openTaskModal(${task.id})" class="text-brand-400 hover:text-brand-300 p-2 transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>
                       <button onclick="deleteTask(${task.id})" class="text-danger-400 hover:text-danger-300 p-2 transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>`;
    }

    const priorityColors = { 'alta': 'text-danger-400 bg-danger-400/10 border-danger-400/20', 'media': 'text-warning-400 bg-warning-400/10 border-warning-400/20', 'baja': 'text-success-400 bg-success-400/10 border-success-400/20' };
    const pColor = priorityColors[task.priority] || 'text-navy-300 bg-navy-700/50 border-navy-600';
    
    let subtasksHTML = '';
    if (task.subtasks && task.subtasks.length > 0 && !isTrash) {
        const sortedSub = [...task.subtasks].sort((a,b) => { if(a.status !== b.status) return a.status === 'completed' ? 1 : -1; return 0; });
        subtasksHTML = `<div class="mt-2 space-y-1">${sortedSub.map(st => renderTaskHTML(st, level + 1, false)).join('')}</div>`;
    }

    return `
    <div class="${paddingLeft} ${borderL} group" draggable="true" ondragstart="handleDragStart(event, ${task.id})" ondragover="handleDragOver(event)" ondrop="handleDrop(event, ${task.id})">
        <div class="flex items-start p-3 sm:p-4">
            ${bulkCheckbox}
            ${!isTrash ? `<button onclick="toggleTaskStatus(${task.id}, event)" class="mt-0.5 flex-shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${isCompleted ? 'bg-brand-500 border-brand-500 text-navy-900' : 'border-navy-500 hover:border-brand-400 text-transparent'}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg></button>` : ''}
            
            <div class="ml-3 flex-grow min-w-0">
                <div class="flex items-center flex-wrap gap-2 mb-1">
                    <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${pColor}">${task.priority}</span>
                    <span class="text-xs font-medium text-navy-300 bg-navy-700/50 px-2 py-0.5 rounded border border-navy-600 truncate max-w-[120px]">${task.area}</span>
                    ${task.context ? `<span class="text-xs font-medium text-brand-300 bg-brand-900/20 px-2 py-0.5 rounded border border-brand-800/30">@${task.context}</span>` : ''}
                    ${task.reminder ? `<svg class="w-3.5 h-3.5 text-warning-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>` : ''}
                    ${hasAttachments ? `<svg class="w-3.5 h-3.5 text-navy-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>` : ''}
                </div>
                
                <h3 class="text-base font-semibold ${isCompleted ? 'text-navy-400 line-through' : 'text-navy-50'} break-words">${task.name}</h3>
                
                ${task.date || task.time ? `<div class="mt-1.5 flex items-center text-sm ${isPast(task.date) && !isCompleted ? 'text-danger-400 font-medium' : 'text-navy-400'}">
                    <svg class="w-4 h-4 mr-1.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                    ${formatDisplayDate(task.date)} ${task.time ? `&bull; ${task.time}` : ''}
                </div>` : ''}
                
                ${task.notes ? `<p class="mt-2 text-sm text-navy-300 line-clamp-2 leading-relaxed bg-navy-900/50 p-2 rounded border border-navy-700/50">${task.notes}</p>` : ''}
                
                <div class="mt-3 flex items-center space-x-2">
                    <button onclick="quickAddSubtask(${task.id}, event)" class="text-xs font-medium text-brand-400 hover:text-brand-300 flex items-center py-1 px-2 hover:bg-brand-500/10 rounded transition-colors" title="Añadir subtarea rápida">
                        <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg> Subtarea
                    </button>
                </div>
            </div>
            
            <div class="flex flex-col space-y-1 ml-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                ${actionsHTML}
            </div>
        </div>
        ${subtasksHTML}
    </div>`;
}

// ARRASTRAR Y SOLTAR (D&D)
function handleDragStart(e, id) { draggingTaskId = id; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => e.target.classList.add('opacity-50'), 0); }
window.handleDragStart = handleDragStart;

function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
window.handleDragOver = handleDragOver;

async function handleDrop(e, targetId) {
    e.preventDefault();
    if (!draggingTaskId || draggingTaskId === targetId) { draggingTaskId = null; renderTasks(); return; }
    
    let sourceTask = null;
    let sourceParent = null;
    let targetTask = null;
    
    const findSource = (nodes, parent) => {
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === draggingTaskId) { sourceTask = nodes[i]; sourceParent = nodes; return; }
            if (nodes[i].subtasks) findSource(nodes[i].subtasks, nodes[i]);
        }
    };
    findSource(tasks, null);
    
    const findTarget = (nodes) => {
        for (const t of nodes) {
            if (t.id === targetId) { targetTask = t; return; }
            if (t.subtasks) findTarget(t.subtasks);
        }
    };
    findTarget(tasks);
    
    if (sourceTask && targetTask) {
        let isDescendant = false;
        const checkDescendant = (node) => { if (node.id === targetId) isDescendant = true; if (node.subtasks) node.subtasks.forEach(checkDescendant); };
        if (sourceTask.subtasks) sourceTask.subtasks.forEach(checkDescendant);
        
        if (!isDescendant) {
            const sourceIndex = sourceParent.findIndex(t => t.id === draggingTaskId);
            sourceParent.splice(sourceIndex, 1);
            if (!targetTask.subtasks) targetTask.subtasks = [];
            targetTask.subtasks.push(sourceTask);
            await saveData();
            updateUI();
        }
    }
    draggingTaskId = null;
    renderTasks();
}
window.handleDrop = handleDrop;

// MODAL Y FORMULARIOS
function openTaskModal(id = null) {
    editingTaskId = id;
    const modal = document.getElementById('taskModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('taskForm');
    currentAttachments = [];
    
    form.reset();
    populateSelect('taskArea', getAllAreasOrdered(), 'Nueva Área...', 'new_area');
    populateSelect('taskContext', getAllContexts(), 'Nuevo Contexto...', 'new_context');
    
    if (id) {
        title.innerText = "Editar Tarea";
        const task = findTask(id);
        if (task) {
            document.getElementById('taskName').value = task.name;
            if (task.area && Array.from(document.getElementById('taskArea').options).some(o => o.value === task.area)) {
                document.getElementById('taskArea').value = task.area;
            } else if (task.area) {
                const opt = new Option(task.area, task.area);
                document.getElementById('taskArea').add(opt, 1);
                document.getElementById('taskArea').value = task.area;
            }
            if (task.context && Array.from(document.getElementById('taskContext').options).some(o => o.value === task.context)) {
                document.getElementById('taskContext').value = task.context;
            } else if (task.context) {
                const opt = new Option(task.context, task.context);
                document.getElementById('taskContext').add(opt, 1);
                document.getElementById('taskContext').value = task.context;
            }
            document.getElementById('taskPriority').value = task.priority;
            document.getElementById('taskDate').value = task.date || '';
            document.getElementById('taskStartDate').value = task.startDate || '';
            document.getElementById('taskTime').value = task.time || '';
            document.getElementById('taskNotes').value = task.notes || '';
            document.getElementById('taskReminder').checked = task.reminder || false;
            if (task.attachments) currentAttachments = JSON.parse(JSON.stringify(task.attachments));
        }
    } else {
        title.innerText = "Nueva Tarea";
        if (currentState.view === 'area') document.getElementById('taskArea').value = currentState.selectedArea;
        if (currentState.view === 'today') document.getElementById('taskDate').value = new Date().toISOString().split('T')[0];
        if (currentState.view === 'tomorrow') { const tmr = new Date(); tmr.setDate(tmr.getDate()+1); document.getElementById('taskDate').value = tmr.toISOString().split('T')[0]; }
    }
    
    renderAttachments();
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('taskName').focus(), 100);
}
window.openTaskModal = openTaskModal;

function closeTaskModal() { document.getElementById('taskModal').classList.add('hidden'); }
window.closeTaskModal = closeTaskModal;

function handleAreaChange(sel) {
    if (sel.value === 'new_area') {
        const newArea = prompt("Nombre de la nueva área:");
        if (newArea && newArea.trim() !== '') {
            const opt = new Option(newArea.trim(), newArea.trim());
            sel.add(opt, 1);
            sel.value = newArea.trim();
        } else { sel.value = 'Inbox'; }
    }
}
window.handleAreaChange = handleAreaChange;

function handleContextChange(sel) {
    if (sel.value === 'new_context') {
        const newCtx = prompt("Nombre del nuevo contexto:");
        if (newCtx && newCtx.trim() !== '') {
            const opt = new Option(newCtx.trim(), newCtx.trim());
            sel.add(opt, 1);
            sel.value = newCtx.trim();
        } else { sel.value = ''; }
    }
}
window.handleContextChange = handleContextChange;

async function saveTaskForm(e) {
    e.preventDefault();
    const name = document.getElementById('taskName').value.trim();
    if (!name) return;

    let area = document.getElementById('taskArea').value;
    if (area === 'new_area' || !area) area = 'Inbox';
    
    let context = document.getElementById('taskContext').value;
    if (context === 'new_context') context = '';

    const taskData = {
        name, area, context,
        priority: document.getElementById('taskPriority').value,
        date: document.getElementById('taskDate').value,
        startDate: document.getElementById('taskStartDate').value,
        time: document.getElementById('taskTime').value,
        notes: document.getElementById('taskNotes').value.trim(),
        reminder: document.getElementById('taskReminder').checked,
        attachments: currentAttachments
    };

    if (editingTaskId) {
        findAndMutateTask(editingTaskId, (nodes, i) => { nodes[i] = { ...nodes[i], ...taskData }; });
    } else {
        tasks.push({ ...taskData, id: Date.now(), status: 'pending', subtasks: [], isDeleted: false, isPinned: false });
    }

    closeTaskModal();
    await saveData();
    updateUI();
    refreshAllDropdowns();
}
window.saveTaskForm = saveTaskForm;

// SUBIDA DE ARCHIVOS ADJUNTOS CON BLINDAJE DE SEGURIDAD
async function uploadAttachment() {
    if (!dbUrl) { showNotice("Configurá la base de datos primero", true); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { showNotice("Archivo demasiado grande (máx 5MB)", true); return; }
        
        showNotice("Subiendo archivo...");
        const reader = new FileReader();
        reader.onload = async () => {
            const base64Data = reader.result.split(',')[1];
            const payload = { action: 'uploadFile', fileName: file.name, mimeType: file.type, fileData: base64Data };
            
            try {
                const response = await fetch(getSecureUrl(dbUrl), {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                const res = await response.json();
                if (res.status === 'success') {
                    currentAttachments.push({ name: file.name, url: res.url, id: res.id });
                    renderAttachments();
                    showNotice("Archivo adjuntado");
                } else { showNotice("Error al adjuntar", true); }
            } catch (err) {
                console.error(err);
                showNotice("Error de red", true);
            }
        };
        reader.readAsDataURL(file);
    };
    input.click();
}
window.uploadAttachment = uploadAttachment;

function renderAttachments() {
    const container = document.getElementById('attachmentsList');
    if (!container) return;
    container.innerHTML = '';
    
    // Verificación de integridad estructural del array
    if (!Array.isArray(currentAttachments) || currentAttachments.length === 0) return;
    
    // Forzamiento de ruteo asíncrono para prevenir bloqueos de renderizado
    requestAnimationFrame(() => {
        currentAttachments.forEach((file, index) => {
            // Evita procesar nodos corruptos
            if (!file || typeof file !== 'object') return;

            const div = document.createElement('div');
            div.className = "flex items-center justify-between bg-navy-800 p-2 rounded mb-1 text-sm border border-navy-700";
            
            // Validación heurística de URLs para prevenir inyecciones y accesos fallidos
            const fileUrl = file.url || file.link || file.fileUrl;
            const isValidLink = typeof fileUrl === 'string' && (fileUrl.startsWith('http://') || fileUrl.startsWith('https://') || fileUrl.startsWith('data:'));
            
            const fileLink = isValidLink 
                ? `<a href="${fileUrl}" target="_blank" rel="noopener noreferrer" class="text-brand-400 hover:underline cursor-pointer truncate mr-2" title="Abrir documento">${file.name}</a>` 
                : `<span class="truncate mr-2 text-navy-400" title="Registro sin enlace recuperable">${file.name}</span>`;

            div.innerHTML = `
                ${fileLink}
                <button type="button" onclick="currentAttachments.splice(${index}, 1); renderAttachments();" class="text-danger-500 font-bold hover:bg-navy-700 px-2 py-1 rounded transition-colors">X</button>
            `;
            container.appendChild(div);
        });
    });
}
window.renderAttachments = renderAttachments;

// STUBS / SIMULATION IA
function initSpeechRecognition() {} function toggleVoiceCapture() { showNotice("Voz no disponible."); } function toggleAIFilter() { document.getElementById('omnibar-container').classList.toggle('hidden'); }
function processOmnibarCommand() { showNotice("Comando procesado localmente (Simulación)."); document.getElementById('omnibarInput').value = ''; }
function handleOmnibarKeydown(event) { if (event.key === 'Enter') processOmnibarCommand(); }
function breakdownTaskWithAI() { showNotice("Funcionalidad de IA en desarrollo."); }