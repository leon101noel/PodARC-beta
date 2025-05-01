#!/bin/bash

# PodARC Upgrade Script for Ubuntu 24.10
# This script updates an existing PodARC installation
# Options include:
# - Updating codebase from GitHub
# - Updating SSL certificate with new domain
# - Reconfiguring application settings

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

# Root check
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root or with sudo${NC}"
  exit 1
fi

# Display banner
echo -e "${BLUE}====== PodARC Upgrade Utility ======${NC}"
echo -e "${YELLOW}This script helps you update your existing PodARC installation${NC}"
echo ""

# Check if PodARC is installed
if [ ! -d "$APP_DIR" ]; then
  echo -e "${RED}PodARC installation not found at $APP_DIR${NC}"
  echo -e "${YELLOW}Please run the full installation script first${NC}"
  exit 1
fi

# Verify service is installed
if [ ! -f "/etc/systemd/system/podarc.service" ]; then
  echo -e "${RED}PodARC service not found. Is it properly installed?${NC}"
  exit 1
fi

# Menu function
show_menu() {
  echo ""
  echo -e "${BLUE}Please select an operation:${NC}"
  echo "1. Update codebase from GitHub"
  echo "2. Update/Change SSL certificate domain"
  echo "3. Backup application data"
  echo "4. View application status and logs"
  echo "5. Exit"
  echo ""
  read -p "Enter your choice [1-5]: " choice
}

# Function to update codebase
update_codebase() {
  echo -e "${BLUE}Updating PodARC codebase from GitHub...${NC}"
  
  # Backup current data
  echo -e "${YELLOW}Backing up current application data...${NC}"
  BACKUP_DIR="/tmp/podarc_backup_$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  
  # Backup essential data files
  if [ -f "$APP_DIR/events-data.json" ]; then
    cp "$APP_DIR/events-data.json" "$BACKUP_DIR/"
  fi
  
  if [ -f "$APP_DIR/settings-data.json" ]; then
    cp "$APP_DIR/settings-data.json" "$BACKUP_DIR/"
  fi
  
  if [ -f "$APP_DIR/users-data.json" ]; then
    cp "$APP_DIR/users-data.json" "$BACKUP_DIR/"
  fi
  
  if [ -f "$APP_DIR/sites-data.json" ]; then
    cp "$APP_DIR/sites-data.json" "$BACKUP_DIR/"
  fi
  
  echo -e "${GREEN}Backup saved to $BACKUP_DIR${NC}"
  
  # Stop the service while updating
  echo -e "${BLUE}Stopping PodARC service...${NC}"
  systemctl stop podarc
  
  # Pull latest code from GitHub
  echo -e "${BLUE}Pulling latest code from GitHub...${NC}"
  cd "$APP_DIR"
  
  # Save current branch
  CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")
  
  # Stash any local changes
  git stash
  
  # Fetch and pull latest changes
  git fetch --all
  git reset --hard origin/$CURRENT_BRANCH
  
  # Update dependencies
  echo -e "${BLUE}Updating Node.js dependencies...${NC}"
  npm install --production
  
  # Restore backed up data
  echo -e "${YELLOW}Restoring application data...${NC}"
  if [ -f "$BACKUP_DIR/events-data.json" ]; then
    cp "$BACKUP_DIR/events-data.json" "$APP_DIR/"
  fi
  
  if [ -f "$BACKUP_DIR/settings-data.json" ]; then
    cp "$BACKUP_DIR/settings-data.json" "$APP_DIR/"
  fi
  
  if [ -f "$BACKUP_DIR/users-data.json" ]; then
    cp "$BACKUP_DIR/users-data.json" "$APP_DIR/"
  fi
  
  if [ -f "$BACKUP_DIR/sites-data.json" ]; then
    cp "$BACKUP_DIR/sites-data.json" "$APP_DIR/"
  fi
  
  # Fix permissions
  echo -e "${BLUE}Updating permissions...${NC}"
  chown -R podarc:podarc "$APP_DIR"
  
  # Restart the service
  echo -e "${BLUE}Starting PodARC service...${NC}"
  systemctl start podarc
  
  # Check if the service started correctly
  if systemctl is-active --quiet podarc; then
    echo -e "${GREEN}PodARC service started successfully!${NC}"
  else
    echo -e "${RED}Failed to start PodARC service. Checking logs...${NC}"
    journalctl -u podarc -n 50
    echo -e "${YELLOW}Attempting to restore from backup...${NC}"
    
    # In case of failure, try to restore from the stash
    git stash pop
    
    systemctl start podarc
    if systemctl is-active --quiet podarc; then
      echo -e "${GREEN}PodARC service restored and started successfully!${NC}"
    else
      echo -e "${RED}Failed to restore PodARC service. Please check the logs.${NC}"
    fi
  fi
}

