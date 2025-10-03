// Health Records PWA - Main Application Logic
// IndexedDB, Sync, Voice, SOS, Offline-first

// ========================================
// IndexedDB Setup
// ========================================
const DB_NAME = 'HealthRecordsDB';
const DB_VERSION = 1;
let db;

const dbHelper = {
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Workers store
        if (!db.objectStoreNames.contains('workers')) {
          const workerStore = db.createObjectStore('workers', { keyPath: 'id' });
          workerStore.createIndex('phone', 'phone', { unique: false });
        }

        // Patients store
        if (!db.objectStoreNames.contains('patients')) {
          const patientStore = db.createObjectStore('patients', { keyPath: 'id' });
          patientStore.createIndex('workerId', 'workerId', { unique: false });
          patientStore.createIndex('name', 'name', { unique: false });
          patientStore.createIndex('village', 'village', { unique: false });
        }

        // Visits store
        if (!db.objectStoreNames.contains('visits')) {
          const visitStore = db.createObjectStore('visits', { keyPath: 'id' });
          visitStore.createIndex('patientId', 'patientId', { unique: false });
          visitStore.createIndex('workerId', 'workerId', { unique: false });
        }

        // Reminders store
        if (!db.objectStoreNames.contains('reminders')) {
          const reminderStore = db.createObjectStore('reminders', { keyPath: 'id' });
          reminderStore.createIndex('patientId', 'patientId', { unique: false });
          reminderStore.createIndex('workerId', 'workerId', { unique: false });
          reminderStore.createIndex('reminderDate', 'reminderDate', { unique: false });
          reminderStore.createIndex('isCompleted', 'isCompleted', { unique: false });
        }
      };
    });
  },

  async add(storeName, data) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.add(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async put(storeName, data) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async get(storeName, id) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async clear(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};

// ========================================
// App State
// ========================================
const appState = {
  currentWorker: null,
  currentPatient: null,
  currentView: 'patients',
  isOnline: navigator.onLine,
  isSyncing: false
};

// ========================================
// Voice Recognition
// ========================================
const voiceHelper = {
  recognition: null,
  isListening: false,
  currentTarget: null,

  init() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-IN';

      this.recognition.onstart = () => {
        this.isListening = true;
        if (this.currentTarget) {
          const btn = document.querySelector(`[data-target="${this.currentTarget}"]`);
          if (btn) btn.classList.add('recording');
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (this.currentTarget) {
          const btn = document.querySelector(`[data-target="${this.currentTarget}"]`);
          if (btn) btn.classList.remove('recording');
        }
      };

      this.recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(result => result[0].transcript)
          .join('');

        if (this.currentTarget) {
          const input = document.getElementById(this.currentTarget);
          if (input) {
            if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
              input.value = transcript;
            }
          }
        }
      };

      this.recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        this.isListening = false;
        if (event.error === 'not-allowed') {
          showToast('Microphone permission denied', 'error');
        } else {
          showToast('Voice input failed. Please try again.', 'error');
        }
      };

      return true;
    }
    return false;
  },

  start(targetId) {
    if (!this.recognition) {
      showToast('Voice input not supported', 'error');
      return;
    }

    if (this.isListening) {
      this.recognition.stop();
      return;
    }

    this.currentTarget = targetId;
    try {
      this.recognition.start();
    } catch (error) {
      console.error('Failed to start recognition:', error);
      showToast('Failed to start voice input', 'error');
    }
  }
};

// ========================================
// Geolocation Helper
// ========================================
const locationHelper = {
  async getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          reject(error);
        },
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 60000
        }
      );
    });
  }
};

