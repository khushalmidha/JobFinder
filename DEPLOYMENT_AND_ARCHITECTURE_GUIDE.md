# 🚀 JobFinder Production Deployment & Security Architecture Guide

---

## 1. 🌐 Cloud Deployment (Laptop ON/OFF Jhanjhat Khatam)
Jab aapka backend cloud par deploy ho jata hai, toh **Node.js process and Cron Schedulers 24/7 zinda rehte hain**. Aapka laptop band ho, switch off ho ya internet disconnect ho — **Server Morning (09:00 AM IST), Afternoon (02:00 PM IST), aur Night (08:30 PM IST) ko automatically career portals crawl karta rahega aur Apollo/Hunter leads update karta rahega.**

### Option A: Render (1-Click Blueprint Deploy)
Project me `render.yaml` add kar diya gaya hai.
1. Code ko apne GitHub repository me push kijiye:
   ```bash
   git add .
   git commit -m "Add access approval flow, manual shared contacts & cloud deploy config"
   git push origin main
   ```
2. [dashboard.render.com](https://dashboard.render.com) par jaiye -> **New +** -> **Blueprint**.
3. Apna repository select kijiye. Render `render.yaml` read karke dono services create kar dega:
   - `jobfinder-backend` (Node Web Service)
   - `jobfinder-web` (Static Site Frontend)
4. Environment Variables me apna MongoDB URI verify kijiye:
   - `MONGODB_URI`: `mongodb+srv://khushalmidha:7H5qXGxJ03vfYt9A@cluster0.qyi5j.mongodb.net/jobfinder`
   - `JWT_SECRET`: `supersecretkey_jobfinder2026`

---

### Option B: AWS (EC2 / App Runner Deploy)
Agar aap AWS par deploy karna chahte hain (jo SMTP ke liye best hai kyunki AWS par IPv4 unrestricted rehta hai):
1. **EC2 Instance Launch (Ubuntu 22.04 / Amazon Linux)**:
   - Security Group me Port `80` (HTTP), `443` (HTTPS), `5000` (Backend API), aur `22` (SSH) allow kijiye.
2. Server me SSH kijiye aur Docker install kijiye:
   ```bash
   sudo apt update && sudo apt install -y docker.io docker-compose
   ```
3. Repository clone karke 1 command se deploy kijiye:
   ```bash
   git clone <YOUR_REPO_URL>
   cd Jobfinder
   sudo docker compose up -d --build
   ```
4. Background me dono containers run karenge:
   - Backend: `http://<YOUR_EC2_IP>:5000`
   - Frontend: `http://<YOUR_EC2_IP>:80`

---

## 2. 🔒 Protected Shared Contacts & Approval Flow (`khushalmidha24@gmail.com`)

### Kaam Kaise Karta Hai:
1. **Direct Access Blocked**:
   - Koi bhi normal user ya visitor Master Shared Recruiter list ya download sheet directly access nahi kar sakta (`403 Forbidden`).
2. **Access Request Form**:
   - Visitors jab Recruiter tab par jayenge, unhe **"🔒 Master Recruiter & Shared Contact Directory is Protected"** barrier dikhega.
   - Wahan wo apna Name, Email, aur Reason daal kar **"📩 Request Access from Khushal Midha"** submit karenge.
3. **1-Click Email to Khushal Midha**:
   - Backend automatically **`khushalmidha24@gmail.com`** par email bhejta hai with:
     - Requester Name, Email, Reason.
     - **`[✅ Approve Access (1-Click)]`** Button / Link.
     - **`[❌ Reject Request]`** Button / Link.
4. **Instant Activation**:
   - Jaise hi Khushal email me **Approve** click karenge:
     - Requester ko confirmation email chala jayega: *"Your access to JobFinder Shared Contacts has been approved!"*
     - Requester ka access turant activate ho jayega.
5. **In-App Admin Console**:
   - Khushal (`khushalmidha24@gmail.com`) jab login karenge, unhe Recruiter tab me ek **`🛡️ Access Requests`** console dikhega jahan se wo bina email khole bhi kisi bhi request ko 1 click me Approve ya Reject kar sakte hain!

---

## 3. 💬 Manual Sharing & Recruiter Reply Tracking

User requirement ke mutabiq status clutter khatam kar diya gaya hai:
* **Manual Mark as Shared (`isShared`)**:
  - Contacts kabhi bhi automatically share nahi honge.
  - Sirf wahi contact Master Directory me aayenge jinke aage Khushal ne manually **`🌐 Shared`** mark kiya hai.
  - Dashboard row me `🌐` / `🔒` click karke ya bulk select karke **"🌐 Mark as Shared"** / **"🔒 Set Private"** kiya ja sakta hai.
* **Recruiter Reply Tracking**:
  - Jab kisi email ka reply aata hai, toh contact ka status **`💬 Replied`** mark ho jata hai.
  - Dashboard me dedicated 1-Click **`💬 Mark Replied`** button har row me aur bulk action bar me available hai.
  - Filter bar me:
    - **💬 Replied Only**: Sirf un contacts ko dikhata hai jinka reply aaya hai.
    - **🌐 Manually Shared Only**: Sirf wahi dikhata hai jo master directory me shared hain.
    - **🔒 Private Only**: Sirf personal contacts dikhata hai.

---

## 4. 🔑 Gmail SMTP Password Error: Reason & Fix

Aapke SMTP password par jo error aa raha tha, uska exact reason:
1. **Regular Password Not Allowed**: Google ne third-party apps ke liye normal Gmail account password block kar diya hai.
2. **Google App Password Zaroori Hai**:
   - Apne Google Account me jaiye: [myaccount.google.com/security](https://myaccount.google.com/security).
   - **2-Step Verification** ko Turn ON kijiye.
   - [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) par jaiye.
   - App Name me daaliye `JobFinder` aur **Create** dabaiye.
   - Google aapko ek **16-letter ka code** dega (e.g. `abcd efgh ijkl mnop`).
   - Is 16-letter code ko **Settings -> SMTP Password** me paste kijiye (bina spaces ke).
3. **AWS vs Render Advantage**:
   - Render ke free tier me Gmail SMTP (`smtp.gmail.com:465`) IPv6 connectivity error de sakta hai.
   - **AWS par deploy karne par direct IPv4 routing milti hai jisse SMTP 100% reliably connect hota hai bina kisi network timeout ke!**
   - Settings page me **"Test Connection"** button add kar diya gaya hai jo exact diagnostic feedback deta hai.
