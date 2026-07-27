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

// Initialize Main Firebase Instance
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Initialize Secondary Firebase Instance (Workaround for Admin creating users without logout)
const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
const secondaryAuth = getAuth(secondaryApp);

// Global States
let currentUser = null;   // Firebase auth user
let profile = null;       // { name, role, uid }
let settings = { visibilityMode: 'adminOnly' }; // 'private' | 'adminOnly' | 'public'

// Cache arrays
let usersCache = [];
let projectsCache = [];
let tasksCache = [];
let updatesCache = [];
let customersCache = [];

// Editing IDs
let editingProjectId = null;
let editingCustomerId = null;
let editingUpdateId = null;

// Modal States
let activeDetailsTaskId = null;
let currentTaskImageData = null; // Base64 compressed image

// ---------- SYSTEM INTIALIZATION & THEME ----------

document.addEventListener('DOMContentLoaded', () => {
  loadAppTheme();
});

function loadAppTheme() {
  const savedColor = localStorage.getItem('asg_theme_color');
  if (savedColor) {
    applyThemeColor(savedColor);
    const picker = document.getElementById('themeCustomPicker');
    if (picker) picker.value = savedColor;
  } else {
    applyThemeColor('#b91c1c'); // Default polite red
  }
}

function applyThemeColor(color) {
  document.documentElement.style.setProperty('--primary-red', color);
  const hoverColor = adjustColorBrightness(color, -15);
  document.documentElement.style.setProperty('--primary-red-hover', hoverColor);
  const lightBg = adjustColorBrightness(color, 90);
  document.documentElement.style.setProperty('--primary-red-light', lightBg);
}

function adjustColorBrightness(hex, percent) {
  let num = parseInt(hex.replace("#",""), 16),
      amt = Math.round(2.55 * percent),
      R = (num >> 16) + amt,
      G = (num >> 8 & 0x00FF) + amt,
      B = (num & 0x0000FF) + amt;
  R = Math.max(0, Math.min(255, R));
  G = Math.max(0, Math.min(255, G));
  B = Math.max(0, Math.min(255, B));
  return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

window.setAppTheme = function(color) {
  localStorage.setItem('asg_theme_color', color);
  applyThemeColor(color);
};

// ---------- AUTHENTICATION & LOGIN ----------

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
    'auth/email-already-in-use': 'อีเมลนี้ถูกลงทะเบียนใช้งานแล้ว',
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
    document.getElementById('meLabel').innerHTML = `<i class="fa-solid fa-user-tie"></i> ${profile.name} ${profile.role === 'admin' ? '<span class="badge urgent" style="padding:1px 5px; font-size:9px">หัวหน้า</span>' : ''}`;
    
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
    // First sign in default fallback
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
  
  // Populate filter dropdowns
  const filterAssignee = document.getElementById('filterAssignee');
  const selectedAssignee = filterAssignee.value;
  filterAssignee.innerHTML = '<option value="">ทุกคนในทีม</option>' + 
    usersCache.map(u => `<option value="${u.uid}">${u.name}</option>`).join('');
  filterAssignee.value = selectedAssignee;
  
  renderTeamMembers(usersCache, tasksCache);
}

// ---------- VISIBILITY RULES ----------

function visibleUids() {
  if (profile.role === 'admin') return null; // sees everyone
  if (settings.visibilityMode === 'public') return null; // sees everyone
  return [profile.uid]; // sees only own tasks
}

document.getElementById('visibilitySelect').addEventListener('change', async (e) => {
  if (profile.role !== 'admin') return;
  settings.visibilityMode = e.target.value;
  await setDoc(doc(db, 'settings', 'global'), settings);
});

// ---------- NAVIGATION CONTROL ----------

window.showPage = function (page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  
  const targetPage = document.getElementById('page-' + page);
  if (targetPage) targetPage.classList.add('active');
  
  const targetBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  if (targetBtn) targetBtn.classList.add('active');
  
  // Close any popups
  document.getElementById('notifBanner').classList.remove('open');
};

// ---------- PROJECTS CRUD ----------

document.getElementById('projectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    name: document.getElementById('projName').value.trim(),
    customerId: document.getElementById('projCustomer').value,
    startDate: document.getElementById('projStart').value,
    dueDate: document.getElementById('projDue').value,
    status: document.getElementById('projStatus').value
  };
  
  try {
    if (editingProjectId) {
      await updateDoc(doc(db, 'projects', editingProjectId), data);
      cancelEditProject();
    } else {
      await addDoc(collection(db, 'projects'), { ...data, createdBy: profile.uid, createdAt: serverTimestamp() });
      e.target.reset();
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการบันทึกโครงการ: ' + err.message);
  }
});

window.editProject = (id) => {
  const p = projectsCache.find(x => x.id === id);
  if (!p) return;
  editingProjectId = id;
  document.getElementById('projName').value = p.name || '';
  document.getElementById('projCustomer').value = p.customerId || '';
  document.getElementById('projStart').value = p.startDate || '';
  document.getElementById('projDue').value = p.dueDate || '';
  document.getElementById('projStatus').value = p.status || 'planning';
  document.getElementById('projSubmitBtn').innerHTML = '<i class="fa-solid fa-check"></i> บันทึกการแก้ไข';
  document.getElementById('projCancelBtn').style.display = 'inline-block';
  document.getElementById('projectForm').classList.add('editing');
  document.getElementById('projectForm').scrollIntoView({ behavior: 'smooth' });
};