// ========================================
// SOS Helper
// ========================================
const sosHelper = {
  async trigger(patient) {
    const confirmed = await showModal(
      'Emergency SOS',
      `Send emergency alert for ${patient.name}?\n\nThis will open SMS with pre-filled emergency information.`
    );

    if (!confirmed) return;

    try {
      const worker = appState.currentWorker;
      let location = 'Location unavailable';

      try {
        const pos = await locationHelper.getCurrentPosition();
        location = `${pos.lat},${pos.lng}`;
      } catch (error) {
        console.warn('Location unavailable:', error);
      }

      const message = `EMERGENCY ALERT\nPatient: ${patient.name}\nAge: ${patient.age || 'N/A'}\nVillage: ${patient.village || 'N/A'}\nWorker: ${worker.name}\nPhone: ${worker.phone || 'N/A'}\nLocation: ${location}\nTime: ${new Date().toLocaleString()}`;

      const smsUri = `sms:?body=${encodeURIComponent(message)}`;

      window.location.href = smsUri;

      setTimeout(() => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(message)
            .then(() => showToast('Emergency info copied to clipboard', 'success'))
            .catch(() => showToast('SOS initiated. Copy failed.', 'success'));
        } else {
          showToast('SOS initiated', 'success');
        }
      }, 500);

    } catch (error) {
      console.error('SOS error:', error);
      showToast('Failed to initiate SOS', 'error');
    }
  }
};

// ========================================
// Sync Helper
// ========================================
const syncHelper = {
  async syncAll() {
    if (appState.isSyncing) return;
    if (!appState.isOnline) {
      showToast('Cannot sync while offline', 'error');
      return;
    }

    appState.isSyncing = true;
    updateSyncButton();

    try {
      const unsynced = await this.getUnsyncedRecords();

      if (unsynced.total === 0) {
        showToast('All records are synced', 'success');
        appState.isSyncing = false;
        updateSyncButton();
        return;
      }

      showToast(`Syncing ${unsynced.total} records...`);

      let synced = 0;

      for (const patient of unsynced.patients) {
        try {
          patient.synced = true;
          await dbHelper.put('patients', patient);
          synced++;
        } catch (error) {
          console.error('Sync failed for patient:', error);
        }
      }

      for (const visit of unsynced.visits) {
        try {
          visit.synced = true;
          await dbHelper.put('visits', visit);
          synced++;
        } catch (error) {
          console.error('Sync failed for visit:', error);
        }
      }

      for (const reminder of unsynced.reminders) {
        try {
          reminder.synced = true;
          await dbHelper.put('reminders', reminder);
          synced++;
        } catch (error) {
          console.error('Sync failed for reminder:', error);
        }
      }

      showToast(`Synced ${synced} records successfully`, 'success');
      updateSyncBadge();
      if (appState.currentView === 'sync') {
        renderSyncView();
      }

    } catch (error) {
      console.error('Sync error:', error);
      showToast('Sync failed. Try again later.', 'error');
    } finally {
      appState.isSyncing = false;
      updateSyncButton();
    }
  },

  async getUnsyncedRecords() {
    const patients = await dbHelper.getAll('patients');
    const visits = await dbHelper.getAll('visits');
    const reminders = await dbHelper.getAll('reminders');

    const unsyncedPatients = patients.filter(p => !p.synced);
    const unsyncedVisits = visits.filter(v => !v.synced);
    const unsyncedReminders = reminders.filter(r => !r.synced);

    return {
      patients: unsyncedPatients,
      visits: unsyncedVisits,
      reminders: unsyncedReminders,
      total: unsyncedPatients.length + unsyncedVisits.length + unsyncedReminders.length
    };
  }
};

