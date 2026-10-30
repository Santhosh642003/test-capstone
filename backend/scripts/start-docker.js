#!/usr/bin/env node
const { execSync } = require('child_process');
const os = require('os');

const platform = os.platform();

if (platform === 'win32') {
  console.log('🐋▶️  Starting Docker Desktop for Windows...');
  execSync('start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"', {
    stdio: 'inherit',
    shell: 'cmd.exe'
  });
  console.log('🐋✅ Docker Desktop (Windows) launch command sent. It may take a moment to fully start.');
} else if (platform === 'darwin') {
  console.log('🐋▶️  Starting Docker Desktop for macOS...');
  try {
    execSync('open -a Docker', { stdio: 'inherit' });
    console.log('🐋✅ Docker Desktop (macOS) launch command sent. It may take a moment to fully start.');
  } catch {
    console.error('🐋❌ Failed to start Docker Desktop. Please start it manually.');
    process.exit(1);
  }
} else if (platform === 'linux') {
  console.log('🐋▶️  Starting Docker service for Linux...');
  try {
    // Try systemctl first (most common)
    execSync('sudo systemctl start docker', { stdio: 'inherit' });
    console.log('🐋✅ Docker service started via systemctl.');
  } catch {
    try {
      // Fallback to service command
      execSync('sudo service docker start', { stdio: 'inherit' });
      console.log('🐋✅ Docker service started via service command.');
    } catch {
      console.error('🐋❌ Failed to start Docker service. Please start it manually or check if Docker is installed.');
      console.error('💡 You may need to run: sudo systemctl start docker');
      process.exit(1);
    }
  }
} else {
  console.log(`🐋⏭️  Platform '${platform}' not supported for automatic Docker start.`);
  console.log('💡 Please start Docker manually.');
}
