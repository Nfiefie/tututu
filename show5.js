const fs = require('fs');
const c = fs.readFileSync('public/app.js', 'utf8');
let i = c.indexOf('function renderControls');
console.log(c.slice(i, i + 1800));