// ========================================
// Export/Import Helpers
// ========================================
const exportHelper = {
  async exportJSON() {
    try {
      const data = {
        workers: await dbHelper.getAll('workers'),
        patients: await dbHelper.getAll('patients'),
        visits: await dbHelper.getAll('visits'),
        reminders: await dbHelper.getAll('reminders'),
        exportDate: new Date().toISOString()
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `health-records-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('Data exported successfully', 'success');
    } catch (error) {
      console.error('Export error:', error);
      showToast('Export failed', 'error');
    }
  },

  async exportCSV() {
    try {
      const patients = await dbHelper.getAll('patients');

      let csv = 'Name,Age,Gender,Phone,Village,Blood Group,Medical History\n';
      patients.forEach(p => {
        csv += `"${p.name}","${p.age || ''}","${p.gender || ''}","${p.phone || ''}","${p.village || ''}","${p.bloodGroup || ''}","${(p.medicalHistory || '').replace(/"/g, '""')}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `patients-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('CSV exported successfully', 'success');
    } catch (error) {
      console.error('Export error:', error);
      showToast('Export failed', 'error');
    }
  },

  async importJSON(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.patients) {
        for (const patient of data.patients) {
          await dbHelper.put('patients', patient);
        }
      }

      if (data.visits) {
        for (const visit of data.visits) {
          await dbHelper.put('visits', visit);
        }
      }

      if (data.reminders) {
        for (const reminder of data.reminders) {
          await dbHelper.put('reminders', reminder);
        }
      }

      showToast('Data imported successfully', 'success');
      if (appState.currentView === 'patients') {
        renderPatients();
      }
    } catch (error) {
      console.error('Import error:', error);
      showToast('Import failed. Check file format.', 'error');
    }
  }
};

// ========================================
// UI Helpers
// ========================================
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function showModal(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalConfirm = document.getElementById('modal-confirm');
    const modalCancel = document.getElementById('modal-cancel');

    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modal.classList.add('show');

    const cleanup = () => {
      modal.classList.remove('show');
      modalConfirm.onclick = null;
      modalCancel.onclick = null;
    };

    modalConfirm.onclick = () => {
      cleanup();
      resolve(true);
    };

    modalCancel.onclick = () => {
      cleanup();
      resolve(false);
    };
  });
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function formatDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function updateSyncBadge() {
  const unsynced = await syncHelper.getUnsyncedRecords();
  const badge = document.getElementById('unsynced-badge');

  if (unsynced.total > 0) {
    badge.textContent = unsynced.total;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

function updateSyncButton() {
  const syncBtn = document.getElementById('sync-btn');
  if (appState.isSyncing) {
    syncBtn.disabled = true;
    syncBtn.style.opacity = '0.5';
  } else {
    syncBtn.disabled = false;
    syncBtn.style.opacity = '1';
  }
}

async function updateReminderBadge() {
  const reminders = await dbHelper.getByIndex('reminders', 'workerId', appState.currentWorker.id);
  const upcoming = reminders.filter(r => !r.isCompleted && new Date(r.reminderDate) >= new Date());

  const badge = document.getElementById('reminder-count-badge');
  if (upcoming.length > 0) {
    badge.textContent = upcoming.length;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

// ========================================
// Navigation
// ========================================
function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`${viewId}-view`).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });

  const navItem = document.querySelector(`[data-view="${viewId}"]`);
  if (navItem) navItem.classList.add('active');

  document.getElementById('screen-title').textContent =
    viewId.charAt(0).toUpperCase() + viewId.slice(1);

  appState.currentView = viewId;
  closeNavDrawer();

  if (viewId === 'patients') renderPatients();
  else if (viewId === 'reminders') renderReminders();
  else if (viewId === 'sync') renderSyncView();
}

function toggleNavDrawer() {
  document.getElementById('nav-drawer').classList.toggle('open');
}

function closeNavDrawer() {
  document.getElementById('nav-drawer').classList.remove('open');
}

// ========================================
// Render Functions
// ========================================
async function renderPatients() {
  const patients = await dbHelper.getByIndex('patients', 'workerId', appState.currentWorker.id);
  const searchTerm = document.getElementById('patient-search').value.toLowerCase();
  const genderFilter = document.getElementById('gender-filter').value;
  const villageFilter = document.getElementById('village-filter').value;

  let filtered = patients;

  if (searchTerm) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(searchTerm) ||
      (p.phone && p.phone.includes(searchTerm)) ||
      (p.village && p.village.toLowerCase().includes(searchTerm))
    );
  }

  if (genderFilter) {
    filtered = filtered.filter(p => p.gender === genderFilter);
  }

  if (villageFilter) {
    filtered = filtered.filter(p => p.village === villageFilter);
  }

  const villages = [...new Set(patients.map(p => p.village).filter(Boolean))];
  const villageSelect = document.getElementById('village-filter');
  const currentVillage = villageSelect.value;
  villageSelect.innerHTML = '<option value="">All Villages</option>';
  villages.forEach(v => {
    const option = document.createElement('option');
    option.value = v;
    option.textContent = v;
    if (v === currentVillage) option.selected = true;
    villageSelect.appendChild(option);
  });

  const listEl = document.getElementById('patient-list');

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
        <p>No patients found</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(patient => `
    <div class="list-item" data-patient-id="${patient.id}">
      <div class="list-item-header">
        <div class="list-item-title">${patient.name}</div>
        ${!patient.synced ? '<span class="status-badge unsynced">Unsynced</span>' : ''}
      </div>
      <div class="list-item-meta">
        ${patient.age ? `<span>${patient.age} yrs</span>` : ''}
        ${patient.gender ? `<span>${patient.gender}</span>` : ''}
        ${patient.village ? `<span>${patient.village}</span>` : ''}
        ${patient.phone ? `<span>${patient.phone}</span>` : ''}
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => {
      const patientId = item.dataset.patientId;
      showPatientDetail(patientId);
    });
  });
}

