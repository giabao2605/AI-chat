import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const layout = await readFile(new URL('../public/layout-v2.css', import.meta.url), 'utf8');
const visual = await readFile(new URL('../public/ui-v3.css', import.meta.url), 'utf8');
const sidebar = await readFile(new URL('../public/sidebar-v3.css', import.meta.url), 'utf8');
const chatV4 = await readFile(new URL('../public/chat-v4.css', import.meta.url), 'utf8');
const roomSession = await readFile(new URL('../public/room-session.js', import.meta.url), 'utf8');
const headerToolbar = await readFile(new URL('../public/header-toolbar-layout.js', import.meta.url), 'utf8');
const headerToolbarCss = await readFile(new URL('../public/header-toolbar-layout.css', import.meta.url), 'utf8');

test('header branding is removed and session controls remain singletons', () => {
  assert.doesNotMatch(index, /AI CONVERSATION LAB/);
  assert.doesNotMatch(index, /class="topbar"/);

  assert.equal((index.match(/id="connectionText"/g) || []).length, 1);
  assert.equal((index.match(/id="roomStatus"/g) || []).length, 1);
  assert.equal((index.match(/id="historyBtn"/g) || []).length, 1);
  assert.match(index, /id="agentATotal"/);
  assert.match(index, /id="agentBTotal"/);
  assert.match(index, /id="combinedTotal"/);
});

test('realtime and history move to chat header while memory/private stay in sidebar tools', () => {
  assert.match(roomSession, /import '\.\/header-toolbar-layout\.js';/);
  assert.match(headerToolbar, /status\.classList\.add\('toolbar-session-status'\)/);
  assert.match(headerToolbar, /toolbar\.append\(status\)/);
  assert.match(headerToolbar, /history\.classList\.add\('toolbar-history-button'\)/);
  assert.match(headerToolbar, /toolbar\.append\(history\)/);
  assert.match(headerToolbar, /\['memoryInspectorBtn', 'privateContextInspectorBtn'\]/);
  assert.match(headerToolbar, /actions\.append\(button\)/);
  assert.match(headerToolbarCss, /\.toolbar-session-status\s*\{[^}]*order:\s*10/s);
  assert.match(headerToolbarCss, /\.toolbar-history-button\s*\{[^}]*order:\s*20/s);
  assert.match(headerToolbarCss, /#openLabInspector\s*\{[^}]*order:\s*30/s);
  assert.match(headerToolbarCss, /#pauseBtn\s*\{[^}]*order:\s*40/s);
  assert.match(headerToolbarCss, /#stopBtn\s*\{[^}]*order:\s*50/s);
  assert.match(headerToolbarCss, /\.sidebar-tool-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
});

test('desktop workspace fills the viewport without a header row', () => {
  assert.match(layout, /\.app-shell\s*\{[^}]*height:\s*100dvh/s);
  assert.match(layout, /\.workspace\s*\{[^}]*height:\s*100%/s);
  assert.match(layout, /\.chat-panel\s*\{[^}]*height:\s*100%/s);
});

test('collapsed sidebar reopen control is a compact arrow tab', () => {
  assert.match(index, /id="expandControlBtn"[\s\S]*<span>›<\/span>/);
  assert.match(layout, /\.expand-control-button\s*\{[^}]*width:\s*30px;[^}]*height:\s*54px;/s);
  assert.match(layout, /\.expand-control-button\s*\{[^}]*font-size:\s*0;/s);
  assert.match(layout, /\.expand-control-button span\s*\{[^}]*font-size:\s*20px;/s);
  assert.match(layout, /border-left:\s*0;/);
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
