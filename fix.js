const fs = require('fs');
let c = fs.readFileSync('public/app.js', 'utf8');

// 1. 修改 RATIO_NAME 为完整格式
c = c.replace(
  "const RATIO_NAME = {\n    '1:1': '方图',\n    '16:9': '横图',\n    '9:16': '竖图',\n    '4:3': '横图',\n    '3:4': '竖图',\n    '3:2': '横图',\n    '2:3': '竖图',\n  };",
  "const RATIO_NAME = {\n    '1:1': '方图 1:1',\n    '16:9': '横图 16:9',\n    '9:16': '竖图 9:16',\n    '4:3': '横图 4:3',\n    '3:4': '竖图 3:4',\n    '3:2': '横图 3:2',\n    '2:3': '竖图 2:3',\n  };"
);

// 2. 修改 renderControls() 中的 val-ratio 显示
const oldRenderRatio = "$('val-quality').textContent =\n      '1K';\n    $('val-count').textContent";
const newRenderRatio = "$('val-quality').textContent =\n      '1K';\n    // 更新比例和分辨率显示\n    $('val-ratio').textContent = S.ratio;\n    $('val-resolution').textContent = S.tier;\n    $('val-count').textContent";

c = c.split(oldRenderRatio).join(newRenderRatio);

// 3. 修改比例菜单 item label 格式（已经是完整格式了，但需要确保正确）
// 注意：现在的代码是 label: RATIO_NAME[ratio] || ratio
// 我们已经改了 RATIO_NAME 的值，所以菜单会自动显示完整格式

// 4. 修改分辨率菜单 label 添加像素信息
const oldResMenu = "const items = tiers.map((tier) => ({";
const newResMenu = "const items = tiers.map((tier) => {\n      const p = SIZE_TABLE[S.ratio];\n      const pixel = p ? p[tier] : null;\n      return {";

c = c.replace(oldResMenu, newResMenu);

// 修改分辨率菜单 label
const oldResLabel = "label: tier === '1K' ? '1K (1080p)' : tier === '2K' ? '2K 高清' : '4K 超清',\n      active: tier === S.tier,\n      tier,\n    }));";
const newResLabel = "label: tier === '1K' ? '1K (1080p) ' + (pixel ? pixel : '') : tier === '2K' ? '2K 高清 ' + (pixel ? pixel : '') : '4K 超清 ' + (pixel ? pixel : ''),\n      active: tier === S.tier,\n      tier,\n    });";

c = c.split(oldResLabel).join(newResLabel);

fs.writeFileSync('public/app.js', c, 'utf8');
console.log('DONE');