# Function to update/change SSL certificate
update_ssl() {
  echo -e "${BLUE}Update/Change SSL Certificate${NC}"
  
  # Get current domain from Nginx config
  CURRENT_DOMAIN=$(grep -r "server_name" /etc/nginx/sites-available/podarc | grep -v "#" | awk '{print $2}' | tr -d ';')
  
  echo -e "${YELLOW}Current domain: $CURRENT_DOMAIN${NC}"
  read -p "Enter the new domain name (leave empty to keep current): " NEW_DOMAIN
  
  if [ -z "$NEW_DOMAIN" ]; then
    NEW_DOMAIN=$CURRENT_DOMAIN
  fi
  
  read -p "Enter your email address for Let's Encrypt: " EMAIL_ADDRESS
  
  # Update Nginx configuration
  echo -e "${BLUE}Updating Nginx configuration...${NC}"
  sed -i "s/server_name .*\$/server_name $NEW_DOMAIN;/" /etc/nginx/sites-available/podarc
  
  # Test Nginx configuration
  nginx -t
  
  # Reload Nginx to apply changes
  systemctl reload nginx
  
  # Request new certificate
  echo -e "${BLUE}Requesting new SSL certificate for $NEW_DOMAIN...${NC}"
  certbot --nginx --noninteractive --agree-tos --email "$EMAIL_ADDRESS" -d "$NEW_DOMAIN"
  
  echo -e "${GREEN}SSL certificate updated successfully!${NC}"
  echo -e "${GREEN}Your application is now accessible at: https://${NEW_DOMAIN}${NC}"
}

# Function to backup application data
backup_application() {
  echo -e "${BLUE}Backing up PodARC application data...${NC}"
  
  BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
  BACKUP_DIR="/var/backups/podarc_$BACKUP_DATE"
  
  mkdir -p "$BACKUP_DIR"
  
  # Backup data files
  echo -e "${YELLOW}Backing up application data files...${NC}"
  cp -r "$APP_DIR"/*.json "$BACKUP_DIR/" 2>/dev/null || echo "No JSON files found to backup"
  
  # Backup nginx configuration
  echo -e "${YELLOW}Backing up Nginx configuration...${NC}"
  cp /etc/nginx/sites-available/podarc "$BACKUP_DIR/nginx_podarc.conf" 2>/dev/null || echo "Nginx config not found"
  
  # Backup systemd service
  echo -e "${YELLOW}Backing up systemd service configuration...${NC}"
  cp /etc/systemd/system/podarc.service "$BACKUP_DIR/podarc.service"
  
  # Optionally backup images (might be large)
  read -p "Backup images directory? (may be large) [y/N]: " backup_images
  if [[ "$backup_images" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Backing up images directory...${NC}"
    mkdir -p "$BACKUP_DIR/public"
    cp -r "$APP_DIR/public/images" "$BACKUP_DIR/public/" 2>/dev/null || echo "No images found to backup"
  fi
  
  # Optionally backup videos (likely very large)
  read -p "Backup videos directory? (may be very large) [y/N]: " backup_videos
  if [[ "$backup_videos" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Backing up videos directory...${NC}"
    mkdir -p "$BACKUP_DIR/public"
    cp -r "$APP_DIR/public/videos" "$BACKUP_DIR/public/" 2>/dev/null || echo "No videos found to backup"
  fi
  
  # Create archive
  echo -e "${YELLOW}Creating backup archive...${NC}"
  cd "$(dirname "$BACKUP_DIR")"
  tar -czf "podarc_backup_$BACKUP_DATE.tar.gz" "podarc_$BACKUP_DATE"
  
  # Cleanup
  rm -rf "$BACKUP_DIR"
  
  echo -e "${GREEN}Backup completed successfully!${NC}"
  echo -e "${GREEN}Backup saved to: /var/backups/podarc_backup_$BACKUP_DATE.tar.gz${NC}"
}

# Function to view application status and logs
view_status() {
  echo -e "${BLUE}PodARC Application Status${NC}"
  
  echo -e "${YELLOW}Service Status:${NC}"
  systemctl status podarc --no-pager
  
  echo -e "\n${YELLOW}Last 50 log entries:${NC}"
  journalctl -u podarc -n 50 --no-pager
  
  echo -e "\n${YELLOW}Memory Usage:${NC}"
  ps -o pid,user,%mem,%cpu,command -p $(pgrep -f "/usr/bin/node ${APP_DIR}/app.js") 2>/dev/null || echo "PodARC process not found"
  
  echo -e "\n${YELLOW}Disk Usage:${NC}"
  df -h /opt | grep -v "Filesystem"
  
  echo -e "\n${YELLOW}Application Directory Size:${NC}"
  du -sh "$APP_DIR"
  du -sh "$APP_DIR/public/images"
  du -sh "$APP_DIR/public/videos"
  
  read -p "Press Enter to continue..."
}

# Main menu loop
while true; do
  show_menu
  
  case $choice in
    1)
      update_codebase
      ;;
    2)
      update_ssl
      ;;
    3)
      backup_application
      ;;
    4)
      view_status
      ;;
    5)
      echo -e "${GREEN}Exiting upgrade utility. Goodbye!${NC}"
      exit 0
      ;;
    *)
      echo -e "${RED}Invalid option. Please try again.${NC}"
      ;;
  esac
done