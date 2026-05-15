const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, 'public', 'icons', 'icon.svg');
const svg = fs.readFileSync(svgPath, 'utf8');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

for (const size of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  const png = resvg.render();
  const buffer = png.asPng();
  const outPath = path.join(__dirname, 'public', 'icons', `icon-${size}.png`);
  fs.writeFileSync(outPath, buffer);
  console.log(`Generated icon-${size}.png (${buffer.length} bytes)`);
}

console.log('All icons generated.');
