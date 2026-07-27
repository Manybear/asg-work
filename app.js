import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;   // firebase auth user
let profile = null;       // { name, role, uid }
let settings = { visibilityMode: 'adminOnly' }; // 'private' | 'adminOnly' | 'public'
let usersCache = [];

// editing state (null = not editing / adding new)
let editingProjectId = null;
let editingTaskId = null;
let editingCustomerId = null;
let editingUpdateId = null;

// latest rendered data, cached for edit-prefill / CSV export
let projectsCache = [];
let tasksCache = [];
let updatesCache = [];
let customersCache = [];

// ---------- AUTH ----------
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const pw = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, pw);
  } catch (err) {
    errBox.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + friendlyError(err.code);
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));

function friendlyError(code) {
  const map = {
    'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    'auth/user-not-found': 'ไม่พบบัญชีนี้',
    'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
    'auth/email-already-in-use': 'อีเมลนี้ถูกใช้แล้ว',
    'auth/weak-password': 'รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัวอักษร)'
  };
  return map[code] || code;
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    await loadProfile(user.uid, user.email);
    document.getElementById('loginScreen').classList.remove('active-screen');
    document.getElementById('appScreen').classList.add('active-screen');
    document.getElementById('meLabel').textContent = profile.name + (profile.role === 'admin' ? ' (หัวหน้า)' : '');
    await loadSettings();
    await loadUsers();
    initRealtimeListeners();
    showPage('dashboard');
  } else {
    document.getElementById('loginScreen').classList.add('active-screen');
    document.getElementById('appScreen').classList.remove('active-screen');
  }
});

async function loadProfile(uid, email) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    profile = { uid, ...snap.data() };
  } else {
    // First-time login: create a basic staff profile.
    // Promote the FIRST person who ever signs in to admin manually in Firestore console.
    const newProfile = { name: email.split('@')[0], email, role: 'staff', createdAt: serverTimestamp() };
    await setDoc(ref, newProfile);
    profile = { uid, ...newProfile };
  }
}

async function loadSettings() {
  const ref = doc(db, 'settings', 'global');
  const snap = await getDoc(ref);
  if (snap.exists()) settings = snap.data();
  else await setDoc(ref, settings);
  document.getElementById('visibilitySelect').value = settings.visibilityMode;
  document.getElementById('adminPanel').style.display = profile.role === 'admin' ? 'block' : 'none';
}

async function loadUsers() {
  const snap = await getDocs(collection(db, 'users'));
  usersCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const sels = document.querySelectorAll('.assigneeSelect');
  sels.forEach(sel => {
    sel.innerHTML = usersCache.map(u => `<option value="${u.uid}">${u.name}</option>`).join('');
  });
}

// ---------- VISIBILITY HELPER ----------
// Decide which uids' data the current user is allowed to see.
function visibleUids() {
  if (profile.role === 'admin') return null; // null = no filter, sees everyone
  if (settings.visibilityMode === 'public') return null; // everyone sees everyone
  return [profile.uid]; // 'private' or 'adminOnly' -> staff sees only their own
}

document.getElementById('visibilitySelect').addEventListener('change', async (e) => {
  if (profile.role !== 'admin') return;
  settings.visibilityMode = e.target.value;
  await setDoc(doc(db, 'settings', 'global'), settings);
});

// ---------- NAVIGATION ----------
window.showPage = function (page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');
};

// ---------- PROJECTS & TASKS ----------
document.getElementById('projectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    name: document.getElementById('projName').value.trim(),
    startDate: document.getElementById('projStart').value,
    dueDate: document.getElementById('projDue').value,
    status: document.getElementById('projStatus').value
  };
  if (editingProjectId) {
    await updateDoc(doc(db, 'projects', editingProjectId), data);
    cancelEditProject();
  } else {
    await addDoc(collection(db, 'projects'), { ...data, createdBy: profile.uid, createdAt: serverTimestamp() });
    e.target.reset();
  }
});