window.cancelEditProject = () => {
  editingProjectId = null;
  document.getElementById('projectForm').reset();
  document.getElementById('projSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> เพิ่มโปรเจกต์';
  document.getElementById('projCancelBtn').style.display = 'none';
  document.getElementById('projectForm').classList.remove('editing');
};

window.deleteProject = async (id) => {
  if (!confirm('ลบโปรเจกต์นี้? งานย่อยที่ผูกกับโปรเจกต์จะยังคงอยู่แต่จะไม่มีสัญลักษณ์เชื่อมโยง')) return;
  try {
    await deleteDoc(doc(db, 'projects', id));
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
};

// ---------- CLIENT-SIDE IMAGE COMPRESSION (CANVAS) ----------

window.handleTaskImageUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Fit to maximum width/height of 800px to secure free space limits
      const max_size = 800;
      let width = img.width;
      let height = img.height;
      
      if (width > height) {
        if (width > max_size) {
          height *= max_size / width;
          width = max_size;
        }
      } else {
        if (height > max_size) {
          width *= max_size / height;
          height = max_size;
        }
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      // Compress to 70% quality JPEG
      currentTaskImageData = canvas.toDataURL('image/jpeg', 0.7);
      
      const previewBox = document.getElementById('taskImagePreview');
      previewBox.innerHTML = `
        <div style="position:relative; display:inline-block">
          <img src="${currentTaskImageData}" style="width:70px; height:70px; object-fit:cover; border-radius:6px; border:1px solid var(--border-color);">
          <button type="button" onclick="removeTaskImage()" style="position:absolute; top:-6px; right:-6px; background:#ef4444; color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center;">×</button>
        </div>
      `;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

window.removeTaskImage = function() {
  currentTaskImageData = null;
  document.getElementById('taskImagePreview').innerHTML = '';
  document.getElementById('taskImageFile').value = '';
};

// ---------- TASK ASSIGNMENT MODAL & CRUD ----------

window.openAddTaskModal = function(taskId = null) {
  // Clear modal inputs
  currentTaskImageData = null;
  document.getElementById('taskLinksContainer').innerHTML = '';
  document.getElementById('taskImagePreview').innerHTML = '';
  document.getElementById('taskImageFile').value = '';
  
  // Populate dropdowns
  const projSelect = document.getElementById('taskProjectSelect');
  projSelect.innerHTML = '<option value="">-- เลือกโครงการ --</option>' + 
    projectsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    
  const assigneeSelect = document.getElementById('taskAssigneeSelect');
  assigneeSelect.innerHTML = '<option value="">-- เลือกคนในทีม --</option>' + 
    usersCache.map(u => `<option value="${u.uid}">${u.name}</option>`).join('');

  if (taskId) {
    // Edit Mode
    const t = tasksCache.find(x => x.id === taskId);
    if (!t) return;
    editingTaskId = taskId;
    document.getElementById('modalTaskTitle').textContent = 'แก้ไขรายละเอียดงาน';
    document.getElementById('taskTitleInput').value = t.title || '';
    document.getElementById('taskDescInput').value = t.description || '';
    document.getElementById('taskProjectSelect').value = t.projectId || '';
    document.getElementById('taskAssigneeSelect').value = t.assignee || '';
    document.getElementById('taskPrioritySelect').value = t.priority || 'mid';
    document.getElementById('taskDueInput').value = t.dueDate || '';
    document.getElementById('taskSubmitBtnText').innerHTML = '<i class="fa-solid fa-check"></i> บันทึกการแก้ไข';
    
    // Add links inputs if any
    if (t.links && t.links.length) {
      t.links.forEach(l => addModalLinkInput(l.url, l.label));
    }
    
    // Preview image if any
    if (t.imageData) {
      currentTaskImageData = t.imageData;
      const previewBox = document.getElementById('taskImagePreview');
      previewBox.innerHTML = `
        <div style="position:relative; display:inline-block">
          <img src="${currentTaskImageData}" style="width:70px; height:70px; object-fit:cover; border-radius:6px; border:1px solid var(--border-color);">
          <button type="button" onclick="removeTaskImage()" style="position:absolute; top:-6px; right:-6px; background:#ef4444; color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center;">×</button>
        </div>
      `;
    }
  } else {
    // Add Mode
    editingTaskId = null;
    document.getElementById('modalTaskTitle').textContent = 'มอบหมายงานใหม่';
    document.getElementById('taskFormSubmit').reset();
    document.getElementById('taskSubmitBtnText').innerHTML = '<i class="fa-solid fa-plus"></i> มอบหมายงาน';
  }
  
  document.getElementById('taskModal').classList.add('open');
};

window.closeAddTaskModal = function() {
  document.getElementById('taskModal').classList.remove('open');
  editingTaskId = null;
};

window.addModalLinkInput = function(urlText = "", labelText = "") {
  const container = document.getElementById('taskLinksContainer');
  const div = document.createElement('div');
  div.className = 'link-input-row';
  div.innerHTML = `
    <input type="text" placeholder="ชื่อป้ายกำกับลิงก์ เช่น Google Drive" value="${labelText}" class="link-label-input" style="width:30%">
    <input type="url" placeholder="https://example.com" value="${urlText}" class="link-url-input">
    <button type="button" class="icon-btn del" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
  `;
  container.appendChild(div);
};

function getModalLinks() {
  const container = document.getElementById('taskLinksContainer');
  const rows = container.querySelectorAll('.link-input-row');
  const links = [];
  rows.forEach(row => {
    const label = row.querySelector('.link-label-input').value.trim();
    const url = row.querySelector('.link-url-input').value.trim();
    if (url) {
      links.push({ label: label || 'ลิงก์เอกสาร', url: url });
    }
  });
  return links;
}

document.getElementById('taskFormSubmit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    title: document.getElementById('taskTitleInput').value.trim(),
    description: document.getElementById('taskDescInput').value.trim(),
    projectId: document.getElementById('taskProjectSelect').value,
    assignee: document.getElementById('taskAssigneeSelect').value,
    priority: document.getElementById('taskPrioritySelect').value,
    dueDate: document.getElementById('taskDueInput').value,
    links: getModalLinks(),
    imageData: currentTaskImageData,
    updatedAt: serverTimestamp()
  };
  
  try {
    if (editingTaskId) {
      await updateDoc(doc(db, 'tasks', editingTaskId), data);
    } else {
      const newTask = {
        ...data,
        status: 'notyet',
        percent: 0,
        subtasks: [],
        comments: [],
        createdBy: profile.uid,
        createdAt: serverTimestamp()
      };
      await addDoc(collection(db, 'tasks'), newTask);
    }
    closeAddTaskModal();
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการเซฟงาน: ' + err.message);
  }
});

window.deleteTask = async (id) => {
  if (!confirm('ลบงานนี้?')) return;
  try {
    await deleteDoc(doc(db, 'tasks', id));
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
};

// ---------- INTERACTIVE TASK DETAILS MODAL (Real-time updates, comments, subtasks) ----------

window.openTaskDetailsModal = function(taskId) {
  activeDetailsTaskId = taskId;
  const t = tasksCache.find(x => x.id === taskId);
  if (!t) return;
  
  renderTaskDetailsModalContent(t);
  document.getElementById('taskDetailsModal').classList.add('open');
};

window.closeTaskDetailsModal = function() {
  document.getElementById('taskDetailsModal').classList.remove('open');
  activeDetailsTaskId = null;
};

function renderTaskDetailsModalContent(t) {
  document.getElementById('detTaskTitle').textContent = t.title || '';
  
  // Priority Badge
  const pBadge = document.getElementById('detTaskPriorityBadge');
  pBadge.className = 'badge ' + (t.priority || 'mid');
  const prioLabels = { urgent: 'ด่วนที่สุด', high: 'สูง', mid: 'กลาง', low: 'ต่ำ' };
  pBadge.textContent = prioLabels[t.priority || 'mid'];
  
  // Meta mappings
  const proj = projectsCache.find(x => x.id === t.projectId);
  document.getElementById('detTaskProject').textContent = proj ? proj.name : '-';
  
  const user = usersCache.find(x => x.uid === t.assignee);
  document.getElementById('detTaskAssignee').textContent = user ? user.name : '-';
  document.getElementById('detTaskDue').textContent = t.dueDate || '-';
  
  // Status select dropdown
  document.getElementById('detTaskStatusSelect').value = t.status || 'notyet';
  
  // Description
  const descBox = document.getElementById('detTaskDesc');
  if (t.description) {
    descBox.textContent = t.description;
    descBox.style.display = 'block';
  } else {
    descBox.textContent = 'ไม่มีรายละเอียดเพิ่มเติม';
  }
  
  // Render Subtasks
  renderSubtasksList(t.subtasks || []);
  
  // Image & Links panel
  const mediaRow = document.getElementById('detTaskMediaRow');
  const imgBox = document.getElementById('detTaskImageContainer');
  const linksBox = document.getElementById('detTaskLinksContainer');
  
  const hasImage = !!t.imageData;
  const hasLinks = !!(t.links && t.links.length);
  
  if (hasImage || hasLinks) {
    mediaRow.style.display = 'block';
    
    if (hasImage) {
      imgBox.innerHTML = `<img src="${t.imageData}" style="width:100px; height:100px; object-fit:cover; border-radius:8px; border:1px solid var(--border-color); cursor:pointer;" onclick="openImageModal('${t.imageData}')">`;
    } else {
      imgBox.innerHTML = '';
    }
    
    if (hasLinks) {
      linksBox.innerHTML = t.links.map(l => `
        <a href="${l.url}" target="_blank" style="color:var(--primary-red); text-decoration:none; font-weight:600; display:inline-flex; align-items:center; gap:6px;">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> ${l.label}
        </a>
      `).join('');
    } else {
      linksBox.innerHTML = '';
    }
  } else {
    mediaRow.style.display = 'none';
  }
  
  // Render comments
  renderCommentsList(t.comments || []);
}

function renderSubtasksList(subtasks) {
  const list = document.getElementById('detTaskSubtaskList');
  if (!subtasks || subtasks.length === 0) {
    list.innerHTML = '<p class="muted" style="font-size:12px">ยังไม่มีรายการงานย่อย</p>';
    updateProgressBar(0);
    return;
  }
  
  list.innerHTML = subtasks.map((st, idx) => `
    <div class="subtask-item">
      <input type="checkbox" ${st.done ? 'checked' : ''} onchange="toggleSubtaskStatus(${idx}, this.checked)">
      <span class="subtask-text ${st.done ? 'completed' : ''}">${st.text}</span>
      <button type="button" class="subtask-del" onclick="deleteSubtask(${idx})"><i class="fa-solid fa-trash-can"></i></button>
    </div>
  `).join('');
  
  const completed = subtasks.filter(x => x.done).length;
  const pct = Math.round((completed / subtasks.length) * 100);
  updateProgressBar(pct);
}

function updateProgressBar(pct) {
  document.getElementById('detTaskProgressText').textContent = `ความคืบหน้า ${pct}%`;
  document.getElementById('detTaskProgressBar').style.setProperty('width', pct + '%');
}

window.toggleSubtaskStatus = async (idx, done) => {
  if (!activeDetailsTaskId) return;
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  const subtasks = [...(t.subtasks || [])];
  subtasks[idx].done = done;
  
  const completed = subtasks.filter(x => x.done).length;
  const pct = Math.round((completed / subtasks.length) * 100);
  let status = t.status;
  
  if (pct === 100) status = 'done';
  else if (pct > 0 && status === 'notyet') status = 'inprog';
  
  await updateDoc(doc(db, 'tasks', activeDetailsTaskId), { subtasks, percent: pct, status });
};

window.addNewSubtaskClick = async () => {
  const input = document.getElementById('newSubtaskText');
  const text = input.value.trim();
  if (!text || !activeDetailsTaskId) return;
  
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  const subtasks = [...(t.subtasks || [])];
  subtasks.push({ text: text, done: false });
  
  const completed = subtasks.filter(x => x.done).length;
  const pct = Math.round((completed / subtasks.length) * 100);
  let status = t.status;
  
  if (pct === 100) status = 'done';
  else if (pct > 0 && status === 'notyet') status = 'inprog';
  
  await updateDoc(doc(db, 'tasks', activeDetailsTaskId), { subtasks, percent: pct, status });
  input.value = '';
};

window.deleteSubtask = async (idx) => {
  if (!activeDetailsTaskId) return;
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  const subtasks = [...(t.subtasks || [])];
  subtasks.splice(idx, 1);
  
  let pct = 0;
  if (subtasks.length > 0) {
    const completed = subtasks.filter(x => x.done).length;
    pct = Math.round((completed / subtasks.length) * 100);
  }
  
  let status = t.status;
  if (pct === 100 && subtasks.length > 0) status = 'done';
  
  await updateDoc(doc(db, 'tasks', activeDetailsTaskId), { subtasks, percent: pct, status });
};

function renderCommentsList(comments) {
  const box = document.getElementById('detTaskComments');
  if (!comments || comments.length === 0) {
    box.innerHTML = '<p class="muted" style="font-size:12px">ยังไม่มีข้อความโต้ตอบ</p>';
    return;
  }
  
  box.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-header">
        <span>${c.name}</span>
        <span>${c.timeStr || ''}</span>
      </div>
      <div class="comment-body">${c.text}</div>
    </div>
  `).join('');
  
  box.scrollTop = box.scrollHeight;
}

window.postTaskCommentClick = async () => {
  const input = document.getElementById('newCommentText');
  const text = input.value.trim();
  if (!text || !activeDetailsTaskId) return;
  
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  const comments = [...(t.comments || [])];
  const now = new Date();
  const timeStr = now.toLocaleDateString('th-TH', { 
    day: 'numeric', month: 'short', year: '2-digit' 
  }) + ' ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  
  comments.push({
    uid: profile.uid,
    name: profile.name,
    text: text,
    timeStr: timeStr,
    createdAt: now.toISOString()
  });
  
  await updateDoc(doc(db, 'tasks', activeDetailsTaskId), { comments });
  input.value = '';
};

window.onModalStatusChange = async (val) => {
  if (!activeDetailsTaskId) return;
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  let updates = { status: val };
  if (val === 'done') {
    updates.percent = 100;
    if (t.subtasks && t.subtasks.length) {
      updates.subtasks = t.subtasks.map(s => ({ ...s, done: true }));
    }
  } else if (val === 'notyet') {
    updates.percent = 0;
    if (t.subtasks && t.subtasks.length) {
      updates.subtasks = t.subtasks.map(s => ({ ...s, done: false }));
    }
  }
  
  await updateDoc(doc(db, 'tasks', activeDetailsTaskId), updates);
};

// ---------- CUSTOMERS & CONTRACTS CRUD ----------

document.getElementById('customerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    name: document.getElementById('custName').value.trim(),
    contractEndDate: document.getElementById('custEndDate').value,
    reminderDays: parseInt(document.getElementById('custReminderDays').value || '15', 10),
    note: document.getElementById('custNote').value.trim()
  };
  
  try {
    if (editingCustomerId) {
      await updateDoc(doc(db, 'customers', editingCustomerId), data);
      cancelEditCustomer();
    } else {
      await addDoc(collection(db, 'customers'), { ...data, createdAt: serverTimestamp() });
      e.target.reset();
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการบันทึกลูกค้า: ' + err.message);
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
  document.getElementById('custSubmitBtn').innerHTML = '<i class="fa-solid fa-check"></i> บันทึกการแก้ไข';
  document.getElementById('custCancelBtn').style.display = 'inline-block';
  document.getElementById('customerForm').classList.add('editing');
  document.getElementById('customerForm').scrollIntoView({ behavior: 'smooth' });
};

window.cancelEditCustomer = () => {
  editingCustomerId = null;
  document.getElementById('customerForm').reset();
  document.getElementById('custSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> เพิ่มข้อมูลลูกค้า';
  document.getElementById('custCancelBtn').style.display = 'none';
  document.getElementById('customerForm').classList.remove('editing');
};

window.deleteCustomer = async (id) => {
  if (!confirm('ต้องการลบข้อมูลลูกค้ารายนี้?')) return;
  try {
    await deleteDoc(doc(db, 'customers', id));
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
};

// ---------- DAILY UPDATES CRUD ----------

document.getElementById('updateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = document.getElementById('updateText').value.trim();
  
  try {
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
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการบันทึกอัปเดต: ' + err.message);
  }
});

window.editUpdate = (id) => {
  const u = updatesCache.find(x => x.id === id);
  if (!u) return;
  editingUpdateId = id;
  document.getElementById('updateText').value = u.text || '';
  document.getElementById('updateSubmitBtn').innerHTML = '<i class="fa-solid fa-check"></i> บันทึกการแก้ไข';
  document.getElementById('updateCancelBtn').style.display = 'inline-block';
  document.getElementById('updateForm').classList.add('editing');
  document.getElementById('updateForm').scrollIntoView({ behavior: 'smooth' });
};

window.cancelEditUpdate = () => {
  editingUpdateId = null;
  document.getElementById('updateForm').reset();
  document.getElementById('updateSubmitBtn').innerHTML = '<i class="fa-solid fa-paper-plane"></i> บันทึกอัปเดต';
  document.getElementById('updateCancelBtn').style.display = 'none';
  document.getElementById('updateForm').classList.remove('editing');
};

window.deleteUpdate = async (id) => {
  if (!confirm('ลบข้อมูลอัปเดตวันนี้?')) return;
  try {
    await deleteDoc(doc(db, 'dailyUpdates', id));
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
};

// ---------- REAL-TIME LISTENER ENGINE ----------

let dashboardChartInstance = null;

function initRealtimeListeners() {
  // 1. Projects listener
  onSnapshot(collection(db, 'projects'), (snap) => {
    projectsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Update task form projects dropdown
    const projFilter = document.getElementById('filterProject');
    const selectedProj = projFilter.value;
    projFilter.innerHTML = '<option value="">ทุกโปรเจกต์</option>' + 
      projectsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    projFilter.value = selectedProj;
    
    renderProjects(projectsCache);
    renderDashboardStats(tasksCache, projectsCache, customersCache, usersCache);
    
    if (activeDetailsTaskId) {
      const t = tasksCache.find(x => x.id === activeDetailsTaskId);
      if (t) renderTaskDetailsModalContent(t);
    }
  });

  // 2. Tasks listener (checks visibility filter)
  onSnapshot(collection(db, 'tasks'), (snap) => {
    tasksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    filterAndRenderTasks();
    renderDashboardStats(tasksCache, projectsCache, customersCache, usersCache);
    renderTeamMembers(usersCache, tasksCache);
    checkTaskReminders(tasksCache);
    
    if (activeDetailsTaskId) {
      const t = tasksCache.find(x => x.id === activeDetailsTaskId);
      if (t) renderTaskDetailsModalContent(t);
    }
  });

  // 3. Customers listener
  onSnapshot(collection(db, 'customers'), (snap) => {
    customersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Update Customer project-form dropdown
    const projCust = document.getElementById('projCustomer');
    const selectedCust = projCust.value;
    projCust.innerHTML = '<option value="">-- เลือกผูกกับลูกค้า (ถ้ามี) --</option>' + 
      customersCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    projCust.value = selectedCust;
    
    renderCustomers(customersCache);
    renderDashboardStats(tasksCache, projectsCache, customersCache, usersCache);
    checkContractReminders(customersCache);
  });

  // 4. Daily updates listener
  onSnapshot(query(collection(db, 'dailyUpdates'), orderBy('date', 'desc')), (snap) => {
    updatesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const uids = visibleUids();
    const updates = uids ? updatesCache.filter(u => uids.includes(u.uid)) : updatesCache;
    
    renderDailyUpdates(updates);
    renderTeamActivity(updates);
  });
}

// ---------- RENDER VIEWS & CONTROLLERS ----------

function renderProjects(projects) {
  const box = document.getElementById('projectList');
  if (projects.length === 0) {
    box.innerHTML = '<p class="muted">ยังไม่มีโปรเจกต์</p>';
    return;
  }
  
  box.innerHTML = projects.map(p => {
    const cust = customersCache.find(x => x.id === p.customerId);
    const custLabel = cust ? `ลูกค้า: ${cust.name}` : '';
    
    // Calculate project progress percentage based on tasks
    const projTasks = tasksCache.filter(t => t.projectId === p.id);
    let pct = 0;
    if (projTasks.length > 0) {
      const completed = projTasks.filter(t => t.status === 'done').length;
      pct = Math.round((completed / projTasks.length) * 100);
    }
    
    return `
      <div class="card project-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start">
          <strong style="font-size:15px">${p.name}</strong>
          <span class="badge ${p.status}">${p.status}</span>
        </div>
        <div style="font-size:12px; margin-top:4px; color:var(--text-muted)">
          ${custLabel ? `<div>${custLabel}</div>` : ''}
          เริ่ม ${p.startDate || '-'} · กำหนดเสร็จ ${p.dueDate || '-'}
        </div>
        <div class="progress-container">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${pct}%"></div>
          </div>
          <span class="progress-pct">${pct}%</span>
        </div>
        <div class="card-actions">
          <button class="icon-btn edit" onclick="editProject('${p.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
          ${profile.role === 'admin' ? `<button class="icon-btn del" onclick="deleteProject('${p.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.filterAndRenderTasks = function() {
  const queryText = document.getElementById('taskSearch').value.toLowerCase().trim();
  const projFilter = document.getElementById('filterProject').value;
  const assigneeFilter = document.getElementById('filterAssignee').value;
  const statusFilter = document.getElementById('filterStatus').value;
  const priorityFilter = document.getElementById('filterPriority').value;
  
  // Apply visibility filters
  const uids = visibleUids();
  let list = uids ? tasksCache.filter(t => uids.includes(t.assignee)) : [...tasksCache];
  
  if (queryText) {
    list = list.filter(t => t.title.toLowerCase().includes(queryText) || (t.description && t.description.toLowerCase().includes(queryText)));
  }
  if (projFilter) {
    list = list.filter(t => t.projectId === projFilter);
  }
  if (assigneeFilter) {
    list = list.filter(t => t.assignee === assigneeFilter);
  }
  if (statusFilter) {
    list = list.filter(t => t.status === statusFilter);
  }
  if (priorityFilter) {
    list = list.filter(t => t.priority === priorityFilter);
  }
  
  renderTasksList(list);
};

window.clearTaskFilters = function() {
  document.getElementById('taskSearch').value = '';
  document.getElementById('filterProject').value = '';
  document.getElementById('filterAssignee').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterPriority').value = '';
  filterAndRenderTasks();
};

function renderTasksList(tasks) {
  const box = document.getElementById('taskList');
  if (tasks.length === 0) {
    box.innerHTML = '<p class="muted">ยังไม่มีรายการงานที่ตรงกับตัวกรอง</p>';
    return;
  }
  
  box.innerHTML = tasks.map(t => {
    const user = usersCache.find(x => x.uid === t.assignee);
    const proj = projectsCache.find(x => x.id === t.projectId);
    const canEdit = profile.role === 'admin' || t.assignee === profile.uid;
    const prioClass = t.priority || 'mid';
    const prioLabel = { urgent: 'ด่วนที่สุด', high: 'สูง', mid: 'กลาง', low: 'ต่ำ' }[prioClass];
    
    let progressSection = '';
    if (t.subtasks && t.subtasks.length > 0) {
      const completed = t.subtasks.filter(st => st.done).length;
      const pct = Math.round((completed / t.subtasks.length) * 100);
      progressSection = `
        <div style="font-size:12px; margin-top: 8px;">
          <strong>ความคืบหน้า:</strong> ${completed}/${t.subtasks.length} (${pct}%)
          <div class="progress-container" style="margin-top:2px">
            <div class="progress-bar-bg"><div class="progress-bar-fill" style="width: ${pct}%"></div></div>
          </div>
        </div>
      `;
    }
    
    return `
      <div class="card task-card ${prioClass}" onclick="openTaskDetailsModal('${t.id}')">
        <div class="task-card-header">
          <span class="task-card-title">${t.title}</span>
          <span class="badge ${t.status}">${t.status}</span>
        </div>
        <div class="task-card-meta">
          <div class="meta-item"><i class="fa-solid fa-folder"></i> ${proj ? proj.name : '-'}</div>
          <div class="meta-item"><i class="fa-solid fa-user-check"></i> ${user ? user.name : '-'}</div>
          <div class="meta-item"><i class="fa-solid fa-calendar-day"></i> ${t.dueDate || '-'}</div>
          <div class="meta-item"><span class="badge ${prioClass}" style="font-size:9px; padding:1px 5px">${prioLabel}</span></div>
        </div>
        ${progressSection}
        <div class="card-actions" onclick="event.stopPropagation()">
          ${canEdit ? `<button class="icon-btn edit" onclick="openAddTaskModal('${t.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>` : ''}
          ${profile.role === 'admin' ? `<button class="icon-btn del" onclick="deleteTask('${t.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderCustomers(customers) {
  const box = document.getElementById('customerList');
  if (customers.length === 0) {
    box.innerHTML = '<p class="muted">ยังไม่มีข้อมูลลูกค้า</p>';
    return;
  }
  
  box.innerHTML = customers.map(c => {
    const days = daysUntil(c.contractEndDate);
    const daysLabel = days < 0 ? `หมดอายุแล้ว ${Math.abs(days)} วัน` : (days === 0 ? 'หมดอายุวันนี้!' : `เหลือเวลาอีก ${days} วัน`);
    const dateClass = days <= 30 ? 'badge urgent' : 'badge done';
    
    return `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start">
          <strong style="font-size:15px; color:var(--text-dark);"><i class="fa-regular fa-building"></i> ${c.name}</strong>
          <span class="${dateClass}">${daysLabel}</span>
        </div>
        <div class="ts"><i class="fa-regular fa-calendar-check"></i> ครบกำหนดสัญญา: ${c.contractEndDate || '-'}</div>
        ${c.note ? `<div style="margin-top:8px; font-size:13px; color:var(--text-muted); background:#f8fafc; padding:8px; border-radius:6px; border:1px solid var(--border-color)">${c.note}</div>` : ''}
        <div class="card-actions">
          <button class="icon-btn edit" onclick="editCustomer('${c.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
          ${profile.role === 'admin' ? `<button class="icon-btn del" onclick="deleteCustomer('${c.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderDailyUpdates(updates) {
  const box = document.getElementById('updateList');
  if (updates.length === 0) {
    box.innerHTML = '<p class="muted">ยังไม่มีบันทึกอัปเดตงาน</p>';
    return;
  }
  
  box.innerHTML = updates.map(u => {
    const person = usersCache.find(x => x.uid === u.uid);
    const canEdit = profile.role === 'admin' || u.uid === profile.uid;
    const initial = person ? person.name.charAt(0).toUpperCase() : '?';
    return `
      <div class="card" style="display:flex; gap:12px; align-items:start;">
        <div class="feed-avatar">${initial}</div>
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:14px; color:var(--text-dark);">${person ? person.name : 'พนักงาน'}</strong>
            <span class="ts"><i class="fa-regular fa-calendar"></i> ${u.date}</span>
          </div>
          <div style="margin-top:6px; font-size:13px; white-space:pre-wrap; line-height:1.4">${u.text}</div>
          ${canEdit ? `
            <div class="card-actions">
              <button class="icon-btn edit" onclick="editUpdate('${u.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
              <button class="icon-btn del" onclick="deleteUpdate('${u.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderDashboardStats(tasks, projects, customers, users) {
  // Stat counters
  document.getElementById('statProjects').textContent = projects.length;
  document.getElementById('statTeamSize').textContent = usersCache.length;
  
  const pendingTasks = tasks.filter(t => t.status !== 'done');
  document.getElementById('statPendingTasks').textContent = pendingTasks.length;
  
  const soonContracts = customers.filter(c => {
    const d = daysUntil(c.contractEndDate);
    return d >= 0 && d <= 30; // contracts expiring in 30 days
  });
  document.getElementById('statExpiringContracts').textContent = soonContracts.length;
  
  // Doughnut Chart status breakdown
  const doneCount = tasks.filter(t => t.status === 'done').length;
  const inprogCount = tasks.filter(t => t.status === 'inprog').length;
  const notyetCount = tasks.filter(t => t.status === 'notyet').length;
  
  const ctx = document.getElementById('dashboardChart').getContext('2d');
  if (dashboardChartInstance) {
    dashboardChartInstance.destroy();
  }
  
  dashboardChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['เสร็จแล้ว', 'กำลังทำ', 'ยังไม่เริ่ม'],
      datasets: [{
        data: [doneCount, inprogCount, notyetCount],
        backgroundColor: ['#059669', '#ea580c', '#64748b'], // emerald, orange, slate-500
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { family: 'Mitr, sans-serif', size: 11 }
          }
        }
      }
    }
  });

  // Urgent task list
  const urgentBox = document.getElementById('urgentDashboardList');
  const uids = visibleUids();
  let userTasks = uids ? tasks.filter(t => uids.includes(t.assignee)) : tasks;
  
  const urgentTasks = userTasks.filter(t => {
    if (t.status === 'done') return false;
    const d = daysUntil(t.dueDate);
    return d <= 3; // due within 3 days or overdue
  });
  
  if (urgentTasks.length === 0) {
    urgentBox.innerHTML = '<p class="muted">ไม่มีงานเร่งด่วน</p>';
  } else {
    urgentBox.innerHTML = urgentTasks.map(t => {
      const d = daysUntil(t.dueDate);
      const daysText = d < 0 ? `เลยกำหนด ${Math.abs(d)} วัน` : (d === 0 ? 'ครบส่งวันนี้!' : `อีก ${d} วัน`);
      const timeClass = d < 0 ? 'badge urgent' : 'badge high';
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color)">
          <div style="cursor:pointer;" onclick="openTaskDetailsModal('${t.id}')">
            <strong style="color:var(--text-dark);">${t.title}</strong>
            <div class="ts">เดดไลน์: ${t.dueDate}</div>
          </div>
          <span class="${timeClass}" style="font-size:10px">${daysText}</span>
        </div>
      `;
    }).join('');
  }

  // Projects progress display list
  const projBox = document.getElementById('projectDashboardList');
  if (projects.length === 0) {
    projBox.innerHTML = '<p class="muted">ไม่มีโครงการในระบบ</p>';
  } else {
    projBox.innerHTML = projects.slice(0, 5).map(p => {
      const projTasks = tasks.filter(t => t.projectId === p.id);
      let pct = 0;
      if (projTasks.length > 0) {
        const completed = projTasks.filter(t => t.status === 'done').length;
        pct = Math.round((completed / projTasks.length) * 100);
      }
      return `
        <div>
          <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700">
            <span>${p.name}</span>
            <span>${pct}%</span>
          </div>
          <div class="progress-container" style="margin-top:4px;">
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${pct}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

function renderTeamActivity(updates) {
  const box = document.getElementById('teamActivityFeed');
  if (!updates || updates.length === 0) {
    box.innerHTML = '<p class="muted">ไม่มีกิจกรรมอัปเดตวันนี้</p>';
    return;
  }
  
  const recent = updates.slice(0, 5);
  box.innerHTML = recent.map(u => {
    const user = usersCache.find(x => x.uid === u.uid);
    const initial = user ? user.name.charAt(0).toUpperCase() : '?';
    return `
      <div class="feed-item">
        <div class="feed-avatar">${initial}</div>
        <div class="feed-info">
          <span class="feed-text"><strong>${user ? user.name : 'พนักงาน'}</strong> อัปเดตงาน:</span>
          <span class="feed-text" style="color:var(--text-muted); font-size:12.5px; margin-top:2px;">"${u.text}"</span>
          <span class="feed-time"><i class="fa-regular fa-clock"></i> ${u.date}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderTeamMembers(users, tasks) {
  const list = document.getElementById('teamMemberList');
  if (users.length === 0) {
    list.innerHTML = '<p class="muted">ไม่มีรายชื่อพนักงาน</p>';
    return;
  }
  
  list.innerHTML = users.map(u => {
    const activeCount = tasks.filter(t => t.assignee === u.uid && t.status !== 'done').length;
    const isCurrentUser = currentUser && currentUser.uid === u.uid;
    const nameLabel = u.name + (isCurrentUser ? ' (คุณ)' : '');
    const roleLabel = u.role === 'admin' ? 'หัวหน้า' : 'พนักงาน';
    const roleClass = u.role === 'admin' ? 'badge urgent' : 'badge planning';
    
    return `
      <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; margin-bottom:8px">
        <div>
          <strong style="font-size:14px; color:var(--text-dark);">${nameLabel}</strong>
          <div class="ts">${u.email}</div>
          <div style="margin-top:6px">
            <span class="${roleClass}" style="padding:1px 6px; font-size:10px">${roleLabel}</span>
            <span class="badge inprog" style="padding:1px 6px; font-size:10px; margin-left:4px">${activeCount} งานค้าง</span>
          </div>
        </div>
        ${profile.role === 'admin' && u.uid !== profile.uid ? `
          <button class="icon-btn del" onclick="deleteUserRecord('${u.uid}')"><i class="fa-solid fa-trash"></i> ลบ</button>
        ` : ''}
      </div>
    `;
  }).join('');
}

window.deleteUserRecord = async (uid) => {
  if (!confirm('ลบพนักงานรายนี้? ข้อมูลโปรไฟล์จะหายไปจากรายชื่อทีม แต่อีเมลจะยังบันทึกอยู่ใน Auth (แอดมินลบถาวรได้ที่คอนโซล)')) return;
  try {
    await deleteDoc(doc(db, 'users', uid));
    await loadUsers();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
};

// ---------- RECURRING TIMERS & NOTIFICATIONS ----------

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
  renderNotifBanner('task', soon.map(t => `งาน "${t.title}" กำหนดส่งในอีก ${daysUntil(t.dueDate)} วัน`));
}

function checkContractReminders(customers) {
  const soon = customers.filter(c => {
    const d = daysUntil(c.contractEndDate);
    return d >= 0 && d <= (c.reminderDays || 15);
  });
  renderNotifBanner('contract', soon.map(c => `ลูกค้า "${c.name}" สัญญาการบริการเหลืออีก ${daysUntil(c.contractEndDate)} วัน`));
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
    : '<div class="muted" style="padding:12px; font-size:12px">ไม่มีการแจ้งเตือนสำคัญ</div>';
}

document.getElementById('bellBtn').addEventListener('click', () => {
  document.getElementById('notifBanner').classList.toggle('open');
});

// ---------- CREATE MEMBER ENGINE (Secondary Auth Bypass) ----------

document.getElementById('addUserForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('newUserEmail').value.trim();
  const pw = document.getElementById('newUserPassword').value;
  const name = document.getElementById('newUserName').value.trim();
  const errBox = document.getElementById('addUserError');
  errBox.textContent = '';
  
  try {
    // Secondary Auth handles employee creation so Admin is not signed out
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pw);
    
    // Save info to Firestore under users collection
    await setDoc(doc(db, 'users', cred.user.uid), {
      name: name,
      email: email,
      role: 'staff',
      createdAt: serverTimestamp()
    });
    
    // Sign out from the secondary session instantly
    await signOut(secondaryAuth);
    
    alert('สร้างบัญชีพนักงานสำเร็จ!\nอีเมล: ' + email + '\nรหัสผ่านเข้าใช้งาน: ' + pw + '\nพนักงานสามารถล็อกอินเข้าเครื่องของตนเองได้ทันที');
    document.getElementById('addUserForm').reset();
    await loadUsers();
  } catch (err) {
    errBox.textContent = friendlyError(err.code);
  }
});

// ---------- CSV EXPORTS & PRINT REPORT ----------

function csvEscape(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

function downloadCSV(filename, rows) {
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
    const rows = [['ชื่อโครงการ', 'วันเริ่มโครงการ', 'วันกำหนดเสร็จ', 'สถานะ']];
    projectsCache.forEach(p => rows.push([p.name, p.startDate, p.dueDate, p.status]));
    downloadCSV('asg-work-projects.csv', rows);
  } else if (type === 'tasks') {
    const rows = [['ชื่องาน', 'โครงการ', 'ผู้รับผิดชอบ', 'ความเร่งด่วน', 'กำหนดส่ง', 'สถานะ', 'รายละเอียด']];
    tasksCache.forEach(t => rows.push([t.title, projectNameOf(t.projectId), nameOf(t.assignee), t.priority, t.dueDate, t.status, t.description]));
    downloadCSV('asg-work-tasks.csv', rows);
  } else if (type === 'updates') {
    const rows = [['วันที่', 'ผู้บันทึก', 'รายละเอียดการทำงาน Standup']];
    updatesCache.forEach(u => rows.push([u.date, nameOf(u.uid), u.text]));
    downloadCSV('asg-work-daily-updates.csv', rows);
  } else if (type === 'customers') {
    const rows = [['ชื่อลูกค้า/บริษัท', 'วันครบสัญญา', 'แจ้งเตือนล่วงหน้า (วัน)', 'หมายเหตุ']];
    customersCache.forEach(c => rows.push([c.name, c.contractEndDate, c.reminderDays, c.note]));
    downloadCSV('asg-work-customers.csv', rows);
  }
};

window.printPage = (pageId) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('printing'));
  document.getElementById(pageId).classList.add('printing');
  window.print();
  setTimeout(() => document.getElementById(pageId).classList.remove('printing'), 500);
};

// ---------- EXPANDED IMAGE PREVIEW ----------

window.openImageModal = function(src) {
  const modal = document.getElementById('imagePreviewModal');
  const img = document.getElementById('previewImageSrc');
  img.src = src;
  modal.classList.add('open');
};

window.closeImageModal = function() {
  document.getElementById('imagePreviewModal').classList.remove('open');
};
