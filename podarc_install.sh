#!/bin/bash

# PodARC Installation Script for Ubuntu 24.10
# This script installs PodARC-beta from GitHub and configures it to run as a system service
# It also sets up Let's Encrypt, an FTP server, and configures the firewall

set -e  # Exit on any error

# Color variables for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration variables - customize these as needed
APP_REPO="https://github.com/leon101noel/PodARC-beta.git"
APP_DIR="/opt/podarc"
APP_PORT=3020
SMTP_PORT=2525
FTP_USER="cctv@cctv.com"
FTP_PASS="cctv"
NODE_VERSION="20" # LTS version

# Let's Encrypt configuration
read -p "Enter your domain name for Let's Encrypt (e.g., podarc.example.com): " DOMAIN_NAME
read -p "Enter your email address for Let's Encrypt: " EMAIL_ADDRESS

# Root check
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root or with sudo${NC}"
  exit 1
fi

echo -e "${BLUE}====== Installing PodARC Beta - CCTV Alert Monitor ======${NC}"
echo -e "${YELLOW}This script will install PodARC on Ubuntu 24.10 with:${NC}"
echo -e "${YELLOW}- Node.js ${NODE_VERSION}.x${NC}"
echo -e "${YELLOW}- Nginx as a reverse proxy with Let's Encrypt SSL${NC}"
echo -e "${YELLOW}- VSFTPD for FTP access${NC}"
echo -e "${YELLOW}- UFW firewall configuration${NC}"
echo ""
echo -e "${YELLOW}Installation will be performed for domain: ${DOMAIN_NAME}${NC}"
echo -e "${YELLOW}Please ensure your DNS is properly configured to point to this server before continuing.${NC}"
echo ""
read -p "Press Enter to continue or Ctrl+C to abort..."

# Update system first
echo -e "${BLUE}Updating system packages...${NC}"
apt update && apt upgrade -y

# Install essential tools
echo -e "${BLUE}Installing essential tools...${NC}"
apt install -y git curl build-essential nginx certbot python3-certbot-nginx vsftpd

# Install Node.js
echo -e "${BLUE}Installing Node.js ${NODE_VERSION}.x...${NC}"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt install -y nodejs

# Verify installations
echo -e "${BLUE}Verifying installations...${NC}"
echo -e "Node.js version: $(node -v)"
echo -e "NPM version: $(npm -v)"
echo -e "Git version: $(git --version)"
echo -e "Nginx version: $(nginx -v 2>&1)"

# Clone the repository
echo -e "${BLUE}Cloning the PodARC repository...${NC}"
if [ -d "$APP_DIR" ]; then
  echo -e "${YELLOW}Directory $APP_DIR already exists. Cleaning...${NC}"
  rm -rf "$APP_DIR"
fi

mkdir -p "$APP_DIR"
git clone "$APP_REPO" "$APP_DIR"
cd "$APP_DIR"

# Install dependencies
echo -e "${BLUE}Installing Node.js dependencies...${NC}"
npm install --production

# Create necessary directories
echo -e "${BLUE}Creating necessary directories...${NC}"
mkdir -p "$APP_DIR/public/videos"
mkdir -p "$APP_DIR/public/images"

# Set permissions
echo -e "${BLUE}Setting permissions...${NC}"
# Create a dedicated user for the application
useradd -r -m -d "$APP_DIR" -s /bin/false podarc || true
chown -R podarc:podarc "$APP_DIR"
chmod -R 755 "$APP_DIR"

# Configure the application as a system service
echo -e "${BLUE}Configuring PodARC as a system service...${NC}"
cat > /etc/systemd/system/podarc.service << EOL
[Unit]
Description=PodARC CCTV Alert Monitor
After=network.target

[Service]
Type=simple
User=podarc
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/app.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
Environment=SMTP_PORT=${SMTP_PORT}

[Install]
WantedBy=multi-user.target
EOL

# Enable and start the service
systemctl daemon-reload
systemctl enable podarc
systemctl start podarc

# Check if the service started correctly
if systemctl is-active --quiet podarc; then
  echo -e "${GREEN}PodARC service started successfully!${NC}"
else
  echo -e "${RED}Failed to start PodARC service. Check the logs with 'journalctl -u podarc'${NC}"
  exit 1
fi

