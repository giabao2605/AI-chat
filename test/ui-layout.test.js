import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const layout = await readFile(new URL('../public/layout-v2.css', import.meta.url), 'utf8');
const visual = await readFile(new URL('../public/ui-v3.css', import.meta.url), 'utf8');
const sidebar = await readFile(new URL('../public/sidebar-v3.css', import.meta.url), 'utf8');
const chatV4 = await readFile(new URL('../public/chat-v4.css', import.meta.url), 'utf8');

test('header branding is removed and status/history live inside Control Room', () => {
  assert.doesNotMatch(index, /AI CONVERSATION LAB/);
  assert.doesNotMatch(index, /class="topbar"/);

  const controlStart = index.indexOf('<aside id="controlPanel"');
  const controlEnd = index.indexOf('</aside>', controlStart);
  const controlMarkup = index.slice(controlStart, controlEnd);

  assert.match(controlMarkup, /id="connectionText"/);
  assert.match(controlMarkup, /id="roomStatus"/);
  assert.match(controlMarkup, /id="historyBtn"/);
  assert.match(controlMarkup, /id="agentATotal"/);
  assert.match(controlMarkup, /id="agentBTotal"/);
  assert.match(controlMarkup, /id="combinedTotal"/);
});

test('desktop workspace fills the viewport without a header row', () => {
  assert.match(layout, /\.app-shell\s*\{[^}]*height:\s*100dvh/s);
  assert.match(layout, /\.workspace\s*\{[^}]*height:\s*100%/s);
  assert.match(layout, /\.chat-panel\s*\{[^}]*height:\s*100%/s);
});

test('sidebar v3 groups dense controls into a compact hierarchy', () => {
  assert.match(index, /href="\/sidebar-v3\.css"/);
  assert.match(index, /class="section-kicker">Thiết lập nhanh</);
  assert.match(index, /id="tokenPanel" class="sidebar-fold token-fold"/);
  assert.match(index, /id="orchestrationPanel" class="sidebar-fold"/);
  assert.match(index, /id="promptPanel" class="sidebar-fold prompt-fold"/);
  assert.match(index, /class="control-scroll"/);
  assert.match(index, /class="control-footer"/);
  assert.match(sidebar, /\.control-panel\s*\{[^}]*display:\s*flex/s);
  assert.match(sidebar, /\.control-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(sidebar, /\.sidebar-fold\s*>\s*summary/);
  assert.match(sidebar, /\.control-footer\s*\{[^}]*flex:\s*0 0 auto/s);
});

test('visual polish stylesheet is still present', () => {
  assert.match(index, /href="\/ui-v3\.css"/);
  assert.match(visual, /\.message\.a \.bubble,[\s\S]*\.message\.b \.bubble[\s\S]*background:\s*transparent/);
  assert.match(visual, /\.message\.user \.bubble[\s\S]*background:/);
  assert.match(visual, /\.control-monitor[\s\S]*border:\s*0/);
});

test('chat v4 uses Apple system typography and keeps both AI lanes on the left', () => {
  assert.match(index, /href="\/chat-v4\.css"/);
  assert.match(chatV4, /font-family:\s*-apple-system,\s*BlinkMacSystemFont/);
  assert.match(chatV4, /\.message\.a,\s*\n\.message\.b\s*\{[\s\S]*margin-left:\s*0;[\s\S]*margin-right:\s*auto;/);
  assert.doesNotMatch(chatV4, /flex-direction:\s*row-reverse/);
  assert.match(chatV4, /\.message\.b \.message-body\s*\{[\s\S]*border-left:\s*2px solid rgba\(178, 140, 255, \.22\)/);
  assert.match(chatV4, /\.message\.a \.message-body,[\s\S]*\.message\.b \.message-body[\s\S]*width:\s*min\(78%,\s*980px\)/);
  assert.match(chatV4, /\.message\.a \.bubble,[\s\S]*\.message\.b \.bubble[\s\S]*font-size:\s*15\.75px/);
  assert.match(chatV4, /@media \(min-width:\s*1500px\)[\s\S]*font-size:\s*16px/);
});
