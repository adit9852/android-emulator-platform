# Android Emulator Platform

A web-based Android emulator platform that allows users to run Android applications in the browser, similar to Appetize.io. Built with Docker, Node.js, and designed to run on a single server with resource isolation.

## 🎯 Features

- **Web-based Android Emulation**: Run Android apps directly in the browser
- **Resource Isolation**: Docker containers with strict CPU and memory limits
- **Concurrent Users**: Support for 20-25 concurrent emulator sessions
- **Session Management**: Automatic cleanup and timeout handling
- **APK Upload**: Upload and install custom Android applications
- **Real-time Monitoring**: Track resource usage and system health
- **Scalable Architecture**: Easily scale from 5 to 25+ concurrent instances

## 📋 Prerequisites

- **Server**: 64GB RAM, Xeon processor (or equivalent)
- **OS**: Ubuntu 20.04+ or Debian 11+
- **Virtualization**: KVM support (Intel VT-x or AMD-V)
- **Docker**: Version 20.10+
- **Docker Compose**: Version 2.0+
- **Ports**: 80, 443, 3000, 6080-6104, 9090 (configurable)

## 🚀 Quick Start

### 1. Server Audit

First, check your server's current resource usage and capabilities:

```bash
# Upload and run the audit script on your Hetzner server
chmod +x server-audit.sh
sudo ./server-audit.sh
```

Review the output to ensure:
- ✅ At least 40GB RAM available for emulators
- ✅ KVM virtualization is supported
- ✅ Sufficient disk space (100GB+ recommended)
- ✅ Current services are using <20GB RAM

### 2. Docker Setup

Install and configure Docker with proper resource limits:

```bash
# Run the Docker setup script
chmod +x docker-setup.sh
sudo ./docker-setup.sh
```

This script will:
- Install Docker Engine and Docker Compose
- Configure Docker daemon with optimized settings
- Set up KVM for hardware acceleration
- Create isolated Docker network
- Pull Android emulator images
- Create directory structure

### 3. Configuration

Create environment file:

```bash
cd android-emulator-platform
cp .env.example .env
nano .env
```

Configure the following variables:

```env
# Database
DB_PASSWORD=your_secure_password_here

# Grafana
GRAFANA_PASSWORD=your_grafana_password

# Application
MAX_CONCURRENT_EMULATORS=25
EMULATOR_RAM_GB=3
SESSION_TIMEOUT_MINUTES=30
NODE_ENV=production

# CORS (optional)
CORS_ORIGIN=*
```

### 4. Start the Platform

#### Option A: Start with 5 emulators (Recommended for testing)

```bash
docker-compose up -d nginx redis postgres backend emulator-1 emulator-2 emulator-3 emulator-4 emulator-5
```

#### Option B: Start all services including monitoring

```bash
docker-compose up -d
```

### 5. Verify Installation

Check that all services are running:

```bash
docker-compose ps
```

Monitor resource usage:

```bash
/opt/android-emulator-platform/scripts/monitor-resources.sh
```

### 6. Access the Platform

- **Frontend**: http://your-server-ip
- **API**: http://your-server-ip/api
- **Grafana Dashboard**: http://your-server-ip:3000
- **Prometheus**: http://your-server-ip:9090
- **Direct Emulator Access**: http://your-server-ip:6080 (emulator-1)

## 📊 Resource Allocation

### Per Service

| Service | RAM | CPU | Purpose |
|---------|-----|-----|---------|
| Nginx | 512MB | 1 | Reverse proxy |
| Redis | 768MB | 1 | Session cache |
| PostgreSQL | 2GB | 2 | Database |
| Backend | 2GB | 2 | API server |
| Each Emulator | 3GB | 2 | Android instance |
| Prometheus | 1GB | 1 | Metrics |
| Grafana | 1GB | 1 | Dashboards |

### Total Resource Usage

| Emulators | Total RAM | Total CPUs | Recommended |
|-----------|-----------|------------|-------------|
| 5 | ~22GB | ~18 | ✅ Safe start |
| 10 | ~37GB | ~28 | ✅ Good |
| 15 | ~52GB | ~38 | ⚠️ Monitor closely |
| 20 | ~67GB | ~48 | ❌ Exceeds 64GB |

**Recommendation**: Start with 5 emulators, monitor for 1-2 weeks, then gradually scale to 10, 15, and finally 20-25 based on actual usage patterns.

## 🔧 Management Commands

### Start/Stop Services

```bash
# Start all services
docker-compose up -d

# Start specific services
docker-compose up -d emulator-1 emulator-2

# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Restart a service
docker-compose restart backend
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend

# Last 100 lines
docker-compose logs --tail=100 emulator-1
```

### Scale Emulators

```bash
# Add more emulators (edit docker-compose.yml first)
docker-compose up -d emulator-6 emulator-7

# Stop specific emulators
docker-compose stop emulator-5
docker-compose rm emulator-5
```

### Monitor Resources

```bash
# Real-time stats
docker stats

# Custom monitoring script
/opt/android-emulator-platform/scripts/monitor-resources.sh

# Check specific container
docker inspect android-emulator-1
```

### Database Management

