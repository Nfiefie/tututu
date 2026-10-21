const fs = require('fs');
const c = fs.readFileSync('public/index.html', 'utf8');
let i = c.indexOf('ctl-ratio');
console.log(c.slice(i - 1500, i + 800));
