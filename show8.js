const fs = require('fs');
const c = fs.readFileSync('public/app.js', 'utf8');
const lines = c.split('\n');
console.log(lines.slice(300, 325).join('\n'));
