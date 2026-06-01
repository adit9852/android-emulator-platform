#!/bin/bash

# Server Audit Script for Android Emulator Platform
# This script checks current resource usage and system capabilities

echo "=========================================="
echo "SERVER AUDIT REPORT"
echo "Date: $(date)"
echo "=========================================="
echo ""

# System Information
echo "=== SYSTEM INFORMATION ==="
echo "Hostname: $(hostname)"
echo "OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
echo "Kernel: $(uname -r)"
echo "Architecture: $(uname -m)"
echo ""

# CPU Information
echo "=== CPU INFORMATION ==="
echo "CPU Model: $(lscpu | grep 'Model name' | cut -d':' -f2 | xargs)"
echo "CPU Cores: $(nproc)"
echo "CPU Threads: $(lscpu | grep '^CPU(s):' | awk '{print $2}')"
echo "Current CPU Usage:"
top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print "  Idle: " $1 "%\n  Used: " 100 - $1 "%"}'
echo ""

# Memory Information
echo "=== MEMORY INFORMATION ==="
free -h | grep -E 'Mem|Swap'
echo ""
echo "Memory Usage Breakdown:"
echo "  Total RAM: $(free -h | awk '/^Mem:/ {print $2}')"
echo "  Used RAM: $(free -h | awk '/^Mem:/ {print $3}')"
echo "  Free RAM: $(free -h | awk '/^Mem:/ {print $4}')"
echo "  Available RAM: $(free -h | awk '/^Mem:/ {print $7}')"
echo "  Used Percentage: $(free | awk '/^Mem:/ {printf "%.2f%%", $3/$2 * 100}')"
echo ""

# Disk Information
echo "=== DISK INFORMATION ==="
df -h | grep -E '^Filesystem|^/dev/'
echo ""
echo "Disk Usage Summary:"
df -h / | tail -1 | awk '{print "  Root Partition: " $3 " used of " $2 " (" $5 " full)"}'
echo ""

# Network Information
echo "=== NETWORK INFORMATION ==="
echo "Network Interfaces:"
ip -br addr show | grep -v 'lo'
echo ""
echo "Network Bandwidth (last 5 seconds):"
if command -v vnstat &> /dev/null; then
    vnstat -tr 5
else
    echo "  vnstat not installed - install with: apt install vnstat"
fi
echo ""

# Virtualization Support
echo "=== VIRTUALIZATION SUPPORT ==="
if grep -E 'vmx|svm' /proc/cpuinfo > /dev/null; then
    echo "✓ Hardware virtualization: ENABLED ($(grep -E 'vmx|svm' /proc/cpuinfo | head -1 | awk '{print $1}'))"
else
    echo "✗ Hardware virtualization: DISABLED or NOT SUPPORTED"
fi

if [ -e /dev/kvm ]; then
    echo "✓ KVM module: LOADED"
    ls -l /dev/kvm
else
    echo "✗ KVM module: NOT LOADED"
fi
echo ""

# Docker Status
echo "=== DOCKER STATUS ==="
if command -v docker &> /dev/null; then
    echo "✓ Docker installed: $(docker --version)"
    echo ""
    echo "Docker Service Status:"
    systemctl is-active docker &> /dev/null && echo "  Status: RUNNING" || echo "  Status: STOPPED"
    echo ""
    echo "Docker Resource Usage:"
    docker system df 2>/dev/null || echo "  Docker daemon not running"
    echo ""
    echo "Running Containers:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" 2>/dev/null || echo "  No containers running or Docker daemon not accessible"
else
    echo "✗ Docker not installed"
fi
echo ""

# Running Services
echo "=== RUNNING SERVICES ==="
echo "Top 10 processes by memory usage:"
ps aux --sort=-%mem | head -11 | awk '{printf "  %-20s %6s %6s %s\n", $11, $3"%", $4"%", $2}' | head -1
ps aux --sort=-%mem | head -11 | tail -10 | awk '{printf "  %-20s %6s %6s %s\n", $11, $3"%", $4"%", $2}'
echo ""

echo "Top 10 processes by CPU usage:"
ps aux --sort=-%cpu | head -11 | awk '{printf "  %-20s %6s %6s %s\n", $11, $3"%", $4"%", $2}' | head -1
ps aux --sort=-%cpu | head -11 | tail -10 | awk '{printf "  %-20s %6s %6s %s\n", $11, $3"%", $4"%", $2}'
echo ""

# Listening Ports
echo "=== LISTENING PORTS ==="
echo "Services listening on network ports:"
if command -v ss &> /dev/null; then
    ss -tlnp | grep LISTEN | awk '{print "  " $4 " - " $6}' | head -20
else
    netstat -tlnp 2>/dev/null | grep LISTEN | awk '{print "  " $4 " - " $7}' | head -20
fi
echo ""

# System Load
echo "=== SYSTEM LOAD ==="
uptime
echo ""

# Available Resources for Emulators
echo "=== RESOURCE ALLOCATION RECOMMENDATION ==="
TOTAL_RAM_GB=$(free -g | awk '/^Mem:/ {print $2}')
USED_RAM_GB=$(free -g | awk '/^Mem:/ {print $3}')
AVAILABLE_RAM_GB=$(free -g | awk '/^Mem:/ {print $7}')
SAFE_BUFFER_GB=16
EMULATOR_POOL_GB=$((AVAILABLE_RAM_GB - SAFE_BUFFER_GB))

if [ $EMULATOR_POOL_GB -lt 0 ]; then
    EMULATOR_POOL_GB=0
fi

echo "Total RAM: ${TOTAL_RAM_GB}GB"
echo "Currently Used: ${USED_RAM_GB}GB"
echo "Available: ${AVAILABLE_RAM_GB}GB"
echo ""
echo "Recommended Allocation:"
echo "  Reserve for existing services + buffer: ${SAFE_BUFFER_GB}GB"
echo "  Available for emulator pool: ${EMULATOR_POOL_GB}GB"
echo ""

if [ $EMULATOR_POOL_GB -ge 40 ]; then
    EMULATOR_RAM_EACH=3
    MAX_INSTANCES=$((EMULATOR_POOL_GB / EMULATOR_RAM_EACH))
    echo "  With ${EMULATOR_RAM_EACH}GB per emulator: ~${MAX_INSTANCES} concurrent instances possible"
    echo "  Recommended safe limit: $((MAX_INSTANCES * 80 / 100)) instances (80% capacity)"
elif [ $EMULATOR_POOL_GB -ge 20 ]; then
    EMULATOR_RAM_EACH=2
    MAX_INSTANCES=$((EMULATOR_POOL_GB / EMULATOR_RAM_EACH))
    echo "  With ${EMULATOR_RAM_EACH}GB per emulator: ~${MAX_INSTANCES} concurrent instances possible"
    echo "  Recommended safe limit: $((MAX_INSTANCES * 80 / 100)) instances (80% capacity)"
else
    echo "  ⚠ WARNING: Less than 20GB available for emulators"
    echo "  Current resource usage is high. Consider:"
    echo "    - Stopping unnecessary services"
    echo "    - Optimizing existing applications"
    echo "    - Upgrading server resources"
fi
echo ""

echo "=========================================="
echo "AUDIT COMPLETE"
echo "=========================================="
echo ""
echo "Next Steps:"
echo "1. Review the resource usage above"
echo "2. Identify services that can be optimized"
echo "3. Ensure KVM is enabled for best emulator performance"
echo "4. Install Docker if not already installed"
echo "5. Proceed with Docker setup and resource limits"
