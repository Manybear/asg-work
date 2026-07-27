import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, setPersistence, inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Initialize Firebase Instances Safely
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);

// Secondary app instance with isolated in-memory persistence to prevent admin logouts
const secondaryApp = getApps().find(a => a.name === "SecondaryApp") || initializeApp(firebaseConfig, "SecondaryApp");
const secondaryAuth = getAuth(secondaryApp);

// Global States
let currentUser = null;   // Firebase auth user
let profile = null;       // { name, role, uid }
let settings = { visibilityMode: 'adminOnly' }; 
let dashboardChartInstance = null;

// Cache arrays
let usersCache = [];
let projectsCache = [];
let tasksCache = [];
let updatesCache = [];
let customersCache = [];
let categoriesCache = [];
let assignersCache = [];
let quotationsCache = [];

// Editing IDs (Declared at module scope)
let editingProjectId = null;
let editingTaskId = null;
let editingCustomerId = null;
let editingUpdateId = null;
let editingQuotationId = null;

// Modal States
let activeDetailsTaskId = null;
let currentTaskImageData = null; // Base64 compressed image
let currentCalendarDate = new Date();

// ---------- SYSTEM INITIALIZATION & THEME ----------

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
  
  // Load dynamic Categories
  const catSnap = await getDoc(doc(db, 'settings', 'categories'));
  if (catSnap.exists()) {
    categoriesCache = catSnap.data().list || [];
  } else {
    categoriesCache = ["งานสิ่งพิมพ์", "งานสติ๊กเกอร์", "งานออกแบบ", "งานวิดีโอ", "งานบริการดิจิทัล"];
    await setDoc(doc(db, 'settings', 'categories'), { list: categoriesCache });
  }
  
  // Load dynamic Assigners
  const assSnap = await getDoc(doc(db, 'settings', 'assigners'));
  if (assSnap.exists()) {
    assignersCache = assSnap.data().list || [];
  } else {
    assignersCache = ["แอดมินบริษัท", "พี่บุ๊ค", "ลูกค้าติดต่อตรง"];
    await setDoc(doc(db, 'settings', 'assigners'), { list: assignersCache });
  }
  
  populateTagsDropdowns();
  renderSettingsTags();
}

async function loadUsers() {
  const snap = await getDocs(collection(db, 'users'));
  usersCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  
  // Populate filter dropdown
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
  
  document.getElementById('notifBanner').classList.remove('open');
  
  if (page === 'calendar') {
    renderCalendar();
  }
};

// ---------- DYNAMIC TAGS (CATEGORIES & ASSIGNERS) MANAGEMENT ----------

