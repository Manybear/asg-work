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
  initGlobalSearch();
  
  // Set default date for daily report filter to today in local timezone (YYYY-MM-DD)
  const filterInput = document.getElementById('dailyReportDateFilter');
  if (filterInput) {
    filterInput.value = new Date().toISOString().slice(0, 10);
  }
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

window.showToast = function(message, type = 'success') {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.color = '#fff';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    toast.style.zIndex = '9999';
    toast.style.transition = 'all 0.3s ease';
    toast.style.transform = 'translateY(10px)';
    toast.style.opacity = '0';
    document.body.appendChild(toast);
  }
  
  if (type === 'success') {
    toast.style.background = '#10b981';
  } else if (type === 'error') {
    toast.style.background = '#ef4444';
  } else {
    toast.style.background = '#3b82f6';
  }
  
  toast.textContent = message;
  // Trigger reflow
  toast.offsetHeight;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
  }, 3000);
};

async function logActivity(text) {
  try {
    const now = new Date();
    const timeFormatted = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    await addDoc(collection(db, 'dailyUpdates'), {
      uid: profile.uid,
      date: now.toISOString().slice(0, 10),
      time: timeFormatted,
      text: text,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error('Error logging activity:', err);
  }
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
  try {
    if (user) {
      await loadProfile(user.uid, user.email);
      const loginScreen = document.getElementById('loginScreen');
      if (loginScreen) loginScreen.classList.remove('active-screen');
      const appScreen = document.getElementById('appScreen');
      if (appScreen) appScreen.classList.add('active-screen');
      
      const meLabel = document.getElementById('meLabel');
      if (meLabel) {
        meLabel.innerHTML = `<i class="fa-solid fa-user-tie"></i> ${profile.name || 'ผู้ใช้งาน'} ${profile.role === 'admin' ? '<span class="badge urgent" style="padding:1px 5px; font-size:9px">หัวหน้า</span>' : ''}`;
      }
      
      await loadSettings();
      await loadUsers();
      initRealtimeListeners();
      showPage('dashboard');
      updateUserPresence();
      setInterval(updateUserPresence, 120000);
    } else {
      const loginScreen = document.getElementById('loginScreen');
      if (loginScreen) loginScreen.classList.add('active-screen');
      const appScreen = document.getElementById('appScreen');
      if (appScreen) appScreen.classList.remove('active-screen');
    }
  } catch (err) {
    console.error("Auth initialization error: ", err);
    const errBox = document.getElementById('loginError');
    if (errBox) {
      errBox.textContent = 'เกิดข้อผิดพลาดในการโหลดระบบ: ' + err.message;
    }
  }
});

let lastPresenceUpdate = 0;

async function updateUserPresence() {
  if (!currentUser) return;
  const now = Date.now();
  if (now - lastPresenceUpdate < 120000) return; // 2 minutes throttle
  
  lastPresenceUpdate = now;
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      lastActive: serverTimestamp()
    });
  } catch (e) {
    console.warn("Failed to update presence:", e);
  }
}

function isUserOnline(user) {
  if (!user || !user.lastActive) return false;
  const lastActiveTime = user.lastActive.toDate ? user.lastActive.toDate().getTime() : new Date(user.lastActive).getTime();
  const diff = Date.now() - lastActiveTime;
  return diff <= 300000; // Online if active in last 5 minutes
}

function formatLastActive(lastActive) {
  if (!lastActive) return 'ไม่เคยเข้าใช้งาน';
  const time = lastActive.toDate ? lastActive.toDate().getTime() : new Date(lastActive).getTime();
  const diff = Date.now() - time;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `${days} วันที่แล้ว`;
}

async function loadProfile(uid, email) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    profile = { uid, ...snap.data() };
  } else {
    const safeEmail = email || '';
    const safeName = safeEmail ? safeEmail.split('@')[0] : 'พนักงาน';
    const newProfile = { name: safeName, email: safeEmail, role: 'staff', createdAt: serverTimestamp() };
    await setDoc(ref, newProfile);
    profile = { uid, ...newProfile };
  }
}

async function loadSettings() {
  const ref = doc(db, 'settings', 'global');
  const snap = await getDoc(ref);
  if (snap.exists()) {
    settings = snap.data();
    const companyNameInput = document.getElementById('setCompanyName');
    if (companyNameInput) companyNameInput.value = settings.companyName || 'บริษัท แอดวานซ์ บิสซิเนส แมกกาซีน จำกัด';
    const companyAddressInput = document.getElementById('setCompanyAddress');
    if (companyAddressInput) companyAddressInput.value = settings.companyAddress || '427/55 ถนนลาดพร้าว แขวงจอมพล เขตจตุจักร กรุงเทพฯ 10900';
    const companyTaxIdInput = document.getElementById('setCompanyTaxId');
    if (companyTaxIdInput) companyTaxIdInput.value = settings.companyTaxId || '';
  } else {
    await setDoc(ref, settings);
  }
  
  const visibilitySelect = document.getElementById('visibilitySelect');
  if (visibilitySelect) visibilitySelect.value = settings.visibilityMode;
  
  const adminPanel = document.getElementById('adminPanel');
  if (adminPanel) adminPanel.style.display = profile.role === 'admin' ? 'block' : 'none';
  
  const companyPanel = document.getElementById('companySettingsPanel');
  if (companyPanel) companyPanel.style.display = profile.role === 'admin' ? 'block' : 'none';
  
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
  if (filterAssignee) {
    const selectedAssignee = filterAssignee.value;
    filterAssignee.innerHTML = '<option value="">ทุกคนในทีม</option>' + 
      usersCache.map(u => `<option value="${u.uid}">${u.name}</option>`).join('');
    filterAssignee.value = selectedAssignee;
  }
  
  // Populate calendar filter dropdown
  const calFilter = document.getElementById('calendarFilterAssignee');
  if (calFilter) {
    const selectedVal = calFilter.value;
    calFilter.innerHTML = '<option value="">ทุกคนในทีม (ทั้งหมด)</option>' + 
      usersCache.map(u => `<option value="${u.uid}">${u.name}</option>`).join('');
    calFilter.value = selectedVal;
  }
  
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

const companyForm = document.getElementById('companySettingsForm');
if (companyForm) {
  companyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (profile.role !== 'admin') {
      alert('เฉพาะหัวหน้างานเท่านั้นที่สามารถแก้ไขข้อมูลบริษัทได้');
      return;
    }
    
    settings.companyName = document.getElementById('setCompanyName').value.trim();
    settings.companyAddress = document.getElementById('setCompanyAddress').value.trim();
    settings.companyTaxId = document.getElementById('setCompanyTaxId').value.trim();
    
    try {
      await setDoc(doc(db, 'settings', 'global'), settings);
      showToast('บันทึกข้อมูลบริษัทสำเร็จ', 'success');
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message);
    }
  });
}

// ---------- NAVIGATION CONTROL ----------

window.showPage = function (page) {
  updateUserPresence();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  
  const targetPage = document.getElementById('page-' + page);
  if (targetPage) targetPage.classList.add('active');
  
  const targetBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  if (targetBtn) targetBtn.classList.add('active');
  
  document.getElementById('notifBanner').classList.remove('open');
  
  // Close mobile navigation dropdown on select
  const navLinks = document.getElementById('navLinks');
  if (navLinks) {
    navLinks.classList.remove('show');
  }

  if (page === 'calendar') {
    renderCalendar();
  }
};

window.toggleMobileMenu = function() {
  const navLinks = document.getElementById('navLinks');
  if (navLinks) {
    navLinks.classList.toggle('show');
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

window.addNewCategoryPrompt = async () => {
  const val = prompt('กรอกชื่อหมวดหมู่ใหม่:');
  if (!val) return;
  const trimmed = val.trim();
  if (!trimmed) return;
  if (categoriesCache.includes(trimmed)) {
    alert('หมวดหมู่นี้มีอยู่แล้ว');
    return;
  }
  categoriesCache.push(trimmed);
  await setDoc(doc(db, 'settings', 'categories'), { list: categoriesCache });
  populateTagsDropdowns();
  renderSettingsTags();
  document.getElementById('taskCategorySelect').value = trimmed;
  showToast('เพิ่มหมวดหมู่สำเร็จ', 'success');
};

window.addNewAssignerPrompt = async () => {
  const val = prompt('กรอกชื่อผู้สั่งงานใหม่:');
  if (!val) return;
  const trimmed = val.trim();
  if (!trimmed) return;
  if (assignersCache.includes(trimmed)) {
    alert('ผู้สั่งงานนี้มีอยู่แล้ว');
    return;
  }
  assignersCache.push(trimmed);
  await setDoc(doc(db, 'settings', 'assigners'), { list: assignersCache });
  populateTagsDropdowns();
  renderSettingsTags();
  document.getElementById('taskAssignerSelect').value = trimmed;
  showToast('เพิ่มผู้สั่งงานสำเร็จ', 'success');
};

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
      await logActivity(`📂 แก้ไขรายละเอียดโครงการ "${data.name}"`);
      cancelEditProject();
      showToast('แก้ไขโครงการสำเร็จ', 'success');
    } else {
      await addDoc(collection(db, 'projects'), { ...data, createdBy: profile.uid, createdAt: serverTimestamp() });
      await logActivity(`📂 สร้างโครงการใหม่ "${data.name}"`);
      e.target.reset();
      showToast('สร้างโครงการสำเร็จ', 'success');
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
  const p = projectsCache.find(x => x.id === id);
  const pName = p ? p.name : 'ไม่ระบุชื่อโครงการ';
  if (!confirm(`ลบโปรเจกต์ "${pName}"? งานย่อยที่เกี่ยวข้องจะยังคงอยู่แต่ไม่เชื่อมโครงการ`)) return;
  try {
    await deleteDoc(doc(db, 'projects', id));
    await logActivity(`🗑️ ลบโครงการ "${pName}"`);
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
  projSelect.innerHTML = '<option value="">-- งานทั่วไป (ไม่มีโครงการ) --</option>' + 
    projectsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    
  // Populate related quotations
  const qtSelect = document.getElementById('taskQuotationSelect');
  qtSelect.innerHTML = '<option value="">-- เลือกใบเสนอราคา (ถ้ามี) --</option>' +
    quotationsCache.map(q => `<option value="${q.id}">${q.code} · ฿${formatMoney(q.total)}</option>`).join('');
    
  // Render multi-assignee checkboxes
  const checkboxesContainer = document.getElementById('taskAssigneesCheckboxes');
  checkboxesContainer.innerHTML = usersCache.map(u => {
    const isOnline = isUserOnline(u);
    const uColor = getEmployeeColor(u.name);
    const onlineIndicator = isOnline 
      ? `<span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%; display: inline-block; box-shadow: 0 0 6px #22c55e; margin-left:4px;" title="ออนไลน์"></span>`
      : `<span style="width: 8px; height: 8px; background: #94a3b8; border-radius: 50%; display: inline-block; margin-left:4px;" title="ออฟไลน์ (ใช้งานล่าสุด: ${formatLastActive(u.lastActive)})"></span>`;
    
    return `
      <label style="display:inline-flex; align-items:center; gap:8px; font-weight:normal; cursor:pointer; margin-bottom: 2px;">
        <input type="checkbox" class="task-assignee-checkbox" value="${u.uid}" style="width:16px; height:16px; accent-color:var(--primary-red);"> 
        <span class="avatar-initial" style="background:${uColor.border}; width:16px; height:16px; font-size:9px; color:#fff; display:inline-flex; align-items:center; justify-content:center; border-radius:50%;">${getEmployeeInitials(u.name)}</span>
        <span style="color:${uColor.border}; font-weight:600; font-size:13px;">${u.name}</span>
        ${onlineIndicator}
      </label>
    `;
  }).join('');
  
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
    document.getElementById('modalTaskTitle').textContent = 'เพิ่มงาน';
    document.getElementById('taskFormSubmit').reset();
    document.getElementById('taskSubmitBtnText').innerHTML = '<i class="fa-solid fa-plus"></i> เพิ่มงาน';
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
      await logActivity(`แก้ไขรายละเอียดงาน "${data.title}"`);
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
      await logActivity(`สร้างงานใหม่ "${data.title}"`);
    }
    closeAddTaskModal();
    showToast(editingTaskId ? 'แก้ไขงานสำเร็จ' : 'สร้างงานสำเร็จ', 'success');
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการเซฟงาน: ' + err.message);
  }
});

