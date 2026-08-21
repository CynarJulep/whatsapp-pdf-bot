/**
 * PM2 — stack local gratis (espejo de los 2 servicios Render).
 * Arranque: npm run local:start
 */
const path = require('path');

const root = __dirname;
const sharedEnv = {
  NODE_ENV: 'production',
  // En local no hace falta sleep/keep-alive de Render
};

module.exports = {
  apps: [
    {
      name: 'wa-pai',
      script: path.join(root, 'index.js'),
      cwd: root,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: '700M',
      env: {
        ...sharedEnv,
        PORT: 3001,
        SESSION_ID: 'pai',
        // PC compartida: sin ventanas de Chromium / sin worker externo
        SAC_HEADLESS: 'true',
        SAC_PROCESS_JOBS: 'true',
      },
      windowsHide: true,
    },
    {
      name: 'wa-licencias',
      script: path.join(root, 'index.js'),
      cwd: root,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: '700M',
      env: {
        ...sharedEnv,
        PORT: 3002,
        SESSION_ID: 'licencias',
        // Licencias no necesita SAC en el mismo proceso
        SAC_FEATURE_ENABLED: 'false',
        SAC_PROCESS_JOBS: 'false',
      },
      windowsHide: true,
    },
    {
      name: 'wa-dashboard',
      script: path.join(root, 'local-stack', 'dashboard', 'server.js'),
      cwd: root,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 30,
      restart_delay: 2000,
      env: {
        ...sharedEnv,
        DASHBOARD_PORT: 9100,
        PAI_URL: 'http://127.0.0.1:3001',
        LICENCIAS_URL: 'http://127.0.0.1:3002',
      },
      windowsHide: true,
    },
    {
      name: 'wa-tunnels',
      script: path.join(root, 'local-stack', 'tunnel', 'run-tunnels.mjs'),
      cwd: root,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 100,
      min_uptime: '5s',
      restart_delay: 5000,
      env: {
        ...sharedEnv,
        PAI_PORT: 3001,
        LICENCIAS_PORT: 3002,
      },
      windowsHide: true,
    },
  ],
};
