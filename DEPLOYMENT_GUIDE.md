# Deployment Guide - Android Emulator Platform

This guide walks you through deploying the Android Emulator Platform on your Hetzner server with 64GB RAM and Xeon processor.

## 📋 Pre-Deployment Checklist

Before starting, ensure you have:

- [ ] SSH access to your Hetzner server
- [ ] Root or sudo privileges
- [ ] Server running Ubuntu 20.04+ or Debian 11+
- [ ] At least 100GB free disk space
- [ ] Backup of existing services and data
- [ ] Domain name (optional, for production)

## 🚀 Step-by-Step Deployment

### Step 1: Upload Files to Server

From your local machine, upload the project files to your server:

```bash
# Option A: Using SCP
scp -r android-emulator-platform root@your-server-ip:/opt/

# Option B: Using rsync (recommended)
rsync -avz --progress android-emulator-platform/ root@your-server-ip:/opt/android-emulator-platform/

# Option C: Using Git (if you have a repository)
ssh root@your-server-ip
cd /opt
git clone https://github.com/yourusername/android-emulator-platform.git
```

### Step 2: Connect to Server

```bash
ssh root@your-server-ip
cd /opt/android-emulator-platform
```

### Step 3: Run Server Audit

Check your server's current state and available resources:

```bash
chmod +x server-audit.sh
./server-audit.sh > audit-report.txt

# Review the report
cat audit-report.txt
```

**Important**: Review the audit report carefully. Ensure:
- Available RAM is at least 40GB
- KVM virtualization is supported
- Current services are using less than 20GB RAM
- Sufficient disk space available

### Step 4: Install Docker

Run the Docker setup script:

```bash
chmod +x docker-setup.sh
./docker-setup.sh
```

This will take 5-10 minutes. The script will:
- Install Docker Engine
- Install Docker Compose
- Configure Docker daemon
- Set up KVM
- Pull Android emulator images (~2GB download)
- Create directory structure

**Verify Docker installation:**

```bash
docker --version
docker-compose --version
docker ps
```

### Step 5: Configure Environment

Create your environment configuration:

```bash
cp .env.example .env
nano .env
```

**Required changes:**

```env
# Change these passwords!
DB_PASSWORD=your_strong_password_here_min_16_chars
JWT_SECRET=your_random_jwt_secret_min_32_chars
GRAFANA_PASSWORD=your_grafana_password

# Adjust based on your needs
MAX_CONCURRENT_EMULATORS=5  # Start with 5, scale later
SESSION_TIMEOUT_MINUTES=30
```

**Generate secure passwords:**

```bash
# Generate random passwords
openssl rand -base64 32
```

### Step 6: Initial Test with Single Emulator

Before starting all services, test with a single emulator:

```bash
# Start only essential services + 1 emulator
docker-compose up -d redis postgres emulator-1

# Wait 2-3 minutes for emulator to start
sleep 180

# Check status
docker-compose ps
docker logs android-emulator-1

# Check resource usage
docker stats --no-stream
```

**Access the emulator:**
- Open browser: `http://your-server-ip:6080`
- You should see the Android emulator screen

**If successful, proceed. If not, check troubleshooting section.**

### Step 7: Start Core Services

```bash
# Stop the test
docker-compose down

# Start core services (without emulators yet)
docker-compose up -d nginx redis postgres backend prometheus grafana

# Wait for services to initialize
sleep 30

# Check all services are running
docker-compose ps

# Check logs for errors
docker-compose logs backend
```

### Step 8: Start with 5 Emulators

```bash
# Start 5 emulators
docker-compose up -d emulator-1 emulator-2 emulator-3 emulator-4 emulator-5

# Monitor startup (this takes 3-5 minutes)
watch -n 5 'docker-compose ps'

# Check resource usage
docker stats
```

**Expected resource usage with 5 emulators:**
- RAM: ~20-25GB
- CPU: Varies based on activity

### Step 9: Verify Everything Works

```bash
# Check all containers are running
docker-compose ps

# Test API health
curl http://localhost:3001/health

# Test Nginx
curl http://localhost/

# Check Grafana
curl http://localhost:3000/
```

**Access points:**
- API: `http://your-server-ip/api`
- Grafana: `http://your-server-ip:3000` (login: admin / your_grafana_password)
- Prometheus: `http://your-server-ip:9090`
- Emulator 1: `http://your-server-ip:6080`
- Emulator 2: `http://your-server-ip:6081`
- Emulator 3: `http://your-server-ip:6082`
- Emulator 4: `http://your-server-ip:6083`
- Emulator 5: `http://your-server-ip:6084`

### Step 10: Monitor for 24-48 Hours

Keep the system running with 5 emulators and monitor:

```bash
# Create a monitoring cron job
crontab -e

# Add this line to run monitoring every hour
0 * * * * /opt/android-emulator-platform/scripts/monitor-resources.sh >> /opt/android-emulator-platform/logs/monitoring.log 2>&1
```

**Manual monitoring:**

```bash
# Real-time resource monitoring
docker stats

# Check system resources
free -h
top

# Check Docker disk usage
docker system df

# View logs
docker-compose logs -f --tail=100
```

### Step 11: Gradual Scaling (After 1-2 Weeks)

If everything is stable after 1-2 weeks, scale to 10 emulators:

```bash
# Add 5 more emulators (you'll need to add them to docker-compose.yml first)
# Or start existing ones if you have them defined

docker-compose up -d emulator-6 emulator-7 emulator-8 emulator-9 emulator-10

# Monitor closely for 1 week
docker stats
```

**Continue this pattern:**
- Week 1-2: 5 emulators
- Week 3-4: 10 emulators
- Week 5-6: 15 emulators
- Week 7-8: 20 emulators (if resources allow)

