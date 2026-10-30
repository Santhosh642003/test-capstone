#!/usr/bin/env node
const readline = require('readline');
const { execSync } = require('child_process');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('🚀⚠️  Are you sure you want to build and deploy to PRODUCTION? (y/n) ', (answer) => {
  rl.close();
  const ans = answer.trim().toLowerCase();
  if (ans !== 'y' && ans !== 'yes') {
    console.log('🚀🚫 Deployment cancelled.');
    process.exit(0);
  }

  try {
    execSync('npm run dockerProd', { stdio: 'inherit' });
    execSync('az acr login --name fieldworker', { stdio: 'inherit' });
    execSync('docker push fieldworker.azurecr.io/fieldworkerapi5:prod', { stdio: 'inherit' });
    execSync('az webapp restart --resource-group FieldworkerProdRG --name fieldworkerserver', { stdio: 'inherit' });
    console.log('🚀✅ Build deployed, (fieldworkerserver) service restarting');
  } catch (err) {
    console.error('🚀❌ Deployment failed: ' + err);
    process.exit(1);
  }
});
