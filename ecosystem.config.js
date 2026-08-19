module.exports = {
  apps: [{
    name: 'whatsapp-backend',
    script: 'src/app.js',
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};