```bash
# Access PostgreSQL
docker exec -it emulator-postgres psql -U emulator_admin -d emulator_platform

# Backup database
docker exec emulator-postgres pg_dump -U emulator_admin emulator_platform > backup.sql

# Restore database
docker exec -i emulator-postgres psql -U emulator_admin emulator_platform < backup.sql
```

### Cleanup

```bash
# Remove stopped containers
docker container prune -f

# Remove unused images
docker image prune -a -f

# Remove unused volumes
docker volume prune -f

# Full cleanup (careful!)
docker system prune -a --volumes -f
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Internet/Users                        │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
            ┌────────────────┐
            │  Nginx (80/443)│
            │  Reverse Proxy │
            └────────┬───────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Frontend │  │ Backend  │  │ Emulator │
│   (Web)  │  │   API    │  │  (noVNC) │
└──────────┘  └────┬─────┘  └──────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
        ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌──────────────┐
   │ Redis  │ │Postgres│ │Docker Engine │
   │ Cache  │ │   DB   │ │  (Emulators) │
   └────────┘ └────────┘ └──────────────┘
```

## 🔒 Security Considerations

1. **Network Isolation**: Emulators run in isolated Docker network
2. **Resource Limits**: Hard limits prevent resource exhaustion
3. **Rate Limiting**: API endpoints are rate-limited
4. **APK Scanning**: Consider adding malware scanning for uploaded APKs
5. **HTTPS**: Configure SSL certificates for production
6. **Firewall**: Only expose necessary ports
7. **Authentication**: Implement user authentication before production

## 📈 Scaling Strategy

### Phase 1: Testing (Week 1-2)
- Start with 5 concurrent emulators
- Monitor resource usage daily
- Test with real users
- Identify bottlenecks

### Phase 2: Gradual Scale (Week 3-4)
- Increase to 10 emulators
- Monitor for 1 week
- Verify existing services unaffected
- Optimize based on metrics

### Phase 3: Production (Week 5-8)
- Scale to 15-20 emulators
- Implement auto-scaling logic
- Set up alerts for high resource usage
- Plan for multi-server deployment if needed

## 🐛 Troubleshooting

### Emulator won't start

```bash
# Check KVM availability
ls -l /dev/kvm

# Check Docker logs
docker logs android-emulator-1

# Verify image exists
docker images | grep android
```

### High memory usage

```bash
# Check container stats
docker stats

# Reduce concurrent emulators
docker-compose stop emulator-10 emulator-9 emulator-8

# Check for memory leaks
docker system df
```

### Network issues

```bash
# Check network
docker network ls
docker network inspect emulator-network

# Restart networking
docker-compose restart nginx
```

### Database connection errors

```bash
# Check PostgreSQL status
docker-compose logs postgres

# Verify connection
docker exec -it emulator-postgres psql -U emulator_admin -d emulator_platform -c "SELECT 1;"
```

## 💰 Cost Breakdown

### Development (DIY)
- Your time: 3-6 months part-time
- Server: Already owned (Hetzner)
- Domain + SSL: $20-50/year
- **Total: ~$50-100/month**

### Hiring Developers
- Freelance developer: $5K-$15K for MVP
- Offshore team: $10K-$25K for complete solution

### Operating Costs
- Server: Already owned
- Bandwidth: Included with Hetzner
- Monitoring: Free (Prometheus/Grafana)
- **Monthly: ~$50-100**

## 📚 API Documentation

### Endpoints

#### Health Check
```
GET /health
Response: { status: "healthy", timestamp: "...", uptime: 123 }
```

#### Create Session
```
POST /api/emulator/session
Body: { device: "Samsung Galaxy S10", timeout: 1800 }
Response: { sessionId: "...", vncUrl: "...", status: "starting" }
```

#### Upload APK
```
POST /api/upload/apk
Body: FormData with 'apk' file
Response: { apkId: "...", filename: "...", size: 12345 }
```

#### Install APK
```
POST /api/emulator/install
Body: { sessionId: "...", apkId: "..." }
Response: { success: true, message: "APK installed" }
```

## 🤝 Contributing

This is a private project, but contributions are welcome:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

MIT License - See LICENSE file for details

## 🆘 Support

For issues or questions:
1. Check the troubleshooting section
2. Review Docker logs
3. Check Grafana dashboards
4. Create an issue in the repository

## 🗺️ Roadmap

- [ ] Phase 1: Basic emulator functionality (Current)
- [ ] Phase 2: User authentication and billing
- [ ] Phase 3: Multiple Android versions support
- [ ] Phase 4: iOS emulator support (requires Mac hardware)
- [ ] Phase 5: Auto-scaling and load balancing
- [ ] Phase 6: Multi-server deployment
- [ ] Phase 7: API for third-party integrations

## ⚠️ Important Notes

1. **Start Small**: Begin with 5 emulators and scale gradually
2. **Monitor Constantly**: Use Grafana dashboards to track resources
3. **Backup Regularly**: Backup database and configuration files
4. **Test Thoroughly**: Test with real users before scaling
5. **Legal Compliance**: Ensure compliance with Android and app licensing
6. **Existing Services**: Monitor your existing services to ensure they're not affected

---

**Built with ❤️ for the Android developer community**