function populateTagsDropdowns() {
  const catSel = document.getElementById('taskCategorySelect');
  if (catSel) {
    catSel.innerHTML = '<option value="">-- เลือกหมวดหมู่ --</option>' + 
      categoriesCache.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  
  const assSel = document.getElementById('taskAssignerSelect');
  if (assSel) {
    assSel.innerHTML = '<option value="">-- เลือกผู้สั่งงาน --</option>' + 
      assignersCache.map(a => `<option value="${a}">${a}</option>`).join('');
  }
}

function renderSettingsTags() {
  const catBox = document.getElementById('settingsCategoriesList');
  if (catBox) {
    catBox.innerHTML = categoriesCache.map((c, idx) => `
      <div class="tag-item" style="display:inline-flex; align-items:center; background:#e2e8f0; padding:4px 10px; border-radius:15px; margin:4px; font-size:12.5px;">
        <span>${c}</span>
        <span class="del" onclick="deleteCategoryTag(${idx})" style="color:#ef4444; margin-left:6px; cursor:pointer; font-weight:bold;">&times;</span>
      </div>
    `).join('') || '<p class="muted" style="font-size:12px">ไม่มีหมวดหมู่งาน</p>';
  }
  
  const assBox = document.getElementById('settingsAssignersList');
  if (assBox) {
    assBox.innerHTML = assignersCache.map((a, idx) => `
      <div class="tag-item" style="display:inline-flex; align-items:center; background:#e2e8f0; padding:4px 10px; border-radius:15px; margin:4px; font-size:12.5px;">
        <span>${a}</span>
        <span class="del" onclick="deleteAssignerTag(${idx})" style="color:#ef4444; margin-left:6px; cursor:pointer; font-weight:bold;">&times;</span>
      </div>
    `).join('') || '<p class="muted" style="font-size:12px">ไม่มีผู้สั่งงาน</p>';
  }
}

window.addNewCategoryClick = async () => {
  const input = document.getElementById('newCategoryInput');
  const val = input.value.trim();
  if (!val) return;
  if (categoriesCache.includes(val)) {
    alert('หมวดหมู่นี้มีอยู่แล้ว');
    return;
  }
  categoriesCache.push(val);
  await setDoc(doc(db, 'settings', 'categories'), { list: categoriesCache });
  input.value = '';
  populateTagsDropdowns();
  renderSettingsTags();
};

window.deleteCategoryTag = async (idx) => {
  if (!confirm('ต้องการลบหมวดหมู่นี้?')) return;
  categoriesCache.splice(idx, 1);
  await setDoc(doc(db, 'settings', 'categories'), { list: categoriesCache });
  populateTagsDropdowns();
  renderSettingsTags();
};

window.addNewAssignerClick = async () => {
  const input = document.getElementById('newAssignerInput');
  const val = input.value.trim();
  if (!val) return;
  if (assignersCache.includes(val)) {
    alert('รายชื่อนี้มีอยู่แล้ว');
    return;
  }
  assignersCache.push(val);
  await setDoc(doc(db, 'settings', 'assigners'), { list: assignersCache });
  input.value = '';
  populateTagsDropdowns();
  renderSettingsTags();
};

window.deleteAssignerTag = async (idx) => {
  if (!confirm('ต้องการลบผู้สั่งงานนี้?')) return;
  assignersCache.splice(idx, 1);
  await setDoc(doc(db, 'settings', 'assigners'), { list: assignersCache });
  populateTagsDropdowns();
  renderSettingsTags();
};

// ---------- PROJECTS CRUD & GROUPED SUBTASKS RENDERING ----------

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
  if (!confirm('ลบโปรเจกต์นี้? งานย่อยที่เกี่ยวข้องจะยังคงอยู่แต่ไม่เชื่อมโครงการ')) return;
  try {
    await deleteDoc(doc(db, 'projects', id));
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
};

window.openAddTaskModalForProject = function(projId) {
  openAddTaskModal();
  document.getElementById('taskProjectSelect').value = projId;
};

function renderProjects(projects) {
  const box = document.getElementById('projectList');
  if (projects.length === 0) {
    box.innerHTML = '<p class="muted">ยังไม่มีโปรเจกต์</p>';
    return;
  }
  
  box.innerHTML = projects.map(p => {
    const cust = customersCache.find(x => x.id === p.customerId);
    const custLabel = cust ? `ลูกค้า: ${cust.name}` : '';
    
    // Fetch all subtasks belonging to this project
    const projTasks = tasksCache.filter(t => t.projectId === p.id);
    let pct = 0;
    if (projTasks.length > 0) {
      const completed = projTasks.filter(t => t.status === 'done').length;
      pct = Math.round((completed / projTasks.length) * 100);
    }
    
    // Grouped tasks list HTML inside the project card
    const tasksHtml = projTasks.map(t => {
      // Handle multi-assignees mapping
      const assignedUsers = t.assignees 
        ? t.assignees.map(uid => usersCache.find(x => x.uid === uid)).filter(Boolean)
        : (t.assignee ? [usersCache.find(x => x.uid === t.assignee)].filter(Boolean) : []);
      const namesLabel = assignedUsers.map(u => u.name).join(', ') || '-';
      
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:12.5px; padding:6px 0; border-bottom:1px dashed var(--border-color)">
          <span style="cursor:pointer; font-weight:600; text-decoration: underline;" onclick="openTaskDetailsModal('${t.id}')">${t.title}</span>
          <div style="display:flex; gap:6px; align-items:center;">
            <span class="ts" style="margin:0; font-size:11px;">(${namesLabel})</span>
            <span class="badge ${t.status}" style="font-size:9px; padding:1px 4px">${t.status}</span>
          </div>
        </div>
      `;
    }).join('') || '<p class="muted" style="font-size:11.5px; padding:4px 0;">ยังไม่มีงานย่อยในโปรเจกต์นี้</p>';
    
    const canModifyProject = profile.role === 'admin' || p.createdBy === profile.uid;
    
    return `
      <div class="card project-card" style="display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start">
          <strong style="font-size:15px">${p.name}</strong>
          <span class="badge ${p.status}">${p.status}</span>
        </div>
        <div style="font-size:12px; color:var(--text-muted)">
          ${custLabel ? `<div>${custLabel}</div>` : ''}
          เริ่ม ${p.startDate || '-'} · กำหนดเสร็จ ${p.dueDate || '-'}
        </div>
        
        <div class="progress-container">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${pct}%"></div>
          </div>
          <span class="progress-pct">${pct}%</span>
        </div>
        
        <!-- Nested Tasks Area -->
        <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; background: #fafafa; margin-top: 8px;">
          <strong style="font-size:12px; color:var(--text-dark); display:block; margin-bottom:6px;"><i class="fa-solid fa-list-check"></i> รายการงานในโปรเจกต์:</strong>
          <div style="max-height:120px; overflow-y:auto; padding-right:4px;">
            ${tasksHtml}
          </div>
        </div>
        
        <div class="card-actions" style="margin-top:auto; padding-top:6px; display:flex; gap:6px;">
          <button class="icon-btn edit" onclick="openAddTaskModalForProject('${p.id}')"><i class="fa-solid fa-plus"></i> มอบหมายงาน</button>
          ${canModifyProject ? `
            <button class="icon-btn edit" onclick="editProject('${p.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
            <button class="icon-btn del" onclick="deleteProject('${p.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ---------- CLIENT-SIDE IMAGE COMPRESSION (CANVAS) ----------

window.handleTaskImageUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
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
  currentTaskImageData = null;
  document.getElementById('taskLinksContainer').innerHTML = '';
  document.getElementById('taskImagePreview').innerHTML = '';
  document.getElementById('taskImageFile').value = '';
  
  // Populate dropdowns
  const projSelect = document.getElementById('taskProjectSelect');
  projSelect.innerHTML = '<option value="">-- เลือกโครงการ --</option>' + 
    projectsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    
  // Populate related quotations
  const qtSelect = document.getElementById('taskQuotationSelect');
  qtSelect.innerHTML = '<option value="">-- เลือกใบเสนอราคา (ถ้ามี) --</option>' +
    quotationsCache.map(q => `<option value="${q.id}">${q.code} · ฿${formatMoney(q.total)}</option>`).join('');
    
  // Render multi-assignee checkboxes
  const checkboxesContainer = document.getElementById('taskAssigneesCheckboxes');
  checkboxesContainer.innerHTML = usersCache.map(u => `
    <label style="display:inline-flex; align-items:center; gap:8px; font-weight:normal; cursor:pointer; margin-bottom: 2px;">
      <input type="checkbox" class="task-assignee-checkbox" value="${u.uid}" style="width:16px; height:16px; accent-color:var(--primary-red);"> ${u.name}
    </label>
  `).join('');
  
  populateTagsDropdowns();

  if (taskId) {
    const t = tasksCache.find(x => x.id === taskId);
    if (!t) return;
    editingTaskId = taskId;
    document.getElementById('modalTaskTitle').textContent = 'แก้ไขรายละเอียดงาน';
    document.getElementById('taskTitleInput').value = t.title || '';
    document.getElementById('taskDescInput').value = t.description || '';
    document.getElementById('taskProjectSelect').value = t.projectId || '';
    document.getElementById('taskCategorySelect').value = t.category || '';
    document.getElementById('taskAssignerSelect').value = t.assigner || '';
    document.getElementById('taskPrioritySelect').value = t.priority || 'mid';
    document.getElementById('taskDueInput').value = t.dueDate || '';
    document.getElementById('taskQuotationSelect').value = t.quotationId || '';
    document.getElementById('taskSubmitBtnText').innerHTML = '<i class="fa-solid fa-check"></i> บันทึกการแก้ไข';
    
    // Check checkboxes
    const selectedAssignees = t.assignees || (t.assignee ? [t.assignee] : []);
    checkboxesContainer.querySelectorAll('.task-assignee-checkbox').forEach(cb => {
      cb.checked = selectedAssignees.includes(cb.value);
    });
    
    if (t.links && t.links.length) {
      t.links.forEach(l => addModalLinkInput(l.url, l.label));
    }
    
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
    <input type="text" placeholder="ป้ายกำกับ เช่น Google Drive" value="${labelText}" class="link-label-input" style="width:30%">
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
  
  // Get checked assignees
  const assignees = [];
  document.getElementById('taskAssigneesCheckboxes').querySelectorAll('.task-assignee-checkbox:checked').forEach(cb => {
    assignees.push(cb.value);
  });
  
  if (assignees.length === 0) {
    alert('กรุณาเลือกผู้รับผิดชอบอย่างน้อย 1 คน');
    return;
  }
  
  const data = {
    title: document.getElementById('taskTitleInput').value.trim(),
    description: document.getElementById('taskDescInput').value.trim(),
    projectId: document.getElementById('taskProjectSelect').value,
    assignees: assignees,
    assignee: assignees[0], // fallback compatibility for legacy scripts
    category: document.getElementById('taskCategorySelect').value,
    assigner: document.getElementById('taskAssignerSelect').value,
    priority: document.getElementById('taskPrioritySelect').value,
    dueDate: document.getElementById('taskDueInput').value,
    quotationId: document.getElementById('taskQuotationSelect').value,
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
        updates: [],
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

// ---------- INTERACTIVE TASK DETAILS MODAL ----------

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
  
  const pBadge = document.getElementById('detTaskPriorityBadge');
  pBadge.className = 'badge ' + (t.priority || 'mid');
  const prioLabels = { urgent: 'ด่วนที่สุด', high: 'สูง', mid: 'กลาง', low: 'ต่ำ' };
  pBadge.textContent = prioLabels[t.priority || 'mid'];
  
  const proj = projectsCache.find(x => x.id === t.projectId);
  document.getElementById('detTaskProject').textContent = proj ? proj.name : '-';
  
  // Render multi-assignee names list
  const assignedUsers = t.assignees 
    ? t.assignees.map(uid => usersCache.find(x => x.uid === uid)).filter(Boolean)
    : (t.assignee ? [usersCache.find(x => x.uid === t.assignee)].filter(Boolean) : []);
  const assigneesNames = assignedUsers.map(u => u.name).join(', ') || '-';
  document.getElementById('detTaskAssignee').textContent = assigneesNames;
  
  document.getElementById('detTaskDue').textContent = t.dueDate || '-';
  document.getElementById('detTaskCategory').textContent = t.category || '-';
  document.getElementById('detTaskAssigner').textContent = t.assigner || '-';
  
  // Related quotation link render
  const qtBox = document.getElementById('detTaskQuotation');
  if (t.quotationId) {
    const q = quotationsCache.find(x => x.id === t.quotationId);
    if (q) {
      qtBox.innerHTML = `<span style="color:var(--primary-red); cursor:pointer; font-weight:700; text-decoration:underline;" onclick="printQuotationDocument('${q.id}')">${q.code} (คลิกดู A4)</span>`;
    } else {
      qtBox.textContent = 'ไม่พบเอกสาร';
    }
  } else {
    qtBox.textContent = '-';
  }
  
  document.getElementById('detTaskStatusSelect').value = t.status || 'notyet';
  
  const descBox = document.getElementById('detTaskDesc');
  if (t.description) {
    descBox.textContent = t.description;
    descBox.style.display = 'block';
  } else {
    descBox.textContent = 'ไม่มีรายละเอียดเพิ่มเติม';
  }
  
  renderSubtasksList(t.subtasks || []);
  renderUpdatesTimeline(t.updates || []);
  
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

// ---------- PROGRESS TIMELINE / TASKS TIMELINE LOGIC ----------

function renderUpdatesTimeline(updates) {
  const box = document.getElementById('detTaskUpdatesTimeline');
  if (!updates || updates.length === 0) {
    box.innerHTML = '<p class="muted" style="font-size:12px">ยังไม่มีบันทึกประวัติความคืบหน้า</p>';
    return;
  }
  
  box.innerHTML = updates.map(u => `
    <div class="comment-item" style="border-left:3px solid var(--primary-red); padding-left:10px; margin-bottom:6px;">
      <div class="comment-header">
        <span><strong>${u.name}</strong></span>
        <span>${u.date}</span>
      </div>
      <div class="comment-body" style="font-size:12.5px;">${u.text}</div>
    </div>
  `).join('');
}

window.addTaskProgressUpdateClick = async () => {
  const input = document.getElementById('newTaskUpdateText');
  const text = input.value.trim();
  if (!text || !activeDetailsTaskId) return;
  
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  const updates = [...(t.updates || [])];
  const now = new Date();
  const dateFormatted = now.toLocaleDateString('th-TH') + ' ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  
  updates.unshift({
    name: profile.name,
    text: text,
    date: dateFormatted,
    createdAt: now.toISOString()
  });
  
  await updateDoc(doc(db, 'tasks', activeDetailsTaskId), { updates });
  
  // Auto publish to standup updates
  await addDoc(collection(db, 'dailyUpdates'), {
    uid: profile.uid,
    date: now.toISOString().slice(0, 10),
    text: `อัปเดตความคืบหน้างาน "${t.title}": ${text}`,
    createdAt: serverTimestamp()
  });
  
  input.value = '';
};

// ---------- LINE SHARE & CLIPBOARD FUNCTIONS ----------

function formatTaskShareMessage(t) {
  const assignedUsers = t.assignees 
    ? t.assignees.map(uid => usersCache.find(x => x.uid === uid)).filter(Boolean)
    : (t.assignee ? [usersCache.find(x => x.uid === t.assignee)].filter(Boolean) : []);
  const namesLabel = assignedUsers.map(u => u.name).join(', ') || '-';
  const proj = projectsCache.find(x => x.id === t.projectId);
  const prioLabels = { urgent: '🔴 ด่วนที่สุด', high: '🟠 สูง', mid: '🟡 กลาง', low: '🟢 ต่ำ' };
  
  return `📢 แจ้งเตือนงาน: ASG WORK\n` +
         `📌 ชื่องาน: ${t.title}\n` +
         `📂 โครงการ: ${proj ? proj.name : '-'}\n` +
         `👤 ผู้รับผิดชอบ: ${namesLabel}\n` +
         `⚡ ระดับความสำคัญ: ${prioLabels[t.priority || 'mid']}\n` +
         `📅 กำหนดส่ง: ${t.dueDate || '-'}\n` +
         `📝 รายละเอียด: ${t.description || 'ไม่มี'}\n` +
         `🔗 ลิงก์ระบบ: https://manybear.github.io/asg-work/`;
}

window.sendTaskToLineShare = function() {
  if (!activeDetailsTaskId) return;
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  const msg = formatTaskShareMessage(t);
  const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(msg)}`;
  window.open(lineUrl, '_blank');
};

window.copyTaskLineShareLink = function() {
  if (!activeDetailsTaskId) return;
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  const msg = formatTaskShareMessage(t);
  const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(msg)}`;
  
  navigator.clipboard.writeText(lineUrl).then(() => {
    alert('คัดลอกลิงก์แชร์ LINE สำเร็จ! สามารถนำลิงก์นี้ส่งต่อได้ทันที');
  }).catch(err => {
    alert('ไม่สามารถคัดลอกได้: ' + err.message);
  });
};

window.copyTaskInfoText = function() {
  if (!activeDetailsTaskId) return;
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  const msg = formatTaskShareMessage(t);
  navigator.clipboard.writeText(msg).then(() => {
    alert('คัดลอกข้อความสรุปรายละเอียดงานสำเร็จ! นำไปวางส่งในแชทได้ทันที');
  }).catch(err => {
    alert('ไม่สามารถคัดลอกได้: ' + err.message);
  });
};

// ---------- COMMENTS REAL-TIME CHAT ----------

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

// ---------- CALENDAR LOGIC ----------

window.changeMonth = function(dir) {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + dir);
  renderCalendar();
};

function renderCalendar() {
  const grid = document.getElementById('calendarDaysGrid');
  const label = document.getElementById('calendarMonthLabel');
  if (!grid || !label) return;
  
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];
  label.textContent = `${thaiMonths[month]} ${year + 543}`;
  
  grid.innerHTML = '';
  
  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  
  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-day empty-day';
    grid.appendChild(emptyCell);
  }
  
  const today = new Date();
  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    
    if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
      cell.classList.add('today');
    }
    
    const numSpan = document.createElement('span');
    numSpan.className = 'calendar-day-num';
    numSpan.textContent = day;
    cell.appendChild(numSpan);
    
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTasks = tasksCache.filter(t => t.dueDate === dateStr);
    
    dayTasks.forEach(t => {
      const taskDiv = document.createElement('div');
      taskDiv.className = `calendar-task-item ${t.status === 'done' ? 'done' : t.priority || 'mid'}`;
      taskDiv.textContent = t.title;
      taskDiv.title = `${t.title} (${t.status})`;
      taskDiv.onclick = (e) => {
        e.stopPropagation();
        openTaskDetailsModal(t.id);
      };
      cell.appendChild(taskDiv);
    });
    
    grid.appendChild(cell);
  }
}

