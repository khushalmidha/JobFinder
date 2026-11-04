# 🚀 JobFinder AWS EC2 Deployment & Zero-Cost CI/CD Guide

Is guide ki madad se aap JobFinder ko **AWS Free Tier (t2.micro / t3.micro)** par **100% Free** deploy kar sakte hain, taaki aapka server **24/7 bina laptop open kiye** background me run karta rahe. Sath hi **GitHub Actions CI/CD** set kiya gaya hai jisse **jaise hi aap `git push` karenge, AWS server automatically updated code pull karke naye containers deploy kar dega!**

---

## 📋 Table of Contents
1. [Cost Breakdown (100% Free Tier)](#1-cost-breakdown-100-free-tier)
2. [Step 1: AWS EC2 Instance Launch (Free Tier)](#step-1-aws-ec2-instance-launch-free-tier)
3. [Step 2: Security Group Configuration (Firewall Ports)](#step-2-security-group-configuration-firewall-ports)
4. [Step 3: Initial Server Setup (1-Command Script)](#step-3-initial-server-setup-1-command-script)
5. [Step 4: GitHub Actions Auto-Deploy on Push (CI/CD)](#step-4-github-actions-auto-deploy-on-push-cicd)
6. [Step 5: 100% Free HTTPS (SSL) Setup](#step-5-100-free-https-ssl-setup)
7. [Step 6: Chrome Extension Production Configuration](#step-6-chrome-extension-production-configuration)

---

## 1. 💰 Cost Breakdown (100% Free Tier)

| Service | Plan | Monthly Cost | Free Tier Limit |
| :--- | :--- | :--- | :--- |
| **AWS EC2** | `t2.micro` or `t3.micro` (Ubuntu 22.04 LTS) | **$0.00** | 750 hours/month free for 12 months (runs 24/7) |
| **AWS EBS Storage** | 30 GB gp3 / gp2 | **$0.00** | 30 GB free storage |
| **MongoDB Database** | MongoDB Atlas M0 Cluster | **$0.00** | Free Forever (Shared 512MB) |
| **GitHub Actions** | CI/CD Runner | **$0.00** | 2,000 free minutes/month for public/private repos |
| **HTTPS SSL Certificate** | Cloudflare / Let's Encrypt Certbot | **$0.00** | 100% Free Forever |
| **Total Monthly Cost** | | **₹0.00 / $0.00** | |

---

## Step 1: AWS EC2 Instance Launch (Free Tier)

1. [AWS Console](https://console.aws.amazon.com/ec2) me login karein.
2. Select Region: **ap-south-1 (Mumbai)** (Sabse kam latency ke liye).
3. Click **"Launch Instance"**:
   * **Name:** `JobFinder-Server`
   * **Application and OS Images:** Select **Ubuntu** -> **Ubuntu Server 22.04 LTS** (Free tier eligible).
   * **Instance Type:** Select **`t2.micro`** (ya `t3.micro` if t2 unavailable) — **Free tier eligible**.
   * **Key Pair (Login):**
     * Click **"Create new key pair"**.
     * Key pair name: `jobfinder-key`.
     * Key pair type: `RSA`.
     * Private key file format: `.pem` (for OpenSSH / Mac / Linux / PowerShell).
     * Click **"Create key pair"** (Yeh file aapke computer me download ho jayegi, isko sambhal kar rakhein).
   * **Storage:** Default `8 GiB` ko badha kar **`20 GiB` ya `30 GiB` gp3** kar sakte hain (AWS Free Tier me 30 GB free hota hai).

---

## Step 2: Security Group Configuration (Firewall Ports)

EC2 Launch screen par **Network settings** me **Edit** par click karein aur Inbound Security Group Rules add karein:

| Type | Protocol | Port Range | Source | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **SSH** | TCP | `22` | `0.0.0.0/0` (ya My IP) | Server terminal connection |
| **HTTP** | TCP | `80` | `0.0.0.0/0` | Web frontend / Let's Encrypt |
| **HTTPS** | TCP | `443` | `0.0.0.0/0` | Secure SSL traffic |
| **Custom TCP** | TCP | `5000` | `0.0.0.0/0` | Direct backend API access |

Click **"Launch instance"**! 1 minute me aapka server ready ho jayega.

---

## Step 3: Initial Server Setup (1-Command Script)

1. Apne laptop me Terminal / PowerShell kholein jahan aapki `jobfinder-key.pem` download hui thi.
2. Permission set karein (Linux/Mac/WSL me):
   ```bash
   chmod 400 jobfinder-key.pem
   ```
3. EC2 Console se apne instance ka **Public IPv4 address** copy karein (e.g. `13.234.56.78`).
4. SSH connect karein:
   ```bash
   ssh -i "jobfinder-key.pem" ubuntu@<YOUR_EC2_PUBLIC_IP>
   ```
5. Server me connect hote hi repository me provided automated initialization script run karein:
   ```bash
   curl -sSL https://raw.githubusercontent.com/khushalmidha/JobFinder/main/setup-ec2.sh | bash
   ```
   *Yeh script automatically:*
   * Docker aur Docker Compose install karega.
   * Firewall ports (22, 80, 443, 5000) configure karega.
   * JobFinder repository clone karega.
   * `docker compose up -d --build` chala kar Frontend aur Backend dono containers launch kar dega!
6. Test kijiye: Apne browser me `http://<YOUR_EC2_PUBLIC_IP>` kholein — aapka JobFinder web dashboard live chal raha hoga!

---

## Step 4: GitHub Actions Auto-Deploy on Push (CI/CD)

Ab har baar code push hone par server automatically deploy ho, uske liye repository me `.github/workflows/deploy.yml` add kar diya gaya hai.

Aapko bas apne GitHub repo me **3 Secrets** add karne hain:

1. Apne GitHub repository me jayein: [`https://github.com/khushalmidha/JobFinder`](https://github.com/khushalmidha/JobFinder).
2. Click **Settings** (tab) -> Left sidebar me **Secrets and variables** -> **Actions**.
3. Click **"New repository secret"** aur ye 3 secrets add karein:

| Secret Name | Value | Example / Description |
| :--- | :--- | :--- |
| `EC2_HOST` | Aapke EC2 ka Public IP | `13.234.56.78` |
| `EC2_USER` | `ubuntu` | Default Ubuntu username |
| `EC2_SSH_KEY` | Aapki `.pem` file ka poora text content | Notepad se `jobfinder-key.pem` open karke `-----BEGIN RSA PRIVATE KEY----- ... -----END RSA PRIVATE KEY-----` poora copy-paste karein |

### 🚀 Verification:
Ab jab bhi aap local machine se koi bhi commit `main` branch par push karenge:
```bash
git add .
git commit -m "update feature"
git push origin main
```
GitHub Actions turant trigger ho jayega, EC2 server me SSH karega, latest code pull karega, aur Docker containers ko restart kar dega! Aapko kabhi bhi server manually login karne ki zaroorat nahi padegi!

---

## Step 5: 100% Free HTTPS (SSL) Setup

HTTPS enable karne ke liye 2 sabse aasan aur 100% free tareeqe hain:

### Option A: Cloudflare Free SSL Proxy (Sabse Best & 1-Minute Setup)
Agar aapke paas domain hai (jaise `khushalmidha.tech`):
1. [Cloudflare.com](https://dash.cloudflare.com) me login karein.
2. DNS Records me jayein aur ek **A record** banayein:
   * **Type:** `A`
   * **Name:** `jobfinder` (iska matlab `jobfinder.khushalmidha.tech`)
   * **IPv4 address:** `<YOUR_EC2_PUBLIC_IP>`
   * **Proxy status:** **Proxied (Orange Cloud) ON**
3. Cloudflare ke **SSL/TLS** menu me:
   * Mode: **Flexible** select karein.
4. **Done!** Ab `https://jobfinder.khushalmidha.tech` par jaate hi valid green-padlock HTTPS SSL active milega!

### Option B: DuckDNS + Let's Encrypt Certbot (Agar Custom Domain Nahi Hai)
Agar custom domain nahi hai aur bilkul free domain + SSL chahiye:
1. [duckdns.org](https://www.duckdns.org) par login karein.
2. Ek subdomain banayein (e.g. `khushal-jobfinder.duckdns.org`) aur apna EC2 IP assign karein.
3. EC2 server me SSH karke Certbot install karein:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot certonly --standalone -d khushal-jobfinder.duckdns.org
   ```

---

## Step 6: Chrome Extension Production Configuration

JobFinder Chrome extension ko AWS production backend se connect karne ke liye:
1. Chrome me Extension icon par click karein ya extension ke **Options** page par jayein.
2. **Backend API URL** field me apna AWS HTTPS URL enter karein:
   ```text
   https://jobfinder.khushalmidha.tech
   ```
   *(ya http://<YOUR_EC2_IP>:5000 agar testing ke liye direct use kar rahe hain)*
3. **Save** karein aur Login karein.
4. Ab extension direct AWS cloud backend se sync karega, bina laptop par backend run kiye!

