// Проверка контраста пар «текст — фон» по WCAG 2.x.
// Запуск: node docs/design/contrast-check.mjs docs/design/tokens.css docs/design/D-2.2-system.md
// Аргументы: путь к tokens.css и путь к документу с таблицей пар (раздел 2.2). Без аргументов скрипт не работает.
if (process.argv.length < 4) {
  console.error('Использование: node docs/design/contrast-check.mjs <tokens.css> <D-2.2-system.md>')
  process.exit(2)
}
import fs from 'node:fs'
const css = fs.readFileSync(process.argv[2], 'utf8')
const doc = fs.readFileSync(process.argv[3], 'utf8')
function block(re){ const m = re.exec(css); return m[1] }
const rootB = block(/:root \{([\s\S]*?)\n\}/), darkB = block(/\n\.dark \{([\s\S]*?)\n\}/)
function parse(b){ const o={}; for(const m of b.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)) o[m[1]]=m[2].trim(); return o }
const root = parse(rootB); const dark = { ...root, ...parse(darkB) }
function res(t, name, seen=0){ let v=t[name]; if(v===undefined) throw new Error('нет '+name); const m=/^var\(--([a-z0-9-]+)\)$/.exec(v); return m? res(t,m[1]):v }
function lum(h){ const n=parseInt(h.slice(1),16); const c=[n>>16,(n>>8)&255,n&255].map(x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4}); return .2126*c[0]+.7152*c[1]+.0722*c[2] }
const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
const rows=[]
for(const line of doc.split('\n')){
  if(!line.startsWith('| ')||!line.includes('Н3.')&&!line.includes('Н9.5')) continue
  const c=line.split('|').map(s=>s.trim())
  const fg=/`([a-z0-9-]+)`/.exec(c[1]); const bg=/`([a-z0-9-]+)`/.exec(c[2]); const th=parseFloat(c[5])
  if(!fg||!bg||!(th>0)) continue
  rows.push({label:c[1],fg:fg[1],bg:bg[1],th})
}
const extra=[
 {label:'Граница поля на фоне / карточке: border-strong',fg:'border-strong',bg:'bg',th:3.1},
 {label:'Граница: border-strong на card',fg:'border-strong',bg:'card',th:3.1},
 {label:'Заголовок и текст на шапке (header-bg)',fg:'text',bg:'header-bg',th:4.6},
 {label:'Текст на активном пункте (text на nav-active-bg)',fg:'text',bg:'nav-active-bg',th:4.6},
 {label:'Приглушённый на nav-active-bg',fg:'muted',bg:'nav-active-bg',th:4.6},
 {label:'Ссылка primary на hero-bg',fg:'primary',bg:'hero-bg',th:4.6},
]
let bad=0, out=[]
for(const r of [...rows,...extra]){
  const l=cr(res(root,r.fg),res(root,r.bg)), d=cr(res(dark,r.fg),res(dark,r.bg))
  const flag=(l<r.th||d<r.th)?' <<< НИЖЕ':''
  if(flag) bad++
  out.push(`${r.fg} / ${r.bg}\t${l.toFixed(2)}\t${d.toFixed(2)}\t${r.th}${flag}\t${r.label}`)
}
console.log(out.join('\n')); console.log('\nпар:',rows.length+extra.length,'ниже порога:',bad)
