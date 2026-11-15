import {chromium} from '@playwright/test';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = spawn(process.execPath, [join(root, 'scripts', 'static-server.mjs')], {
 cwd: root,
 stdio: ['ignore', 'pipe', 'pipe']
});
await new Promise(resolve => setTimeout(resolve, 1200));

const mock = `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`;

const viewports = [
 {name: 'small-phone', width: 360, height: 800},
 {name: 'standard-phone', width: 390, height: 844},
 {name: 'large-phone', width: 430, height: 932},
 {name: 'tablet', width: 768, height: 1024},
 {name: 'desktop', width: 1440, height: 900}
];

const browser = await chromium.launch();
const results = [];
try {
 for (const vp of viewports) {
  const page = await browser.newPage({viewport: {width: vp.width, height: vp.height}});
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: mock}));
  await page.route(/supabase\.co/, route => route.abort());
  await page.route(/open-meteo\.com/, route => route.abort());
  await page.goto('http://127.0.0.1:4173/', {waitUntil: 'domcontentloaded'});
  await page.evaluate(() => {
   document.querySelector('#app')?.classList.remove('hidden');
   document.querySelector('#login')?.classList.add('hidden');
  });
  const stats = await page.evaluate(() => {
   const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
   const kpi = document.querySelector('.kpi-strip.nexus-kpi');
   const nav = document.querySelector('.bottom-nav');
   const kpiBox = kpi?.getBoundingClientRect();
   const navBox = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
   return {
    overflow,
    kpiInFirstScreen: kpiBox ? kpiBox.top < window.innerHeight : false,
    kpiTop: kpiBox ? Math.round(kpiBox.top) : null,
    navVisible: Boolean(navBox),
    navTop: navBox ? Math.round(navBox.top) : null
   };
  });
  results.push({...vp, ...stats, ok: stats.overflow <= 1});
  await page.close();
 }
} finally {
 await browser.close();
 server.kill();
}

console.log(JSON.stringify(results, null, 2));
if (results.some(item => !item.ok)) process.exit(1);
