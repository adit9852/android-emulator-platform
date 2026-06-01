# Quick Deployment Instructions

## 📋 What I Need From You to Deploy

To deploy this Android Emulator Platform on your Hetzner server, I need the following information:

### 1. **Server Access** (Required)
- [ ] **Server IP Address**: `_____._____._____._____ `
- [ ] **SSH Username**: (usually `root` or your username)
- [ ] **SSH Password** OR **SSH Private Key**: (for authentication)
- [ ] **SSH Port**: (default is 22, unless you changed it)

### 2. **Passwords to Set** (Required - You Choose These)
- [ ] **Database Password**: (min 16 characters, strong password)
- [ ] **JWT Secret**: (min 32 characters, random string)
- [ ] **Grafana Password**: (for monitoring dashboard access)

### 3. **Optional Information**
- [ ] **Domain Name**: (if you want to use a domain instead of IP)
- [ ] **Existing Services**: (list any services already running on the server)

---

## 🚀 Deployment Steps (What I'll Do)

Once you provide the above information, here's what will happen:

### Step 1: Upload Files to Server
I'll upload all the project files to `/opt/android-emulator-platform/` on your server.

### Step 2: Run Server Audit
I'll execute `server-audit.sh` to:
- Check available RAM and CPU
- Verify KVM virtualization support
- Identify existing services
- Confirm resources are sufficient

### Step 3: Install Docker
I'll run `docker-setup.sh` to:
- Install Docker Engine and Docker Compose
- Configure Docker daemon with optimizations
- Set up KVM for hardware acceleration
- Pull Android emulator images (~2GB download)
- Create directory structure

### Step 4: Configure Environment
I'll create the `.env` file with:
- Your chosen passwords
- Resource limits (starting with 5 emulators)
- Database connection strings
- Redis configuration

### Step 5: Start Services
I'll start the platform with:
```bash
docker-compose up -d redis postgres backend emulator-1
```

This starts:
- Redis (session cache)
- PostgreSQL (database)
- Backend API
- 1 test emulator

### Step 6: Verify Everything Works
I'll check:
- All containers are running
- API responds to health checks
- Emulator is accessible via browser
- No impact on existing services

### Step 7: Scale to 5 Emulators
Once verified, I'll scale to 5 emulators:
```bash
docker-compose up -d emulator-2 emulator-3 emulator-4 emulator-5
```

---

## 📊 What You'll Get

After deployment, you'll have:

### **Access Points:**
- **API**: `http://YOUR_SERVER_IP:3001`
- **Emulator 1**: `http://YOUR_SERVER_IP:6080`
- **Emulator 2**: `http://YOUR_SERVER_IP:6081`
- **Emulator 3**: `http://YOUR_SERVER_IP:6082`
- **Emulator 4**: `http://YOUR_SERVER_IP:6083`
- **Emulator 5**: `http://YOUR_SERVER_IP:6084`
- **Grafana Dashboard**: `http://YOUR_SERVER_IP:3000`
- **Prometheus**: `http://YOUR_SERVER_IP:9090`

### **API Endpoints:**
- `GET /health` - Check API health
- `POST /api/emulator/session` - Create new emulator session
- `GET /api/emulator/session/:id` - Get session status
- `DELETE /api/emulator/session/:id` - Stop session
- `GET /api/emulator/sessions` - List all active sessions
- `GET /api/emulator/containers` - List all containers

### **Test Commands:**
```bash
# Check API health
curl http://YOUR_SERVER_IP:3001/health

# Create a session
curl -X POST http://YOUR_SERVER_IP:3001/api/emulator/session \
  -H "Content-Type: application/json" \
  -d '{"device":"Samsung Galaxy S10","timeout":30}'

# List active sessions
curl http://YOUR_SERVER_IP:3001/api/emulator/sessions
```

---

## ⏱️ Estimated Time

- **File Upload**: 2-5 minutes (depending on internet speed)
- **Docker Installation**: 5-10 minutes
- **Image Download**: 3-5 minutes
- **Service Startup**: 2-3 minutes
- **Total**: ~15-25 minutes

---

## 🔒 Security Notes

1. **Firewall**: I'll configure UFW to only allow necessary ports
2. **Passwords**: All passwords will be stored in `.env` (not in git)
3. **Docker Socket**: Will be secured with proper permissions
4. **Network Isolation**: Emulators run in isolated Docker network

---

## 📝 Post-Deployment

After deployment, you should:

1. **Test the emulators**: Open `http://YOUR_SERVER_IP:6080` in browser
2. **Monitor resources**: Run `docker stats` to see resource usage
3. **Check logs**: Run `docker-compose logs -f` to see all logs
4. **Set up monitoring**: Access Grafana at `http://YOUR_SERVER_IP:3000`
5. **Backup .env file**: Keep a secure copy of your `.env` file

---

## 🆘 If Something Goes Wrong

I'll provide:
- Complete logs of all operations
- Error messages with explanations
- Rollback instructions if needed
- Troubleshooting steps

Your existing services will NOT be affected because:
- Docker containers are isolated
- Resource limits are strictly enforced
- Separate network namespace
- No port conflicts (we'll check first)

---

## ✅ Ready to Deploy?

**Please provide:**

1. **Server IP**: `_________________`
2. **SSH Username**: `_________________`
3. **SSH Password/Key**: `_________________`
4. **Database Password** (you choose): `_________________`
5. **JWT Secret** (you choose): `_________________`
6. **Grafana Password** (you choose): `_________________`

**Optional:**
- Domain name: `_________________`
- Any concerns about existing services: `_________________`

---

## 🔐 Security of Your Credentials

**Important**: I will NOT store your credentials anywhere. They will only be used for:
1. SSH connection to your server
2. Creating the `.env` configuration file on your server

After deployment, you should:
- Change SSH password (recommended)
- Keep `.env` file secure
- Set up SSH key authentication (more secure than password)

---

## 📞 Alternative: Manual Deployment

If you prefer to deploy manually:

1. Download the `android-emulator-platform` folder from your Desktop
2. Upload to your server: `scp -r android-emulator-platform root@YOUR_IP:/opt/`
3. SSH to server: `ssh root@YOUR_IP`
4. Follow the `DEPLOYMENT_GUIDE.md` step-by-step

This gives you full control but takes longer (~1-2 hours for first-time deployment).

---

**Ready when you are!** Just provide the credentials above and I'll get your Android Emulator Platform running. 🚀
