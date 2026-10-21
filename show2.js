const fs = require('fs');
const c = fs.readFileSync('public/app.js', 'utf8');
const i = c.indexOf('val-ratio');
console.log('val-ratio at', i);
console.log(c.slice(i - 400, i + 600));
