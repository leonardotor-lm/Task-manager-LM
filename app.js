// ESTADOS Y VARIABLES GLOBALES
const apiKey = ""; 
const DB_URL_KEY = 'leo_agenda_db_url';
const API_KEY_STORAGE_KEY = 'leo_gemini_api_key';

// --- MÓDULO DE SEGURIDAD (CORREGIDO) ---
const SECURITY_TOKEN = "e7b8c9d0-f1a2-4b3c-9d8e-7f6a5b4c3d2e";

const getSecureUrl = (baseUrl) => {
    if (!baseUrl) return "";
    try {
        const url = new URL(baseUrl);
        url.searchParams.set('token', SECURITY_TOKEN);
        return url.toString();
    } catch (e) {
        // Fallback para URLs relativas o mal formadas
        const separator = baseUrl.includes('?') ? '&' : '?';
        return baseUrl + separator + "token=" + SECURITY_TOKEN;
    }
};
// ----------------------------------------

let dbUrl = localStorage.getItem(DB_URL_KEY) || "";
let customApiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || "";

function safeParse(key, fallback) {
    try { const data = localStorage.getItem(key); return data ? JSON.parse(data) : fallback; } 
    catch (e) { return fallback; }
}

// INSERCIÓN RÁPIDA DE SUBTAREAS
async function quickAddSubtask(parentId, event) {
    if (event) event.stopPropagation(); 
    const title = prompt("Ingresá el título de la nueva subtarea:");
    if (!title || title.trim() === "") return;
    
    findAndMutateTask(parentId, (nodes, i) => {
        if (!nodes[i].subtasks) nodes[i].subtasks = [];
        nodes[i].subtasks.push({ 
            id: Date.now(), name: title.trim(), area: nodes[i].area || 'Inbox', 
            context: '', priority: 'baja', date: '', startDate: '', time: '', 
            notes: '', reminder: false, status: 'pending', attachments: [], 
            subtasks: [], isDeleted: false, parentId: parentId 
        });
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

// FUNCIONES DE FECHAS Y NAVEGACIÓN (MANTENIDAS)
function isToday(dateStr) { if (!dateStr) return false; const d = new Date(dateStr + 'T12:00:00'); const today = new Date(); return d.toDateString() === today.toDateString(); }
function isPast(dateStr) { if (!dateStr) return false; const d = new Date(dateStr + 'T12:00:00'); const today = new Date(); today.setHours(0,0,0,0); return d < today; }
function formatDisplayDate(dateStr) { if (!dateStr) return ''; const [y, m, d] = dateStr.split('-'); return `${d}/${m}/${y}`; }

function navigate(view, area = null) {
    if (currentState.view !== view || currentState.selectedArea !== area) {
        navHistory.push(JSON.parse(JSON.stringify(currentState)));
    }
    currentState.view = view;
    currentState.selectedArea = area;
    updateUI();
}
window.navigate = navigate;

window.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('dbUrlInput').value = dbUrl;
    document.getElementById('apiKeyInput').value = customApiKey;
    if (dbUrl) {
        document.getElementById('settingsModal').classList.add('hidden');
        await loadData();
        updateUI();
    } else {
        document.getElementById('settingsModal').classList.remove('hidden');
    }
});

async function loadData() {
    if (!dbUrl) return;
    try {
        const response = await fetch(getSecureUrl(dbUrl));
        if (!response.ok) throw new Error('Error de conexión');
        tasks = await response.json();
        updateUI();
    } catch (e) {
        showNotice("Error al cargar datos", true);
        tasks = [];
    }
}
window.loadData = loadData;

async function saveData() {
    if (!dbUrl) return;
    try {
        await fetch(getSecureUrl(dbUrl), {
            method: 'POST',
            body: JSON.stringify(tasks)
        });
        showNotice("Sincronización completa");
    } catch (e) {
        showNotice("Error al sincronizar", true);
    }
}

// ... RESTO DE LA LÓGICA (MANTENIDA IDÉNTICA PARA PRESERVAR ESTADO)
function findAndMutateTask(id, callback, nodes = tasks) {
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id == id) { callback(nodes, i); return true; }
        if (nodes[i].subtasks && findAndMutateTask(id, callback, nodes[i].subtasks)) return true;
    }
    return false;
}

function updateUI() {
    // UI Refresh Logic
    if (typeof renderTasks === 'function') renderTasks();
}

async function uploadAttachment() {
    if (!dbUrl) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const payload = { action: 'uploadFile', fileName: file.name, fileData: reader.result.split(',')[1] };
            const response = await fetch(getSecureUrl(dbUrl), { method: 'POST', body: JSON.stringify(payload) });
            const res = await response.json();
            if (res.status === 'success') {
                currentAttachments.push({ name: file.name, url: res.url });
                renderAttachments();
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
    container.innerHTML = currentAttachments.map((f, i) => `<div>${f.name}</div>`).join('');
}
window.renderAttachments = renderAttachments;