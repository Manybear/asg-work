# ASG Work — คู่มือติดตั้ง (ฟรี 100%)

แอปนี้ใช้ **GitHub Pages** เปิดหน้าเว็บ และ **Firebase** (ฟรี tier) เป็นฐานข้อมูลกลาง
ให้พนักงาน 10 คนเห็นข้อมูลชุดเดียวกันแบบ real-time ไม่ต้องมี server, ไม่ต้อง build,
ไม่ต้องผูกบัตรเครดิต

---

## ขั้นตอนที่ 1 — สร้างโปรเจกต์ Firebase (5 นาที)

1. เข้า https://console.firebase.google.com แล้ว login ด้วยบัญชี Google
2. กด **Add project** → ตั้งชื่อ เช่น `asg-work` → กด Continue จนเสร็จ (ปิด Google Analytics ก็ได้ ไม่จำเป็น)
3. ในเมนูซ้าย เลือก **Build > Authentication** → กด **Get started**
   → แท็บ Sign-in method → เลือก **Email/Password** → เปิดใช้งาน (Enable) → Save
4. ในเมนูซ้าย เลือก **Build > Firestore Database** → กด **Create database**
   → เลือก **Start in production mode** → เลือก location (เช่น `asia-southeast1`) → Enable
5. ไปที่แท็บ **Rules** ของ Firestore → ลบของเดิมทิ้งแล้ววางเนื้อหาจากไฟล์ `firestore.rules`
   ที่แนบมาให้ในโฟลเดอร์นี้ → กด **Publish**
6. กลับไปหน้าโปรเจกต์หลัก (กดรูปเฟือง > Project settings) → เลื่อนลงมาที่ **Your apps**
   → กดไอคอน **</>** (Web) → ตั้งชื่อแอป (เช่น asg-work-web) → **ไม่ต้อง**ติ๊ก Firebase Hosting
   → กด Register app → จะเห็นโค้ด config หน้าตาแบบนี้:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "asg-work.firebaseapp.com",
  projectId: "asg-work",
  storageBucket: "asg-work.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

7. คัดลอกค่าทั้งหมด ไปวางแทนที่ในไฟล์ **`firebase-config.js`** ของโปรเจกต์นี้

---

## ขั้นตอนที่ 2 — สร้างบัญชีหัวหน้าคนแรก (Admin)

1. กลับไปที่ Firebase Console > Authentication > แท็บ **Users** → กด **Add user**
   → กรอกอีเมล+รหัสผ่านของคุณ (คนที่จะเป็นหัวหน้า) → Add user
2. ไปที่ Firestore Database > แท็บ **Data** → กด **Start collection**
   → Collection ID พิมพ์ว่า `users` → Document ID ให้ใช้ **UID** ของ user ที่เพิ่งสร้าง
   (คัดลอกจากหน้า Authentication > Users) → เพิ่ม field:
   - `name` (string) = ชื่อคุณ
   - `role` (string) = `admin`
   - `email` (string) = อีเมลที่ใช้สมัคร
   → กด Save

พนักงานที่เหลืออีก 9 คน ไม่ต้องทำตรงนี้ — สร้างผ่านหน้า **ตั้งค่า > จัดการผู้ใช้** ในแอปได้เลย
หลังจากล็อกอินด้วยบัญชี admin แล้ว (role จะเป็น `staff` โดยอัตโนมัติ)

---

## ขั้นตอนที่ 3 — Push ขึ้น GitHub + เปิด GitHub Pages

```bash
cd asg-work
git init
git add .
git commit -m "ASG Work - initial version"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

จากนั้นบน GitHub:
1. เข้า repo ของคุณ → **Settings** → เมนูซ้าย **Pages**
2. Source เลือก **Deploy from a branch** → Branch เลือก `main` / folder `/ (root)` → Save
3. รอ 1-2 นาที จะได้ลิงก์แบบ `https://<your-username>.github.io/<repo-name>/`
   ส่งลิงก์นี้ให้พนักงานทั้ง 10 คนเข้าใช้งานได้เลย

---

## โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หน้าตาแอปทั้งหมด (login, nav, ทุกหน้า) |
| `app.js` | ตรรกะระบบ: login, CRUD โปรเจกต์/งาน/อัปเดต/ลูกค้า, แจ้งเตือน |
| `firebase-config.js` | ค่าเชื่อมต่อ Firebase ของคุณ (ต้องแก้ก่อนใช้งาน) |
| `firestore.rules` | กฎความปลอดภัยของฐานข้อมูล (วางใน Firebase Console) |

## โมดูลที่ทำไว้ในเวอร์ชันนี้

- ล็อกอินแยกรายคน (Firebase Authentication)
- โปรเจกต์ + งานย่อย มอบหมายรายบุคคล
- อัปเดตงานรายวันส่วนตัว
- ตั้งค่าการมองเห็น: ส่วนตัว / หัวหน้าเห็นทุกคน / เปิดให้ทุกคนเห็นกัน
- ลูกค้า + วันครบสัญญา + ตั้งวันแจ้งเตือนล่วงหน้าได้เอง (ระฆังแจ้งเตือนมุมขวาบน)
- หัวหน้าเพิ่มบัญชีพนักงานได้จากในแอป

## สิ่งที่ยังไม่ได้ทำ (ต่อยอดได้)

- แดชบอร์ดวิเคราะห์ข้อมูล (กราฟ/สถิติ) — ตอนนี้มีแค่โครงหน้าเปล่า
- ใบเสนอราคา/ใบแจ้งหนี้
- แจ้งเตือนผ่าน LINE/อีเมล (ตอนนี้แจ้งในแอปเท่านั้น ต้องเปิดแอปถึงจะเห็น)
- แก้ไข/ลบข้อมูลที่เพิ่มไปแล้ว (ตอนนี้เพิ่มได้อย่างเดียว)

บอกได้เลยว่าอยากให้ผมทำส่วนไหนต่อ จะเขียนโค้ดเพิ่มให้ในไฟล์เดิมนี้
