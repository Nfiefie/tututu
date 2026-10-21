const fs = require('fs');
const c = fs.readFileSync('public/app.js', 'utf8');
const lines = c.split('\n');
lines.forEach((l, i) => {
  if (l.includes('RATIO_NAME')) console.log((i+1) + ': ' + l.trim());
});