async function showPatientDetail(patientId) {
  const patient = await dbHelper.get('patients', patientId);
  if (!patient) return;

  appState.currentPatient = patient;

  document.getElementById('patient-detail-name').textContent = patient.name;
  document.getElementById('detail-age').textContent = patient.age || 'N/A';
  document.getElementById('detail-gender').textContent = patient.gender || 'N/A';
  document.getElementById('detail-phone').textContent = patient.phone || 'N/A';
  document.getElementById('detail-village').textContent = patient.village || 'N/A';
  document.getElementById('detail-blood').textContent = patient.bloodGroup || 'N/A';
  document.getElementById('detail-history').textContent = patient.medicalHistory || 'No medical history recorded';

  const visits = await dbHelper.getByIndex('visits', 'patientId', patientId);
  visits.sort((a, b) => new Date(b.visitDate) - new Date(a.visitDate));

  const visitListEl = document.getElementById('visit-list');
  if (visits.length === 0) {
    visitListEl.innerHTML = '<p style="color: #999; text-align: center; padding: 1rem;">No visits recorded</p>';
  } else {
    visitListEl.innerHTML = visits.slice(0, 5).map(visit => `
      <div class="list-item">
        <div class="list-item-header">
          <div class="list-item-title">${formatDate(visit.visitDate)}</div>
          ${!visit.synced ? '<span class="status-badge unsynced">Unsynced</span>' : ''}
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.875rem; color: #666;">
          ${visit.symptoms ? `<div><strong>Symptoms:</strong> ${visit.symptoms}</div>` : ''}
          ${visit.diagnosis ? `<div><strong>Diagnosis:</strong> ${visit.diagnosis}</div>` : ''}
        </div>
      </div>
    `).join('');
  }

  const reminders = await dbHelper.getByIndex('reminders', 'patientId', patientId);
  const upcoming = reminders.filter(r => !r.isCompleted);

  const reminderListEl = document.getElementById('patient-reminder-list');
  if (upcoming.length === 0) {
    reminderListEl.innerHTML = '<p style="color: #999; text-align: center; padding: 1rem;">No active reminders</p>';
  } else {
    reminderListEl.innerHTML = upcoming.slice(0, 3).map(reminder => `
      <div class="list-item">
        <div class="list-item-title">${reminder.reminderType}</div>
        <div style="font-size: 0.875rem; color: #666; margin-top: 0.25rem;">
          ${formatDateTime(reminder.reminderDate)}
        </div>
      </div>
    `).join('');
  }

  switchView('patient-detail');
}

