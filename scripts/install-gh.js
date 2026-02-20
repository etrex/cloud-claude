'use strict';

const { execSync } = require('child_process');
const { mkdirSync } = require('fs');
const { join } = require('path');

async function main() {
  const vendorBin = join(__dirname, '..', 'vendor', 'bin');
  mkdirSync(vendorBin, { recursive: true });

  const res = await fetch('https://api.github.com/repos/cli/cli/releases/latest');
  const { tag_name } = await res.json();
  const version = tag_name.replace('v', '');
  const url = `https://github.com/cli/cli/releases/download/${tag_name}/gh_${version}_linux_amd64.tar.gz`;

  console.log(`Installing gh ${version}...`);
  execSync(
    `curl -fsSL "${url}" | tar -xz -C /tmp && cp /tmp/gh_${version}_linux_amd64/bin/gh "${vendorBin}/gh" && chmod +x "${vendorBin}/gh"`,
    { stdio: 'inherit' }
  );
  console.log(execSync(`"${vendorBin}/gh" --version`).toString().trim());
}

main().catch((err) => {
  console.error('Failed to install gh:', err.message);
  process.exit(1);
});