window.editProject = (id) => {
  const p = projectsCache.find(x => x.id === id);
  if (!p) return;
  editingProjectId = id;
  document.getElementById('projName').value = p.name || '';
  document.getElementById('projStart').value = p.startDate || '';
  document.getElementById('projDue').value = p.dueDate || '';
  document.getElementById('projStatus').value = p.status || 'planning';
  document.getElementById('projSubmitBtn').textContent = 'บันทึกการแก้ไข';
  document.getElementById('projCancelBtn').style.display = 'inline-block';
  document.getElementById('projectForm').classList.add('editing');
  document.getElementById('projectForm').scrollIntoView({ behavior: 'smooth' });
};

window.cancelEditProject = () => {
  editingProjectId = null;
  document.getElementById('projectForm').reset();
  document.getElementById('projSubmitBtn').textContent = '+ เพิ่มโปรเจกต์';
  document.getElementById('projCancelBtn').style.display = 'none';
  document.getElementById('projectForm').classList.remove('editing');
};

window.deleteProject = async (id) => {
  if (!confirm('ลบโปรเจกต์นี้? งานย่อยที่ผูกกับโปรเจกต์นี้จะยังอยู่ แต่จะไม่มีโปรเจกต์แม่แล้ว')) return;
  await deleteDoc(doc(db, 'projects', id));
};

document.getElementById('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    projectId: document.getElementById('taskProject').value,
    title: document.getElementById('taskTitle').value.trim(),
    assignee: document.getElementById('taskAssignee').value,
    dueDate: document.getElementById('taskDue').value
  };
  if (editingTaskId) {
    await updateDoc(doc(db, 'tasks', editingTaskId), data);
    cancelEditTask();
  } else {
    await addDoc(collection(db, 'tasks'), { ...data, status: 'notyet', createdAt: serverTimestamp() });
    e.target.reset();
  }
});

window.editTask = (id) => {
  const t = tasksCache.find(x => x.id === id);
  if (!t) return;
  editingTaskId = id;
  document.getElementById('taskProject').value = t.projectId || '';
  document.getElementById('taskTitle').value = t.title || '';
  document.getElementById('taskAssignee').value = t.assignee || '';
  document.getElementById('taskDue').value = t.dueDate || '';
  document.getElementById('taskSubmitBtn').textContent = 'บันทึกการแก้ไข';
  document.getElementById('taskCancelBtn').style.display = 'inline-block';
  document.getElementById('taskForm').classList.add('editing');
  document.getElementById('taskForm').scrollIntoView({ behavior: 'smooth' });
};

window.cancelEditTask = () => {
  editingTaskId = null;
  document.getElementById('taskForm').reset();
  document.getElementById('taskSubmitBtn').textContent = '+ เพิ่มงาน';
  document.getElementById('taskCancelBtn').style.display = 'none';
  document.getElementById('taskForm').classList.remove('editing');
};

window.deleteTask = async (id) => {
  if (!confirm('ลบงานนี้?')) return;
  await deleteDoc(doc(db, 'tasks', id));
};

function initRealtimeListeners() {
  // Projects
  onSnapshot(collection(db, 'projects'), (snap) => {
    const projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProjects(projects);
    const projSel = document.getElementById('taskProject');
    projSel.innerHTML = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  });

  // Tasks (filtered by visibility)
  onSnapshot(collection(db, 'tasks'), (snap) => {
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const uids = visibleUids();
    const tasks = uids ? all.filter(t => uids.includes(t.assignee)) : all;
    renderTasks(tasks);
    checkTaskReminders(all);
  });

  // Daily updates
  onSnapshot(query(collection(db, 'dailyUpdates'), orderBy('date', 'desc')), (snap) => {
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const uids = visibleUids();
    const updates = uids ? all.filter(u => uids.includes(u.uid)) : all;
    renderDailyUpdates(updates);
  });

  // Customers / contracts
  onSnapshot(collection(db, 'customers'), (snap) => {
    const customers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCustomers(customers);
    checkContractReminders(customers);
  });
}

