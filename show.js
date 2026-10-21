const fs = require('fs');
const c = fs.readFileSync('public/app.js', 'utf8');
const i = c.indexOf("ctl-ratio').addEventListener");
console.log(c.slice(i - 100, i + 1200));
