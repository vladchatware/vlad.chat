import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const fixtureDir = join(root, 'assets/native-fixture-recording-ipad');
const sourceVideo = join(fixtureDir, 'native-fixture-screen-recording-ipad.mp4');
const resultFrame = join(fixtureDir, 'completed-profile-task-ipad.png');
const background = join(root, 'assets/native-fixture-recording/preview-background.png');
const audio = join(root, 'assets/audio-review/vlad-audio-animatic-recorded-v02.m4a');
const output = join(root, 'assets/vlad-app-preview-native-fixture-captioned-ipad-v01.mp4');
const tempDir = await mkdtemp(join(tmpdir(), 'vlad-ipad-preview-'));
const master = join(tempDir, 'master.mp4');
const cards = join(root, 'assets/store-cards-appstore-ipad-v01');
const tempCaptions = join(tempDir, 'captions');
const ffmpegPath = 'ffmpeg';
const font = '/System/Library/Fonts/Supplemental/Arial.ttf';
const width = 2064;
const height = 2752;
const screenWidth = 1664;
const screenHeight = 2218;
const fps = 30;

for (const input of [sourceVideo, resultFrame, background, audio, font]) {
  await access(input);
}

await rm(cards, { recursive: true, force: true });
await mkdir(cards, { recursive: true });
await mkdir(tempCaptions, { recursive: true });

const captionScenes = [
  { file: '01-start-with-a-message.txt', start: 0, end: 2.4, text: 'Start with a message.' },
  { file: '02-point-of-view.txt', start: 2.4, end: 10.96, text: 'A point of view,\ncarried into an agent.' },
  { file: '03-computer-task.txt', start: 12.76, end: 17.1, text: 'Give me a task.\nI open the tools I need.' },
  { file: '04-hand-control.txt', start: 17.1, end: 20.72, text: 'When you need to step in,\nI hand control back.' },
  { file: '05-result-in-chat.txt', start: 20.72, end: 25.18, text: 'Then I bring the\nresult to chat.' },
  { file: '06-think-with-vlad.txt', start: 25.18, end: 26.84, text: 'Think with Vlad.' },
  { file: '07-take-action.txt', start: 28.82, end: 30, text: 'Take action.' }
];

for (const scene of captionScenes) {
  await writeFile(join(tempCaptions, scene.file), scene.text);
}

const toScreen = input => `${input}scale=${screenWidth}:${screenHeight}:force_original_aspect_ratio=decrease,pad=${screenWidth}:${screenHeight}:(ow-iw)/2:(oh-ih)/2:color=0x07191f,setsar=1,fps=${fps}`;
const filters = [
  `[0:v]trim=start=15:end=25.96,setpts=PTS-STARTPTS,${toScreen('')}[chat]`,
  `[0:v]trim=start=30.8:end=36.94,setpts=PTS-STARTPTS,${toScreen('')}[computer]`,
  `[0:v]trim=start=53.6:end=57.22,setpts=PTS-STARTPTS,${toScreen('')}[handoff]`,
  `[1:v]trim=duration=10.62,setpts=PTS-STARTPTS,${toScreen('')}[result]`,
  '[chat][computer][handoff][result]concat=n=4:v=1:a=0[screen]',
  `[2:v]delogo=x=50:y=82:w=350:h=47:show=0,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-ow)/2:180,setsar=1[bg]`,
  `[bg][screen]overlay=x=200:y=480:shortest=1[base]`,
  `[base]drawbox=x=200:y=194:w=90:h=7:color=0x78d6c7:t=fill,drawtext=fontfile=${font}:text='VLAD  /  PERSONAL AI AGENT':x=200:y=120:fontsize=42:fontcolor=0xa9d8d0[branded]`
];

let chain = '[branded]';
for (let index = 0; index < captionScenes.length; index++) {
  const scene = captionScenes[index];
  const next = index === captionScenes.length - 1 ? '[vout]' : `[title${index}]`;
  const textFile = join(tempCaptions, scene.file);
  filters.push(`${chain}drawtext=fontfile=${font}:textfile=${textFile}:x=200:y=260:fontsize=92:line_spacing=18:fontcolor=0xf4f6f4:alpha='min(1,max(0,min((t-${scene.start})*4,(${scene.end}-t)*4)))':enable='between(t,${scene.start},${scene.end})'${next}`);
  chain = next;
}

const encode = spawn(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-y', '-i', sourceVideo,
  '-loop', '1', '-framerate', String(fps), '-i', resultFrame,
  '-loop', '1', '-framerate', String(fps), '-i', background,
  '-i', audio,
  '-filter_complex', filters.join(';'),
  '-map', '[vout]', '-map', '3:a:0', '-t', '30',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-profile:v', 'high', '-level:v', '5.1',
  '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'copy', '-movflags', '+faststart',
  '-metadata', 'title=Vlad — iPad native fixture App Preview layout V01',
  '-metadata', 'comment=Native iPad fixture recording with matching portrait background and caption-led card design', master
], { stdio: 'inherit' });

const [exitCode] = await once(encode, 'exit');
if (exitCode !== 0) throw new Error(`ffmpeg exited with status ${exitCode}.`);

const stills = [
  ['01-start-with-a-message.png', '1.2'],
  ['02-point-of-view.png', '6.0'],
  ['03-computer-task.png', '14.1'],
  ['04-hand-control.png', '18.9'],
  ['05-result-in-chat.png', '22.9'],
  ['06-think-with-vlad.png', '25.8'],
  ['07-take-action.png', '29.4']
];

for (const [filename, timestamp] of stills) {
  const exportFrame = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', timestamp, '-i', master,
    '-frames:v', '1', '-q:v', '1', join(cards, filename)
  ], { stdio: 'inherit' });
  const [code] = await once(exportFrame, 'exit');
  if (code !== 0) throw new Error(`Could not export ${filename}.`);
}

const compatiblePreview = spawn(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-y', '-i', master,
  '-vf', 'scale=1200:1600:flags=lanczos,setsar=1',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-level:v', '4.0',
  '-pix_fmt', 'yuv420p', '-r', String(fps), '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart',
  '-metadata', 'title=Vlad — iPad App Preview V01', output
], { stdio: 'inherit' });
const [previewExitCode] = await once(compatiblePreview, 'exit');
if (previewExitCode !== 0) throw new Error(`iPad App Preview transcode exited with status ${previewExitCode}.`);
await rm(master, { force: true });
await rm(tempDir, { recursive: true, force: true });

console.log(`Wrote ${output}`);
console.log(`Wrote ${stills.length} 2064×2752 text-plus-native-screen cards to ${cards}`);
console.log(`Wrote 1200×1600 H.264 High Level 4.0 iPad App Preview to ${output}`);