function renderProjects(projects) {
  projectsCache = projects;
  const box = document.getElementById('projectList');
  box.innerHTML = projects.map(p => `
    <div class="card">
      <b>${p.name}</b> <span class="badge ${p.status === 'done' ? 'done' : 'inprog'}">${p.status}</span>
      <div class="ts">เริ่ม ${p.startDate || '-'} · กำหนดเสร็จ ${p.dueDate || '-'}</div>
      <div class="card-actions">
        <button class="icon-btn edit" onclick="editProject('${p.id}')">✏️ แก้ไข</button>
        ${profile.role === 'admin' ? `<button class="icon-btn del" onclick="deleteProject('${p.id}')">🗑 ลบ</button>` : ''}
      </div>
    </div>`).join('') || '<p class="muted">ยังไม่มีโปรเจกต์</p>';
}

function renderTasks(tasks) {
  tasksCache = tasks;
  const box = document.getElementById('taskList');
  box.innerHTML = tasks.map(t => {
    const u = usersCache.find(x => x.uid === t.assignee);
    const canEdit = profile.role === 'admin' || t.assignee === profile.uid;
    return `<div class="card">
      <b>${t.title}</b> <span class="badge ${t.status}">${t.status}</span>
      <div class="ts">ผู้รับผิดชอบ: ${u ? u.name : '-'} · กำหนดส่ง ${t.dueDate || '-'}</div>
      <select onchange="updateTaskStatus('${t.id}', this.value)">
        <option value="notyet" ${t.status === 'notyet' ? 'selected' : ''}>ยังไม่เริ่ม</option>
        <option value="inprog" ${t.status === 'inprog' ? 'selected' : ''}>กำลังทำ</option>
        <option value="done" ${t.status === 'done' ? 'selected' : ''}>เสร็จแล้ว</option>
      </select>
      ${canEdit ? `<div class="card-actions">
        <button class="icon-btn edit" onclick="editTask('${t.id}')">✏️ แก้ไข</button>
        <button class="icon-btn del" onclick="deleteTask('${t.id}')">🗑 ลบ</button>
      </div>` : ''}
    </div>`;
  }).join('') || '<p class="muted">ยังไม่มีงาน</p>';
}

window.updateTaskStatus = async (id, status) => {
  await updateDoc(doc(db, 'tasks', id), { status });
};

// ---------- DAILY UPDATES ----------
document.getElementById('updateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = document.getElementById('updateText').value.trim();
  if (editingUpdateId) {
    await updateDoc(doc(db, 'dailyUpdates', editingUpdateId), { text });
    cancelEditUpdate();
  } else {
    await addDoc(collection(db, 'dailyUpdates'), {
      uid: profile.uid,
      date: new Date().toISOString().slice(0, 10),
      text,
      createdAt: serverTimestamp()
    });
    e.target.reset();
  }
});

window.editUpdate = (id) => {
  const u = updatesCache.find(x => x.id === id);
  if (!u) return;
  editingUpdateId = id;
  document.getElementById('updateText').value = u.text || '';
  document.getElementById('updateSubmitBtn').textContent = 'บันทึกการแก้ไข';
  document.getElementById('updateCancelBtn').style.display = 'inline-block';
  document.getElementById('updateForm').classList.add('editing');
  document.getElementById('updateForm').scrollIntoView({ behavior: 'smooth' });
};

window.cancelEditUpdate = () => {
  editingUpdateId = null;
  document.getElementById('updateForm').reset();
  document.getElementById('updateSubmitBtn').textContent = 'บันทึก';
  document.getElementById('updateCancelBtn').style.display = 'none';
  document.getElementById('updateForm').classList.remove('editing');
};

window.deleteUpdate = async (id) => {
  if (!confirm('ลบอัปเดตนี้?')) return;
  await deleteDoc(doc(db, 'dailyUpdates', id));
};