window.deleteTask = async (id) => {
  const t = tasksCache.find(x => x.id === id);
  const taskTitle = t ? t.title : 'ไม่ระบุชื่องาน';
  if (!confirm(`ลบงาน "${taskTitle}"?`)) return;
  try {
    await deleteDoc(doc(db, 'tasks', id));
    await logActivity(`🗑️ ลบงาน "${taskTitle}"`);
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
  
  const subText = subtasks[idx].text;
  await logActivity(`อัปเดตงาน "${t.title}": ${done ? '✅ ติ๊กเสร็จ' : '❌ ติ๊กยกเลิก'}งานย่อย "${subText}"`);
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
  await logActivity(`อัปเดตงาน "${t.title}": ➕ เพิ่มงานย่อย "${text}"`);
  input.value = '';
};

window.deleteSubtask = async (idx) => {
  if (!activeDetailsTaskId) return;
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  const subtasks = [...(t.subtasks || [])];
  const delText = subtasks[idx].text;
  subtasks.splice(idx, 1);
  
  let pct = 0;
  if (subtasks.length > 0) {
    const completed = subtasks.filter(x => x.done).length;
    pct = Math.round((completed / subtasks.length) * 100);
  }
  
  let status = t.status;
  if (pct === 100 && subtasks.length > 0) status = 'done';
  
  await updateDoc(doc(db, 'tasks', activeDetailsTaskId), { subtasks, percent: pct, status });
  await logActivity(`อัปเดตงาน "${t.title}": ➖ ลบงานย่อย "${delText}"`);
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
  await logActivity(`อัปเดตงาน "${t.title}": ${text}`);
  
  input.value = '';
  showTaskDetails(activeDetailsTaskId); // Refresh the modal with the new update
  showToast('บันทึกอัปเดตงานสำเร็จ', 'success');
};

// ---------- LINE SHARE & CLIPBOARD FUNCTIONS ----------

function formatTaskShareMessage(t) {
  const assignedUsers = t.assignees 
    ? t.assignees.map(uid => usersCache.find(x => x.uid === uid)).filter(Boolean)
    : (t.assignee ? [usersCache.find(x => x.uid === t.assignee)].filter(Boolean) : []);
  const namesLabel = assignedUsers.map(u => u.name).join(', ') || '-';
  const proj = projectsCache.find(x => x.id === t.projectId);
  const prioLabels = { urgent: '🔴 ด่วนที่สุด', high: '🟠 สูง', mid: '🟡 กลาง', low: '🟢 ต่ำ' };
  
  // Format checklist progress (if subtasks exist)
  let checklistLabel = '';
  if (t.subtasks && t.subtasks.length > 0) {
    const completed = t.subtasks.filter(x => x.done).length;
    checklistLabel = `\n📋 งานย่อย: ${completed}/${t.subtasks.length} (${t.percent || 0}%)`;
  }
  
  // Format timeline updates (if updates exist, show up to 3 latest)
  let updatesLabel = '';
  if (t.updates && t.updates.length > 0) {
    updatesLabel = `\n\n🔄 อัปเดตความคืบหน้าล่าสุด:\n` + 
      t.updates.slice(0, 3).map(u => `- [${u.date}] ${u.name}: ${u.text}`).join('\n');
  }
  
  return `📢 แจ้งเตือนงาน: ASG WORK\n` +
         `📌 ชื่องาน: ${t.title}\n` +
         `📂 โครงการ: ${proj ? proj.name : '-'}\n` +
         `👤 ผู้รับผิดชอบ: ${namesLabel}\n` +
         `⚡ ระดับความสำคัญ: ${prioLabels[t.priority || 'mid']}\n` +
         `📅 กำหนดส่ง: ${t.dueDate || '-'}${checklistLabel}\n` +
         `📝 รายละเอียด: ${t.description || 'ไม่มี'}${updatesLabel}\n` +
         `🔗 ลิงก์ระบบ: https://manybear.github.io/asg-work/`;
}

function openLineShareUrl(msg) {
  const encodedMsg = encodeURIComponent(msg);
  // If the encoded message is very long (over 1500 chars), LINE will fail with a 414 error.
  // In that case, we copy the message to the clipboard and show a toast/alert advising the user to paste it.
  if (encodedMsg.length > 1500) {
    navigator.clipboard.writeText(msg).then(() => {
      alert(`⚠️ รายงานข้อความยาวเกินขีดจำกัดสูงสุดของแอป LINE (${encodedMsg.length} ตัวอักษร)\n\nระบบได้ทำการ "คัดลอกข้อความสรุปทั้งหมด" ลงคลิปบอร์ดให้คุณโดยอัตโนมัติแล้วครับ! สามารถเปิดแชท LINE แล้วกดวาง (Paste) ส่งได้ทันทีครับ`);
    }).catch(err => {
      alert('ไม่สามารถเปิดแชร์ไลน์หรือคัดลอกได้เนื่องจากข้อความยาวเกินไป: ' + err.message);
    });
  } else {
    const lineUrl = `https://line.me/R/msg/text/?${encodedMsg}`;
    window.open(lineUrl, '_blank');
  }
}

window.sendTaskToLineShare = function() {
  if (!activeDetailsTaskId) return;
  const t = tasksCache.find(x => x.id === activeDetailsTaskId);
  if (!t) return;
  
  const msg = formatTaskShareMessage(t);
  openLineShareUrl(msg);
};

window.shareTaskToLineCard = function(taskId) {
  const t = tasksCache.find(x => x.id === taskId);
  if (!t) return;
  
  const msg = formatTaskShareMessage(t);
  openLineShareUrl(msg);
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
  
  const statusLabels = { notyet: 'ยังไม่เริ่ม', inprog: 'กำลังทำ', done: 'เสร็จแล้ว' };
  await logActivity(`เปลี่ยนสถานะงาน "${t.title}" เป็น ${statusLabels[val] || val}`);
  
  showTaskDetails(activeDetailsTaskId); // Refresh the modal with the new status
  showToast(`เปลี่ยนสถานะเป็น "${statusLabels[val] || val}" สำเร็จ`, 'success');
};

// ---------- CALENDAR LOGIC ----------

let currentCalendarView = 'month';
let activeCalendarDayDetail = null;

window.changeMonth = function(dir) {
  if (currentCalendarView === 'week') {
    currentCalendarDate.setDate(currentCalendarDate.getDate() + (dir * 7));
  } else {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + dir);
  }
  renderCalendar();
};

window.switchCalendarView = function(view) {
  currentCalendarView = view;
  document.getElementById('btnCalendarMonthView').classList.toggle('active', view === 'month');
  document.getElementById('btnCalendarWeekView').classList.toggle('active', view === 'week');
  renderCalendar();
};

window.showUserActivitiesInSidebar = function(userName, dateStr, userUpdates) {
  activeCalendarDayDetail = { userName, dateStr, updates: userUpdates };
  renderCalendarSidebar();
  
  // Scroll the sidebar to the top to show the details card
  const sidebarContainer = document.querySelector('.calendar-sidebar-card');
  if (sidebarContainer) {
    sidebarContainer.scrollTop = 0;
  }
};

window.clearCalendarDayDetail = function() {
  activeCalendarDayDetail = null;
  renderCalendarSidebar();
};

function getEmployeeColor(name) {
  const colors = [
    { bg: '#f0fdf4', text: '#166534', border: '#15803d' }, // green
    { bg: '#eff6ff', text: '#1e40af', border: '#1d4ed8' }, // blue
    { bg: '#faf5ff', text: '#6b21a8', border: '#7e22ce' }, // purple
    { bg: '#fff7ed', text: '#9a3412', border: '#c2410c' }, // orange
    { bg: '#f5f3ff', text: '#5b21b6', border: '#6d28d9' }, // violet
    { bg: '#f0fdfa', text: '#075985', border: '#0369a1' }, // sky
    { bg: '#fff1f2', text: '#9f1239', border: '#be123c' }, // rose
    { bg: '#fdf2f8', text: '#9d174d', border: '#c2185b' }  // pink
  ];
  let hash = 0;
  const str = String(name || '');
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

function getEmployeeInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
}

