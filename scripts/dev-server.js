const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const PORT_MONGO = 27017;
const DB_PATH = path.join(process.cwd(), '.dev-db');

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

async function start() {
  console.log('====================================================');
  console.log('  🚀 Starting SettleUp Local Development Stack');
  console.log('====================================================\n');

  let replSet = null;
  const inUse = await isPortInUse(PORT_MONGO);

  if (inUse) {
    console.log(`✓ Detected existing MongoDB service running on port ${PORT_MONGO}.`);
  } else {
    console.log(`Starting embedded MongoDB Replica Set on port ${PORT_MONGO}...`);
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(DB_PATH, { recursive: true });
    }

    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ port: PORT_MONGO, dbPath: DB_PATH }],
    });

    console.log(`✓ Embedded MongoDB Replica Set online at port ${PORT_MONGO} (ACID transactions enabled).`);
  }

  // Run Seed script
  console.log('\nChecking / seeding initial demo data...');
  try {
    const seedProc = spawn('node', ['scripts/seed.js'], { stdio: 'inherit', env: process.env });
    await new Promise((resolve, reject) => {
      seedProc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Seed failed with code ${code}`));
      });
    });
  } catch (err) {
    console.warn('Seed notice:', err.message);
  }

  // Start Next.js development server
  console.log('\nLaunching Next.js server on http://localhost:3000 ...\n');
  const nextProc = spawn('npx', ['next', 'dev', '-p', '3000'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '3000' },
  });

  const cleanup = async () => {
    console.log('\nShutting down dev stack...');
    nextProc.kill('SIGINT');
    if (replSet) {
      await replSet.stop();
      console.log('Embedded MongoDB stopped.');
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

start().catch((err) => {
  console.error('Fatal dev-server error:', err);
  process.exit(1);
});