function renderDailyUpdates(updates) {
  updatesCache = updates;
  const box = document.getElementById('updateList');
  box.innerHTML = updates.map(u => {
    const person = usersCache.find(x => x.uid === u.uid);
    const canEdit = profile.role === 'admin' || u.uid === profile.uid;
    return `<div class="card">
      <b>${person ? person.name : '-'}</b> <span class="ts">${u.date}</span>
      <div>${u.text}</div>
      ${canEdit ? `<div class="card-actions">
        <button class="icon-btn edit" onclick="editUpdate('${u.id}')">✏️ แก้ไข</button>
        <button class="icon-btn del" onclick="deleteUpdate('${u.id}')">🗑 ลบ</button>
      </div>` : ''}
    </div>`;
  }).join('') || '<p class="muted">ยังไม่มีอัปเดต</p>';
}

// ---------- CUSTOMERS / CONTRACTS ----------
document.getElementById('customerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    name: document.getElementById('custName').value.trim(),
    contractEndDate: document.getElementById('custEndDate').value,
    reminderDays: parseInt(document.getElementById('custReminderDays').value || '15', 10),
    note: document.getElementById('custNote').value.trim()
  };
  if (editingCustomerId) {
    await updateDoc(doc(db, 'customers', editingCustomerId), data);
    cancelEditCustomer();
  } else {
    await addDoc(collection(db, 'customers'), { ...data, createdAt: serverTimestamp() });
    e.target.reset();
  }
});

window.editCustomer = (id) => {
  const c = customersCache.find(x => x.id === id);
  if (!c) return;
  editingCustomerId = id;
  document.getElementById('custName').value = c.name || '';
  document.getElementById('custEndDate').value = c.contractEndDate || '';
  document.getElementById('custReminderDays').value = c.reminderDays || 15;
  document.getElementById('custNote').value = c.note || '';
  document.getElementById('custSubmitBtn').textContent = 'บันทึกการแก้ไข';
  document.getElementById('custCancelBtn').style.display = 'inline-block';
  document.getElementById('customerForm').classList.add('editing');
  document.getElementById('customerForm').scrollIntoView({ behavior: 'smooth' });
};

window.cancelEditCustomer = () => {
  editingCustomerId = null;
  document.getElementById('customerForm').reset();
  document.getElementById('custSubmitBtn').textContent = '+ เพิ่มลูกค้า';
  document.getElementById('custCancelBtn').style.display = 'none';
  document.getElementById('customerForm').classList.remove('editing');
};

window.deleteCustomer = async (id) => {
  if (!confirm('ลบข้อมูลลูกค้ารายนี้?')) return;
  await deleteDoc(doc(db, 'customers', id));
};

function renderCustomers(customers) {
  customersCache = customers;
  const box = document.getElementById('customerList');
  box.innerHTML = customers.map(c => `
    <div class="card">
      <b>${c.name}</b>
      <div class="ts">ครบสัญญา ${c.contractEndDate || '-'} · แจ้งเตือนล่วงหน้า ${c.reminderDays} วัน</div>
      ${c.note ? `<div>${c.note}</div>` : ''}
      <div class="card-actions">
        <button class="icon-btn edit" onclick="editCustomer('${c.id}')">✏️ แก้ไข</button>
        ${profile.role === 'admin' ? `<button class="icon-btn del" onclick="deleteCustomer('${c.id}')">🗑 ลบ</button>` : ''}
      </div>
    </div>`).join('') || '<p class="muted">ยังไม่มีข้อมูลลูกค้า</p>';
}

// ---------- NOTIFICATIONS ----------
function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function checkTaskReminders(tasks) {
  const uids = visibleUids();
  const mine = uids ? tasks.filter(t => uids.includes(t.assignee)) : tasks;
  const soon = mine.filter(t => t.status !== 'done' && daysUntil(t.dueDate) <= 3 && daysUntil(t.dueDate) >= 0);
  renderNotifBanner('task', soon.map(t => `งาน "${t.title}" กำหนดส่งอีก ${daysUntil(t.dueDate)} วัน`));
}

function checkContractReminders(customers) {
  const soon = customers.filter(c => {
    const d = daysUntil(c.contractEndDate);
    return d >= 0 && d <= (c.reminderDays || 15);
  });
  renderNotifBanner('contract', soon.map(c => `ลูกค้า "${c.name}" ครบสัญญาอีก ${daysUntil(c.contractEndDate)} วัน`));
}