function renderDayCell(d, grid) {
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  
  const cell = document.createElement('div');
  cell.className = 'calendar-day';
  
  const today = new Date();
  if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
    cell.classList.add('today');
  }
  
  const numSpan = document.createElement('span');
  numSpan.className = 'calendar-day-num';
  numSpan.textContent = day;
  cell.appendChild(numSpan);
  
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // 1. Render Tasks
  const isPrivateMode = visibleUids();
  let dayTasks = tasksCache.filter(t => t.dueDate === dateStr);
  
  if (isPrivateMode) {
    dayTasks = dayTasks.filter(t => (t.assignees && t.assignees.includes(profile.uid)) || (t.assignee === profile.uid));
  }
  
  const filterVal = document.getElementById('calendarFilterAssignee') ? document.getElementById('calendarFilterAssignee').value : '';
  if (filterVal) {
    dayTasks = dayTasks.filter(t => (t.assignees && t.assignees.includes(filterVal)) || (t.assignee === filterVal));
  }
  
  dayTasks.forEach(t => {
    const taskDiv = document.createElement('div');
    taskDiv.className = `calendar-task-item ${t.status === 'done' ? 'done' : t.priority || 'mid'}`;
    
    let assigneesList = [];
    if (t.assignees && t.assignees.length > 0) {
      assigneesList = t.assignees.map(uid => usersCache.find(u => u.uid === uid)).filter(Boolean);
    } else if (t.assignee) {
      const u = usersCache.find(x => x.uid === t.assignee);
      if (u) assigneesList.push(u);
    }
    
    if (assigneesList.length > 0) {
      const primaryColor = getEmployeeColor(assigneesList[0].name);
      taskDiv.style.borderLeftColor = primaryColor.border;
    }
    
    const titleSpan = document.createElement('span');
    titleSpan.style.overflow = 'hidden';
    titleSpan.style.textOverflow = 'ellipsis';
    titleSpan.textContent = (t.status === 'done' ? '✓ ' : '') + t.title;
    taskDiv.appendChild(titleSpan);
    
    const avatarsContainer = document.createElement('div');
    avatarsContainer.style.display = 'flex';
    avatarsContainer.style.gap = '2px';
    avatarsContainer.style.alignItems = 'center';
    
    assigneesList.slice(0, 3).forEach(u => {
      const uColor = getEmployeeColor(u.name);
      const av = document.createElement('span');
      av.className = 'avatar-initial';
      av.style.backgroundColor = uColor.border;
      av.style.color = '#fff';
      av.textContent = getEmployeeInitials(u.name);
      av.title = u.name;
      avatarsContainer.appendChild(av);
    });
    taskDiv.appendChild(avatarsContainer);
    
    taskDiv.title = `${t.title} (${t.status === 'done' ? 'เสร็จแล้ว' : 'ค้างคา'})\nผู้รับผิดชอบ: ${assigneesList.map(x => x.name).join(', ')}`;
    taskDiv.onclick = (e) => {
      e.stopPropagation();
      openTaskDetailsModal(t.id);
    };
    cell.appendChild(taskDiv);
  });
  
  // 2. Render Customer Contracts (skip if assignee filter is active)
  if (!filterVal) {
    const expiringCustomers = customersCache.filter(c => c.contractEndDate === dateStr);
    expiringCustomers.forEach(c => {
      const contractDiv = document.createElement('div');
      contractDiv.className = 'calendar-task-item';
      contractDiv.style.borderLeftColor = '#ef4444';
      contractDiv.style.background = '#fef2f2';
      contractDiv.style.color = '#991b1b';
      
      const titleSpan = document.createElement('span');
      titleSpan.style.overflow = 'hidden';
      titleSpan.style.textOverflow = 'ellipsis';
      titleSpan.innerHTML = `🏢 ${c.name}`;
      contractDiv.appendChild(titleSpan);
      
      contractDiv.title = `🏢 สัญญาหมดอายุ: ${c.name}\nเบอร์โทร: ${c.phone || '-'}\nTax ID: ${c.taxId || '-'}`;
      contractDiv.onclick = (e) => {
        e.stopPropagation();
        showCustomerCard(c.id);
      };
      cell.appendChild(contractDiv);
    });
  }
  
  // 3. Render Employee Activity Logs (History logs)
  const dayUpdates = updatesCache.filter(u => u.date === dateStr);
  let visibleDayUpdates = isPrivateMode ? dayUpdates.filter(u => isPrivateMode.includes(u.uid)) : dayUpdates;
  if (filterVal) {
    visibleDayUpdates = visibleDayUpdates.filter(u => u.uid === filterVal);
  }
  
  if (visibleDayUpdates.length > 0) {
    // Group updates by uid
    const grouped = {};
    visibleDayUpdates.forEach(u => {
      if (!grouped[u.uid]) grouped[u.uid] = [];
      grouped[u.uid].push(u);
    });
    
    Object.keys(grouped).forEach(uid => {
      const user = usersCache.find(x => x.uid === uid);
      const userName = user ? user.name : 'ไม่ระบุผู้ใช้';
      const uColor = getEmployeeColor(userName);
      const userUpdates = grouped[uid];
      const count = userUpdates.length;
      
      const actDiv = document.createElement('div');
      actDiv.className = 'calendar-task-item';
      actDiv.style.borderLeftColor = uColor.border;
      actDiv.style.background = uColor.bg;
      actDiv.style.color = uColor.text;
      
      const titleSpan = document.createElement('span');
      titleSpan.style.overflow = 'hidden';
      titleSpan.style.textOverflow = 'ellipsis';
      titleSpan.innerHTML = `<i class="fa-regular fa-clipboard"></i> ${userName} (${count} งาน)`;
      actDiv.appendChild(titleSpan);
      
      actDiv.title = `📝 บันทึกงานของ ${userName} วันที่ ${dateStr} (${count} รายการ)\nคลิกเพื่อเปิดรายละเอียดในแถบด้านข้าง`;
      actDiv.onclick = (e) => {
        e.stopPropagation();
        showUserActivitiesInSidebar(userName, dateStr, userUpdates);
      };
      cell.appendChild(actDiv);
    });
  }
  
  grid.appendChild(cell);
}

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
  
  if (currentCalendarView === 'week') {
    const startOfWeek = new Date(currentCalendarDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    
    const startStr = `${startOfWeek.getDate()} ${thaiMonths[startOfWeek.getMonth()]}`;
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const endStr = `${endOfWeek.getDate()} ${thaiMonths[endOfWeek.getMonth()]} ${endOfWeek.getFullYear() + 543}`;
    label.textContent = `สัปดาห์: ${startStr} - ${endStr}`;
    
    grid.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      renderDayCell(d, grid);
    }
  } else {
    label.textContent = `${thaiMonths[month]} ${year + 543}`;
    grid.innerHTML = '';
    
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'calendar-day empty-day';
      grid.appendChild(emptyCell);
    }
    
    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(year, month, day);
      renderDayCell(d, grid);
    }
  }
  
  // Render Sidebar alerts
  renderCalendarSidebar();
}

