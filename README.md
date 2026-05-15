#!/usr/bin/env node
// Run: node generate-icons.js
// Generates icon-192.png and icon-512.png
const { createCanvas } = require('canvas');
const fs = require('fs');

function makeIcon(size, path) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0e0e0f';
  ctx.fillRect(0, 0, size, size);
  const fontSize = Math.floor(size * 0.38);
  ctx.font = `800 ${fontSize}px sans-serif`;
  ctx.fillStyle = '#c8f060';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('F', size / 2, size / 2);
  fs.writeFileSync(path, canvas.toBuffer('image/png'));
}
makeIcon(192, 'public/icon-192.png');
makeIcon(512, 'public/icon-512.png');
console.log('Icons generated');
