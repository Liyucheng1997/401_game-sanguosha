// 由 assets/voice/manifest.json 生成 js/voicedata.js（可用配音及时长），供游戏判断有哪些台词
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const man = JSON.parse(fs.readFileSync(path.join(root, 'assets/voice/manifest.json'), 'utf8'));
const clips = {};
for (const [id, v] of Object.entries(man)) if (fs.existsSync(path.join(root, 'assets/voice', id + '.mp3'))) clips[id] = v.dur;
fs.writeFileSync(path.join(root, 'js/voicedata.js'), `// 自动生成：node tools/build_voice_index.js\n(globalThis.SGS = globalThis.SGS || {}).VOICE_CLIPS = ${JSON.stringify(clips)};\n`);
console.log('配音条数', Object.keys(clips).length);
