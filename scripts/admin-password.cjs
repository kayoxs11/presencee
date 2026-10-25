// Read from stdin so passwords do not appear in process arguments or shell history.
const { randomBytes, scryptSync } = require('node:crypto');
let value = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => value += chunk);
process.stdin.on('end', () => {
  const password = value.trim();
  if (password.length < 14 || password.length > 200) { console.error('Use uma senha exclusiva com 14 a 200 caracteres.'); process.exitCode = 1; return; }
  const salt = randomBytes(16).toString('hex');
  console.log(salt + ':' + scryptSync(password, salt, 64).toString('hex'));
});