function renderCalendarSidebar() {
  const sidebar = document.getElementById('calendarAlertList');
  if (!sidebar) return;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  let html = '';
  
  // Prepend selected calendar day updates detail if active
  if (activeCalendarDayDetail) {
    const { userName, dateStr, updates } = activeCalendarDayDetail;
    const uColor = getEmployeeColor(userName);
    const initials = getEmployeeInitials(userName);
    const sorted = [...updates].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    
    const parts = dateStr.split('-');
    const thaiYear = parseInt(parts[0], 10) + 543;
    const formattedDate = `${parts[2]}/${parts[1]}/${thaiYear}`;
    
    const rawDetails = updates.map(x => `- [${x.time || ''}] ${x.text}`).join('\n');
    const encodedText = encodeURIComponent(rawDetails);
    
    html += `
      <div style="background:${uColor.bg}; border: 1px solid ${uColor.border}; border-radius: 8px; padding: 12px; margin-bottom: 16px; position: relative; animation: fadeIn 0.2s ease;">
        <button onclick="clearCalendarDayDetail()" style="position: absolute; right: 8px; top: 6px; background: none; border: none; font-size: 18px; font-weight:700; color: ${uColor.border}; cursor: pointer;" title="ปิดหน้าต่าง">&times;</button>
        <h4 style="font-size: 13px; font-weight: 700; color: ${uColor.border}; margin: 0 0 4px 0; display: flex; align-items: center; gap: 6px;">
          <span class="avatar-initial" style="background:${uColor.border}; width:18px; height:18px; font-size:9.5px; color:#fff;">${initials}</span>
          รายงานกิจกรรม: ${userName}
        </h4>
        <div style="font-size: 10.5px; color: var(--text-muted); margin-bottom: 8px;"><i class="fa-solid fa-calendar-day"></i> วันที่ ${formattedDate}</div>
        <ul style="margin: 0; padding-left: 12px; font-size: 11.5px; line-height: 1.5; color: var(--text-dark);">
    `;
    
    sorted.forEach(u => {
      const displayTime = u.time ? `<strong style="color:${uColor.border};">[${u.time}]</strong>` : '';
      html += `<li style="margin-bottom: 4px; list-style: disc;">${displayTime} ${escapeHtml(u.text)}</li>`;
    });
    
    html += `
        </ul>
        <div style="display:flex; gap:6px; margin-top:10px;">
          <button class="btn btn-ghost btn-sm" onclick="sendIndividualGroupedUpdateToLine('${userName}', '${dateStr}', '${encodedText}')" style="font-size:10px; color:#06c755; display:inline-flex; align-items:center; gap:3px; padding:3px 6px; border:1px solid #06c755; border-radius:4px; background:#fff;"><i class="fa-brands fa-line"></i> ส่ง LINE</button>
          <button class="btn btn-ghost btn-sm" onclick="copyIndividualGroupedUpdateText('${userName}', '${dateStr}', '${encodedText}')" style="font-size:10px; display:inline-flex; align-items:center; gap:3px; padding:3px 6px; border:1px solid var(--border-color); border-radius:4px; background:#fff;"><i class="fa-regular fa-copy"></i> คัดลอก</button>
        </div>
      </div>
    `;
  }
  
  // 1. GATHER TASKS ALERTS
  const overdueTasks = tasksCache.filter(t => t.dueDate && t.dueDate < todayStr && t.status !== 'done');
  const todayTasks = tasksCache.filter(t => t.dueDate === todayStr && t.status !== 'done');
  
  const upcomingTasks = tasksCache.filter(t => {
    if (!t.dueDate || t.status === 'done' || t.dueDate <= todayStr) return false;
    const diff = new Date(t.dueDate) - today;
    const days = Math.round(diff / 86400000);
    return days > 0 && days <= 5;
  });
  
  // 2. GATHER CONTRACTS ALERTS
  const expiredContracts = customersCache.filter(c => c.contractEndDate && c.contractEndDate < todayStr);
  const expiringContracts = customersCache.filter(c => {
    if (!c.contractEndDate || c.contractEndDate < todayStr) return false;
    const diff = new Date(c.contractEndDate) - today;
    const days = Math.round(diff / 86400000);
    return days >= 0 && days <= 30;
  });
  
  let hasAlerts = false;
  
  // A. Contracts Alerts Section
  if (expiredContracts.length > 0 || expiringContracts.length > 0) {
    hasAlerts = true;
    html += `<h4 style="font-size:12px; font-weight:700; color:#b91c1c; margin-top:6px; margin-bottom:8px; display:flex; align-items:center; gap:4px;"><i class="fa-solid fa-file-shield"></i> สัญญาบริการลูกค้า</h4>`;
    
    expiredContracts.forEach(c => {
      const days = Math.round((today - new Date(c.contractEndDate)) / 86400000);
      html += `
        <div class="sidebar-alert-item" style="border-left: 3px solid #ef4444;" onclick="showCustomerCard('${c.id}')">
          <div style="flex:1;">
            <div class="sidebar-alert-title">🏢 ${c.name}</div>
            <div class="sidebar-alert-meta">วันหมดสัญญา: ${c.contractEndDate}</div>
            <span class="sidebar-alert-status" style="background:#fef2f2; color:#ef4444; border:1px solid #fca5a5; font-size:9.5px; padding:1px 6px;">🔴 หมดสัญญามาแล้ว ${days} วัน</span>
          </div>
        </div>
      `;
    });
    
    expiringContracts.forEach(c => {
      const diff = new Date(c.contractEndDate) - today;
      const days = Math.round(diff / 86400000);
      const statusLabel = days === 0 ? 'หมดสัญญาวันนี้!' : `เหลือสัญญาอีก ${days} วัน`;
      html += `
        <div class="sidebar-alert-item" style="border-left: 3px solid #f97316;" onclick="showCustomerCard('${c.id}')">
          <div style="flex:1;">
            <div class="sidebar-alert-title">🏢 ${c.name}</div>
            <div class="sidebar-alert-meta">วันหมดสัญญา: ${c.contractEndDate}</div>
            <span class="sidebar-alert-status" style="background:#fff7ed; color:#d97706; border:1px solid #fdba74; font-size:9.5px; padding:1px 6px;">🟡 ${statusLabel}</span>
          </div>
        </div>
      `;
    });
  }
  
  // B. Tasks Alerts Section
  if (overdueTasks.length > 0 || todayTasks.length > 0 || upcomingTasks.length > 0) {
    hasAlerts = true;
    html += `<h4 style="font-size:12px; font-weight:700; color:var(--text-dark); margin-top:14px; margin-bottom:8px; display:flex; align-items:center; gap:4px;"><i class="fa-solid fa-list-check"></i> รายการส่งมอบงานทีม</h4>`;
    
    overdueTasks.forEach(t => {
      const diff = Math.round((today - new Date(t.dueDate)) / 86400000);
      let assigneesText = 'ไม่ระบุ';
      if (t.assignees && t.assignees.length > 0) {
        assigneesText = t.assignees.map(uid => {
          const u = usersCache.find(x => x.uid === uid);
          return u ? u.name : '';
        }).filter(Boolean).join(', ');
      } else if (t.assignee) {
        const u = usersCache.find(x => x.uid === t.assignee);
        if (u) assigneesText = u.name;
      }
      
      html += `
        <div class="sidebar-alert-item" style="border-left: 3px solid #ef4444;" onclick="openTaskDetailsModal('${t.id}')">
          <div style="flex:1;">
            <div class="sidebar-alert-title">📌 ${t.title}</div>
            <div class="sidebar-alert-meta">กำหนดส่ง: ${t.dueDate} | ผู้ทำ: ${assigneesText}</div>
            <span class="sidebar-alert-status" style="background:#fef2f2; color:#ef4444; border:1px solid #fca5a5; font-size:9.5px; padding:1px 6px;">🔴 เลยกำหนดมาแล้ว ${diff} วัน</span>
          </div>
        </div>
      `;
    });
    
    todayTasks.forEach(t => {
      let assigneesText = 'ไม่ระบุ';
      if (t.assignees && t.assignees.length > 0) {
        assigneesText = t.assignees.map(uid => {
          const u = usersCache.find(x => x.uid === uid);
          return u ? u.name : '';
        }).filter(Boolean).join(', ');
      } else if (t.assignee) {
        const u = usersCache.find(x => x.uid === t.assignee);
        if (u) assigneesText = u.name;
      }
      
      html += `
        <div class="sidebar-alert-item" style="border-left: 3px solid #ea580c;" onclick="openTaskDetailsModal('${t.id}')">
          <div style="flex:1;">
            <div class="sidebar-alert-title">📌 ${t.title}</div>
            <div class="sidebar-alert-meta">กำหนดส่ง: วันนี้ | ผู้ทำ: ${assigneesText}</div>
            <span class="sidebar-alert-status" style="background:#fff7ed; color:#ea580c; border:1px solid #fdba74; font-size:9.5px; padding:1px 6px;">🟡 ครบกำหนดวันนี้</span>
          </div>
        </div>
      `;
    });
    
    upcomingTasks.forEach(t => {
      const diff = new Date(t.dueDate) - today;
      const days = Math.round(diff / 86400000);
      let assigneesText = 'ไม่ระบุ';
      if (t.assignees && t.assignees.length > 0) {
        assigneesText = t.assignees.map(uid => {
          const u = usersCache.find(x => x.uid === uid);
          return u ? u.name : '';
        }).filter(Boolean).join(', ');
      } else if (t.assignee) {
        const u = usersCache.find(x => x.uid === t.assignee);
        if (u) assigneesText = u.name;
      }
      
      html += `
        <div class="sidebar-alert-item" style="border-left: 3px solid #eab308;" onclick="openTaskDetailsModal('${t.id}')">
          <div style="flex:1;">
            <div class="sidebar-alert-title">📌 ${t.title}</div>
            <div class="sidebar-alert-meta">กำหนดส่ง: ${t.dueDate} | ผู้ทำ: ${assigneesText}</div>
            <span class="sidebar-alert-status" style="background:#fef9c3; color:#a16207; border:1px solid #fef08a; font-size:9.5px; padding:1px 6px;">🟡 ใกล้ส่ง (อีก ${days} วัน)</span>
          </div>
        </div>
      `;
    });
  }
  
  // C. Active Tasks Section
  let hasActiveSection = false;
  let activeHtml = '';
  
  usersCache.forEach(u => {
    // Find active tasks assigned to this user (excluding completed ones)
    const userActiveTasks = tasksCache.filter(t => {
      if (t.status === 'done') return false;
      return (t.assignees && t.assignees.includes(u.uid)) || (t.assignee === u.uid);
    });
    
    if (userActiveTasks.length > 0) {
      hasActiveSection = true;
      const uColor = getEmployeeColor(u.name);
      activeHtml += `
        <div style="margin-bottom:12px; border-bottom:1px dashed var(--border-color); padding-bottom:8px;">
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
            <span class="avatar-initial" style="background:${uColor.border}; width:16px; height:16px; font-size:9px; color:#fff;">${getEmployeeInitials(u.name)}</span>
            <strong style="font-size:11.5px; color:${uColor.border};">${u.name}</strong>
            <span style="font-size:10px; color:var(--text-muted); margin-left:auto;">(${userActiveTasks.length} งานกำลังทำ/ค้าง)</span>
          </div>
      `;
      
      userActiveTasks.forEach(t => {
        const statusText = t.status === 'inprog' ? 'กำลังทำ' : 'ยังไม่เริ่ม';
        const statusColor = t.status === 'inprog' ? '#2563eb' : '#64748b'; // Blue or Slate
        const progressText = t.percent ? ` (${t.percent}%)` : '';
        
        activeHtml += `
          <div class="sidebar-alert-item" style="padding:6px 10px; margin-bottom:4px; border-left: 3px solid ${statusColor}; background:#fff;" onclick="openTaskDetailsModal('${t.id}')">
            <div style="flex:1; font-size:11px;">
              <div style="font-weight:600; color:var(--text-dark);">${t.title}</div>
              <div style="font-size:10.5px; color:${statusColor}; margin-top:2px;">
                <i class="fa-regular fa-circle-dot"></i> ${statusText}${progressText}
                ${t.dueDate ? ` | ส่ง: ${t.dueDate}` : ''}
              </div>
            </div>
          </div>
        `;
      });
      
      activeHtml += `</div>`;
    }
  });

  if (hasActiveSection) {
    html += `<h4 style="font-size:12px; font-weight:700; color:var(--text-dark); margin-top:16px; margin-bottom:8px; display:flex; align-items:center; gap:4px; border-top:1px solid var(--border-color); padding-top:12px;"><i class="fa-solid fa-users-gear"></i> พนักงานกำลังทำอะไรอยู่ (Active Tasks)</h4>`;
    html += activeHtml;
  }
  
  if (!hasAlerts && !hasActiveSection) {
    sidebar.innerHTML = `<p class="muted" style="font-size:12px; padding: 20px 0;">🎉 ไม่มีคิวสัญญาหมดอายุหรือความเร่งด่วนในขณะนี้</p>`;
  } else {
    sidebar.innerHTML = html;
  }
}

