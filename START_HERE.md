# START HERE — Deploy to Hetzner VPS

Target: `178.63.95.122` (root)
Stack: nginx + React (Vite build) + Node/Express backend + PostgreSQL + Redis + on-demand Android emulator containers (budtmo/docker-android) + Prometheus + Grafana.
Auth: open access (no login).
TLS: none — HTTP only on port 80.

---

## 0. What's on the server already?

Before you do anything, log in and run the audit script you already have:

```bash
ssh root@178.63.95.122
# copy the repo there, then:
cd android-emulator-platform
chmod +x server-audit.sh docker-setup.sh
./server-audit.sh
```

Confirm:
- KVM available (`ls -l /dev/kvm`)
- Ports 80, 3000, 5554-5558, 6080-6104, 9090 are free
- ≥ 30GB RAM free for a 5-emulator pilot

If Docker isn't installed yet:

```bash
./docker-setup.sh
```

## 1. Copy this folder to the server

From your laptop:

```powershell
scp -r C:\Users\Asus\Desktop\android-emulator-platform root@178.63.95.122:/opt/
```

Or `git clone` if you push it to a repo.

## 2. Create `.env` on the server

```bash
cd /opt/android-emulator-platform
cp .env.example .env
nano .env
```

Set at minimum:

```env
DB_PASSWORD=<a long random string>
GRAFANA_PASSWORD=<another password>
MAX_CONCURRENT_EMULATORS=5      # start small
EMULATOR_RAM_GB=3
EMULATOR_CPU_CORES=2
PUBLIC_HOST=178.63.95.122        # IMPORTANT: noVNC URLs are built from this
CORS_ORIGIN=*
```

`PUBLIC_HOST` is required because the backend hands `http://<PUBLIC_HOST>:<vncPort>` URLs to the React app — that URL has to be reachable from the user's browser.

## 3. Pull the Android emulator image (once)

```bash
docker pull budtmo/docker-android:emulator_11.0
```

This is ~2-3 GB. Doing it ahead of time means the first session start isn't a 5-minute pull.

## 4. Open the firewall

```bash
ufw allow 80/tcp           # nginx → frontend + API
ufw allow 6080:6104/tcp    # noVNC for each emulator slot (25 max)
ufw allow 3000/tcp         # Grafana (optional, internal only is safer)
ufw allow 9090/tcp         # Prometheus (optional)
ufw reload
```

If your Hetzner project also has a cloud firewall in the Hetzner Console, open the same ports there.

## 5. Start the stack

```bash
cd /opt/android-emulator-platform
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

First `up --build` takes 2-5 minutes because nginx's Dockerfile builds the React app.

## 6. Verify

```bash
curl http://localhost/health           # → { status: "healthy" }
curl http://localhost/api/emulator/sessions   # → { count: 0, ... }
```

From your laptop browser: **http://178.63.95.122**

You should see the React UI. Click **Start Emulator**. The backend will:
1. Pull a port pair from Redis (`6080`/`5554` first time)
2. Spawn an `android-emulator-<uuid>` container via dockerode
3. Return `vncUrl: http://178.63.95.122:6080`

The iframe loads that URL. Boot takes 60-120 seconds.

## 7. Where things live

| Thing | URL / path |
|---|---|
| Frontend | http://178.63.95.122 |
| API | http://178.63.95.122/api/... |
| Health | http://178.63.95.122/health |
| Direct noVNC (any session) | http://178.63.95.122:6080-6104 |
| Grafana | http://178.63.95.122:3000 (`admin` / `GRAFANA_PASSWORD`) |
| Prometheus | http://178.63.95.122:9090 |
| Postgres data | docker volume `postgres-data` |
| Backend logs | `./logs/` |

## 8. Day-to-day

```bash
# tail backend logs
docker compose logs -f backend

# tail a specific emulator
docker logs -f android-emulator-<uuid>

# stop a runaway emulator manually
docker stop android-emulator-<uuid> && docker rm android-emulator-<uuid>

# stop everything
docker compose down

# update code
git pull   # or scp again
docker compose up -d --build
```

## 9. Known limitations (intentional, for v1)

- **No auth.** Anyone with the URL can launch emulators. Add JWT later (`backend/src/routes/auth.js` is a stub).
- **No APK upload.** `backend/src/routes/upload.js` is a stub. Multer is in deps, ready to wire.
- **No HTTPS.** When you're ready, add Caddy or certbot to nginx and point a domain at the server.
- **noVNC bypasses nginx.** Browsers hit `:6080-6104` directly. Cleaner long-term is to proxy `/emulator/<id>/` through nginx with websocket support — leaves only port 80 open.
- **Port pool is bounded** by `MAX_CONCURRENT_EMULATORS`. Default 25; firewall above only opens up to 6104.
- **No KVM on Windows / Docker Desktop.** Local testing on your laptop will not boot the Android emulator (the container will start but the emulator process inside will fail without `/dev/kvm`). Backend, DB, Redis, nginx, and React all run fine locally for UI iteration.

## 10. If something breaks

```bash
# nothing on port 80?
docker compose logs nginx
# can't reach API?
docker compose logs backend
# DB connection refused?
docker compose logs postgres
# emulator failed to start?
docker logs android-emulator-<uuid>
ls -l /dev/kvm    # must exist
```
