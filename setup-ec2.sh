#!/bin/bash
# ==============================================================================
# JobFinder AWS EC2 One-Click Initialization Script
# OS: Ubuntu 22.04 LTS / Ubuntu 24.04 LTS (AWS Free Tier t2.micro / t3.micro)
# ==============================================================================

set -e

echo "=========================================================="
echo "🚀 Initializing JobFinder AWS EC2 Production Environment"
echo "=========================================================="

# 1. Update system packages
echo "📦 Updating apt packages..."
sudo apt update -y
sudo apt install -y curl git ufw ca-certificates gnupg lsb-release

# 2. Install Docker & Docker Compose
echo "🐳 Installing Docker & Docker Compose..."
if ! command -v docker &> /dev/null; then
    sudo apt install -y docker.io
    sudo systemctl enable docker
    sudo systemctl start docker
    sudo usermod -aG docker $USER
    echo "✅ Docker installed successfully."
else
    echo "✅ Docker is already installed."
fi

# Ensure docker compose plugin exists
if ! docker compose version &> /dev/null; then
    echo "Installing docker-compose..."
    sudo apt install -y docker-compose-v2 || sudo apt install -y docker-compose
fi

# 3. Configure Firewall (UFW)
echo "🛡️ Configuring Firewall rules (Ports 22, 80, 443, 5000)..."
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP Web / Nginx'
sudo ufw allow 443/tcp comment 'HTTPS SSL'
sudo ufw allow 5000/tcp comment 'Backend API'
sudo ufw --force enable

# 4. Clone or update repository
REPO_URL="https://github.com/khushalmidha/JobFinder.git"
TARGET_DIR="$HOME/JobFinder"

if [ ! -d "$TARGET_DIR" ]; then
    echo "📥 Cloning JobFinder repository..."
    git clone "$REPO_URL" "$TARGET_DIR"
    cd "$TARGET_DIR"
else
    echo "📂 Repository already exists at $TARGET_DIR. Pulling latest code..."
    cd "$TARGET_DIR"
    git pull origin main
fi

# 5. Build and launch containers
echo "🚀 Launching JobFinder containers via Docker Compose..."
sudo docker compose up -d --build

echo ""
echo "=========================================================="
echo "🎉 JobFinder is now running in the background!"
echo "=========================================================="
PUBLIC_IP=$(curl -s http://checkip.amazonaws.com || curl -s https://ifconfig.me || echo "<YOUR_EC2_PUBLIC_IP>")
echo "🌐 Frontend URL: http://$PUBLIC_IP"
echo "🔌 Backend API:  http://$PUBLIC_IP:5000/api"
echo ""
echo "Next step: For 100% Free HTTPS, point your domain (e.g. Cloudflare or DuckDNS) to $PUBLIC_IP"
echo "=========================================================="