window.showCustomerCard = (id) => {
  showPage('customers');
  setTimeout(() => {
    const card = document.getElementById(`customer-card-${id}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.borderColor = 'var(--primary-red)';
      card.style.boxShadow = '0 0 15px rgba(185, 28, 28, 0.4)';
      setTimeout(() => {
        card.style.borderColor = '';
        card.style.boxShadow = '';
      }, 2500);
    }
  }, 100);
};

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
      await logActivity(`👤 แก้ไขประวัติข้อมูลลูกค้า "${data.name}"`);
      cancelEditCustomer();
      showToast('แก้ไขข้อมูลลูกค้าสำเร็จ', 'success');
    } else {
      await addDoc(collection(db, 'customers'), { ...data, createdAt: serverTimestamp() });
      await logActivity(`👤 เพิ่มรายชื่อลูกค้าใหม่ "${data.name}"`);
      e.target.reset();
      showToast('เพิ่มรายชื่อลูกค้าสำเร็จ', 'success');
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการบันทึกข้อมูลลูกค้า: ' + err.message);
  }
});

let renewalCustomerId = null;

window.openRenewalModal = function(id) {
  const c = customersCache.find(x => x.id === id);
  if (!c) return;
  
  renewalCustomerId = id;
  document.getElementById('renewCustName').value = c.name || '';
  document.getElementById('renewEndDate').value = '';
  document.getElementById('renewNote').value = '';
  
  const select = document.getElementById('renewQuotationSelect');
  if (select) {
    const custName = (c.name || '').toLowerCase();
    const relatedQuots = quotationsCache.filter(q => (q.qtCustomer || '').toLowerCase() === custName);
    
    let optionsHtml = '<option value="">-- ไม่ผูกใบเสนอราคา --</option>';
    
    if (relatedQuots.length > 0) {
      optionsHtml += `<optgroup label="ใบเสนอราคาของเจ้านี้">`;
      relatedQuots.forEach(q => {
        optionsHtml += `<option value="${q.id}|${q.qtCode}">${q.qtCode} - วันที่ ${q.qtDate || '-'} (ยอด ${parseFloat(q.grandTotal || 0).toLocaleString()} บ.)</option>`;
      });
      optionsHtml += `</optgroup>`;
    }
    
    const otherQuots = quotationsCache.filter(q => (q.qtCustomer || '').toLowerCase() !== custName);
    if (otherQuots.length > 0) {
      optionsHtml += `<optgroup label="ใบเสนอราคาอื่น ๆ">`;
      otherQuots.forEach(q => {
        optionsHtml += `<option value="${q.id}|${q.qtCode}">${q.qtCode} (${q.qtCustomer || 'ไม่ระบุ'}) - วันที่ ${q.qtDate || '-'} (ยอด ${parseFloat(q.grandTotal || 0).toLocaleString()} บ.)</option>`;
      });
      optionsHtml += `</optgroup>`;
    }
    
    select.innerHTML = optionsHtml;
  }
  
  document.getElementById('renewalModal').style.display = 'flex';
};

window.closeRenewalModal = function() {
  renewalCustomerId = null;
  const f = document.getElementById('renewalForm');
  if (f) f.reset();
  const m = document.getElementById('renewalModal');
  if (m) m.style.display = 'none';
};

const renewalForm = document.getElementById('renewalForm');
if (renewalForm) {
  renewalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!renewalCustomerId) return;
    
    const c = customersCache.find(x => x.id === renewalCustomerId);
    if (!c) return;
    
    const endInput = document.getElementById('renewEndDate');
    const newEndDate = endInput ? endInput.value : '';
    
    const quotInput = document.getElementById('renewQuotationSelect');
    const quotVal = quotInput ? quotInput.value : '';
    
    const noteInput = document.getElementById('renewNote');
    const newNote = noteInput ? noteInput.value.trim() : '';
    
    let linkedQuotationId = '';
    let linkedQuotationCode = '';
    if (quotVal) {
      const parts = quotVal.split('|');
      linkedQuotationId = parts[0];
      linkedQuotationCode = parts[1];
    }
    
    const historyItem = {
      id: 'hist_' + Date.now(),
      contractEndDate: c.contractEndDate || '',
      note: c.note || '',
      quotationId: c.linkedQuotationId || '',
      quotationCode: c.linkedQuotationCode || '',
      renewedAt: new Date().toISOString()
    };
    
    const contractHistory = c.contractHistory || [];
    contractHistory.push(historyItem);
    
    const updates = {
      contractEndDate: newEndDate,
      note: newNote,
      linkedQuotationId,
      linkedQuotationCode,
      contractHistory
    };
    
    try {
      await updateDoc(doc(db, 'customers', renewalCustomerId), updates);
      await logActivity(`👤 ต่ออายุสัญญาลูกค้า "${c.name}" รอบใหม่ถึงวันที่ ${newEndDate}`);
      closeRenewalModal();
      showToast('ต่ออายุสัญญาสำเร็จและบันทึกประวัติการต่อรอบเก่าเรียบร้อย', 'success');
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการต่ออายุสัญญา: ' + err.message);
    }
  });
}

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
  const c = customersCache.find(x => x.id === id);
  const cName = c ? c.name : 'ไม่ระบุชื่อลูกค้า';
  if (!confirm(`ต้องการลบข้อมูลลูกค้า "${cName}"?`)) return;
  try {
    await deleteDoc(doc(db, 'customers', id));
    await logActivity(`🗑️ ลบข้อมูลลูกค้า "${cName}"`);
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
    let badgeHtml = '';
    if (!c.contractEndDate) {
      badgeHtml = `<span class="badge" style="background:#cbd5e1; color:#475569; padding:2px 8px; font-size:11px; border-radius:12px;">ไม่มีข้อมูลสัญญา</span>`;
    } else {
      const days = daysUntil(c.contractEndDate);
      if (days < 0) {
        badgeHtml = `<span class="badge" style="background:#fef2f2; color:#ef4444; border:1px solid #fca5a5; padding:2px 8px; font-size:11px; border-radius:12px; font-weight:700;">🔴 หมดสัญญาแล้ว (${Math.abs(days)} วัน)</span>`;
      } else if (days === 0) {
        badgeHtml = `<span class="badge" style="background:#fff7ed; color:#ea580c; border:1px solid #fdba74; padding:2px 8px; font-size:11px; border-radius:12px; font-weight:700;">🟡 หมดสัญญาวันนี้!</span>`;
      } else if (days <= 30) {
        badgeHtml = `<span class="badge" style="background:#fff7ed; color:#d97706; border:1px solid #fdba74; padding:2px 8px; font-size:11px; border-radius:12px; font-weight:700;">🟡 เหลืออีก ${days} วัน</span>`;
      } else {
        badgeHtml = `<span class="badge" style="background:#f0fdf4; color:#16a34a; border:1px solid #86efac; padding:2px 8px; font-size:11px; border-radius:12px; font-weight:700;">🟢 ปกติ (เหลืออีก ${days} วัน)</span>`;
      }
    }
    
    const linkedQuotHtml = c.linkedQuotationCode ? `<div style="font-size:12px; color:#2563eb; margin-top:2px;"><strong><i class="fa-solid fa-link"></i> ผูกใบเสนอราคา:</strong> ${c.linkedQuotationCode}</div>` : '';
    
    let historyHtml = '';
    if (c.contractHistory && c.contractHistory.length > 0) {
      const sortedHistory = [...c.contractHistory].sort((a, b) => b.renewedAt.localeCompare(a.renewedAt));
      historyHtml = `
        <div style="margin-top: 8px; border-top: 1px dashed var(--border-color); padding-top: 6px;">
          <strong style="font-size:11px; color:var(--text-dark); display:block; margin-bottom:4px;"><i class="fa-solid fa-clock-rotate-left"></i> ประวัติสัญญารอบก่อนหน้า:</strong>
          <div style="max-height: 80px; overflow-y: auto; display:flex; flex-direction:column; gap:3px;">
            ${sortedHistory.map(h => {
              const histParts = h.contractEndDate ? h.contractEndDate.split('-') : [];
              const histYear = histParts[0] ? parseInt(histParts[0], 10) + 543 : '';
              const histDateStr = histParts[0] ? `${histParts[2]}/${histParts[1]}/${histYear}` : '-';
              const quotLabel = h.quotationCode ? ` (ใบเสนอราคา: ${h.quotationCode})` : '';
              return `<div style="font-size:11px; color:var(--text-muted);">• หมดอายุ: ${histDateStr}${quotLabel} ${h.note ? ` | ${h.note}` : ''}</div>`;
            }).join('')}
          </div>
        </div>
      `;
    }
    
    return `
      <div class="card" id="customer-card-${c.id}" style="display:flex; flex-direction:column; gap:4px; transition: all 0.2s;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start">
          <strong style="font-size:15px; color:var(--text-dark);"><i class="fa-regular fa-building"></i> ${c.name}</strong>
          ${badgeHtml}
        </div>
        <div class="ts"><i class="fa-regular fa-calendar-check"></i> ครบกำหนดสัญญา: ${c.contractEndDate || '-'}</div>
        ${linkedQuotHtml}
        <div style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">
          ${c.taxId ? `<div><strong>Tax ID:</strong> ${c.taxId}</div>` : ''}
          ${c.phone ? `<div><strong>ติดต่อ:</strong> ${c.phone}</div>` : ''}
          ${c.address ? `<div style="white-space:pre-line; margin-top:2px;"><strong>ที่อยู่:</strong> ${c.address}</div>` : ''}
        </div>
        ${c.note ? `<div style="margin-top:6px; font-size:12.5px; color:var(--text-muted); background:#f8fafc; padding:8px; border-radius:6px; border:1px solid var(--border-color)">${c.note}</div>` : ''}
        ${historyHtml}
        <div class="card-actions" style="margin-top:8px; display:flex; gap:6px;">
          <button class="icon-btn edit" onclick="editCustomer('${c.id}')" style="flex:1;"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
          <button class="icon-btn" onclick="openRenewalModal('${c.id}')" style="flex:1.3; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;"><i class="fa-solid fa-arrows-rotate"></i> ต่ออายุสัญญา</button>
          ${profile.role === 'admin' ? `<button class="icon-btn del" onclick="deleteCustomer('${c.id}')" style="flex:1;"><i class="fa-solid fa-trash"></i> ลบ</button>` : ''}
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
  
  const datalist = document.getElementById('customersDatalist');
  if (datalist) {
    datalist.innerHTML = customersCache.map(c => `<option value="${c.name}"></option>`).join('');
  }
  const custInput = document.getElementById('qtCustomer');
  if (custInput) custInput.value = '';
  
  const compNameInput = document.getElementById('qtCompanyName');
  if (compNameInput) compNameInput.value = settings.companyName || 'บริษัท แอดวานซ์ บิสซิเนส แมกกาซีน จำกัด';
  const compAddrInput = document.getElementById('qtCompanyAddress');
  if (compAddrInput) compAddrInput.value = settings.companyAddress || '427/55 ถนนลาดพร้าว แขวงจอมพล เขตจตุจักร กรุงเทพฯ 10900';
  
  const whtBox = document.getElementById('qtWhtCheckbox');
  if (whtBox) whtBox.checked = false;
    
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
  
  const isWht = document.getElementById('qtWhtCheckbox').checked;
  const wht = isWht ? subtotal * 0.03 : 0;
  
  const total = subtotal + vat - wht;
  
  document.getElementById('qtSubtotalDisplay').textContent = '฿' + formatMoney(subtotal);
  document.getElementById('qtVatDisplay').textContent = '฿' + formatMoney(vat);
  document.getElementById('qtWhtDisplay').textContent = '-฿' + formatMoney(wht);
  document.getElementById('qtTotalDisplay').textContent = '฿' + formatMoney(total);
  
  document.getElementById('qtVatRow').style.display = isVat ? 'block' : 'none';
  document.getElementById('qtWhtRow').style.display = isWht ? 'block' : 'none';
};

document.getElementById('quotationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const code = document.getElementById('qtCode').value.trim();
  const date = document.getElementById('qtDate').value;
  
  const customerInput = document.getElementById('qtCustomer').value.trim();
  if (!customerInput) {
    alert('กรุณากรอกชื่อลูกค้า');
    return;
  }
  
  // Prevent duplicate quotation code
  if (!editingQuotationId) {
    const isDuplicate = quotationsCache.some(q => q.code && q.code.toLowerCase() === code.toLowerCase());
    if (isDuplicate) {
      alert(`เลขที่ใบเสนอราคา "${code}" นี้มีอยู่ในระบบแล้ว กรุณาใช้เลขอื่น`);
      return;
    }
  } else {
    const isDuplicate = quotationsCache.some(q => q.id !== editingQuotationId && q.code && q.code.toLowerCase() === code.toLowerCase());
    if (isDuplicate) {
      alert(`เลขที่ใบเสนอราคา "${code}" นี้มีอยู่ในระบบแล้ว กรุณาใช้เลขอื่น`);
      return;
    }
  }
  
  const matchedCust = customersCache.find(c => c.name === customerInput);
  const customerId = matchedCust ? matchedCust.id : '';
  const customerName = customerInput;
  
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
  
  const isWht = document.getElementById('qtWhtCheckbox').checked;
  const wht = isWht ? subtotal * 0.03 : 0;
  
  const total = subtotal + vat - wht;
  
  const id = editingQuotationId || ('qt_' + Date.now());
  const data = {
    type: 'quotation',
    code,
    date,
    customerId,
    customerName,
    companyName,
    companyAddress,
    items,
    subtotal,
    vat,
    wht,
    total,
    notes,
    createdBy: editingQuotationId 
      ? (quotationsCache.find(x => x.id === editingQuotationId)?.createdBy || profile.uid) 
      : profile.uid,
    createdAt: editingQuotationId 
      ? (quotationsCache.find(x => x.id === editingQuotationId).createdAt || serverTimestamp()) 
      : serverTimestamp()
  };
  
  try {
    await setDoc(doc(db, 'settings', id), data);
    if (editingQuotationId) {
      await logActivity(`💰 แก้ไขข้อมูลใบเสนอราคา หมายเลข "${code}" สำหรับลูกค้า "${customerName}"`);
    } else {
      await logActivity(`💰 ออกใบเสนอราคาใหม่ หมายเลข "${code}" สำหรับลูกค้า "${customerName}"`);
    }
    closeQuotationFormPanel();
    showToast(editingQuotationId ? 'แก้ไขใบเสนอราคาสำเร็จ' : 'ออกใบเสนอราคาสำเร็จ', 'success');
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
  
  const datalist = document.getElementById('customersDatalist');
  if (datalist) {
    datalist.innerHTML = customersCache.map(c => `<option value="${c.name}"></option>`).join('');
  }
  const custInput = document.getElementById('qtCustomer');
  if (custInput) {
    custInput.value = q.customerName || (cust ? cust.name : '');
  }
  
  document.getElementById('qtCompanyName').value = q.companyName || 'บริษัท แอดวานซ์ บิสซิเนส แมกกาซีน จำกัด';
  document.getElementById('qtCompanyAddress').value = q.companyAddress || '';
  document.getElementById('qtNotes').value = q.notes || '';
  document.getElementById('qtVatCheckbox').checked = q.vat > 0;
  document.getElementById('qtWhtCheckbox').checked = q.wht > 0;
  
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
        <div class="ts">วันที่: ${q.date || '-'} · ลูกค้า: ${escapeHtml(q.customerName || (cust ? cust.name : '-'))}</div>
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
  const q = quotationsCache.find(x => x.id === qId);
  const qCode = q ? q.code : 'ไม่ระบุหมายเลข';
  const qCustName = q ? (q.customerName || '') : '';
  if (!confirm(`ลบเอกสารใบเสนอราคา หมายเลข "${qCode}"?`)) return;
  try {
    await deleteDoc(doc(db, 'settings', qId));
    await logActivity(`🗑️ ลบข้อมูลใบเสนอราคา หมายเลข "${qCode}" ของลูกค้า "${qCustName}"`);
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
  
  const whtSection = q.wht > 0 ? `
    <tr>
      <td colspan="3" style="border:none;"></td>
      <td style="text-align:right; font-weight:700; background:#f9fafb; border:1px solid #cbd5e1; padding:8px;">หักภาษี ณ ที่จ่าย (3%):</td>
      <td style="text-align:right; font-weight:700; background:#f9fafb; border:1px solid #cbd5e1; padding:8px;">-฿${formatMoney(q.wht)}</td>
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
          <strong>ลูกค้า/บริษัท:</strong> ${escapeHtml(q.customerName || (cust ? cust.name : '-'))}${custPhoneLine}${custTaxLine}${custAddressLine}
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
        ${whtSection}
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

// ---------- DAILY UPDATES / HISTORY FEED CRUD ----------

const quickActivityForm = document.getElementById('quickActivityForm');
if (quickActivityForm) {
  quickActivityForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const textInput = document.getElementById('quickActivityText');
    const text = textInput ? textInput.value.trim() : '';
    if (!text) return;
    
    try {
      await logActivity(text);
      if (textInput) textInput.value = '';
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการบันทึกกิจกรรมด่วน: ' + err.message);
    }
  });
}

window.deleteUpdate = async (id) => {
  if (!confirm('ลบรายการประวัตินี้?')) return;
  try {
    await deleteDoc(doc(db, 'dailyUpdates', id));
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
};

function formatIndividualGroupedMessage(name, dateStr, detailsText) {
  const dParts = dateStr.split('-');
  let dateFormatted = dateStr;
  if (dParts.length === 3) {
    const dObj = new Date(dParts[0], dParts[1] - 1, dParts[2]);
    dateFormatted = dObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  return `📢 รายงานความคืบหน้าการทำงาน (รายบุคคล)\n` +
         `👤 ผู้รายงาน: ${name}\n` +
         `📅 ประจำวันที่: ${dateFormatted}\n` +
         `📝 รายละเอียดอัปเดต:\n${detailsText}\n\n` +
         `🔗 ลิงก์ระบบ: https://manybear.github.io/asg-work/`;
}

window.sendIndividualGroupedUpdateToLine = (name, dateStr, encodedDetails) => {
  const detailsText = decodeURIComponent(encodedDetails);
  const msg = formatIndividualGroupedMessage(name, dateStr, detailsText);
  openLineShareUrl(msg);
};

window.copyIndividualGroupedUpdateText = (name, dateStr, encodedDetails) => {
  const detailsText = decodeURIComponent(encodedDetails);
  const msg = formatIndividualGroupedMessage(name, dateStr, detailsText);
  navigator.clipboard.writeText(msg).then(() => {
    alert(`คัดลอกสรุปอัปเดตของ ${name} สำเร็จ!`);
  }).catch(err => {
    alert('ไม่สามารถคัดลอกได้: ' + err.message);
  });
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
    filterAndRenderDailyUpdates();
    
    const uids = visibleUids();
    const updatesForFeed = uids ? updatesCache.filter(u => uids.includes(u.uid)) : updatesCache;
    renderTeamActivity(updatesForFeed);
  });

  // 5. Quotations listener
  const q = query(collection(db, 'settings'), where('type', '==', 'quotation'));
  onSnapshot(q, (snap) => {
    quotationsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    filterAndRenderQuotations();
    renderDashboardStats(tasksCache, projectsCache, customersCache, usersCache);
  });

  // 6. Users snapshot listener (Real-time online status)
  onSnapshot(collection(db, 'users'), (snap) => {
    usersCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    renderTeamMembers(usersCache, tasksCache);
    
    const filterAssignee = document.getElementById('filterAssignee');
    if (filterAssignee) {
      const selectedAssignee = filterAssignee.value;
      filterAssignee.innerHTML = '<option value="">ทุกคนในทีม</option>' + 
        usersCache.map(u => {
          const statusChar = isUserOnline(u) ? '🟢 ' : '⚫ ';
          return `<option value="${u.uid}">${statusChar}${u.name}</option>`;
        }).join('');
      filterAssignee.value = selectedAssignee;
    }
    
    const calFilter = document.getElementById('calendarFilterAssignee');
    if (calFilter) {
      const selectedVal = calFilter.value;
      calFilter.innerHTML = '<option value="">ทุกคนในทีม (ทั้งหมด)</option>' + 
        usersCache.map(u => {
          const statusChar = isUserOnline(u) ? '🟢 ' : '⚫ ';
          return `<option value="${u.uid}">${statusChar}${u.name}</option>`;
        }).join('');
      calFilter.value = selectedVal;
    }
    
    renderDashboardStats(tasksCache, projectsCache, customersCache, usersCache);
  });
}

// ---------- RENDER VIEWS & CONTROLLERS ----------

window.filterAndRenderTasks = function() {
  const searchEl = document.getElementById('taskSearch');
  const queryText = searchEl ? searchEl.value.toLowerCase().trim() : '';
  
  const projFilterEl = document.getElementById('filterProject');
  const projFilter = projFilterEl ? projFilterEl.value : '';
  
  const assigneeFilterEl = document.getElementById('filterAssignee');
  const assigneeFilter = assigneeFilterEl ? assigneeFilterEl.value : '';
  
  const statusFilterEl = document.getElementById('filterStatus');
  const statusFilter = statusFilterEl ? statusFilterEl.value : '';
  
  const priorityFilterEl = document.getElementById('filterPriority');
  const priorityFilter = priorityFilterEl ? priorityFilterEl.value : '';
  
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
  // Reset quick filter button styles
  document.querySelectorAll('.quick-filters-bar button').forEach(btn => {
    btn.classList.remove('active-quick-filter');
  });
  const qfAll = document.getElementById('qfAll');
  if (qfAll) qfAll.classList.add('active-quick-filter');

  document.getElementById('taskSearch').value = '';
  document.getElementById('filterProject').value = '';
  document.getElementById('filterAssignee').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterPriority').value = '';
  filterAndRenderTasks();
};

window.applyQuickFilter = function(filterType) {
  // Update active button state
  document.querySelectorAll('.quick-filters-bar button').forEach(btn => {
    btn.classList.remove('active-quick-filter');
  });
  const activeBtn = document.getElementById('qf' + filterType.charAt(0).toUpperCase() + filterType.slice(1));
  if (activeBtn) activeBtn.classList.add('active-quick-filter');
  
  // Reset manual inputs
  const taskSearch = document.getElementById('taskSearch');
  if (taskSearch) taskSearch.value = '';
  const filterProject = document.getElementById('filterProject');
  if (filterProject) filterProject.value = '';
  const filterAssignee = document.getElementById('filterAssignee');
  if (filterAssignee) filterAssignee.value = '';
  const filterStatus = document.getElementById('filterStatus');
  if (filterStatus) filterStatus.value = '';
  const filterPriority = document.getElementById('filterPriority');
  if (filterPriority) filterPriority.value = '';
  
  // Filter tasks based on selected quick filter
  const uids = visibleUids();
  let list = uids ? tasksCache.filter(t => {
    const isAssigned = t.assignees ? t.assignees.includes(profile.uid) : (t.assignee === profile.uid);
    return isAssigned;
  }) : [...tasksCache];
  
  if (filterType === 'notyet') {
    list = list.filter(t => t.status === 'notyet');
    if (filterStatus) filterStatus.value = 'notyet';
  } else if (filterType === 'inprog') {
    list = list.filter(t => t.status === 'inprog');
    if (filterStatus) filterStatus.value = 'inprog';
  } else if (filterType === 'done') {
    list = list.filter(t => t.status === 'done');
    if (filterStatus) filterStatus.value = 'done';
  } else if (filterType === 'my') {
    if (currentUser) {
      list = list.filter(t => t.assignees ? t.assignees.includes(currentUser.uid) : (t.assignee === currentUser.uid));
      if (filterAssignee) filterAssignee.value = currentUser.uid;
    }
  } else if (filterType === 'urgent') {
    list = list.filter(t => t.priority === 'urgent' && t.status !== 'done');
    if (filterPriority) filterPriority.value = 'urgent';
  } else if (filterType === 'overdue') {
    const todayStr = new Date().toISOString().slice(0, 10);
    list = list.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < todayStr);
  }
  
  renderTasksList(list);
};

window.filterAndRenderQuotations = function() {
  const searchInput = document.getElementById('quotationSearch');
  const queryText = searchInput ? searchInput.value.toLowerCase().trim() : '';
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
    
    let linksSection = '';
    if (t.links && t.links.length) {
      linksSection = `
        <div class="task-card-links" style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;" onclick="event.stopPropagation()">
          ${t.links.map(l => `
            <a href="${l.url}" target="_blank" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:#ffffff; background:#6366f1; border:1px solid #4f46e5; padding:3px 8px; border-radius:15px; text-decoration:none; transition:all 0.2s;" onmouseover="this.style.background='#4f46e5'" onmouseout="this.style.background='#6366f1'">
              <i class="fa-solid fa-link" style="font-size:9px"></i> ${escapeHtml(l.label)}
            </a>
          `).join('')}
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
        ${linksSection}
        <div class="card-actions" onclick="event.stopPropagation()">
          <button class="icon-btn" onclick="shareTaskToLineCard('${t.id}')" style="background:#06c755; color:#fff;" title="แชร์ลง LINE"><i class="fa-brands fa-line"></i> LINE</button>
          ${canEdit ? `<button class="icon-btn edit" onclick="openAddTaskModal('${t.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>` : ''}
          ${profile.role === 'admin' ? `<button class="icon-btn del" onclick="deleteTask('${t.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderDashboardStats(tasks, projects, customers, users) {
  const statProj = document.getElementById('statProjects');
  if (statProj) statProj.textContent = projects.length;
  
  const statTeam = document.getElementById('statTeamSize');
  if (statTeam) statTeam.textContent = usersCache.length;
  
  const pendingTasks = tasks.filter(t => t.status !== 'done');
  const statPending = document.getElementById('statPendingTasks');
  if (statPending) statPending.textContent = pendingTasks.length;
  
  const soonContracts = customers.filter(c => {
    const d = daysUntil(c.contractEndDate);
    return d >= 0 && d <= 30;
  });
  const statContracts = document.getElementById('statExpiringContracts');
  if (statContracts) statContracts.textContent = soonContracts.length;
  
  // Calculate and render Quotations statistics (exclude void/cancelled ones)
  const activeQuotes = quotationsCache.filter(q => q.status !== 'void');
  const totalAmount = activeQuotes.reduce((sum, q) => sum + (Number(q.total) || 0), 0);
  const statQuotes = document.getElementById('statQuotations');
  if (statQuotes) {
    const formattedAmount = Number(totalAmount).toLocaleString('th-TH', { maximumFractionDigits: 0 });
    statQuotes.textContent = `${activeQuotes.length} ใบ / ฿${formattedAmount}`;
  }
  
  const doneCount = tasks.filter(t => t.status === 'done').length;
  const inprogCount = tasks.filter(t => t.status === 'inprog').length;
  const notyetCount = tasks.filter(t => t.status === 'notyet').length;
  
  const chartEl = document.getElementById('dashboardChart');
  if (!chartEl) return;
  const ctx = chartEl.getContext('2d');
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
      
      let assigneesList = [];
      if (t.assignees && t.assignees.length > 0) {
        assigneesList = t.assignees.map(uid => usersCache.find(u => u.uid === uid)).filter(Boolean);
      } else if (t.assignee) {
        const u = usersCache.find(x => x.uid === t.assignee);
        if (u) assigneesList.push(u);
      }
      
      const avatarsHtml = assigneesList.map(u => {
        const uColor = getEmployeeColor(u.name);
        return `<span class="avatar-initial" style="background:${uColor.border}; width:16px; height:16px; font-size:9px; color:#fff;" title="${u.name}">${getEmployeeInitials(u.name)}</span>`;
      }).join('');
      
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color)">
          <div style="cursor:pointer; flex:1;" onclick="openTaskDetailsModal('${t.id}')">
            <strong style="color:var(--text-dark);">${t.title}</strong>
            <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
              <span class="ts" style="margin:0;">เดดไลน์: ${t.dueDate}</span>
              <div style="display:flex; gap:2px; align-items:center;">${avatarsHtml}</div>
            </div>
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

function renderDailyUpdates(updates) {
  const box = document.getElementById('updateList');
  if (!box) return;
  if (!updates || updates.length === 0) {
    box.innerHTML = '<p class="muted">ไม่มีบันทึกกิจกรรมการทำงานในวันที่เลือก</p>';
    return;
  }
  
  // Group updates by uid
  const grouped = {};
  updates.forEach(u => {
    if (!grouped[u.uid]) {
      grouped[u.uid] = [];
    }
    grouped[u.uid].push(u);
  });
  
  // Render a card for each user
  const htmlParts = Object.keys(grouped).map(uid => {
    const userUpdates = grouped[uid];
    userUpdates.sort((a, b) => {
      const timeA = a.time || '';
      const timeB = b.time || '';
      return timeA.localeCompare(timeB);
    });
    
    const user = usersCache.find(x => x.uid === uid);
    const userName = user ? user.name : 'ไม่ระบุผู้ใช้';
    const canDeleteAny = profile && profile.role === 'admin';
    
    const listHtml = userUpdates.map(u => {
      const displayTime = u.time ? `[${u.time}]` : '';
      const isOwner = currentUser && currentUser.uid === u.uid;
      const canManage = isOwner || canDeleteAny;
      
      return `
        <li style="margin-bottom: 6px; display:flex; justify-content:space-between; align-items:start; list-style:none;">
          <span style="font-size:13.5px; line-height:1.5; color:var(--text-dark);">
            <span style="color:var(--text-muted); font-weight:600; margin-right:4px;">${displayTime}</span> ${escapeHtml(u.text)}
          </span>
          ${canManage ? `
            <button onclick="deleteUpdate('${u.id}')" style="font-size:10px; padding:2px 4px; margin-left:8px; border:none; background:none; color:var(--high-color); cursor:pointer;" title="ลบรายการนี้"><i class="fa-solid fa-trash"></i></button>
          ` : ''}
        </li>
      `;
    }).join('');
    
    const dateStr = userUpdates[0].date;
    const reportDetailsText = userUpdates.map(u => {
      const displayTime = u.time ? `[${u.time}]` : '';
      return `- ${displayTime} ${u.text}`;
    }).join('\n');
    
    const encodedText = encodeURIComponent(reportDetailsText);
    
    const uColor = getEmployeeColor(userName);
    const initials = getEmployeeInitials(userName);
    
    return `
      <div class="card" style="margin-bottom: 12px; border-left: 4px solid ${uColor.border}; padding: 12px; background: #fff;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:8px; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="avatar-initial" style="background:${uColor.border}; width:18px; height:18px; font-size:10px; color:#fff;">${initials}</span>
            <strong style="color:${uColor.border}; font-size:15px;">${userName}</strong>
            <span class="ts" style="margin-left: 10px; font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-calendar-day"></i> ${dateStr}</span>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button class="btn btn-ghost btn-sm" onclick="sendIndividualGroupedUpdateToLine('${userName}', '${dateStr}', '${encodedText}')" style="padding: 3px 8px; font-size:11px; color:#06c755; display:inline-flex; align-items:center; gap:3px;" title="ส่งไลน์รายงานความคืบหน้าของพนักงานคนนี้"><i class="fa-brands fa-line"></i> ส่ง LINE</button>
            <button class="btn btn-ghost btn-sm" onclick="copyIndividualGroupedUpdateText('${userName}', '${dateStr}', '${encodedText}')" style="padding: 3px 8px; font-size:11px; display:inline-flex; align-items:center; gap:3px;" title="คัดลอกรายงานของพนักงานคนนี้"><i class="fa-regular fa-copy"></i> คัดลอก</button>
          </div>
        </div>
        <ul style="margin: 0; padding-left: 4px;">
          ${listHtml}
        </ul>
      </div>
    `;
  });
  
  box.innerHTML = htmlParts.join('');
}

window.filterAndRenderDailyUpdates = () => {
  const dateFilterInput = document.getElementById('dailyReportDateFilter');
  const selectedDate = dateFilterInput ? dateFilterInput.value : '';
  
  const uids = visibleUids();
  let list = uids ? updatesCache.filter(u => uids.includes(u.uid)) : [...updatesCache];
  
  if (selectedDate) {
    list = list.filter(u => u.date === selectedDate);
  }
  
  renderDailyUpdates(list);
};

function renderTeamActivity(updates) {
  const box = document.getElementById('teamActivityFeed');
  if (!updates || updates.length === 0) {
    box.innerHTML = '<p class="muted">ไม่มีกิจกรรมอัปเดตวันนี้</p>';
    return;
  }
  
  const recent = updates.slice(0, 5);
  box.innerHTML = recent.map(u => {
    const user = usersCache.find(x => x.uid === u.uid);
    const userName = user ? user.name : 'พนักงาน';
    const uColor = getEmployeeColor(userName);
    const initial = getEmployeeInitials(userName);
    return `
      <div class="feed-item" style="border-left: 3.5px solid ${uColor.border}; padding-left: 10px; margin-bottom: 10px; display: flex; align-items: start; gap: 10px; padding-top: 4px; padding-bottom: 4px;">
        <div class="feed-avatar" style="background:${uColor.border}; color:#fff; font-size:10px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; flex-shrink:0;">${initial}</div>
        <div class="feed-info" style="flex:1;">
          <span class="feed-text"><strong style="color:${uColor.border}">${userName}</strong> อัปเดตงาน:</span>
          <span class="feed-text" style="color:var(--text-muted); font-size:12.5px; margin-top:2px; display:block;">"${u.text}"</span>
          <span class="feed-time" style="font-size:10.5px; color:var(--text-muted); margin-top:3px; display:block;"><i class="fa-regular fa-clock"></i> ${u.date}</span>
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
    
    const uColor = getEmployeeColor(u.name);
    const initials = getEmployeeInitials(u.name);
    const isOnline = isUserOnline(u);
    
    const onlineIndicator = isOnline 
      ? `<span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%; display: inline-block; box-shadow: 0 0 8px #22c55e; margin-left: 6px;" title="ออนไลน์กำลังใช้งานระบบ"></span>`
      : `<span style="width: 8px; height: 8px; background: #94a3b8; border-radius: 50%; display: inline-block; margin-left: 6px;" title="ออฟไลน์ (ใช้งานล่าสุด: ${formatLastActive(u.lastActive)})"></span>`;
    
    return `
      <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; margin-bottom:8px; border-left: 4px solid ${uColor.border};">
        <div onclick="viewEmployeeTasksAndHistory('${u.uid}', '${escapeHtml(u.name)}')" style="cursor:pointer; flex:1;" title="คลิกเพื่อดูงานของ ${u.name}">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="avatar-initial" style="background:${uColor.border}; width:20px; height:20px; font-size:10px; color:#fff; display:inline-flex; align-items:center; justify-content:center; border-radius:50%;">${initials}</span>
            <strong style="font-size:14px; color:${uColor.border}; text-decoration:underline; text-decoration-style:dotted;">${nameLabel}</strong>
            ${onlineIndicator}
          </div>
          <div class="ts" style="margin-left: 26px;">${u.email}</div>
          <div style="margin-top:6px; margin-left: 26px;">
            <span class="${roleClass}" style="padding:1px 6px; font-size:10px">${roleLabel}</span>
            <span class="badge inprog" style="padding:1px 6px; font-size:10px; margin-left:4px">${activeCount} งานค้าง</span>
          </div>
        </div>
        ${profile.role === 'admin' && u.uid !== profile.uid ? `
          <div style="display:flex; gap:8px;">
            <button class="icon-btn edit" onclick="toggleUserRole('${u.uid}', '${u.role || 'staff'}')">
              <i class="fa-solid fa-user-gear"></i> ${u.role === 'admin' ? 'ตั้งเป็นพนักงาน' : 'ตั้งเป็นหัวหน้า'}
            </button>
            <button class="icon-btn del" onclick="deleteUserRecord('${u.uid}')"><i class="fa-solid fa-trash"></i> ลบ</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

window.viewEmployeeTasksAndHistory = function(uid, name) {
  showPage('tasks');
  const filterAssignee = document.getElementById('filterAssignee');
  if (filterAssignee) {
    filterAssignee.value = uid;
    filterAndRenderTasks();
  }
  showToast(`แสดงรายการงานของ ${name}`, 'success');
};

window.deleteUserRecord = async (uid) => {
  if (!confirm('ลบพนักงานรายนี้? ข้อมูลโปรไฟล์จะหายไปจากรายชื่อทีม แต่อีเมลจะยังคงล็อกอินได้')) return;
  try {
    await deleteDoc(doc(db, 'users', uid));
    await loadUsers();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
};

window.toggleUserRole = async (uid, currentRole) => {
  const newRole = currentRole === 'admin' ? 'staff' : 'admin';
  const roleName = newRole === 'admin' ? 'หัวหน้างาน (Admin)' : 'พนักงาน (Staff)';
  if (!confirm(`เปลี่ยนบทบาทของพนักงานคนนี้ให้เป็น ${roleName}?`)) return;
  try {
    await updateDoc(doc(db, 'users', uid), { role: newRole });
    await loadUsers();
    alert('เปลี่ยนบทบาทสำเร็จเรียบร้อยแล้ว!');
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการเปลี่ยนบทบาท: ' + err.message);
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
  const role = document.getElementById('newUserRole').value;
  const errBox = document.getElementById('addUserError');
  errBox.textContent = '';
  
  try {
    await setPersistence(secondaryAuth, inMemoryPersistence);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pw);
    
    // Write profile using the primary Firestore client (since primary session is an Admin, this satisfies the rules check)
    await setDoc(doc(db, 'users', cred.user.uid), {
      name: name,
      email: email,
      role: role,
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
  } else if (type === 'quotations') {
    const rows = [['เลขที่ใบเสนอราคา', 'วันที่เอกสาร', 'ลูกค้า', 'ยอดเงินรวม (บาท)', 'ผู้จัดทำ', 'สถานะ']];
    quotationsCache.forEach(q => {
      const cust = customersCache.find(x => x.id === q.customerId);
      const custName = cust ? cust.name : '-';
      const creatorName = nameOf(q.createdBy);
      rows.push([q.code, q.date, custName, q.total || 0, creatorName, q.status || 'active']);
    });
    downloadCSV('asg-work-quotations.csv', rows);
  }
};

function generateDailyReportText() {
  const filterInput = document.getElementById('dailyReportDateFilter');
  const targetDateStr = filterInput ? filterInput.value : new Date().toISOString().slice(0, 10);
  
  if (!targetDateStr) return "";
  
  const todayUpdates = updatesCache.filter(u => u.date === targetDateStr);
  if (todayUpdates.length === 0) return "";
  
  const dParts = targetDateStr.split('-');
  let dateFormatted = targetDateStr;
  if (dParts.length === 3) {
    const dObj = new Date(dParts[0], dParts[1] - 1, dParts[2]);
    dateFormatted = dObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  
  // Group by user
  const grouped = {};
  todayUpdates.forEach(u => {
    if (!grouped[u.uid]) grouped[u.uid] = [];
    grouped[u.uid].push(u);
  });
  
  let msg = `📢 รายงานความคืบหน้าทีมงาน (Daily Standup)\n📅 ประจำวันที่: ${dateFormatted}\n\n`;
  
  Object.keys(grouped).forEach((uid, index) => {
    const userUpdates = grouped[uid];
    userUpdates.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    
    const user = usersCache.find(x => x.uid === uid);
    const userName = user ? user.name : 'ไม่ระบุผู้ใช้';
    
    msg += `👤 ${index + 1}. ${userName}\n`;
    userUpdates.forEach(u => {
      const displayTime = u.time ? `[${u.time}] ` : '';
      msg += `   - ${displayTime}${u.text}\n`;
    });
    msg += `\n`;
  });
  
  msg += `🔗 ลิงก์ระบบ: https://manybear.github.io/asg-work/`;
  return msg;
}

window.copyDailyReportText = () => {
  const filterInput = document.getElementById('dailyReportDateFilter');
  const targetDateStr = filterInput ? filterInput.value : '';
  const msg = generateDailyReportText();
  if (!msg) {
    alert(targetDateStr ? 'วันที่เลือกนี้ยังไม่มีพนักงานคนใดบันทึกอัปเดตงานเข้ามาครับ' : 'วันนี้ยังไม่มีพนักงานคนใดบันทึกอัปเดตงานเข้ามาครับ');
    return;
  }
  
  navigator.clipboard.writeText(msg).then(() => {
    alert('คัดลอกสรุปรายงานการทำงานวันนี้สำเร็จ! นำไปวางส่งในกลุ่มแชทภายนอกได้ทันที');
  }).catch(err => {
    alert('ไม่สามารถคัดลอกได้: ' + err.message);
  });
};

window.sendDailyReportToLine = () => {
  const filterInput = document.getElementById('dailyReportDateFilter');
  const targetDateStr = filterInput ? filterInput.value : '';
  const msg = generateDailyReportText();
  if (!msg) {
    alert(targetDateStr ? 'วันที่เลือกนี้ยังไม่มีพนักงานคนใดบันทึกอัปเดตงานเข้ามาครับ' : 'วันนี้ยังไม่มีพนักงานคนใดบันทึกอัปเดตงานเข้ามาครับ');
    return;
  }
  
  openLineShareUrl(msg);
};

window.printPage = (pageId) => {
  const titles = {
    'page-tasks': 'รายงานรายการงานขององค์กร (Tasks Report)',
    'page-updates': 'รายงานประวัติการทำงานประจำวัน (History Feed)',
    'page-customers': 'รายงานข้อมูลลูกค้าและสัญญา (Customers & Contracts)'
  };
  
  const page = document.getElementById(pageId);
  if (page) {
    const titleEl = page.querySelector('.print-header .print-title');
    if (titleEl) titleEl.textContent = titles[pageId] || 'รายงานข้อมูลระบบ';
    
    const byEl = page.querySelector('.print-header .print-by');
    if (byEl) byEl.textContent = profile ? profile.name : 'System';
    
    const timeEl = page.querySelector('.print-header .print-time');
    if (timeEl) {
      const now = new Date();
      timeEl.textContent = now.toLocaleDateString('th-TH') + ' ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    }
  }

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

// ---------- GLOBAL SEARCH ENGINE ----------

function initGlobalSearch() {
  const input = document.getElementById('globalSearchInput');
  const resultsBox = document.getElementById('globalSearchResults');
  const clearBtn = document.getElementById('globalSearchClear');
  if (!input || !resultsBox) return;
  
  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    if (!val) {
      resultsBox.style.display = 'none';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }
    if (clearBtn) clearBtn.style.display = 'block';
    
    // 1. Search Tasks
    const matchedTasks = tasksCache.filter(t => 
      (t.title && t.title.toLowerCase().includes(val)) || 
      (t.description && t.description.toLowerCase().includes(val))
    ).slice(0, 5);
    
    // 2. Search Projects
    const matchedProjects = projectsCache.filter(p => 
      p.name && p.name.toLowerCase().includes(val)
    ).slice(0, 5);
    
    // 3. Search Customers
    const matchedCustomers = customersCache.filter(c => 
      (c.name && c.name.toLowerCase().includes(val)) || 
      (c.phone && c.phone.toLowerCase().includes(val)) || 
      (c.taxId && c.taxId.toLowerCase().includes(val))
    ).slice(0, 5);
    
    // 4. Search Quotations
    const matchedQuotations = quotationsCache.filter(q => 
      (q.code && q.code.toLowerCase().includes(val)) || 
      (q.customerName && q.customerName.toLowerCase().includes(val))
    ).slice(0, 5);
    
    let html = '';
    
    // Render Tasks (Purple)
    if (matchedTasks.length) {
      html += `<div style="font-size:11px; font-weight:700; color:#a855f7; padding:6px 12px; background:#f3e8ff; border-top:1px solid #e9d5ff; border-bottom:1px solid #e9d5ff; margin-top:4px;">🟣 รายการงาน (${matchedTasks.length})</div>`;
      matchedTasks.forEach(t => {
        html += `
          <div class="search-item" onclick="clickGlobalSearchResult('task', '${t.id}')" style="padding:8px 12px; cursor:pointer; font-size:13px; color:#374151; transition:background 0.15s;" onmouseover="this.style.background='#faf5ff'" onmouseout="this.style.background='transparent'">
            <strong style="color:#7c3aed;">${escapeHtml(t.title)}</strong>
            <div style="font-size:11px; color:#6b7280; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(t.description || '')}</div>
          </div>
        `;
      });
    }
    
    // Render Projects (Green)
    if (matchedProjects.length) {
      html += `<div style="font-size:11px; font-weight:700; color:#15803d; padding:6px 12px; background:#dcfce7; border-top:1px solid #bbf7d0; border-bottom:1px solid #bbf7d0; margin-top:4px;">🟢 โครงการ (${matchedProjects.length})</div>`;
      matchedProjects.forEach(p => {
        html += `
          <div class="search-item" onclick="clickGlobalSearchResult('project', '${p.id}')" style="padding:8px 12px; cursor:pointer; font-size:13px; color:#374151; transition:background 0.15s;" onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='transparent'">
            <strong style="color:#166534;">${escapeHtml(p.name)}</strong>
          </div>
        `;
      });
    }
    
    // Render Customers (Blue)
    if (matchedCustomers.length) {
      html += `<div style="font-size:11px; font-weight:700; color:#1d4ed8; padding:6px 12px; background:#dbeafe; border-top:1px solid #bfdbfe; border-bottom:1px solid #bfdbfe; margin-top:4px;">🔵 ข้อมูลลูกค้า (${matchedCustomers.length})</div>`;
      matchedCustomers.forEach(c => {
        const details = [c.phone, c.taxId].filter(Boolean).join(' · ');
        html += `
          <div class="search-item" onclick="clickGlobalSearchResult('customer', '${c.id}')" style="padding:8px 12px; cursor:pointer; font-size:13px; color:#374151; transition:background 0.15s;" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='transparent'">
            <strong style="color:#1e40af;">${escapeHtml(c.name)}</strong>
            <div style="font-size:11px; color:#6b7280;">${escapeHtml(details)}</div>
          </div>
        `;
      });
    }
    
    // Render Quotations (Red)
    if (matchedQuotations.length) {
      html += `<div style="font-size:11px; font-weight:700; color:#b91c1c; padding:6px 12px; background:#fee2e2; border-top:1px solid #fecaca; border-bottom:1px solid #fecaca; margin-top:4px;">🔴 ใบเสนอราคา (${matchedQuotations.length})</div>`;
      matchedQuotations.forEach(q => {
        html += `
          <div class="search-item" onclick="clickGlobalSearchResult('quotation', '${q.id}')" style="padding:8px 12px; cursor:pointer; font-size:13px; color:#374151; transition:background 0.15s;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'">
            <strong style="color:#991b1b;">${escapeHtml(q.code)}</strong> · <span style="font-size:12px; color:#4b5563;">${escapeHtml(q.customerName || '')}</span>
          </div>
        `;
      });
    }
    
    if (!html) {
      html = `<div style="padding:16px; text-align:center; font-size:13px; color:var(--text-muted);">❌ ไม่พบข้อมูลที่ตรงกัน</div>`;
    }
    
    resultsBox.innerHTML = html;
    resultsBox.style.display = 'block';
  });
  
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      resultsBox.style.display = 'none';
      clearBtn.style.display = 'none';
      input.focus();
    });
  }
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      resultsBox.style.display = 'none';
    }
  });
  
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !resultsBox.contains(e.target)) {
      resultsBox.style.display = 'none';
    }
  });
}

window.clickGlobalSearchResult = function(type, id) {
  const input = document.getElementById('globalSearchInput');
  const resultsBox = document.getElementById('globalSearchResults');
  if (input) input.value = '';
  if (resultsBox) resultsBox.style.display = 'none';
  const clearBtn = document.getElementById('globalSearchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  
  if (type === 'task') {
    showPage('tasks');
    openTaskDetailsModal(id);
  } else if (type === 'project') {
    showPage('projects');
    setTimeout(() => {
      const el = document.getElementById('projectList');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 200);
  } else if (type === 'customer') {
    showPage('customers');
    setTimeout(() => {
      const el = document.getElementById('customerList');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 200);
  } else if (type === 'quotation') {
    showPage('quotations');
  }
};