// ---------- CUSTOMERS & CONTRACTS CRUD ----------

document.getElementById('customerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    name: document.getElementById('custName').value.trim(),
    taxId: document.getElementById('custTaxId').value.trim(),
    phone: document.getElementById('custPhone').value.trim(),
    contractEndDate: document.getElementById('custEndDate').value,
    reminderDays: parseInt(document.getElementById('custReminderDays').value || '15', 10),
    address: document.getElementById('custAddress').value.trim(),
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
    alert('เกิดข้อผิดพลาดในการบันทึกข้อมูลลูกค้า: ' + err.message);
  }
});

window.editCustomer = (id) => {
  const c = customersCache.find(x => x.id === id);
  if (!c) return;
  editingCustomerId = id;
  document.getElementById('custName').value = c.name || '';
  document.getElementById('custTaxId').value = c.taxId || '';
  document.getElementById('custPhone').value = c.phone || '';
  document.getElementById('custEndDate').value = c.contractEndDate || '';
  document.getElementById('custReminderDays').value = c.reminderDays || 15;
  document.getElementById('custAddress').value = c.address || '';
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
      <div class="card" id="customer-card-${c.id}" style="display:flex; flex-direction:column; gap:4px; transition: all 0.2s;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start">
          <strong style="font-size:15px; color:var(--text-dark);"><i class="fa-regular fa-building"></i> ${c.name}</strong>
          <span class="${dateClass}">${daysLabel}</span>
        </div>
        <div class="ts"><i class="fa-regular fa-calendar-check"></i> ครบกำหนดสัญญา: ${c.contractEndDate || '-'}</div>
        <div style="font-size:12.5px; color:var(--text-muted);">
          ${c.taxId ? `<div><strong>Tax ID:</strong> ${c.taxId}</div>` : ''}
          ${c.phone ? `<div><strong>ติดต่อ:</strong> ${c.phone}</div>` : ''}
          ${c.address ? `<div style="white-space:pre-line; margin-top:2px;"><strong>ที่อยู่:</strong> ${c.address}</div>` : ''}
        </div>
        ${c.note ? `<div style="margin-top:6px; font-size:12.5px; color:var(--text-muted); background:#f8fafc; padding:8px; border-radius:6px; border:1px solid var(--border-color)">${c.note}</div>` : ''}
        <div class="card-actions" style="margin-top:8px;">
          <button class="icon-btn edit" onclick="editCustomer('${c.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
          ${profile.role === 'admin' ? `<button class="icon-btn del" onclick="deleteCustomer('${c.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ---------- QUOTATIONS BILLING ENGINE ----------

window.openCreateQuotationForm = function() {
  document.getElementById('quotationForm').reset();
  document.getElementById('quotationItemsBody').innerHTML = '';
  editingQuotationId = null;
  document.getElementById('quotationFormTitle').textContent = 'ออกใบเสนอราคา';
  
  const now = new Date();
  document.getElementById('qtDate').value = now.toISOString().slice(0, 10);
  document.getElementById('qtCode').value = 'QT-' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '-' + String(Date.now()).slice(-3);
  
  const custSel = document.getElementById('qtCustomer');
  custSel.innerHTML = '<option value="">-- เลือกบริษัทลูกค้า --</option>' + 
    customersCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    
  addQuotationItemRow("", 1, 0);
  document.getElementById('quotationFormPanel').style.display = 'block';
  document.getElementById('quotationFormPanel').scrollIntoView({ behavior: 'smooth' });
};

window.closeQuotationFormPanel = function() {
  document.getElementById('quotationFormPanel').style.display = 'none';
  editingQuotationId = null;
  document.getElementById('quotationFormTitle').textContent = 'ออกใบเสนอราคา';
};

window.onQuotationCustomerChange = function(custId) {
  if (!custId) return;
  const c = customersCache.find(x => x.id === custId);
  if (c && c.address) {
    // If the customer has a stored address, we can alert or log it, but let's prefill in the note if needed
  }
};

window.addQuotationItemRow = function(desc = "", qty = 1, price = 0) {
  const tbody = document.getElementById('quotationItemsBody');
  const tr = document.createElement('tr');
  tr.className = 'qt-item-row';
  tr.innerHTML = `
    <td style="padding:6px;"><input type="text" class="qt-item-desc" placeholder="เช่น ค่าจัดทำอาร์ตเวิร์กแผ่นพับ" value="${desc}" style="width:100%;" required></td>
    <td style="padding:6px; text-align:center;"><input type="number" class="qt-item-qty" value="${qty}" min="1" oninput="calculateQuotationTotals()" style="width:100%; text-align:center;" required></td>
    <td style="padding:6px; text-align:right;"><input type="number" class="qt-item-price" value="${price}" min="0" step="0.01" oninput="calculateQuotationTotals()" style="width:100%; text-align:right;" required></td>
    <td style="padding:6px; text-align:right; font-weight:600; font-size:13px;" class="qt-item-amount">฿0.00</td>
    <td style="padding:6px; text-align:center;"><button type="button" class="subtask-del" onclick="this.parentElement.parentElement.remove(); calculateQuotationTotals();"><i class="fa-solid fa-trash-can"></i></button></td>
  `;
  tbody.appendChild(tr);
  calculateQuotationTotals();
};

window.calculateQuotationTotals = function() {
  const tbody = document.getElementById('quotationItemsBody');
  const rows = tbody.querySelectorAll('.qt-item-row');
  let subtotal = 0;
  
  rows.forEach(row => {
    const qty = Number(row.querySelector('.qt-item-qty').value) || 0;
    const price = Number(row.querySelector('.qt-item-price').value) || 0;
    const amt = qty * price;
    subtotal += amt;
    row.querySelector('.qt-item-amount').textContent = '฿' + formatMoney(amt);
  });
  
  const isVat = document.getElementById('qtVatCheckbox').checked;
  const vat = isVat ? subtotal * 0.07 : 0;
  const total = subtotal + vat;
  
  document.getElementById('qtSubtotalDisplay').textContent = '฿' + formatMoney(subtotal);
  document.getElementById('qtVatDisplay').textContent = '฿' + formatMoney(vat);
  document.getElementById('qtTotalDisplay').textContent = '฿' + formatMoney(total);
  
  document.getElementById('qtVatRow').style.display = isVat ? 'block' : 'none';
};

document.getElementById('quotationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const code = document.getElementById('qtCode').value.trim();
  const date = document.getElementById('qtDate').value;
  const customerId = document.getElementById('qtCustomer').value;
  const companyName = document.getElementById('qtCompanyName').value.trim();
  const companyAddress = document.getElementById('qtCompanyAddress').value.trim();
  const notes = document.getElementById('qtNotes').value.trim();
  
  const tbody = document.getElementById('quotationItemsBody');
  const rows = tbody.querySelectorAll('.qt-item-row');
  const items = [];
  let subtotal = 0;
  
  rows.forEach(row => {
    const desc = row.querySelector('.qt-item-desc').value.trim();
    const qty = Number(row.querySelector('.qt-item-qty').value) || 0;
    const price = Number(row.querySelector('.qt-item-price').value) || 0;
    subtotal += qty * price;
    items.push({ desc, qty, price });
  });
  
  if (items.length === 0) {
    alert('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ');
    return;
  }
  
  const isVat = document.getElementById('qtVatCheckbox').checked;
  const vat = isVat ? subtotal * 0.07 : 0;
  const total = subtotal + vat;
  
  const id = editingQuotationId || ('qt_' + Date.now());
  const data = {
    type: 'quotation',
    code,
    date,
    customerId,
    companyName,
    companyAddress,
    items,
    subtotal,
    vat,
    total,
    notes,
    createdBy: profile.uid,
    createdAt: editingQuotationId 
      ? (quotationsCache.find(x => x.id === editingQuotationId).createdAt || serverTimestamp()) 
      : serverTimestamp()
  };
  
  try {
    await setDoc(doc(db, 'settings', id), data);
    alert(editingQuotationId ? 'แก้ไขใบเสนอราคาสำเร็จ' : 'บันทึกใบเสนอราคาสำเร็จ');
    closeQuotationFormPanel();
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการบันทึกเอกสาร: ' + err.message);
  }
});

window.editQuotation = function(qId) {
  const q = quotationsCache.find(x => x.id === qId);
  if (!q) return;
  
  editingQuotationId = qId;
  document.getElementById('quotationFormTitle').textContent = 'แก้ไขใบเสนอราคา';
  document.getElementById('qtCode').value = q.code || '';
  document.getElementById('qtDate').value = q.date || '';
  
  const custSel = document.getElementById('qtCustomer');
  custSel.innerHTML = '<option value="">-- เลือกบริษัทลูกค้า --</option>' + 
    customersCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  custSel.value = q.customerId || '';
  
  document.getElementById('qtCompanyName').value = q.companyName || 'บริษัท แอดวานซ์ บิสซิเนส แมกกาซีน จำกัด';
  document.getElementById('qtCompanyAddress').value = q.companyAddress || '';
  document.getElementById('qtNotes').value = q.notes || '';
  document.getElementById('qtVatCheckbox').checked = q.vat > 0;
  
  const tbody = document.getElementById('quotationItemsBody');
  tbody.innerHTML = '';
  if (q.items && q.items.length) {
    q.items.forEach(it => {
      addQuotationItemRow(it.desc, it.qty, it.price);
    });
  } else {
    addQuotationItemRow("", 1, 0);
  }
  
  document.getElementById('quotationFormPanel').style.display = 'block';
  document.getElementById('quotationFormPanel').scrollIntoView({ behavior: 'smooth' });
};

function renderQuotations(quotations) {
  const box = document.getElementById('quotationList');
  if (quotations.length === 0) {
    box.innerHTML = '<p class="muted">ยังไม่มีประวัติการออกใบเสนอราคา</p>';
    return;
  }
  
  box.innerHTML = quotations.map(q => {
    const cust = customersCache.find(x => x.id === q.customerId);
    const grandTotal = Number(q.total) || 0;
    return `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start">
          <strong style="font-size:14px;"><i class="fa-solid fa-file-invoice-dollar"></i> ${q.code || '-'}</strong>
          <span style="font-size:14px; font-weight:700; color:var(--primary-red)">฿${formatMoney(grandTotal)}</span>
        </div>
        <div class="ts">วันที่: ${q.date || '-'} · ลูกค้า: ${cust ? cust.name : '-'}</div>
        <div style="margin-top:6px; font-size:12px; color:var(--text-muted);">
          รายการ: ${(q.items || []).map(i => i.desc).join(', ')}
        </div>
        <div class="card-actions">
          <button class="icon-btn edit" onclick="printQuotationDocument('${q.id}')"><i class="fa-solid fa-print"></i> พิมพ์ / PDF</button>
          <button class="icon-btn edit" onclick="editQuotation('${q.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
          ${profile.role === 'admin' ? `<button class="icon-btn del" onclick="deleteQuotationRecord('${q.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.deleteQuotationRecord = async (qId) => {
  if (!confirm('ลบเอกสารใบเสนอราคานี้?')) return;
  try {
    await deleteDoc(doc(db, 'settings', qId));
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
};

// ---------- A4 RENDER & PDF TRIGGER ----------

let activePrintQuotationId = null;

window.printQuotationDocument = function(qId) {
  activePrintQuotationId = qId;
  const q = quotationsCache.find(x => x.id === qId);
  if (!q) return;
  
  const cust = customersCache.find(x => x.id === q.customerId);
  const paper = document.getElementById('quotationPaper');
  
  // Find original creator name from cache
  const creatorObj = usersCache.find(x => x.uid === q.createdBy);
  const creatorName = creatorObj ? creatorObj.name : 'ผู้ดูแลระบบ';
  
  const itemsHtml = q.items.map((it, idx) => `
    <tr>
      <td style="text-align:center; border:1px solid #cbd5e1; padding:8px;">${idx + 1}</td>
      <td style="border:1px solid #cbd5e1; padding:8px;"><strong>${escapeHtml(it.desc)}</strong></td>
      <td style="text-align:center; border:1px solid #cbd5e1; padding:8px;">${formatMoney(it.qty)}</td>
      <td style="text-align:right; border:1px solid #cbd5e1; padding:8px;">฿${formatMoney(it.price)}</td>
      <td style="text-align:right; border:1px solid #cbd5e1; padding:8px;">฿${formatMoney(it.qty * it.price)}</td>
    </tr>
  `).join('');
  
  const vatSection = q.vat > 0 ? `
    <tr>
      <td colspan="3" style="border:none;"></td>
      <td style="text-align:right; font-weight:700; background:#f9fafb; border:1px solid #cbd5e1; padding:8px;">ภาษีมูลค่าเพิ่ม (VAT 7%):</td>
      <td style="text-align:right; font-weight:700; background:#f9fafb; border:1px solid #cbd5e1; padding:8px;">฿${formatMoney(q.vat)}</td>
    </tr>
  ` : '';
  
  const custPhoneLine = cust && cust.phone ? `<br><strong>เบอร์โทร/ผู้ติดต่อ:</strong> ${escapeHtml(cust.phone)}` : '';
  const custTaxLine = cust && cust.taxId ? `<br><strong>เลขประจำตัวผู้เสียภาษี (Tax ID):</strong> ${escapeHtml(cust.taxId)}` : '';
  const custAddressLine = cust && cust.address ? `<br><strong>ที่อยู่:</strong> ${escapeHtml(cust.address).replace(/\n/g, '<br>')}` : '';
  
  paper.innerHTML = `
    <div style="display:flex; justify-content:space-between; border-bottom:2px solid #0f172a; padding-bottom:12px; margin-bottom:20px;">
      <div>
        <h2 style="font-size:18px; font-weight:800; color:#0f172a;">${escapeHtml(q.companyName || 'บริษัท แอดวานซ์ บิสซิเนส แมกกาซีน จำกัด')}</h2>
        <p style="font-size:11px; color:#475569; margin-top:2px;">${escapeHtml(q.companyAddress || '427/55 ถนนลาดพร้าว แขวงจอมพล เขตจตุจักร กรุงเทพฯ 10900')}</p>
      </div>
      <div style="text-align:right;">
        <h1 style="font-size:22px; font-weight:800; color:var(--primary-red); margin:0;">ใบเสนอราคา</h1>
        <p style="font-size:13px; font-weight:700; color:#0f172a; margin-top:4px;">QUOTATION</p>
      </div>
    </div>
    
    <div class="print-grid" style="margin-bottom:20px;">
      <div class="print-box" style="border:1px solid #cbd5e1; padding:12px; border-radius:6px; background:#f8fafc;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#475569; border-bottom:1px solid #e2e8f0; padding-bottom:4px; margin-bottom:8px;">👤 ข้อมูลลูกค้า / ผู้รับการเสนอราคา</div>
        <div style="font-size:12px; line-height:1.6;">
          <strong>ลูกค้า/บริษัท:</strong> ${cust ? escapeHtml(cust.name) : '-'}${custPhoneLine}${custTaxLine}${custAddressLine}
        </div>
      </div>
      <div class="print-box" style="border:1px solid #cbd5e1; padding:12px; border-radius:6px; background:#f8fafc;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#475569; border-bottom:1px solid #e2e8f0; padding-bottom:4px; margin-bottom:8px;">📄 ข้อมูลเอกสาร</div>
        <div style="font-size:12px; line-height:1.6;">
          <strong>เลขที่เอกสาร:</strong> <strong>${escapeHtml(q.code)}</strong><br>
          <strong>วันที่เอกสาร:</strong> ${escapeHtml(q.date)}<br>
          <strong>ผู้จัดทำ:</strong> ${escapeHtml(creatorName)}
        </div>
      </div>
    </div>
    
    <table class="print-table" style="width:100%; border-collapse:collapse; margin-bottom:20px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th width="40" style="text-align:center; border:1px solid #cbd5e1; padding:8px; font-size:11px;">ลำดับ</th>
          <th style="border:1px solid #cbd5e1; padding:8px; font-size:11px;">รายละเอียดสินค้า / การบริการ</th>
          <th width="80" style="text-align:center; border:1px solid #cbd5e1; padding:8px; font-size:11px;">จำนวน</th>
          <th width="120" style="text-align:right; border:1px solid #cbd5e1; padding:8px; font-size:11px;">ราคา/หน่วย</th>
          <th width="120" style="text-align:right; border:1px solid #cbd5e1; padding:8px; font-size:11px;">จำนวนเงิน (บาท)</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
        <tr>
          <td colspan="3" style="border:none;"></td>
          <td style="text-align:right; font-weight:700; background:#f9fafb; font-size:12px; border:1px solid #cbd5e1; padding:8px;">รวมราคาสุทธิ:</td>
          <td style="text-align:right; font-weight:700; background:#f9fafb; font-size:12px; border:1px solid #cbd5e1; padding:8px;">฿${formatMoney(q.subtotal)}</td>
        </tr>
        ${vatSection}
        <tr style="background:#f1f5f9;">
          <td colspan="3" style="border:none;"></td>
          <td style="text-align:right; font-weight:800; font-size:13px; border:1px solid #cbd5e1; padding:8px; color:var(--primary-red);">ยอดเงินรวมสุทธิ:</td>
          <td style="text-align:right; font-weight:800; font-size:13px; border:1px solid #cbd5e1; padding:8px; color:var(--primary-red);">฿${formatMoney(q.total)}</td>
        </tr>
      </tbody>
    </table>
    
    ${q.notes ? `
      <div style="font-size:11px; color:#475569; border:1px solid #e2e8f0; padding:10px; border-radius:6px; margin-bottom:30px; background:#f8fafc; line-height:1.5;">
        <strong>เงื่อนไข & หมายเหตุ:</strong><br>
        ${escapeHtml(q.notes).replace(/\n/g, '<br>')}
      </div>
    ` : ''}
    
    <div style="display:flex; justify-content:space-between; margin-top:50px; text-align:center;">
      <div style="width:45%; border-top:1px dashed #94a3b8; padding-top:8px; font-size:11px;">
        <br><br>
        ลงชื่อ.........................................................<br>
        ( ผู้เสนอราคา / ผู้ส่งเอกสาร )
      </div>
      <div style="width:45%; border-top:1px dashed #94a3b8; padding-top:8px; font-size:11px;">
        <br><br>
        ลงชื่อ.........................................................<br>
        ( ผู้อนุมัติสั่งซื้อ / ผู้รับการเสนอราคา )
      </div>
    </div>
  `;
  
  document.getElementById('quotationPrintModal').classList.add('open');
};

window.closeQuotationPrintModal = function() {
  document.getElementById('quotationPrintModal').classList.remove('open');
  activePrintQuotationId = null;
};

window.triggerQuotationPrint = function() {
  window.print();
};

window.downloadQuotationPDF = function() {
  if (!activePrintQuotationId) return;
  const q = quotationsCache.find(x => x.id === activePrintQuotationId);
  if (!q) return;
  
  const element = document.getElementById('quotationPaper');
  const opt = {
    margin:       15,
    filename:     `Quotation_${q.code || 'QT'}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  
  alert('กำลังเจเนอเรตไฟล์ PDF กรุณารอสักครู่...');
  html2pdf().from(element).set(opt).save();
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

function initRealtimeListeners() {
  // 1. Projects listener
  onSnapshot(collection(db, 'projects'), (snap) => {
    projectsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const projFilter = document.getElementById('filterProject');
    const selectedProj = projFilter.value;
    projFilter.innerHTML = '<option value="">ทุกโปรเจกต์</option>' + 
      projectsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    projFilter.value = selectedProj;
    
    renderProjects(projectsCache);
    renderDashboardStats(tasksCache, projectsCache, customersCache, usersCache);
    renderCalendar();
    
    if (activeDetailsTaskId) {
      const t = tasksCache.find(x => x.id === activeDetailsTaskId);
      if (t) renderTaskDetailsModalContent(t);
    }
  });

  // 2. Tasks listener
  onSnapshot(collection(db, 'tasks'), (snap) => {
    tasksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    filterAndRenderTasks();
    renderProjects(projectsCache); // re-render projects so task list updates inside cards
    renderDashboardStats(tasksCache, projectsCache, customersCache, usersCache);
    renderTeamMembers(usersCache, tasksCache);
    checkTaskReminders(tasksCache);
    renderCalendar();
    
    if (activeDetailsTaskId) {
      const t = tasksCache.find(x => x.id === activeDetailsTaskId);
      if (t) renderTaskDetailsModalContent(t);
    }
  });

  // 3. Customers listener
  onSnapshot(collection(db, 'customers'), (snap) => {
    customersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
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

  // 5. Quotations listener
  const q = query(collection(db, 'settings'), where('type', '==', 'quotation'));
  onSnapshot(q, (snap) => {
    quotationsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    filterAndRenderQuotations();
  });
}

// ---------- RENDER VIEWS & CONTROLLERS ----------

window.filterAndRenderTasks = function() {
  const queryText = document.getElementById('taskSearch').value.toLowerCase().trim();
  const projFilter = document.getElementById('filterProject').value;
  const assigneeFilter = document.getElementById('filterAssignee').value;
  const statusFilter = document.getElementById('filterStatus').value;
  const priorityFilter = document.getElementById('filterPriority').value;
  
  const uids = visibleUids();
  let list = uids ? tasksCache.filter(t => {
    const isAssigned = t.assignees ? t.assignees.includes(profile.uid) : (t.assignee === profile.uid);
    return isAssigned;
  }) : [...tasksCache];
  
  if (queryText) {
    list = list.filter(t => t.title.toLowerCase().includes(queryText) || (t.description && t.description.toLowerCase().includes(queryText)));
  }
  if (projFilter) {
    list = list.filter(t => t.projectId === projFilter);
  }
  if (assigneeFilter) {
    list = list.filter(t => t.assignees ? t.assignees.includes(assigneeFilter) : (t.assignee === assigneeFilter));
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

window.filterAndRenderQuotations = function() {
  const queryText = document.getElementById('quotationSearch').value.toLowerCase().trim();
  let list = [...quotationsCache];
  if (queryText) {
    list = list.filter(q => {
      const cust = customersCache.find(x => x.id === q.customerId);
      const custName = cust ? cust.name.toLowerCase() : '';
      return q.code.toLowerCase().includes(queryText) || custName.includes(queryText);
    });
  }
  renderQuotations(list);
};

function renderTasksList(tasks) {
  const box = document.getElementById('taskList');
  if (tasks.length === 0) {
    box.innerHTML = '<p class="muted">ยังไม่มีรายการงานที่ตรงกับตัวกรอง</p>';
    return;
  }
  
  box.innerHTML = tasks.map(t => {
    // Map assignees names
    const assignedUsers = t.assignees 
      ? t.assignees.map(uid => usersCache.find(x => x.uid === uid)).filter(Boolean)
      : (t.assignee ? [usersCache.find(x => x.uid === t.assignee)].filter(Boolean) : []);
    const namesLabel = assignedUsers.map(u => u.name).join(', ') || '-';
    
    const proj = projectsCache.find(x => x.id === t.projectId);
    const canEdit = profile.role === 'admin' || (t.assignees ? t.assignees.includes(profile.uid) : (t.assignee === profile.uid));
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
          <div class="meta-item"><i class="fa-solid fa-user-check"></i> ${namesLabel}</div>
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

function renderDashboardStats(tasks, projects, customers, users) {
  document.getElementById('statProjects').textContent = projects.length;
  document.getElementById('statTeamSize').textContent = usersCache.length;
  
  const pendingTasks = tasks.filter(t => t.status !== 'done');
  document.getElementById('statPendingTasks').textContent = pendingTasks.length;
  
  const soonContracts = customers.filter(c => {
    const d = daysUntil(c.contractEndDate);
    return d >= 0 && d <= 30;
  });
  document.getElementById('statExpiringContracts').textContent = soonContracts.length;
  
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
        backgroundColor: ['#059669', '#ea580c', '#64748b'],
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

  const urgentBox = document.getElementById('urgentDashboardList');
  const uids = visibleUids();
  let userTasks = uids ? tasks.filter(t => t.assignees ? t.assignees.includes(profile.uid) : (t.assignee === profile.uid)) : tasks;
  
  const urgentTasks = userTasks.filter(t => {
    if (t.status === 'done') return false;
    const d = daysUntil(t.dueDate);
    return d <= 3;
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
    const activeCount = tasks.filter(t => {
      const isAssigned = t.assignees ? t.assignees.includes(u.uid) : (t.assignee === u.uid);
      return isAssigned && t.status !== 'done';
    }).length;
    
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
  if (!confirm('ลบพนักงานรายนี้? ข้อมูลโปรไฟล์จะหายไปจากรายชื่อทีม แต่อีเมลจะยังคงล็อกอินได้')) return;
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
  const mine = uids ? tasks.filter(t => t.assignees ? t.assignees.includes(profile.uid) : (t.assignee === profile.uid)) : tasks;
  
  // 1. Unfinished tasks close to due date within 5 days
  const soon = mine.filter(t => t.status !== 'done' && daysUntil(t.dueDate) <= 5 && daysUntil(t.dueDate) >= 0);
  const soonItems = soon.map(t => ({
    id: t.id,
    type: 'task',
    text: `📅 งาน "${t.title}" ใกล้กำหนดส่งในอีก ${daysUntil(t.dueDate)} วัน`
  }));
  
  // 2. Unfinished tasks not updated for > 5 days (stalled)
  const now = new Date();
  const stalled = mine.filter(t => {
    if (t.status === 'done') return false;
    const lastUpdatedDate = t.updatedAt ? t.updatedAt.toDate() : (t.createdAt ? t.createdAt.toDate() : new Date());
    const elapsedDays = Math.round((now - lastUpdatedDate) / 86400000);
    return elapsedDays > 5;
  });
  const stalledItems = stalled.map(t => ({
    id: t.id,
    type: 'task',
    text: `⚠️ งาน "${t.title}" ค้างไว้ไม่มีการเคลื่อนไหวเกิน 5 วัน`
  }));
  
  renderNotifBanner('task', [...soonItems, ...stalledItems]);
}

function checkContractReminders(customers) {
  const soon = customers.filter(c => {
    const d = daysUntil(c.contractEndDate);
    return d >= 0 && d <= (c.reminderDays || 15);
  });
  const items = soon.map(c => ({
    id: c.id,
    type: 'contract',
    text: `ลูกค้า "${c.name}" สัญญาเหลืออีก ${daysUntil(c.contractEndDate)} วัน`
  }));
  renderNotifBanner('contract', items);
}

const notifState = { task: [], contract: [] };
function renderNotifBanner(kind, items) {
  notifState[kind] = items;
  const all = [...notifState.task, ...notifState.contract];
  const box = document.getElementById('notifBanner');
  const badge = document.getElementById('notifCount');
  badge.textContent = all.length;
  badge.style.display = all.length ? 'inline-block' : 'none';
  
  if (all.length === 0) {
    box.innerHTML = '<div class="muted" style="padding:12px; font-size:12px">ไม่มีการแจ้งเตือนสำคัญ</div>';
    return;
  }
  
  box.innerHTML = all.map(item => {
    if (item.type === 'task') {
      return `<div class="notif-item" onclick="clickNotifTask('${item.id}')"><i class="fa-solid fa-list-check" style="color:var(--primary-red); margin-right:6px;"></i> ${item.text}</div>`;
    } else {
      return `<div class="notif-item" onclick="clickNotifCustomer('${item.id}')"><i class="fa-solid fa-file-contract" style="color:var(--high-color); margin-right:6px;"></i> ${item.text}</div>`;
    }
  }).join('');
}

window.clickNotifTask = function(taskId) {
  document.getElementById('notifBanner').classList.remove('open');
  openTaskDetailsModal(taskId);
};

window.clickNotifCustomer = function(customerId) {
  document.getElementById('notifBanner').classList.remove('open');
  showPage('customers');
  const card = document.getElementById(`customer-card-${customerId}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('highlight-flash');
    setTimeout(() => card.classList.remove('highlight-flash'), 2000);
  }
};

document.getElementById('bellBtn').addEventListener('click', () => {
  document.getElementById('notifBanner').classList.toggle('open');
});

// ---------- CREATE MEMBER ENGINE ----------

document.getElementById('addUserForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('newUserEmail').value.trim();
  const pw = document.getElementById('newUserPassword').value;
  const name = document.getElementById('newUserName').value.trim();
  const errBox = document.getElementById('addUserError');
  errBox.textContent = '';
  
  try {
    await setPersistence(secondaryAuth, inMemoryPersistence);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pw);
    
    // Write profile under secondary Firestore client session (satisfies users rules check)
    const secondaryDb = getFirestore(secondaryApp);
    await setDoc(doc(secondaryDb, 'users', cred.user.uid), {
      name: name,
      email: email,
      role: 'staff',
      createdAt: serverTimestamp()
    });
    
    await signOut(secondaryAuth);
    alert('สร้างบัญชีพนักงานสำเร็จ!\nอีเมล: ' + email + '\nรหัสผ่าน: ' + pw + '\nพนักงานสามารถล็อกอินได้เลย แอดมินยังคงล็อกอินปกติ');
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
    const rows = [['ชื่องาน', 'โครงการ', 'ผู้รับผิดชอบ', 'ระดับบริการ', 'ผู้สั่งงาน', 'ความเร่งด่วน', 'กำหนดส่ง', 'สถานะ', 'รายละเอียด']];
    tasksCache.forEach(t => {
      const assignedUsers = t.assignees 
        ? t.assignees.map(uid => usersCache.find(x => x.uid === uid)).filter(Boolean)
        : (t.assignee ? [usersCache.find(x => x.uid === t.assignee)].filter(Boolean) : []);
      const names = assignedUsers.map(u => u.name).join(', ') || '-';
      rows.push([t.title, projectNameOf(t.projectId), names, t.category, t.assigner, t.priority, t.dueDate, t.status, t.description]);
    });
    downloadCSV('asg-work-tasks.csv', rows);
  } else if (type === 'updates') {
    const rows = [['วันที่', 'ผู้บันทึก', 'รายละเอียดการทำงาน']];
    updatesCache.forEach(u => rows.push([u.date, nameOf(u.uid), u.text]));
    downloadCSV('asg-work-daily-updates.csv', rows);
  } else if (type === 'customers') {
    const rows = [['ชื่อลูกค้า/บริษัท', 'เลขประจำตัวผู้เสียภาษี', 'เบอร์โทร', 'วันครบสัญญา', 'ที่อยู่', 'หมายเหตุ']];
    customersCache.forEach(c => rows.push([c.name, c.taxId, c.phone, c.contractEndDate, c.address, c.note]));
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

// ---------- FINANCIAL UTILS ----------

function formatMoney(num) {
  return Number(num || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(text) {
  if (!text) return '';
  return text.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