async function renderReminders() {
  const reminders = await dbHelper.getByIndex('reminders', 'workerId', appState.currentWorker.id);
  const activeTab = document.querySelector('.tab.active').dataset.tab;

  let filtered;
  if (activeTab === 'upcoming') {
    filtered = reminders.filter(r => !r.isCompleted && new Date(r.reminderDate) >= new Date());
    filtered.sort((a, b) => new Date(a.reminderDate) - new Date(b.reminderDate));
  } else {
    filtered = reminders.filter(r => r.isCompleted);
    filtered.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  }

  const listEl = document.getElementById('reminders-list');

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/>
        </svg>
        <p>No ${activeTab} reminders</p>
      </div>
    `;
    return;
  }

  for (const reminder of filtered) {
    const patient = await dbHelper.get('patients', reminder.patientId);
    reminder.patientName = patient ? patient.name : 'Unknown';
    reminder.patientPhone = patient ? patient.phone : '';
  }

  listEl.innerHTML = filtered.map(reminder => `
    <div class="list-item">
      <div class="list-item-header">
        <div class="list-item-title">${reminder.reminderType}</div>
        ${!reminder.synced ? '<span class="status-badge unsynced">Unsynced</span>' : ''}
      </div>
      <div style="margin: 0.5rem 0; font-size: 0.875rem;">
        <div><strong>Patient:</strong> ${reminder.patientName}</div>
        <div><strong>Date:</strong> ${formatDateTime(reminder.reminderDate)}</div>
        ${reminder.message ? `<div style="margin-top: 0.25rem;">${reminder.message}</div>` : ''}
      </div>
      ${!reminder.isCompleted ? `
        <div class="list-item-actions">
          <button class="btn btn-secondary btn-mark-done" data-id="${reminder.id}">Mark Done</button>
          ${reminder.patientPhone ? `<button class="btn btn-secondary btn-call-reminder" data-phone="${reminder.patientPhone}">Call</button>` : ''}
        </div>
      ` : ''}
    </div>
  `).join('');

  listEl.querySelectorAll('.btn-mark-done').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const reminder = await dbHelper.get('reminders', id);
      reminder.isCompleted = true;
      reminder.completedAt = new Date().toISOString();
      reminder.synced = false;
      await dbHelper.put('reminders', reminder);
      showToast('Reminder marked as done', 'success');
      renderReminders();
      updateReminderBadge();
      updateSyncBadge();
    });
  });

  listEl.querySelectorAll('.btn-call-reminder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.href = `tel:${btn.dataset.phone}`;
    });
  });
}

async function renderSyncView() {
  const unsynced = await syncHelper.getUnsyncedRecords();

  const statusEl = document.getElementById('sync-status');
  if (unsynced.total === 0) {
    statusEl.textContent = 'All records are synced';
    statusEl.style.color = '#2D7D46';
  } else {
    statusEl.textContent = `${unsynced.total} unsynced records`;
    statusEl.style.color = '#E8A445';
  }

  const listEl = document.getElementById('unsynced-list');

  if (unsynced.total === 0) {
    listEl.innerHTML = '<p style="color: #999; text-align: center; padding: 1rem;">No unsynced records</p>';
    return;
  }

  let html = '';

  if (unsynced.patients.length > 0) {
    html += '<h4 style="margin: 1rem 0 0.5rem; font-size: 0.875rem; color: #666;">Patients</h4>';
    html += unsynced.patients.map(p => `
      <div class="list-item">
        <div class="list-item-title">${p.name}</div>
        <div style="font-size: 0.875rem; color: #666;">Added ${formatDate(p.createdAt)}</div>
      </div>
    `).join('');
  }

  if (unsynced.visits.length > 0) {
    html += '<h4 style="margin: 1rem 0 0.5rem; font-size: 0.875rem; color: #666;">Visits</h4>';
    for (const visit of unsynced.visits) {
      const patient = await dbHelper.get('patients', visit.patientId);
      html += `
        <div class="list-item">
          <div class="list-item-title">Visit - ${patient ? patient.name : 'Unknown'}</div>
          <div style="font-size: 0.875rem; color: #666;">${formatDate(visit.visitDate)}</div>
        </div>
      `;
    }
  }

  if (unsynced.reminders.length > 0) {
    html += '<h4 style="margin: 1rem 0 0.5rem; font-size: 0.875rem; color: #666;">Reminders</h4>';
    for (const reminder of unsynced.reminders) {
      const patient = await dbHelper.get('patients', reminder.patientId);
      html += `
        <div class="list-item">
          <div class="list-item-title">${reminder.reminderType} - ${patient ? patient.name : 'Unknown'}</div>
          <div style="font-size: 0.875rem; color: #666;">${formatDate(reminder.reminderDate)}</div>
        </div>
      `;
    }
  }

  listEl.innerHTML = html;
}

// ========================================
// Form Handlers
// ========================================
async function handleLoginForm(e) {
  e.preventDefault();

  const worker = {
    id: generateId(),
    name: document.getElementById('worker-name').value,
    phone: document.getElementById('worker-phone').value,
    role: document.getElementById('worker-role').value,
    area: document.getElementById('worker-area').value,
    createdAt: new Date().toISOString()
  };

  await dbHelper.put('workers', worker);
  appState.currentWorker = worker;

  localStorage.setItem('currentWorkerId', worker.id);

  document.getElementById('nav-worker-name').textContent = worker.name;
  document.getElementById('nav-worker-role').textContent = worker.role;

  switchScreen('app-screen');
  renderPatients();
  updateSyncBadge();
  updateReminderBadge();
}

async function handlePatientForm(e) {
  e.preventDefault();

  const patient = {
    id: generateId(),
    workerId: appState.currentWorker.id,
    name: document.getElementById('patient-name').value,
    age: parseInt(document.getElementById('patient-age').value) || null,
    gender: document.getElementById('patient-gender').value,
    phone: document.getElementById('patient-phone-form').value,
    village: document.getElementById('patient-village').value,
    address: document.getElementById('patient-address').value,
    bloodGroup: document.getElementById('patient-blood-group').value,
    medicalHistory: document.getElementById('patient-medical-history').value,
    synced: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await dbHelper.add('patients', patient);

  showToast('Patient saved locally. Will sync later.', 'success');
  updateSyncBadge();

  document.getElementById('patient-form').reset();
  switchView('patients');
}

async function handleVisitForm(e) {
  e.preventDefault();

  const visit = {
    id: generateId(),
    patientId: appState.currentPatient.id,
    workerId: appState.currentWorker.id,
    visitDate: new Date().toISOString(),
    symptoms: document.getElementById('visit-symptoms').value,
    vitals_bp: document.getElementById('visit-bp').value,
    vitals_temp: document.getElementById('visit-temp').value,
    vitals_pulse: document.getElementById('visit-pulse').value,
    vitals_weight: document.getElementById('visit-weight').value,
    diagnosis: document.getElementById('visit-diagnosis').value,
    treatment: document.getElementById('visit-treatment').value,
    notes: document.getElementById('visit-notes').value,
    followUpDate: document.getElementById('visit-followup').value || null,
    synced: false,
    createdAt: new Date().toISOString()
  };

  await dbHelper.add('visits', visit);

  showToast('Visit saved locally. Will sync later.', 'success');
  updateSyncBadge();

  document.getElementById('visit-form').reset();
  showPatientDetail(appState.currentPatient.id);
}

async function handleReminderForm(e) {
  e.preventDefault();

  const reminder = {
    id: generateId(),
    patientId: appState.currentPatient.id,
    workerId: appState.currentWorker.id,
    reminderType: document.getElementById('reminder-type').value,
    reminderDate: new Date(document.getElementById('reminder-date').value).toISOString(),
    message: document.getElementById('reminder-message').value,
    isCompleted: false,
    synced: false,
    createdAt: new Date().toISOString()
  };

  await dbHelper.add('reminders', reminder);

  showToast('Reminder saved locally. Will sync later.', 'success');
  updateSyncBadge();
  updateReminderBadge();

  document.getElementById('reminder-form').reset();
  showPatientDetail(appState.currentPatient.id);
}

// ========================================
// Eligibility Wizard
// ========================================
const app = {
  nextEligibilityStep(step) {
    document.querySelectorAll('.eligibility-step').forEach(s => s.classList.remove('active'));
    document.querySelector(`[data-step="${step}"]`).classList.add('active');
  },

  checkEligibility() {
    const age = document.getElementById('eligibility-age').value;
    const gender = document.getElementById('eligibility-gender').value;
    const pregnant = document.getElementById('eligibility-pregnant').checked;
    const chronic = document.getElementById('eligibility-chronic').checked;
    const disability = document.getElementById('eligibility-disability').checked;
    const bpl = document.getElementById('eligibility-bpl').checked;

    let programs = [];

    if (age === 'infant') {
      programs.push('Universal Immunization Program');
      programs.push('Integrated Child Development Services');
    }

    if (age === 'child') {
      programs.push('Mid-Day Meal Scheme');
      programs.push('School Health Program');
    }

    if (pregnant) {
      programs.push('Pradhan Mantri Matru Vandana Yojana');
      programs.push('Janani Suraksha Yojana');
    }

    if (chronic || disability) {
      programs.push('Rashtriya Arogya Nidhi');
    }

    if (bpl) {
      programs.push('Ayushman Bharat - PM-JAY');
      programs.push('National Health Mission');
    }

    if (age === 'senior') {
      programs.push('National Programme for Health Care of Elderly');
    }

    const resultsEl = document.getElementById('eligibility-results');

    if (programs.length === 0) {
      resultsEl.innerHTML = '<p style="color: #666;">No specific programs identified based on the information provided. General health services are available.</p>';
    } else {
      resultsEl.innerHTML = `
        <div style="background: #E8F5E9; padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
          <strong style="color: #2D7D46;">Eligible for ${programs.length} program(s)</strong>
        </div>
        <ul style="padding-left: 1.5rem;">
          ${programs.map(p => `<li style="margin-bottom: 0.5rem;">${p}</li>`).join('')}
        </ul>
      `;
    }

    this.nextEligibilityStep(4);
  },

  exportEligibility() {
    const age = document.getElementById('eligibility-age').value;
    const gender = document.getElementById('eligibility-gender').value;
    const pregnant = document.getElementById('eligibility-pregnant').checked;
    const chronic = document.getElementById('eligibility-chronic').checked;
    const disability = document.getElementById('eligibility-disability').checked;
    const bpl = document.getElementById('eligibility-bpl').checked;

    const resultsText = document.getElementById('eligibility-results').innerText;

    const report = `ELIGIBILITY CHECK REPORT
Generated: ${new Date().toLocaleString()}

PATIENT INFORMATION:
Age Group: ${age}
Gender: ${gender}
Pregnant: ${pregnant ? 'Yes' : 'No'}
Chronic Disease: ${chronic ? 'Yes' : 'No'}
Disability: ${disability ? 'Yes' : 'No'}
Below Poverty Line: ${bpl ? 'Yes' : 'No'}

RESULTS:
${resultsText}

Healthcare Worker: ${appState.currentWorker.name}
`;

    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eligibility-report-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Report exported', 'success');
  }
};

// Make app object available globally for onclick handlers
window.app = app;

// ========================================
// Event Listeners
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
  await dbHelper.init();

  const voiceSupported = voiceHelper.init();
  if (!voiceSupported) {
    console.warn('Voice recognition not supported');
  }

  const savedWorkerId = localStorage.getItem('currentWorkerId');
  if (savedWorkerId) {
    const worker = await dbHelper.get('workers', savedWorkerId);
    if (worker) {
      appState.currentWorker = worker;
      document.getElementById('nav-worker-name').textContent = worker.name;
      document.getElementById('nav-worker-role').textContent = worker.role;
      switchScreen('app-screen');
      renderPatients();
      updateSyncBadge();
      updateReminderBadge();
    }
  }

  document.getElementById('login-form').addEventListener('submit', handleLoginForm);
  document.getElementById('patient-form').addEventListener('submit', handlePatientForm);
  document.getElementById('visit-form').addEventListener('submit', handleVisitForm);
  document.getElementById('reminder-form').addEventListener('submit', handleReminderForm);

  document.getElementById('menu-btn').addEventListener('click', toggleNavDrawer);

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      switchView(view);
    });
  });

  document.getElementById('sync-btn').addEventListener('click', () => syncHelper.syncAll());
  document.getElementById('sync-all-btn').addEventListener('click', () => syncHelper.syncAll());

  document.getElementById('patient-search').addEventListener('input', () => renderPatients());
  document.getElementById('gender-filter').addEventListener('change', () => renderPatients());
  document.getElementById('village-filter').addEventListener('change', () => renderPatients());

  document.getElementById('voice-search-btn').addEventListener('click', () => {
    voiceHelper.start('patient-search');
  });

  document.getElementById('test-voice-btn').addEventListener('click', () => {
    const resultEl = document.getElementById('voice-test-result');
    resultEl.textContent = 'Listening...';

    const tempInput = document.createElement('input');
    tempInput.id = 'voice-test-temp';
    tempInput.style.display = 'none';
    document.body.appendChild(tempInput);

    voiceHelper.start('voice-test-temp');

    setTimeout(() => {
      const result = tempInput.value;
      if (result) {
        resultEl.textContent = `Success! You said: "${result}"`;
        resultEl.style.color = '#2D7D46';
      } else {
        resultEl.textContent = 'No speech detected. Try again.';
        resultEl.style.color = '#D84040';
      }
      document.body.removeChild(tempInput);
    }, 3000);
  });

  document.querySelectorAll('.voice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      voiceHelper.start(targetId);
    });
  });

  document.getElementById('add-patient-btn').addEventListener('click', () => {
    document.getElementById('patient-form').reset();
    switchView('patient-form');
  });

  document.getElementById('cancel-patient-form').addEventListener('click', () => {
    switchView('patients');
  });

  document.getElementById('back-to-patients').addEventListener('click', () => {
    switchView('patients');
  });

  document.getElementById('add-visit-btn').addEventListener('click', () => {
    document.getElementById('visit-form').reset();
    switchView('visit-form');
  });

  document.getElementById('cancel-visit-form').addEventListener('click', () => {
    showPatientDetail(appState.currentPatient.id);
  });

  document.getElementById('add-reminder-btn').addEventListener('click', () => {
    document.getElementById('reminder-form').reset();
    const now = new Date();
    now.setHours(now.getHours() + 1);
    document.getElementById('reminder-date').value = now.toISOString().slice(0, 16);
    switchView('reminder-form');
  });

  document.getElementById('cancel-reminder-form').addEventListener('click', () => {
    showPatientDetail(appState.currentPatient.id);
  });

  document.getElementById('call-patient-btn').addEventListener('click', () => {
    if (appState.currentPatient.phone) {
      window.location.href = `tel:${appState.currentPatient.phone}`;
    } else {
      showToast('No phone number available', 'error');
    }
  });

  document.getElementById('sos-btn').addEventListener('click', () => {
    sosHelper.trigger(appState.currentPatient);
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderReminders();
    });
  });

  document.getElementById('export-json-btn').addEventListener('click', () => exportHelper.exportJSON());
  document.getElementById('export-csv-btn').addEventListener('click', () => exportHelper.exportCSV());

  document.getElementById('import-json-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      exportHelper.importJSON(file);
    }
  });

  document.getElementById('request-mic-btn').addEventListener('click', async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      showToast('Microphone access granted', 'success');
    } catch (error) {
      showToast('Microphone access denied', 'error');
    }
  });

  document.getElementById('request-location-btn').addEventListener('click', async () => {
    try {
      await locationHelper.getCurrentPosition();
      showToast('Location access granted', 'success');
    } catch (error) {
      showToast('Location access denied', 'error');
    }
  });

  document.getElementById('clear-data-btn').addEventListener('click', async () => {
    const confirmed = await showModal(
      'Clear All Data',
      'This will permanently delete all local records. This action cannot be undone. Export your data first if needed.'
    );

    if (confirmed) {
      await dbHelper.clear('patients');
      await dbHelper.clear('visits');
      await dbHelper.clear('reminders');
      showToast('All data cleared', 'success');
      renderPatients();
      updateSyncBadge();
      updateReminderBadge();
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    const confirmed = await showModal(
      'Logout',
      'Are you sure you want to logout? Unsynced data will remain on this device.'
    );

    if (confirmed) {
      localStorage.removeItem('currentWorkerId');
      location.reload();
    }
  });

  window.addEventListener('online', () => {
    appState.isOnline = true;
    showToast('Back online', 'success');
  });

  window.addEventListener('offline', () => {
    appState.isOnline = false;
    showToast('You are offline. Data will be saved locally.', 'error');
  });
});

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('Service Worker registered'))
      .catch(err => console.error('Service Worker registration failed:', err));
  });
}