const notifState = { task: [], contract: [] };
function renderNotifBanner(kind, lines) {
  notifState[kind] = lines;
  const all = [...notifState.task, ...notifState.contract];
  const box = document.getElementById('notifBanner');
  const badge = document.getElementById('notifCount');
  badge.textContent = all.length;
  badge.style.display = all.length ? 'inline-block' : 'none';
  box.innerHTML = all.length
    ? all.map(l => `<div class="notif-item">${l}</div>`).join('')
    : '<div class="muted" style="padding:12px">ไม่มีการแจ้งเตือน</div>';
}

document.getElementById('bellBtn').addEventListener('click', () => {
  document.getElementById('notifBanner').classList.toggle('open');
});

// ---------- EXPORT CSV ----------
function csvEscape(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

function downloadCSV(filename, rows) {
  // BOM so Thai text opens correctly in Excel
  const csv = '\uFEFF' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

window.exportCSVGeneric = (type) => {
  const nameOf = (uid) => (usersCache.find(u => u.uid === uid) || {}).name || '-';
  const projectNameOf = (pid) => (projectsCache.find(p => p.id === pid) || {}).name || '-';

  if (type === 'projects') {
    const rows = [['ชื่อโปรเจกต์', 'วันเริ่ม', 'กำหนดเสร็จ', 'สถานะ']];
    projectsCache.forEach(p => rows.push([p.name, p.startDate, p.dueDate, p.status]));
    downloadCSV('asg-work-projects.csv', rows);
  } else if (type === 'tasks') {
    const rows = [['ชื่องาน', 'โปรเจกต์', 'ผู้รับผิดชอบ', 'กำหนดส่ง', 'สถานะ']];
    tasksCache.forEach(t => rows.push([t.title, projectNameOf(t.projectId), nameOf(t.assignee), t.dueDate, t.status]));
    downloadCSV('asg-work-tasks.csv', rows);
  } else if (type === 'updates') {
    const rows = [['วันที่', 'ผู้บันทึก', 'รายละเอียด']];
    updatesCache.forEach(u => rows.push([u.date, nameOf(u.uid), u.text]));
    downloadCSV('asg-work-daily-updates.csv', rows);
  } else if (type === 'customers') {
    const rows = [['ชื่อลูกค้า', 'วันครบสัญญา', 'แจ้งเตือนล่วงหน้า (วัน)', 'โน้ต']];
    customersCache.forEach(c => rows.push([c.name, c.contractEndDate, c.reminderDays, c.note]));
    downloadCSV('asg-work-customers.csv', rows);
  }
};

// ---------- PRINT ----------
window.printPage = (pageId) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('printing'));
  document.getElementById(pageId).classList.add('printing');
  window.print();
  setTimeout(() => document.getElementById(pageId).classList.remove('printing'), 500);
};

// ---------- ADMIN: manage users ----------
document.getElementById('addUserForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('newUserEmail').value.trim();
  const pw = document.getElementById('newUserPassword').value;
  const name = document.getElementById('newUserName').value.trim();
  const errBox = document.getElementById('addUserError');
  errBox.textContent = '';
  try {
    // NOTE: creating a user this way signs the admin OUT and signs the new user IN,
    // because client-side Firebase Auth can only create+sign-in in one step.
    // Simplest workaround for a 10-person team: admin creates all accounts once up front,
    // then re-logs into their own account afterward.
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await setDoc(doc(db, 'users', cred.user.uid), { name, email, role: 'staff', createdAt: serverTimestamp() });
    alert('สร้างบัญชีสำเร็จ: ' + email + '\nระบบจะสลับไปล็อกอินเป็นบัญชีนี้ชั่วคราว กรุณาล็อกอินกลับเป็นบัญชีของคุณอีกครั้ง');
  } catch (err) {
    errBox.textContent = friendlyError(err.code);
  }
});