## 🔒 Security Hardening

### Configure Firewall

```bash
# Install UFW if not present
apt-get install ufw

# Allow SSH (IMPORTANT: Do this first!)
ufw allow 22/tcp

# Allow HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow emulator ports (adjust range as needed)
ufw allow 6080:6104/tcp

# Allow monitoring (restrict to your IP if possible)
ufw allow from YOUR_IP_ADDRESS to any port 3000
ufw allow from YOUR_IP_ADDRESS to any port 9090

# Enable firewall
ufw enable

# Check status
ufw status
```

### SSL/HTTPS Setup (Production)

```bash
# Install Certbot
apt-get install certbot python3-certbot-nginx

# Get SSL certificate
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renewal is configured automatically
# Test renewal
certbot renew --dry-run
```

### Secure Docker Socket

```bash
# Create Docker group if not exists
groupadd docker

# Add your user to docker group
usermod -aG docker $USER

# Secure the socket
chmod 660 /var/run/docker.sock
```

## 📊 Setting Up Monitoring Dashboards

### Grafana Setup

1. Access Grafana: `http://your-server-ip:3000`
2. Login with admin / your_grafana_password
3. Add Prometheus data source:
   - URL: `http://prometheus:9090`
   - Save & Test
4. Import dashboard:
   - Dashboard ID: 1860 (Node Exporter Full)
   - Dashboard ID: 893 (Docker Dashboard)

### Set Up Alerts

Configure alerts for:
- High memory usage (>90%)
- High CPU usage (>80% sustained)
- Container failures
- Disk space low (<10GB)

## 🔄 Backup Strategy

### Automated Backups

```bash
# Create backup script
cat > /opt/android-emulator-platform/scripts/backup.sh <<'EOF'
#!/bin/bash
BACKUP_DIR="/opt/backups/emulator-platform"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
docker exec emulator-postgres pg_dump -U emulator_admin emulator_platform | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Backup environment file
cp /opt/android-emulator-platform/.env $BACKUP_DIR/env_$DATE

# Backup docker-compose
cp /opt/android-emulator-platform/docker-compose.yml $BACKUP_DIR/compose_$DATE.yml

# Keep only last 7 days
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete
find $BACKUP_DIR -name "env_*" -mtime +7 -delete
find $BACKUP_DIR -name "compose_*" -mtime +7 -delete

echo "Backup completed: $DATE"
EOF

chmod +x /opt/android-emulator-platform/scripts/backup.sh

# Schedule daily backups
crontab -e
# Add: 0 2 * * * /opt/android-emulator-platform/scripts/backup.sh
```

## 🚨 Troubleshooting Deployment Issues

### Issue: Docker installation fails

```bash
# Clean up and retry
apt-get remove docker docker-engine docker.io containerd runc
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io
```

### Issue: KVM not available

```bash
# Check if virtualization is enabled in BIOS
egrep -c '(vmx|svm)' /proc/cpuinfo
# Should return > 0

# Load KVM module
modprobe kvm
modprobe kvm_intel  # or kvm_amd for AMD

# Make permanent
echo "kvm" >> /etc/modules
echo "kvm_intel" >> /etc/modules  # or kvm_amd
```

### Issue: Emulator won't start

```bash
# Check logs
docker logs android-emulator-1

# Check KVM permissions
ls -l /dev/kvm
chmod 666 /dev/kvm

# Restart container
docker-compose restart emulator-1
```

### Issue: High memory usage

```bash
# Check what's using memory
docker stats

# Stop unnecessary emulators
docker-compose stop emulator-5 emulator-4

# Clean up
docker system prune -f
```

### Issue: Port conflicts

```bash
# Check what's using ports
netstat -tulpn | grep :6080

# Kill conflicting process or change ports in docker-compose.yml
```

## 📝 Post-Deployment Checklist

After deployment, verify:

- [ ] All containers are running (`docker-compose ps`)
- [ ] API health check passes (`curl http://localhost:3001/health`)
- [ ] At least one emulator is accessible via browser
- [ ] Grafana dashboards are showing metrics
- [ ] Firewall is configured and active
- [ ] Backups are scheduled
- [ ] Monitoring alerts are configured
- [ ] Resource usage is within acceptable limits
- [ ] Existing services are unaffected
- [ ] Documentation is accessible to team

## 🔄 Updating the Platform

```bash
# Pull latest changes
cd /opt/android-emulator-platform
git pull  # if using git

# Backup current state
./scripts/backup.sh

# Rebuild containers
docker-compose build --no-cache

# Restart services with zero downtime
docker-compose up -d --no-deps --build backend

# Or restart everything
docker-compose down
docker-compose up -d
```

## 📞 Getting Help

If you encounter issues:

1. Check logs: `docker-compose logs -f`
2. Review troubleshooting section in README.md
3. Check Grafana dashboards for resource issues
4. Review audit report for system limitations
5. Check Docker documentation
6. Create an issue in the repository

## ✅ Success Criteria

Your deployment is successful when:

1. ✅ All containers show "Up" status
2. ✅ API responds to health checks
3. ✅ At least one emulator loads in browser
4. ✅ Resource usage is stable over 24 hours
5. ✅ Existing services continue to work normally
6. ✅ Monitoring dashboards show data
7. ✅ Backups are running automatically

---

**Congratulations! Your Android Emulator Platform is now deployed!** 🎉

Next steps:
- Monitor for 1-2 weeks with 5 emulators
- Gradually scale to 10, then 15, then 20 emulators
- Implement user authentication
- Add payment integration
- Build frontend interface
- Set up domain and SSL