# Configure Nginx as a reverse proxy
echo -e "${BLUE}Configuring Nginx as a reverse proxy...${NC}"
cat > /etc/nginx/sites-available/podarc << EOL
server {
    listen 80;
    server_name ${DOMAIN_NAME};

    location / {
        proxy_pass http://localhost:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # For handling large uploads of videos
    client_max_body_size 100M;
}
EOL

# Enable the site
ln -sf /etc/nginx/sites-available/podarc /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default  # Remove default site

# Test Nginx configuration
nginx -t

# Restart Nginx
systemctl restart nginx

# Set up Let's Encrypt SSL
echo -e "${BLUE}Setting up Let's Encrypt SSL...${NC}"
certbot --nginx --noninteractive --agree-tos --email "$EMAIL_ADDRESS" -d "$DOMAIN_NAME"

# Configure automatic renewal
echo -e "${BLUE}Configuring automatic SSL renewal...${NC}"
systemctl enable certbot.timer
systemctl start certbot.timer

# Configure VSFTPD server
echo -e "${BLUE}Configuring VSFTPD server...${NC}"
# Back up original config
cp /etc/vsftpd.conf /etc/vsftpd.conf.backup

# Create a new configuration
cat > /etc/vsftpd.conf << EOL
# General config
listen=YES
listen_ipv6=NO
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
use_localtime=YES
xferlog_enable=YES
connect_from_port_20=YES
chroot_local_user=YES
secure_chroot_dir=/var/run/vsftpd/empty
pam_service_name=vsftpd
pasv_enable=YES
pasv_min_port=40000
pasv_max_port=40100
userlist_enable=YES
userlist_file=/etc/vsftpd.userlist
userlist_deny=NO
allow_writeable_chroot=YES

# Logging
xferlog_std_format=YES
log_ftp_protocol=YES
EOL

# Create FTP user
echo -e "${BLUE}Creating FTP user...${NC}"
# Extract username part before @
FTP_USERNAME=$(echo "$FTP_USER" | cut -d "@" -f 1)

# Check if user already exists
if id "$FTP_USERNAME" &>/dev/null; then
    echo -e "${YELLOW}User $FTP_USERNAME already exists. Updating...${NC}"
    userdel -r "$FTP_USERNAME" || true
fi

# Create user with home directory in app's videos folder
useradd -m -d "$APP_DIR/public/videos" -s /bin/bash "$FTP_USERNAME"
echo "$FTP_USERNAME:$FTP_PASS" | chpasswd

# Add user to the allowed FTP users list
echo "$FTP_USERNAME" > /etc/vsftpd.userlist

# Set permissions for FTP user on the videos directory
chown -R "$FTP_USERNAME":"$FTP_USERNAME" "$APP_DIR/public/videos"
chmod -R 755 "$APP_DIR/public/videos"

# Restart VSFTPD
systemctl restart vsftpd
systemctl enable vsftpd

# Configure UFW firewall
echo -e "${BLUE}Configuring firewall...${NC}"
# Ensure UFW is installed
apt install -y ufw

# Reset UFW to default
ufw --force reset

# Allow SSH
ufw allow ssh

# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow application ports
ufw allow $APP_PORT/tcp
ufw allow $SMTP_PORT/tcp

# Allow FTP control and data ports
ufw allow 21/tcp
ufw allow 20/tcp

# Allow passive FTP ports
ufw allow 40000:40100/tcp

# Enable UFW
ufw --force enable

# Final instructions
echo -e "${GREEN}PodARC installation completed successfully!${NC}"
echo -e "${GREEN}----------------------------------------${NC}"
echo -e "${GREEN}Your application is now running as a system service!${NC}"
echo -e "${GREEN}The application is accessible at: https://${DOMAIN_NAME}${NC}"
echo -e "${GREEN}FTP credentials: ${NC}"
echo -e "${GREEN}- Username: ${FTP_USERNAME}${NC}"
echo -e "${GREEN}- Password: ${FTP_PASS}${NC}"
echo -e "${GREEN}- FTP Home Directory: /opt/podarc/public/videos${NC}"
echo -e "${GREEN}Default Admin Login: ${NC}"
echo -e "${GREEN}- Username: admin${NC}"
echo -e "${GREEN}- Password: admin${NC}"
echo -e "${GREEN}Please change the default admin password after first login!${NC}"
echo -e "${GREEN}----------------------------------------${NC}"
echo -e "${BLUE}Useful commands:${NC}"
echo -e "${BLUE}- Check service status: systemctl status podarc${NC}"
echo -e "${BLUE}- View service logs: journalctl -u podarc${NC}"
echo -e "${BLUE}- Restart the service: systemctl restart podarc${NC}"
echo -e "${BLUE}- Update from GitHub: cd ${APP_DIR} && git pull && npm install && systemctl restart podarc${NC}"
echo -e "${BLUE}- Check VSFTPD status: systemctl status vsftpd${NC}"
echo -e "${BLUE}----------------------------------------${NC}"