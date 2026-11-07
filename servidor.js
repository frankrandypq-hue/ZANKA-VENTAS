'use strict';
// Servidor ZANKA: sirve la página y guarda los datos compartidos. Sin dependencias (solo Node.js).
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const PORT=+process.env.PORT||3000;
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'datos');
const FILE=path.join(DATA_DIR,'zanka-datos.json'),HTML=path.join(__dirname,'emisor-de-boletas.html');
const KEYS=['boletas','clientes','telefonos','gastos','kardex','abiertos','catalogo','secciones','usuarios','authrec','nmesas','negocio','asistencia','asisconf'];
fs.mkdirSync(DATA_DIR,{recursive:true});

// Clave de acceso de los equipos (se muestra al iniciar; se guarda en datos/clave.txt)
const CF=path.join(DATA_DIR,'clave.txt');
let CLAVE=(process.env.ZANKA_CLAVE||'').trim();
if(!CLAVE){try{CLAVE=fs.readFileSync(CF,'utf8').trim()}catch(e){}}
if(!CLAVE){const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';CLAVE=Array.from(crypto.randomBytes(8),b=>a[b%a.length]).join('');fs.writeFileSync(CF,CLAVE)}
const dig=s=>crypto.createHash('sha256').update(String(s)).digest();
const claveOk=s=>crypto.timingSafeEqual(dig(s),dig(CLAVE));

// Datos en memoria + archivo (escritura atómica y copia diaria)
let db={seq:0,keys:{}};
try{db=JSON.parse(fs.readFileSync(FILE,'utf8'))}catch(e){}
let pend=null;
function guarda(){
  if(pend)return;
  pend=setTimeout(()=>{
    pend=null;
    try{
      const tmp=FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db));fs.renameSync(tmp,FILE);
      const dir=path.join(DATA_DIR,'copias');fs.mkdirSync(dir,{recursive:true});
      const f=path.join(dir,'datos-'+new Date().toISOString().slice(0,10)+'.json');
      if(!fs.existsSync(f))fs.copyFileSync(FILE,f);
      const l=fs.readdirSync(dir).sort();while(l.length>30)fs.unlinkSync(path.join(dir,l.shift()));
    }catch(e){console.error('No se pudo guardar:',e.message)}
  },300);
}

// Límite de intentos con clave incorrecta
const malos=new Map();
function bloqueado(ip){const r=malos.get(ip);return !!r&&r.n>=10&&Date.now()-r.t<60000}
function falla(ip){const r=malos.get(ip);if(!r||Date.now()-r.t>60000)malos.set(ip,{n:1,t:Date.now()});else{r.n++;r.t=Date.now()}}

function cuerpo(req,max){return new Promise((ok,no)=>{let n=0;const b=[];req.on('data',c=>{n+=c.length;if(n>max){no(new Error('grande'));req.destroy()}else b.push(c)});req.on('end',()=>ok(Buffer.concat(b).toString('utf8')));req.on('error',no)})}

http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x'),ip=req.socket.remoteAddress;
  const send=(c,o)=>{res.writeHead(c,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(o))};
  try{
    if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/index.html')){
      fs.readFile(HTML,(e,b)=>{if(e){res.writeHead(500);return res.end('Falta emisor-de-boletas.html junto a server.js')}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});res.end(b)});
      return;
    }
    if(!u.pathname.startsWith('/api/')){res.writeHead(404);return res.end()}
    if(u.pathname==='/api/ping')return send(200,{ok:true,zanka:true});
    if(bloqueado(ip))return send(429,{error:'Demasiados intentos'});
    if(!claveOk(req.headers['x-clave']||'')){falla(ip);return send(401,{error:'Clave incorrecta'})}
    if(req.method==='GET'&&u.pathname==='/api/state'){
      const since=+u.searchParams.get('since')||0,out={};
      for(const k in db.keys)if(db.keys[k].seq>since)out[k]={v:db.keys[k].v,data:db.keys[k].data};
      return send(200,{seq:db.seq,keys:out});
    }
    if(req.method==='POST'&&u.pathname==='/api/dev'){db.dev=(db.dev||0)+1;guarda();return send(200,{n:db.dev})}   // número de equipo (serie propia por equipo)
    const m=u.pathname.match(/^\/api\/key\/([a-z]+)$/);
    if(req.method==='PUT'&&m&&KEYS.includes(m[1])){
      const k=m[1],b=JSON.parse(await cuerpo(req,60*1024*1024)),cur=db.keys[k];
      if(cur&&b.base!==cur.v)return send(409,{v:cur.v,data:cur.data});
      db.keys[k]={v:(cur?cur.v:0)+1,seq:++db.seq,data:b.data};guarda();
      return send(200,{v:db.keys[k].v,seq:db.seq});
    }
    send(404,{error:'No existe'});
  }catch(e){send(400,{error:'Solicitud no válida'})}
}).listen(PORT,'0.0.0.0',()=>{
  console.log('\n=== Servidor ZANKA en marcha ===');
  console.log('Clave de acceso para los equipos:  '+CLAVE+'\n');
  console.log('Abre en ESTE equipo:   http://localhost:'+PORT);
  Object.values(os.networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).forEach(i=>console.log('Abre en otros equipos: http://'+i.address+':'+PORT+'   (misma red WiFi)'));
  console.log('\nDatos guardados en: '+DATA_DIR+'\nNo cierres esta ventana mientras el negocio esté abierto.\n');
});
