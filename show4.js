const fs = require('fs');
const c = fs.readFileSync('public/index.html', 'utf8');
let i = c.indexOf('ctl');
console.log('first ctl at', i);
console.log(c.slice(i - 2000, i + 2000));
