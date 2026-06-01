#!/bin/bash

# Docker Setup Script for Android Emulator Platform
# This script installs and configures Docker with proper resource limits

set -e  # Exit on error

echo "=========================================="
echo "DOCKER SETUP FOR ANDROID EMULATOR PLATFORM"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "⚠ This script must be run as root or with sudo"
    echo "Please run: sudo bash docker-setup.sh"
    exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VERSION=$VERSION_ID
else
    echo "✗ Cannot detect OS. This script supports Ubuntu/Debian."
    exit 1
fi

echo "Detected OS: $OS $VERSION"
echo ""

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "=== INSTALLING DOCKER ==="
    echo "Docker not found. Installing..."
    
    # Update package index
    apt-get update
    
    # Install prerequisites
    apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release
    
    # Add Docker's official GPG key
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$OS/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    # Set up repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker Engine
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    echo "✓ Docker installed successfully"
else
    echo "✓ Docker already installed: $(docker --version)"
fi
echo ""

# Start and enable Docker service
echo "=== CONFIGURING DOCKER SERVICE ==="
systemctl start docker
systemctl enable docker
echo "✓ Docker service started and enabled"
echo ""

# Configure Docker daemon for resource management
echo "=== CONFIGURING DOCKER DAEMON ==="
DOCKER_DAEMON_CONFIG="/etc/docker/daemon.json"

# Backup existing config if present
if [ -f "$DOCKER_DAEMON_CONFIG" ]; then
    cp "$DOCKER_DAEMON_CONFIG" "${DOCKER_DAEMON_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
    echo "✓ Backed up existing Docker daemon config"
fi

# Create optimized Docker daemon configuration
cat > "$DOCKER_DAEMON_CONFIG" <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 64000,
      "Soft": 64000
    }
  },
  "default-address-pools": [
    {
      "base": "172.80.0.0/16",
      "size": 24
    }
  ],
  "live-restore": true,
  "userland-proxy": false
}
EOF

echo "✓ Docker daemon configured with optimized settings"
echo ""

# Restart Docker to apply changes
echo "=== RESTARTING DOCKER ==="
systemctl restart docker
sleep 3
echo "✓ Docker restarted successfully"
echo ""

# Create Docker network for emulators
echo "=== CREATING DOCKER NETWORKS ==="
if ! docker network ls | grep -q "emulator-network"; then
    docker network create \
        --driver bridge \
        --subnet=172.80.0.0/24 \
        --gateway=172.80.0.1 \
        emulator-network
    echo "✓ Created isolated network: emulator-network"
else
    echo "✓ Network 'emulator-network' already exists"
fi
echo ""

# Install KVM for hardware acceleration
echo "=== CHECKING KVM SUPPORT ==="
if grep -E 'vmx|svm' /proc/cpuinfo > /dev/null; then
    echo "✓ Hardware virtualization supported"
    
    if ! [ -e /dev/kvm ]; then
        echo "Installing KVM..."
        apt-get install -y qemu-kvm libvirt-daemon-system libvirt-clients bridge-utils
        modprobe kvm
        modprobe kvm_intel || modprobe kvm_amd
        echo "✓ KVM installed and loaded"
    else
        echo "✓ KVM already available"
    fi
    
    # Set permissions for KVM device
    chmod 666 /dev/kvm
    echo "✓ KVM permissions configured"
else
    echo "⚠ Hardware virtualization not available"
    echo "  Emulators will run without hardware acceleration (slower)"
fi
echo ""

# Install Docker Compose (standalone) if not present
echo "=== CHECKING DOCKER COMPOSE ==="
if ! command -v docker-compose &> /dev/null; then
    echo "Installing Docker Compose..."
    COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d\" -f4)
    curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo "✓ Docker Compose installed: $(docker-compose --version)"
else
    echo "✓ Docker Compose already installed: $(docker-compose --version)"
fi
echo ""

# Pull Android emulator image
echo "=== PULLING ANDROID EMULATOR IMAGE ==="
echo "This may take several minutes..."
docker pull budtmo/docker-android:emulator_11.0
echo "✓ Android emulator image downloaded"
echo ""

# Create directories for emulator data
echo "=== CREATING DIRECTORY STRUCTURE ==="
mkdir -p /opt/android-emulator-platform/{apks,logs,data,scripts}
chmod -R 755 /opt/android-emulator-platform
echo "✓ Directory structure created at /opt/android-emulator-platform"
echo ""

# Create resource monitoring script
cat > /opt/android-emulator-platform/scripts/monitor-resources.sh <<'EOF'
#!/bin/bash
# Resource monitoring script

echo "=== SYSTEM RESOURCES ==="
echo "Time: $(date)"
echo ""

echo "Memory Usage:"
free -h | grep -E 'Mem|Swap'
echo ""

echo "CPU Usage:"
top -bn1 | grep "Cpu(s)"
echo ""

echo "Docker Containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.CPUPerc}}\t{{.MemUsage}}"
echo ""

echo "Docker Stats (5 second snapshot):"
timeout 5 docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
EOF

chmod +x /opt/android-emulator-platform/scripts/monitor-resources.sh
echo "✓ Resource monitoring script created"
echo ""

# Test Docker installation
echo "=== TESTING DOCKER INSTALLATION ==="
if docker run --rm hello-world > /dev/null 2>&1; then
    echo "✓ Docker is working correctly"
else
    echo "✗ Docker test failed"
    exit 1
fi
echo ""

echo "=========================================="
echo "DOCKER SETUP COMPLETE!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  ✓ Docker Engine installed and configured"
echo "  ✓ Docker Compose installed"
echo "  ✓ KVM support configured (if available)"
echo "  ✓ Isolated network created: emulator-network"
echo "  ✓ Android emulator image downloaded"
echo "  ✓ Directory structure created"
echo "  ✓ Monitoring scripts installed"
echo ""
echo "Next Steps:"
echo "  1. Run: /opt/android-emulator-platform/scripts/monitor-resources.sh"
echo "  2. Review the docker-compose.yml configuration"
echo "  3. Test a single emulator instance"
echo "  4. Gradually scale to multiple instances"
echo ""
echo "Useful Commands:"
echo "  - Monitor resources: /opt/android-emulator-platform/scripts/monitor-resources.sh"
echo "  - View Docker logs: docker logs <container-name>"
echo "  - List containers: docker ps -a"
echo "  - Remove all stopped containers: docker container prune"
