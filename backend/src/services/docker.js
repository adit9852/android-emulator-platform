const Docker = require('dockerode');
const logger = require('../utils/logger');

let docker = null;

/**
 * Initialize Docker connection
 */
async function initializeDocker() {
  try {
    docker = new Docker({ socketPath: '/var/run/docker.sock' });
    
    // Test connection
    await docker.ping();
    logger.info('Docker connection established');
    
    return docker;
  } catch (error) {
    logger.error('Failed to connect to Docker:', error);
    throw error;
  }
}

/**
 * Get Docker instance
 */
function getDocker() {
  if (!docker) {
    throw new Error('Docker not initialized. Call initializeDocker() first.');
  }
  return docker;
}

/**
 * Start an emulator container
 */
async function startEmulator(emulatorId, options = {}) {
  try {
    const containerName = `android-emulator-${emulatorId}`;
    
    const containerConfig = {
      Image: 'budtmo/docker-android:emulator_11.0',
      name: containerName,
      Env: [
        `EMULATOR_DEVICE=${options.device || 'Samsung Galaxy S10'}`,
        'WEB_VNC=true',
        'APPIUM=false',
        `EMULATOR_TIMEOUT=${options.timeout || 1800}`
      ],
      HostConfig: {
        Memory: (options.memoryGB || 3) * 1024 * 1024 * 1024, // Convert GB to bytes
        NanoCpus: (options.cpus || 2) * 1000000000, // Convert CPUs to nano CPUs
        Privileged: true,
        Devices: [
          {
            PathOnHost: '/dev/kvm',
            PathInContainer: '/dev/kvm',
            CgroupPermissions: 'rwm'
          }
        ],
        NetworkMode: 'emulator-network',
        RestartPolicy: {
          Name: 'no'
        },
        PortBindings: {
          '6080/tcp': [{ HostPort: String(options.vncPort || 6080) }],
          '5554/tcp': [{ HostPort: String(options.adbPort || 5554) }]
        }
      },
      ExposedPorts: {
        '6080/tcp': {},
        '5554/tcp': {}
      }
    };

    const container = await docker.createContainer(containerConfig);
    await container.start();
    
    logger.info(`Emulator ${emulatorId} started successfully`);
    
    return {
      id: emulatorId,
      containerId: container.id,
      containerName,
      vncPort: options.vncPort || 6080,
      adbPort: options.adbPort || 5554,
      status: 'running'
    };
  } catch (error) {
    logger.error(`Failed to start emulator ${emulatorId}:`, error);
    throw error;
  }
}

/**
 * Stop an emulator container
 */
async function stopEmulator(containerName) {
  try {
    const container = docker.getContainer(containerName);
    await container.stop({ t: 10 }); // 10 second timeout
    await container.remove();
    
    logger.info(`Emulator ${containerName} stopped and removed`);
    return true;
  } catch (error) {
    if (error.statusCode === 404) {
      logger.warn(`Container ${containerName} not found`);
      return false;
    }
    logger.error(`Failed to stop emulator ${containerName}:`, error);
    throw error;
  }
}

/**
 * Get emulator container status
 */
async function getEmulatorStatus(containerName) {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    
    return {
      id: info.Id,
      name: info.Name.replace('/', ''),
      status: info.State.Status,
      running: info.State.Running,
      startedAt: info.State.StartedAt,
      memory: info.HostConfig.Memory,
      cpus: info.HostConfig.NanoCpus / 1000000000
    };
  } catch (error) {
    if (error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * List all emulator containers
 */
async function listEmulators() {
  try {
    const containers = await docker.listContainers({ all: true });
    
    const emulators = containers
      .filter(c => c.Names.some(name => name.includes('android-emulator')))
      .map(c => ({
        id: c.Id,
        name: c.Names[0].replace('/', ''),
        status: c.State,
        image: c.Image,
        created: c.Created,
        ports: c.Ports
      }));
    
    return emulators;
  } catch (error) {
    logger.error('Failed to list emulators:', error);
    throw error;
  }
}

/**
 * Get container stats
 */
async function getContainerStats(containerName) {
  try {
    const container = docker.getContainer(containerName);
    const stats = await container.stats({ stream: false });
    
    // Calculate CPU percentage
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;
    
    // Calculate memory usage
    const memoryUsage = stats.memory_stats.usage;
    const memoryLimit = stats.memory_stats.limit;
    const memoryPercent = (memoryUsage / memoryLimit) * 100;
    
    return {
      cpu: cpuPercent.toFixed(2),
      memory: {
        usage: (memoryUsage / 1024 / 1024 / 1024).toFixed(2), // GB
        limit: (memoryLimit / 1024 / 1024 / 1024).toFixed(2), // GB
        percent: memoryPercent.toFixed(2)
      },
      network: {
        rx: stats.networks?.eth0?.rx_bytes || 0,
        tx: stats.networks?.eth0?.tx_bytes || 0
      }
    };
  } catch (error) {
    logger.error(`Failed to get stats for ${containerName}:`, error);
    throw error;
  }
}

/**
 * Execute command in container
 */
async function execInContainer(containerName, command) {
  try {
    const container = docker.getContainer(containerName);
    
    const exec = await container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true
    });
    
    const stream = await exec.start();
    
    return new Promise((resolve, reject) => {
      let output = '';
      
      stream.on('data', (chunk) => {
        output += chunk.toString();
      });
      
      stream.on('end', () => {
        resolve(output);
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    });
  } catch (error) {
    logger.error(`Failed to execute command in ${containerName}:`, error);
    throw error;
  }
}

/**
 * Install APK in emulator
 */
async function installAPK(containerName, apkPath) {
  try {
    logger.info(`Installing APK in ${containerName}: ${apkPath}`);
    
    // Copy APK to container
    // Note: This is a simplified version. In production, you'd need to handle file transfer properly
    const command = ['adb', 'install', '-r', apkPath];
    const output = await execInContainer(containerName, command);
    
    logger.info(`APK installation output: ${output}`);
    return output.includes('Success');
  } catch (error) {
    logger.error(`Failed to install APK in ${containerName}:`, error);
    throw error;
  }
}

/**
 * Clean up stopped containers
 */
async function cleanupStoppedContainers() {
  try {
    const containers = await docker.listContainers({ 
      all: true,
      filters: { status: ['exited'] }
    });
    
    const emulatorContainers = containers.filter(c => 
      c.Names.some(name => name.includes('android-emulator'))
    );
    
    for (const containerInfo of emulatorContainers) {
      const container = docker.getContainer(containerInfo.Id);
      await container.remove();
      logger.info(`Removed stopped container: ${containerInfo.Names[0]}`);
    }
    
    return emulatorContainers.length;
  } catch (error) {
    logger.error('Failed to cleanup stopped containers:', error);
    throw error;
  }
}

module.exports = {
  initializeDocker,
  getDocker,
  startEmulator,
  stopEmulator,
  getEmulatorStatus,
  listEmulators,
  getContainerStats,
  execInContainer,
  installAPK,
  cleanupStoppedContainers
};
