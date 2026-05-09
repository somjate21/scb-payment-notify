# 💳 SCB Payment Notify - ระบบแจ้งเตือนเงินเข้า

## วิธีใช้งาน

### 1. รันเซิร์ฟเวอร์
```bash
node server.js
```
เปิดเบราว์เซอร์ไปที่: http://localhost:3000

---

### 2. ทดสอบระบบ (ก่อนเชื่อม SCB จริง)
กด **"ส่งทดสอบ"** ในหน้าเว็บ หรือ curl:
```bash
curl -X POST http://localhost:3000/test -H "Content-Type: application/json" -d '{"amount": 150}'
```

---

### 3. เชื่อม SCB API จริง

#### สมัคร SCB Developer
1. ไปที่ https://developer.scb.co.th
2. สมัครบัญชี → สร้าง Application ใหม่
3. เลือก Product: **Payment Solution**
4. ได้ `API_KEY` และ `API_SECRET`

#### ตั้ง Webhook บน SCB
- Webhook URL: `https://your-domain.com/webhook/scb`
- (ระหว่างทดสอบ localhost ใช้ **ngrok**: `ngrok http 3000`)

#### ติดตั้ง ngrok สำหรับทดสอบ
```bash
# ติดตั้ง ngrok (ฟรี)
# https://ngrok.com/download
ngrok http 3000
# จะได้ URL เช่น https://xxxx.ngrok.io
# เอา URL นั้นไปใส่ใน SCB Developer Console
```

---

### โครงสร้างไฟล์
```
scb-notify/
├── server.js   ← Node.js server + Webhook receiver
├── index.html  ← หน้า Dashboard แจ้งเตือนเสียง
└── README.md
```

---

### Webhook Payload จาก SCB (ตัวอย่าง)
```json
{
  "transRef": "SCB1234567890",
  "amount": 150.00,
  "sendingBank": "KBANK",
  "receiver": {
    "accountNumber": "xxx-x-xxxxx-x",
    "accountName": "ร้านของฉัน"
  },
  "transDate": "20250509",
  "transTime": "163800"
}
```
